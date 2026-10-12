/* ============ 管理後台 ============ */
let KEY = ss.get("esign.key") || "";
let SETTINGS = {}, CONTRACTS = [];

async function api(a, { method = "GET", body, query = "" } = {}){
  const headers = { "x-admin-key": KEY };
  if (body && !(body instanceof FormData)) headers["content-type"] = "application/json";
  const r = await fetch(`/api/admin?a=${a}${query}`, { method, headers, body });
  if (r.status === 401){ logout("密碼不對，請重新輸入。"); throw new Error("unauthorized"); }
  if (r.status === 503){ logout("網站還沒設定管理密碼。請到 Netlify 的 Environment variables 新增 ADMIN_PASSWORD，再重新部署。"); throw new Error("no_password"); }
  return r;
}
function logout(msg){
  KEY = ""; ss.del("esign.key");
  $("adminBody").hidden = true; $("loginBox").hidden = false; $("btnLogout").hidden = true;
  err("loginErr", msg || "");
}
async function login(){
  KEY = $("pwIn").value; err("loginErr", "");
  if (!KEY) return err("loginErr", "請輸入密碼。");
  $("btnLogin").disabled = true;
  try { const r = await api("ping"); if (r.ok){ ss.set("esign.key", KEY); $("pwIn").value = ""; await enter(); } }
  catch (e) { if (e.message !== "unauthorized" && e.message !== "no_password") err("loginErr", "連不上網站，請稍後再試。"); }
  finally { $("btnLogin").disabled = false; }
}
$("btnLogin").onclick = login;
$("pwIn").addEventListener("keydown", e => { if (e.key === "Enter") login(); });
$("btnLogout").onclick = () => logout("已登出。");

async function enter(){
  $("loginBox").hidden = true; $("adminBody").hidden = false; $("btnLogout").hidden = false;
  await loadList();
}

const linkFor = id => `${location.origin}/sign.html?c=${encodeURIComponent(id)}`;
async function loadList(highlightId){
  err("listErr", "");
  let data;
  try { const r = await api("list"); if (!r.ok) throw new Error(r.status); data = await r.json(); }
  catch (e) { if (e.message !== "unauthorized" && e.message !== "no_password") err("listErr", "讀取清單失敗，請按重新整理。"); return; }
  CONTRACTS = data.contracts || []; SETTINGS = data.settings || {};
  $("aFirm").textContent = (SETTINGS.firm ? SETTINGS.firm + "・" : "") + "管理後台";
  $("sFirm").value = SETTINGS.firm || ""; $("sLine").value = SETTINGS.line || "";
  const ul = $("list"); ul.innerHTML = "";
  if (!CONTRACTS.length){ const li = document.createElement("li"); li.className = "small"; li.textContent = "還沒有合約。按「＋ 新增合約」上傳第一份。"; ul.append(li); }
  for (const c of CONTRACTS){
    const li = document.createElement("li"); if (c.id === highlightId) li.className = "new";
    const t = document.createElement("div"); t.className = "t"; t.append(c.name);
    const badge = document.createElement("span");
    badge.className = "badge " + (c.signedAt ? "done" : "wait");
    badge.textContent = c.signedAt ? `已簽署 ${fmtDateTime(new Date(c.signedAt))}` : "等待簽署";
    t.append(badge);
    const meta = document.createElement("div"); meta.className = "meta";
    meta.textContent = `${c.title}・建立於 ${fmtDate(new Date(c.created))}` + (c.signCount > 1 ? `・客戶簽了 ${c.signCount} 次，保留最新一份` : "");
    const row = document.createElement("div"); row.className = "row";
    const link = linkFor(c.id);
    const box = document.createElement("input"); box.className = "linkbox"; box.readOnly = true; box.value = link; box.hidden = c.id !== highlightId;
    box.setAttribute("aria-label", "客戶連結");
    const cp = document.createElement("button"); cp.className = "small primary"; cp.textContent = "複製連結";
    cp.onclick = () => copyText(link, box).then(ok => toast(ok ? "連結已複製，貼給客戶即可" : "已選取連結，請手動複製"));
    const pv = document.createElement("a"); pv.className = "plain small"; pv.textContent = "預覽"; pv.href = link + "&preview=1"; pv.target = "_blank"; pv.rel = "noopener";
    pv.style.alignSelf = "center"; pv.style.padding = "6px 4px";
    row.append(cp);
    if (c.signedAt){
      const dl = document.createElement("button"); dl.className = "small"; dl.textContent = "下載已簽 PDF";
      dl.onclick = () => downloadPdf(c, "signed", dl);
      row.append(dl);
    }
    const og = document.createElement("button"); og.className = "small"; og.textContent = "原始 PDF";
    og.onclick = () => downloadPdf(c, "pdf", og);
    const del = document.createElement("button"); del.className = "small danger"; del.textContent = "刪除";
    del.onclick = async () => {
      if (!del.dataset.armed){ del.dataset.armed = "1"; del.textContent = "確定刪除？"; setTimeout(() => { delete del.dataset.armed; del.textContent = "刪除"; }, 4000); return; }
      del.disabled = true; del.textContent = "刪除中…";
      try { const r = await api("delete", { method: "POST", query: "&c=" + encodeURIComponent(c.id) }); if (!r.ok) throw new Error(r.status); toast("已刪除"); await loadList(); }
      catch (e) { del.disabled = false; del.textContent = "刪除"; if (e.message !== "unauthorized") err("listErr", "刪除失敗，請再試一次。"); }
    };
    row.append(og, pv, del);
    li.append(t, meta, row, box); ul.append(li);
  }
}
async function downloadPdf(c, kind, btn){
  const label = btn.textContent; btn.disabled = true; btn.textContent = "下載中…";
  try {
    const r = await api(kind, { query: "&c=" + encodeURIComponent(c.id) });
    if (!r.ok) throw new Error(r.status);
    const name = [cleanName(c.name), cleanName(c.title)].filter(Boolean).join("_") + (kind === "pdf" ? "_原始" : "") + ".pdf";
    saveBlob(await r.blob(), name);
  } catch (e) { if (e.message !== "unauthorized") toast("下載失敗，請再試一次"); }
  finally { btn.disabled = false; btn.textContent = label; }
}
$("btnRefresh").onclick = () => loadList();
document.addEventListener("visibilitychange", () => { if (!document.hidden && KEY && $("editor").hidden) loadList(); });

$("btnSaveSettings").onclick = async () => {
  err("setErr", ""); $("btnSaveSettings").disabled = true;
  try {
    const r = await api("settings", { method: "POST", body: JSON.stringify({ firm: $("sFirm").value, line: $("sLine").value }) });
    if (!r.ok) throw new Error(r.status);
    toast("已儲存"); await loadList();
  } catch (e) { if (e.message !== "unauthorized") err("setErr", "儲存失敗，請再試一次。"); }
  finally { $("btnSaveSettings").disabled = false; }
};

/* ---------- editor ---------- */
const ED = { bytes: null, doc: null, page: 0, vw: 0, vh: 0, sig: null, date: null, mode: "sig", scale: 1, questions: [] };
function resetEditor(){
  Object.assign(ED, { bytes: null, doc: null, page: 0, sig: null, date: null, mode: "sig", questions: [] });
  $("fName").value = ""; $("fTitle").value = ""; $("fFile").value = ""; $("fDate").checked = true; $("fSummary").checked = true;
  $("placeTools").hidden = true; $("btnSave").disabled = true; err("fileErr",""); err("saveErr","");
  updateFnPreview(); renderQEd(); setMode("sig");
}
function updateFnPreview(){
  const n = cleanName($("fName").value) || "客戶名稱", t = cleanName($("fTitle").value) || "合約名稱";
  $("fnPreview").textContent = `客戶下載的檔名會是：${n}_${t}.pdf`;
}
$("fName").addEventListener("input", updateFnPreview);
$("fTitle").addEventListener("input", updateFnPreview);
$("btnNew").onclick = () => { resetEditor(); $("editor").hidden = false; $("newCard").hidden = true; $("fName").focus(); };
$("btnCancelNew").onclick = () => { $("editor").hidden = true; $("newCard").hidden = false; };

function setMode(m){
  ED.mode = m;
  $("modeSig").setAttribute("aria-pressed", m === "sig"); $("modeDate").setAttribute("aria-pressed", m === "date");
  document.querySelectorAll("#qEd [data-mark]").forEach(b => b.setAttribute("aria-pressed", typeof m === "object" && b.dataset.mark === `${m.qi}-${m.oi}`));
}
$("modeSig").onclick = () => setMode("sig");
$("modeDate").onclick = () => { if (!$("fDate").checked){ $("fDate").checked = true; ED.date = ED.date || defaultDate(); drawMarks(); } setMode("date"); };
$("fDate").onchange = e => { if (e.target.checked){ ED.date = ED.date || defaultDate(); } else { ED.date = null; if (ED.mode === "date") setMode("sig"); } drawMarks(); };

$("fFile").onchange = async e => {
  const f = e.target.files[0]; err("fileErr",""); $("placeTools").hidden = true; $("btnSave").disabled = true;
  if (!f) return;
  const bytes = new Uint8Array(await f.arrayBuffer());
  try { await PDFLib.PDFDocument.load(bytes); }
  catch (x) {
    const enc = /encrypt/i.test(String(x && (x.name || x.message)));
    return err("fileErr", enc ? "這份 PDF 有密碼保護，請先移除保護再上傳。" : "讀不到這份 PDF，請確認檔案是否完整。");
  }
  ED.bytes = bytes; ED.sig = null; ED.date = null;
  ED.questions.forEach(q => q.options.forEach(o => o.mark = null));
  ED.doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  const sel = $("fPage"); sel.innerHTML = "";
  for (let i = 1; i <= ED.doc.numPages; i++){ const o = document.createElement("option"); o.value = i - 1; o.textContent = `第 ${i} 頁` + (i === ED.doc.numPages ? "（最後一頁）" : ""); sel.append(o); }
  sel.value = ED.doc.numPages - 1;
  if (!$("fTitle").value){ $("fTitle").value = f.name.replace(/\.pdf$/i, ""); updateFnPreview(); }
  $("placeTools").hidden = false;
  await loadPage(ED.doc.numPages - 1);
  renderQEd();
  $("btnSave").disabled = false;
};
$("fPage").onchange = e => loadPage(+e.target.value);

function defaultDate(){ return { page: ED.sig.page, x: ED.sig.x, y: Math.min(ED.vh - 8, ED.sig.y + ED.sig.h + 28) }; }
async function loadPage(i){
  ED.page = i;
  const page = await ED.doc.getPage(i + 1);
  const v1 = page.getViewport({ scale: 1 }); ED.vw = v1.width; ED.vh = v1.height;
  const cssW = $("place").clientWidth || 360; ED.scale = cssW / v1.width;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vp = page.getViewport({ scale: ED.scale * dpr });
  const c = $("placeCanvas"); c.width = vp.width; c.height = vp.height;
  await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
  if (!ED.sig){
    const w = +$("fW").value, h = +$("fH").value;
    ED.sig = { page: i, x: Math.max(0, ED.vw - w - 60), y: Math.max(0, ED.vh - h - 150), w, h };
    ED.date = $("fDate").checked ? defaultDate() : null;
  }
  drawMarks();
}
function clampSig(){ const s = ED.sig; s.x = Math.min(Math.max(0, s.x), ED.vw - s.w); s.y = Math.min(Math.max(0, s.y), ED.vh - s.h); }
function drawMarks(){
  if (!ED.sig) return;
  const k = ED.scale, s = ED.sig, ms = $("markSig"), md = $("markDate");
  ms.hidden = s.page !== ED.page;
  Object.assign(ms.style, { left: s.x*k+"px", top: s.y*k+"px", width: s.w*k+"px", height: s.h*k+"px" });
  md.hidden = !ED.date || ED.date.page !== ED.page;
  md.textContent = fmtDate(new Date());
  if (ED.date) Object.assign(md.style, { left: ED.date.x*k+"px", top: ED.date.y*k+"px", fontSize: Math.max(9, 11*k)+"px" });
  document.querySelectorAll("#place .optm").forEach(n => n.remove());
  ED.questions.forEach((q, qi) => q.options.forEach((o, oi) => {
    if (!o.mark || o.mark.page !== ED.page) return;
    const d = document.createElement("div"); d.className = "mark optm"; d.textContent = "✓";
    const lab = document.createElement("span"); lab.textContent = `${qi + 1}-${oi + 1} ${o.t || ""}`.trim(); d.append(lab);
    Object.assign(d.style, { left: o.mark.x*k+"px", top: o.mark.y*k+"px" });
    $("place").append(d);
  }));
  const parts = [`紅框（簽名）在第 ${s.page + 1} 頁`];
  if (ED.date) parts.push(`藍線（日期）在第 ${ED.date.page + 1} 頁`);
  $("placeStatus").textContent = parts.join("・") + "。切換「顯示第幾頁」可以到別頁放置。";
}
function placeAt(e){
  const r = $("place").getBoundingClientRect();
  const px = (e.clientX - r.left) / ED.scale, py = (e.clientY - r.top) / ED.scale;
  const m = ED.mode;
  if (m === "sig"){ ED.sig.page = ED.page; ED.sig.x = px - ED.sig.w/2; ED.sig.y = py - ED.sig.h/2; clampSig(); }
  else if (m === "date"){ ED.date = { page: ED.page, x: Math.min(Math.max(0, px), ED.vw - 60), y: Math.min(Math.max(14, py), ED.vh - 2) }; }
  else { const o = ED.questions[m.qi] && ED.questions[m.qi].options[m.oi]; if (!o) return; o.mark = { page: ED.page, x: Math.min(Math.max(6, px), ED.vw - 6), y: Math.min(Math.max(6, py), ED.vh - 6) }; updateMarkBtn(m.qi, m.oi); }
  drawMarks();
}
let placing = false;
$("place").addEventListener("pointerdown", e => { if (!ED.sig) return; e.preventDefault(); placing = true; $("place").setPointerCapture(e.pointerId); placeAt(e); });
$("place").addEventListener("pointermove", e => { if (placing){ e.preventDefault(); placeAt(e); } });
$("place").addEventListener("pointerup", () => placing = false);
$("place").addEventListener("pointercancel", () => placing = false);
for (const id of ["fW","fH"]) $(id).addEventListener("input", () => {
  if (!ED.sig) return; const s = ED.sig, cx = s.x + s.w/2, cy = s.y + s.h/2;
  s.w = +$("fW").value; s.h = +$("fH").value; s.x = cx - s.w/2; s.y = cy - s.h/2; clampSig(); drawMarks();
});
window.addEventListener("resize", () => { if (!$("editor").hidden && ED.doc) { clearTimeout(loadPage.t); loadPage.t = setTimeout(() => loadPage(ED.page), 200); } });

/* ---------- 題目編輯 ---------- */
function el(tag, props, ...kids){ const n = document.createElement(tag); Object.assign(n, props || {}); n.append(...kids); return n; }
function markLabel(o){ return o.mark ? `已標在第 ${o.mark.page + 1} 頁（重標）` : "在 PDF 上標位置"; }
function updateMarkBtn(qi, oi){
  const b = document.querySelector(`#qEd [data-mark="${qi}-${oi}"]`); if (b) b.textContent = markLabel(ED.questions[qi].options[oi]);
  const c = $(`qClr${qi}_${oi}`); if (c) c.hidden = !ED.questions[qi].options[oi].mark;
}
function renderQEd(){
  const box = $("qEd"); box.innerHTML = "";
  ED.questions.forEach((q, qi) => {
    const wrap = el("div", { className: "qed" });
    const qt = el("input", { type: "text", id: `qT${qi}`, value: q.q, placeholder: "題目，例如：本次委任的服務項目" });
    qt.setAttribute("aria-label", `第 ${qi + 1} 題題目`);
    qt.oninput = () => q.q = qt.value;
    const ty = el("select", { id: `qM${qi}` }, el("option", { value: "0", textContent: "單選" }), el("option", { value: "1", textContent: "可複選" }));
    ty.value = q.multi ? "1" : "0"; ty.onchange = () => q.multi = ty.value === "1"; ty.setAttribute("aria-label", "題型");
    const rq = el("input", { type: "checkbox", id: `qR${qi}`, checked: q.required }); rq.onchange = () => q.required = rq.checked;
    const rql = el("label", { className: "ck", htmlFor: `qR${qi}` }, rq, "必填");
    const del = el("button", { className: "small danger", textContent: "刪除此題" });
    del.onclick = () => { ED.questions.splice(qi, 1); if (typeof ED.mode === "object") setMode("sig"); renderQEd(); drawMarks(); };
    wrap.append(el("div", { className: "r" }, el("strong", { textContent: `第 ${qi + 1} 題` }), ty, rql, del), el("div", { className: "r" }, qt));
    const opts = el("div", { className: "opts" });
    q.options.forEach((o, oi) => {
      const ot = el("input", { type: "text", id: `qO${qi}_${oi}`, value: o.t, placeholder: `選項 ${oi + 1}` });
      ot.setAttribute("aria-label", `第 ${qi + 1} 題選項 ${oi + 1}`);
      ot.oninput = () => { o.t = ot.value; drawMarks(); };
      const mk = el("button", { className: "small", textContent: markLabel(o) });
      mk.dataset.mark = `${qi}-${oi}`; mk.setAttribute("aria-pressed", "false");
      mk.onclick = () => {
        if (!ED.doc){ toast("請先上傳 PDF"); return; }
        setMode({ qi, oi }); toast("在下方 PDF 頁面上點一下要打勾的位置", 3000);
        $("place").scrollIntoView({ block: "center", behavior: "smooth" });
      };
      const clr = el("button", { className: "small", id: `qClr${qi}_${oi}`, textContent: "取消位置", hidden: !o.mark });
      clr.onclick = () => { o.mark = null; updateMarkBtn(qi, oi); drawMarks(); };
      const rm = el("button", { className: "small danger", textContent: "×" }); rm.setAttribute("aria-label", "刪除選項");
      rm.onclick = () => { q.options.splice(oi, 1); if (typeof ED.mode === "object") setMode("sig"); renderQEd(); drawMarks(); };
      opts.append(el("div", { className: "r" }, ot, mk, clr, rm));
    });
    const add = el("button", { className: "small", textContent: "＋ 新增選項" });
    add.onclick = () => { q.options.push({ t: "", mark: null }); renderQEd(); $(`qO${qi}_${q.options.length - 1}`).focus(); };
    opts.append(el("div", { className: "r" }, add));
    wrap.append(opts); box.append(wrap);
  });
  setMode(ED.mode);
}
$("btnAddQ").onclick = () => {
  ED.questions.push({ q: "", multi: false, required: true, options: [{ t: "", mark: null }, { t: "", mark: null }] });
  renderQEd(); $(`qT${ED.questions.length - 1}`).focus();
};

$("btnSave").onclick = async () => {
  err("saveErr","");
  const name = $("fName").value.trim(), title = $("fTitle").value.trim();
  if (!name) { err("saveErr","請填客戶名稱。"); $("fName").focus(); return; }
  if (!title) { err("saveErr","請填合約名稱。"); $("fTitle").focus(); return; }
  if (!ED.bytes) { err("saveErr","請選擇 PDF。"); return; }
  if (ED.bytes.length > 4 * 1024 * 1024) { err("saveErr","PDF 超過 4 MB，請先壓縮（例如用 Adobe 或 iLovePDF 的「壓縮 PDF」）再上傳。"); return; }
  const r = v => Math.round(v * 10) / 10;
  const questions = [];
  for (let i = 0; i < ED.questions.length; i++){
    const q = ED.questions[i], opts = q.options.filter(o => o.t.trim());
    if (!q.q.trim() && !opts.length) continue;
    if (!q.q.trim()) { err("saveErr", `第 ${i + 1} 題還沒填題目。`); $(`qT${i}`).focus(); return; }
    if (!opts.length) { err("saveErr", `第 ${i + 1} 題至少要有一個選項。`); return; }
    questions.push({ q: q.q.trim(), multi: !!q.multi, required: !!q.required,
      options: opts.map(o => ({ t: o.t.trim(), mark: o.mark ? { page: o.mark.page, x: r(o.mark.x), y: r(o.mark.y) } : null })) });
  }
  const summary = $("fSummary").checked;
  if (questions.length && !summary && questions.some(q => q.options.some(o => !o.mark))){
    err("saveErr", "有選項沒有標位置，又沒有加「勾選結果」頁，客戶的答案會不見。請標位置，或勾選加一頁勾選結果。"); return;
  }
  const meta = { name, title, sig: { page: ED.sig.page, x: r(ED.sig.x), y: r(ED.sig.y), w: r(ED.sig.w), h: r(ED.sig.h) },
    date: ED.date ? { page: ED.date.page, x: r(ED.date.x), y: r(ED.date.y) } : null, questions, summary };
  const fd = new FormData();
  fd.append("meta", JSON.stringify(meta));
  fd.append("pdf", new Blob([ED.bytes], { type: "application/pdf" }), "contract.pdf");
  $("btnSave").disabled = true; $("btnSave").textContent = "建立中…";
  try {
    const res = await api("create", { method: "POST", body: fd });
    if (res.status === 413) throw new Error("PDF 太大，請先壓縮到 4 MB 以內。");
    if (!res.ok) throw new Error("建立失敗，請再試一次。");
    const { contract } = await res.json();
    $("editor").hidden = true; $("newCard").hidden = false;
    await loadList(contract.id);
    toast(`已建立「${name}」，按「複製連結」傳給客戶`, 4000);
    $("list").scrollIntoView({ block: "start", behavior: reduceMotion() ? "auto" : "smooth" });
  } catch (e) { if (e.message !== "unauthorized") err("saveErr", e.message || "建立失敗，請再試一次。"); }
  finally { $("btnSave").disabled = false; $("btnSave").textContent = "建立連結"; }
};

if (KEY) api("ping").then(r => r.ok && enter()).catch(() => {});
