/* ============ 客戶簽署頁 ============ */
const params = new URLSearchParams(location.search);
const CID = params.get("c") || "";
const PREVIEW = params.get("preview") === "1";
let C = null, origPdf = null, signedBytes = null;

function show(view){
  ["viewMsg", "viewClient"].forEach(v => $(v).hidden = v !== view);
  $("bar").hidden = view !== "viewClient";
  document.body.classList.toggle("signing", view === "viewClient");
}
function message(t, s){ $("msgTitle").textContent = t; $("msgText").textContent = s || ""; show("viewMsg"); }
function setStep(s){
  const order = ["read", "agree", "sign", "done"], i = order.indexOf(s);
  document.querySelectorAll("#steps li").forEach(li => { const j = order.indexOf(li.dataset.s); li.className = j < i ? "done" : j === i ? "on" : ""; });
}

async function boot(){
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(CID)) return message("請使用事務所提供的連結開啟", "每份文件都有自己的專屬連結。");
  message("文件載入中…");
  try {
    const r = await fetch(`/api/c?c=${encodeURIComponent(CID)}`);
    if (r.status === 404) return message("這份文件已不存在", "連結可能已被事務所移除，請向事務所索取新的連結。");
    if (!r.ok) throw new Error(r.status);
    const meta = await r.json();
    const p = await fetch(`/api/c?c=${encodeURIComponent(CID)}&f=pdf`);
    if (!p.ok) throw new Error(p.status);
    C = { ...meta, pdfBytes: new Uint8Array(await p.arrayBuffer()) };
  } catch (e) { console.error(e); return message("文件載入失敗", "請檢查網路連線後重新整理頁面。"); }

  C.questions = C.questions || [];
  if (C.date && C.date.page == null) C.date.page = C.sig.page;
  document.title = `${C.title}｜線上簽署`;
  $("firm").textContent = C.firm || "";
  $("docTitle").textContent = C.title;
  $("previewBar").hidden = !PREVIEW;
  renderQuestions();
  show("viewClient");
  if (C.signedAt && !PREVIEW && await showSignedView()) return;
  $("pages").innerHTML = '<div class="loading">文件載入中…</div>';
  try {
    const r = await renderPages(C.pdfBytes, true);
    origPdf = r.doc;
    $("hint").textContent = C.questions.length
      ? `請往下閱讀全部內容，並回答文件下方的勾選題目。第 ${C.sig.page + 1} 頁有紅框簽名處。`
      : `請往下閱讀全部內容，第 ${C.sig.page + 1} 頁有紅框簽名處。`;
    setStep("read");
  } catch (e) { console.error(e); $("pages").innerHTML = '<div class="loading">文件無法顯示，請重新整理頁面。</div>'; }
}

const zhDateTime = d => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const signedUrl = () => `/api/c?c=${encodeURIComponent(CID)}&f=signed&t=${encodeURIComponent(C.signedAt || "")}`;
function setBanner(){
  $("signedBanner").hidden = !C.signedAt;
  if (C.signedAt) $("signedBanner").textContent = `✓ ${zhDateTime(new Date(C.signedAt))} 已簽署，回傳事務所完成`;
}

/* 已經簽過的人再打開連結：直接顯示簽好的那份、簽署時間，可下載；需要時可重新簽署 */
async function showSignedView(){
  try {
    const r = await fetch(signedUrl());
    if (!r.ok) return false;
    signedBytes = new Uint8Array(await r.arrayBuffer());
    await renderPages(signedBytes, false);
  } catch (e) { console.error(e); return false; }
  setBanner();
  $("hint").textContent = C.canResign && C.lockAt
    ? `以下是你簽好的文件。如需修改，可在 ${zhDateTime(new Date(C.lockAt))} 前按「重新簽署」。`
    : "以下是你簽好的文件。";
  $("qSection").hidden = true;
  $("barSign").hidden = true; $("barDone").hidden = false;
  $("done").hidden = true;
  setStep("done");
  return true;
}

/* ---------- 提示視窗（取代瀏覽器的 alert） ---------- */
function notice(title, text){
  $("noticeTitle").textContent = title; $("noticeText").textContent = text || "";
  $("noticeScrim").hidden = false; $("noticeOk").focus();
}
$("noticeOk").onclick = () => { $("noticeScrim").hidden = true; };
const ARCHIVED = ["合約已歸檔", "合約已歸檔，如欲變更，請通知管理人員。"];

/* ---------- 回傳已簽署PDF：打開手機分享畫面（可選 LINE 傳給事務所） ---------- */
const canShareFiles = (() => {
  try { return !!(navigator.canShare && navigator.canShare({ files: [new File([new Uint8Array(8)], "a.pdf", { type: "application/pdf" })] })); }
  catch { return false; }
})();
function sharePdf(){
  // 必須在使用者按下的當下呼叫，手機才會打開分享畫面
  return navigator.share({ files: [new File([signedBytes], fileName(), { type: "application/pdf" })], title: C.title });
}
async function sharePdfNow(){
  if (!canShareFiles){
    notice("這個瀏覽器無法直接分享檔案", "請點右上角「⋯」→「用預設瀏覽器開啟」（或用 Safari／Chrome 打開這個連結），再按一次「回傳已簽署PDF」。");
    return;
  }
  try { await sharePdf(); }
  catch (e) { if (e && e.name !== "AbortError") toast("無法分享，請再試一次"); }
}
$("btnShare").onclick = () => { if (signedBytes) sharePdfNow(); };

async function renderPages(bytes, interactive){
  const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  const box = $("pages"); box.innerHTML = "";
  const cssW = Math.min(box.clientWidth || 360, 720);
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const canvases = [];
  for (let n = 1; n <= doc.numPages; n++){
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = cssW / base.width;
    const vp = page.getViewport({ scale: scale * dpr });
    const wrap = document.createElement("div"); wrap.className = "page";
    const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
    wrap.append(c); box.append(wrap); canvases.push(c);
    await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    if (interactive && n - 1 === C.sig.page){
      const { x, y, w, h } = C.sig;
      const spot = document.createElement("div"); spot.className = "sigspot"; spot.id = "sigspot";
      Object.assign(spot.style, { left: x * scale + "px", top: y * scale + "px", width: w * scale + "px", height: h * scale + "px" });
      spot.textContent = "點這裡簽名"; spot.setAttribute("role", "button"); spot.tabIndex = 0;
      spot.onclick = trySign;
      if (!$("agree").checked) spot.dataset.off = "";
      wrap.append(spot);
    }
  }
  return { doc, canvases };
}

$("agree").addEventListener("change", e => {
  $("btnSign").disabled = !e.target.checked;
  const s = $("sigspot"); if (s) { if (e.target.checked) delete s.dataset.off; else s.dataset.off = ""; }
  setStep(e.target.checked ? "sign" : "agree");
});
window.addEventListener("scroll", () => { if (C && !$("agree").checked && !signedBytes && window.scrollY > 200) setStep("agree"); }, { passive: true });
$("btnSign").onclick = trySign;

/* ---------- 勾選題目 ---------- */
function renderQuestions(){
  const qs = C.questions, box = $("qList"); box.innerHTML = "";
  $("qSection").hidden = !qs.length;
  qs.forEach((q, i) => {
    const fs = document.createElement("fieldset"); fs.className = "q"; fs.id = "q" + i;
    const lg = document.createElement("legend"); lg.append(`${i + 1}. ${q.q}`);
    const t1 = document.createElement("span"); t1.className = "tag " + (q.required ? "req" : "nreq"); t1.textContent = q.required ? "必填" : "選填"; lg.append(t1);
    if (q.multi){ const t2 = document.createElement("span"); t2.className = "tag nreq"; t2.textContent = "可複選"; lg.append(t2); }
    fs.append(lg);
    q.options.forEach((o, j) => {
      const lab = document.createElement("label"); lab.className = "opt-row"; lab.htmlFor = `q${i}o${j}`;
      const inp = document.createElement("input"); inp.type = q.multi ? "checkbox" : "radio"; inp.name = "q" + i; inp.id = `q${i}o${j}`;
      inp.onchange = () => fs.classList.remove("missing");
      const sp = document.createElement("span"); sp.textContent = o.t;
      lab.append(inp, sp); fs.append(lab);
    });
    box.append(fs);
  });
}
const answers = () => C.questions.map((q, i) => q.options.map((o, j) => $(`q${i}o${j}`).checked ? j : -1).filter(j => j >= 0));
const lockQuestions = b => document.querySelectorAll("#qList fieldset").forEach(f => f.disabled = b);
function trySign(){
  const ans = answers();
  const miss = C.questions.findIndex((q, i) => q.required && !ans[i].length);
  if (miss >= 0){
    $("q" + miss).classList.add("missing");
    $("q" + miss).scrollIntoView({ block: "center", behavior: reduceMotion() ? "auto" : "smooth" });
    toast(`請先回答第 ${miss + 1} 題`); return;
  }
  if (!$("agree").checked){ $("agree").focus(); toast("請先勾選「我已閱讀並同意」"); return; }
  openPad();
}

/* ---------- 簽名板 ---------- */
const pad = $("pad"), pctx = pad.getContext("2d");
let strokes = [], cur = null;
function sizePad(){
  const box = $("padbox"), w = box.clientWidth;
  const h = Math.max(120, Math.min(w / (C.sig.w / C.sig.h), window.innerHeight * 0.5));
  box.style.height = h + "px";
  const dpr = window.devicePixelRatio || 1;
  pad.width = w * dpr; pad.height = h * dpr; pctx.setTransform(dpr, 0, 0, dpr, 0, 0); redraw();
}
function drawStroke(ctx, s){
  ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#111a2e";
  if (s.length === 1){ ctx.beginPath(); ctx.arc(s[0].x, s[0].y, s[0].w / 2, 0, Math.PI * 2); ctx.fillStyle = "#111a2e"; ctx.fill(); return; }
  for (let i = 1; i < s.length; i++){ const a = s[i - 1], b = s[i]; ctx.lineWidth = b.w; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
}
function redraw(){ pctx.clearRect(0, 0, pad.width, pad.height); strokes.forEach(s => drawStroke(pctx, s)); $("padOk").disabled = strokes.length === 0; }
function pt(e){
  const r = pad.getBoundingClientRect(), base = Math.max(2, r.width / 140);
  const p = { x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp };
  if (cur && cur.length){ const l = cur[cur.length - 1]; const v = Math.hypot(p.x - l.x, p.y - l.y) / Math.max(1, p.t - l.t); const target = Math.max(base * 0.55, Math.min(base * 1.5, base * 1.5 - v * base * 0.6)); p.w = l.w + (target - l.w) * 0.35; }
  else p.w = base * 1.2;
  return p;
}
pad.addEventListener("pointerdown", e => { e.preventDefault(); pad.setPointerCapture(e.pointerId); cur = [pt(e)]; strokes.push(cur); redraw(); });
pad.addEventListener("pointermove", e => { if (!cur) return; e.preventDefault(); const p = pt(e), l = cur[cur.length - 1]; if (Math.hypot(p.x - l.x, p.y - l.y) < 1) return; cur.push(p); drawStroke(pctx, cur.slice(-2)); });
const endStroke = () => { cur = null; $("padOk").disabled = strokes.length === 0; };
pad.addEventListener("pointerup", endStroke); pad.addEventListener("pointercancel", endStroke);
$("padClear").onclick = () => { strokes = []; redraw(); };
$("padCancel").onclick = () => { $("scrim").hidden = true; };
window.addEventListener("resize", () => { if (!$("scrim").hidden) sizePad(); });
function openPad(){ $("scrim").hidden = false; sizePad(); }

function signaturePng(){
  const r = pad.getBoundingClientRect(), k = 3;
  const c = document.createElement("canvas"); c.width = r.width * k; c.height = r.height * k;
  const x = c.getContext("2d"); x.scale(k, k); strokes.forEach(s => drawStroke(x, s));
  const d = x.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
  for (let y = 0; y < c.height; y++) for (let xx = 0; xx < c.width; xx++) if (d[(y * c.width + xx) * 4 + 3] > 8){ if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const m = 6 * k; x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(c.width, x1 + m); y1 = Math.min(c.height, y1 + m);
  const o = document.createElement("canvas"); o.width = x1 - x0; o.height = y1 - y0;
  o.getContext("2d").drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return o.toDataURL("image/png");
}

/* 位置以「頁面正放、scale 1、左上為原點」的點數儲存，再由 pdf.js 換算成 PDF 座標（旋轉頁面也正確） */
async function stamp(pngDataUrl, now){
  const { PDFDocument, StandardFonts, rgb, degrees } = PDFLib;
  const doc = await PDFDocument.load(C.pdfBytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  const page = pages[C.sig.page];
  const jsPage = await origPdf.getPage(C.sig.page + 1);
  const vp = jsPage.getViewport({ scale: 1 });
  const rot = ((jsPage.rotate || 0) % 360 + 360) % 360;
  const img = await doc.embedPng(pngDataUrl);
  const { x, y, w, h } = C.sig, inset = 4;
  const s = Math.min((w - inset * 2) / img.width, (h - inset * 2) / img.height);
  const iw = img.width * s, ih = img.height * s;
  const [px, py] = vp.convertToPdfPoint(x + (w - iw) / 2, y + (h + ih) / 2);
  page.drawImage(img, { x: px, y: py, width: iw, height: ih, rotate: degrees(rot) });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  if (C.date && pages[C.date.page]){
    const dp = await origPdf.getPage(C.date.page + 1), dv = dp.getViewport({ scale: 1 });
    const drot = ((dp.rotate || 0) % 360 + 360) % 360;
    const [dx, dy] = dv.convertToPdfPoint(C.date.x, C.date.y);
    pages[C.date.page].drawText(fmtDate(now), { x: dx, y: dy, size: 11, font, color: rgb(.1, .12, .18), rotate: degrees(drot) });
  }
  const off = -now.getTimezoneOffset(), tz = `UTC${off >= 0 ? "+" : "-"}${pad2(Math.floor(Math.abs(off) / 60))}:${pad2(Math.abs(off) % 60)}`;
  const rec = `Agreed & e-signed ${fmtDate(now)} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())} (${tz})`;
  let ry = y + h + 9; if (ry > vp.height - 4) ry = y - 3;
  const [rx, rpy] = vp.convertToPdfPoint(x, ry);
  page.drawText(rec, { x: rx, y: rpy, size: 6.5, font, color: rgb(.45, .48, .52), rotate: degrees(rot) });

  const ans = answers();
  for (let i = 0; i < C.questions.length; i++){
    for (const j of ans[i]){
      const m = C.questions[i].options[j].mark; if (!m || !pages[m.page]) continue;
      const v = (await origPdf.getPage(m.page + 1)).getViewport({ scale: 1 });
      const pts = [[-5, 0], [-1.5, 4.5], [6, -6]].map(([a, b]) => v.convertToPdfPoint(m.x + a, m.y + b));
      for (let k = 1; k < pts.length; k++)
        pages[m.page].drawLine({ start: { x: pts[k - 1][0], y: pts[k - 1][1] }, end: { x: pts[k][0], y: pts[k][1] }, thickness: 1.8, color: rgb(.05, .1, .35) });
    }
  }
  if (C.questions.length && C.summary !== false){
    for (const png of await summaryPages(ans, pngDataUrl, now)){
      const im = await doc.embedPng(png);
      const p = doc.addPage([595.28, 841.89]);
      p.drawImage(im, { x: 0, y: 0, width: 595.28, height: 841.89 });
    }
  }
  doc.setModificationDate(now);
  return await doc.save();
}

/* 「勾選結果」頁用畫布排版成圖片（中文字不用另外嵌字型），A4 大小 */
async function summaryPages(ans, sigPng, now){
  try { await Promise.all([document.fonts.load('400 12px "Noto Sans TC"'), document.fonts.load('700 18px "Noto Sans TC"')]); } catch {}
  const S = 2.5, W = 595.28, H = 841.89, M = 56, INK = "#1c2430", MUTED = "#5e6b7a", LINE = "#d5dbe2";
  const F = (w, px) => `${w} ${px}px "Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif`;
  const out = []; let cv, x, y;
  const newPage = () => { cv = document.createElement("canvas"); cv.width = Math.round(W * S); cv.height = Math.round(H * S); x = cv.getContext("2d"); x.scale(S, S); x.fillStyle = "#fff"; x.fillRect(0, 0, W, H); x.textBaseline = "top"; y = M; out.push(cv); };
  const need = h => { if (y + h > H - M) newPage(); };
  const wrap = (text, font, maxW) => { x.font = font; const lines = []; for (const para of String(text).split("\n")){ let line = ""; for (const ch of para){ if (line && x.measureText(line + ch).width > maxW){ lines.push(line); line = ch; } else line += ch; } lines.push(line); } return lines; };
  newPage();
  x.fillStyle = INK; x.font = F(700, 18); x.fillText("勾選結果", M, y); y += 30;
  const off = -now.getTimezoneOffset();
  const when = `${fmtDate(now)} ${pad2(now.getHours())}:${pad2(now.getMinutes())}（UTC${off >= 0 ? "+" : "-"}${pad2(Math.floor(Math.abs(off) / 60))}:${pad2(Math.abs(off) % 60)}）`;
  x.font = F(400, 11); x.fillStyle = MUTED;
  for (const l of [`文件：${C.title}`, `客戶：${C.name}`, `簽署時間：${when}`]) for (const w of wrap(l, F(400, 11), W - 2 * M)){ x.fillText(w, M, y); y += 17; }
  y += 6; x.fillStyle = LINE; x.fillRect(M, y, W - 2 * M, 1); y += 18;
  C.questions.forEach((q, i) => {
    const qf = F(700, 12.5), ql = wrap(`${i + 1}. ${q.q}${q.multi ? "（可複選）" : ""}`, qf, W - 2 * M);
    need(ql.length * 19 + 26);
    x.fillStyle = INK; x.font = qf; for (const l of ql){ x.fillText(l, M, y); y += 19; }
    y += 4;
    q.options.forEach((o, j) => {
      const sel = ans[i].includes(j), of = F(sel ? 700 : 400, 12), ol = wrap(o.t, of, W - 2 * M - 26);
      need(ol.length * 18 + 4);
      x.strokeStyle = sel ? INK : "#9aa4b0"; x.lineWidth = 1; x.strokeRect(M + 4.5, y + 2.5, 11, 11);
      if (sel){ x.strokeStyle = INK; x.lineWidth = 1.8; x.beginPath(); x.moveTo(M + 6.5, y + 8); x.lineTo(M + 9.5, y + 11.5); x.lineTo(M + 15, y + 4); x.stroke(); }
      x.fillStyle = sel ? INK : MUTED; x.font = of; for (const l of ol){ x.fillText(l, M + 26, y); y += 18; }
      y += 3;
    });
    y += 12;
  });
  need(110);
  x.fillStyle = MUTED; x.font = F(400, 11); x.fillText("簽名：", M, y); y += 18;
  const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = sigPng; });
  const s = Math.min(180 / img.width, 70 / img.height);
  x.drawImage(img, M, y, img.width * s, img.height * s);
  return out.map(c => c.toDataURL("image/png"));
}

/* ---------- 簽完：自動傳回事務所 ---------- */
function setUp(state){
  const el = $("upStatus");
  const map = {
    sending: ["wait", "正在傳回事務所…"],
    ok: ["ok", "✓ 已自動傳回事務所，不需要再另外傳送。"],
    preview: ["wait", "預覽模式：這份簽名沒有傳回事務所。"],
    big: ["bad", "檔案太大，無法自動傳回。請按「回傳已簽署PDF」傳給事務所。"],
    locked: ["bad", "合約已歸檔，這次的簽名沒有送出。如欲變更，請通知管理人員。"],
    fail: ["bad", "傳回事務所失敗，請確認網路後按「重新傳送」。"],
  };
  const [cls, text] = map[state];
  el.className = "status " + cls; el.textContent = text;
  $("btnRetry").hidden = state !== "fail";
}
async function upload(){
  if (PREVIEW){ setUp("preview"); return; }
  setUp("sending");
  try {
    const r = await fetch(`/api/c?c=${encodeURIComponent(CID)}&f=signed`, { method: "POST", headers: { "content-type": "application/pdf" }, body: signedBytes });
    if (r.status === 413) return setUp("big");
    if (r.status === 423){
      // 已超過重簽期限：這次簽名不會送出，改回顯示已歸檔的那一份
      setUp("locked"); notice(...ARCHIVED);
      C.canResign = false;
      await showSignedView(); setBanner();
      return;
    }
    if (!r.ok) throw new Error(r.status);
    const res = await r.json();
    C.signedAt = res.signedAt; C.canResign = res.canResign; C.lockAt = res.lockAt;
    setUp("ok"); setStep("done"); setBanner();
    $("upStatus").textContent = `✓ ${zhDateTime(new Date(C.signedAt))} 已簽署，回傳事務所完成。`;
  } catch (e) { console.error(e); setUp("fail"); }
}
$("btnRetry").onclick = upload;

$("padOk").onclick = async () => {
  $("padOk").disabled = true; $("padOk").textContent = "處理中…";
  try {
    signedBytes = await stamp(signaturePng(), new Date());
    $("scrim").hidden = true;
    await renderPages(signedBytes, false);
    $("barSign").hidden = true; $("barDone").hidden = false; $("done").hidden = false;
    lockQuestions(true);
    $("hint").textContent = "簽名已放入文件。";
    $("done").scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth" });
    upload();
  } catch (e) { console.error(e); toast("簽名放入文件時出錯，請再試一次"); }
  finally { $("padOk").textContent = "確認簽名"; $("padOk").disabled = strokes.length === 0; }
};

/* 重新簽署：先向伺服器確認還在 1 小時內（或管理人員已開放），否則顯示已歸檔 */
$("btnRedo").onclick = async () => {
  if (!PREVIEW && C.signedAt){
    $("btnRedo").disabled = true;
    try {
      const r = await fetch(`/api/c?c=${encodeURIComponent(CID)}`);
      if (r.ok){ const m = await r.json(); C.canResign = m.canResign; C.lockAt = m.lockAt; }
    } catch {}
    $("btnRedo").disabled = false;
    if (!C.canResign){ notice(...ARCHIVED); return; }
  }
  signedBytes = null; strokes = [];
  $("done").hidden = true; $("barDone").hidden = true; $("barSign").hidden = false; $("signedBanner").hidden = true;
  $("qSection").hidden = !C.questions.length;
  lockQuestions(false);
  $("hint").textContent = C.lockAt && !PREVIEW
    ? `請在 ${zhDateTime(new Date(C.lockAt))} 前完成重新簽署，簽完會取代先前的版本。`
    : "可以修改勾選內容後重新簽名。";
  const r = await renderPages(C.pdfBytes, true);
  origPdf = r.doc;
  setStep($("agree").checked ? "sign" : "agree");
};

const fileName = () => [cleanName(C.name), cleanName(C.title) || "文件"].filter(Boolean).join("_") + ".pdf";

boot();
