/* ============ 管理後台 ============ */
const CATS = [
  { id: "bookkeeping",  label: "記帳合約",       group: "合約",   tone: "--tone-teal"  },
  { id: "registration", label: "工商合約",       group: "合約",   tone: "--tone-teal"  },
  { id: "withholding",  label: "扣繳確認函",     group: "確認函", tone: "--tone-sage"  },
  { id: "provisional",  label: "暫繳確認函",     group: "確認函", tone: "--tone-khaki" },
  { id: "nonop",        label: "業外收入確認函", group: "確認函", tone: "--tone-khaki" },
  { id: "settlement",   label: "結算申報確認函", group: "確認函", tone: "--tone-khaki" },
  { id: "uncat",        label: "未分類（改版前）", group: "其他", tone: "--tone-grey", onlyIfAny: true },
];
const catOf = id => CATS.find(c => c.id === id);
const THIS_YEAR = new Date().getFullYear();

let KEY = ss.get("esign.key") || "";
let SETTINGS = {}, COUNTS = {}, CLIENTS = [], CLIENT_COUNT = 0;
let VIEW = null, CAT = null, ROWS = [], HIGHLIGHT = new Set();

async function api(a, { method = "GET", body, query = "" } = {}){
  const headers = { "x-admin-key": KEY };
  if (body && !(body instanceof FormData)) headers["content-type"] = "application/json";
  const r = await fetch(`/api/admin?a=${a}${query}`, { method, headers, body });
  if (r.status === 401){ logout("密碼不對，請重新輸入。"); throw new Error("unauthorized"); }
  if (r.status === 503){ logout("網站還沒設定管理密碼。請到 Netlify 的 Environment variables 新增 ADMIN_PASSWORD，再重新部署。"); throw new Error("no_password"); }
  return r;
}
const quiet = e => e && (e.message === "unauthorized" || e.message === "no_password");

/* ---------- 登入 ---------- */
function logout(msg){
  KEY = ""; ss.del("esign.key");
  $("app").hidden = true; $("loginView").hidden = false;
  err("loginErr", msg || ""); $("pwIn").focus();
}
async function login(){
  KEY = $("pwIn").value; err("loginErr", "");
  if (!KEY) return err("loginErr", "請輸入密碼。");
  $("btnLogin").disabled = true;
  try { const r = await api("ping"); if (r.ok){ ss.set("esign.key", KEY); $("pwIn").value = ""; await enter(); } }
  catch (e) { if (!quiet(e)) err("loginErr", "連不上網站，請稍後再試。"); }
  finally { $("btnLogin").disabled = false; }
}
$("btnLogin").onclick = login;
$("pwIn").addEventListener("keydown", e => { if (e.key === "Enter") login(); });
$("btnLogout").onclick = () => logout("已登出。");

async function enter(){
  $("loginView").hidden = true; $("app").hidden = false;
  await Promise.all([loadCounts(), loadClients()]);
  route();
}

/* ---------- 左側選單 ---------- */
function renderNav(){
  const nav = $("nav"); nav.innerHTML = "";
  const head = t => { const d = document.createElement("div"); d.className = "navlabel"; d.textContent = t; nav.append(d); };
  head("後台客戶清單管理");
  const cb = navBtn({ view: "clients", label: "客戶名單", ico: "☰", count: CLIENT_COUNT || "" });
  nav.append(cb);
  let group = null;
  for (const c of CATS){
    const cnt = COUNTS[c.id];
    if (c.onlyIfAny && !(cnt && cnt.total)) continue;
    if (c.group !== group){ group = c.group; head(group === "其他" ? "其他" : `${group}檢索`); }
    nav.append(navBtn({ cat: c.id, label: c.label, tone: c.tone, pending: cnt ? cnt.pending : 0 }));
  }
  markNav();
}
function navBtn({ view, cat, label, ico, tone, count, pending }){
  const b = document.createElement("button"); b.className = "nav";
  if (view) b.dataset.view = view; if (cat) b.dataset.cat = cat;
  if (tone){ const s = document.createElement("span"); s.className = "tone"; s.style.setProperty("--tone", `var(${tone})`); b.append(s); }
  if (ico){ const s = document.createElement("span"); s.className = "ico"; s.textContent = ico; s.setAttribute("aria-hidden", "true"); b.append(s); }
  b.append(label);
  const c = document.createElement("span");
  if (pending){ c.className = "cnt hot"; c.textContent = pending; c.title = `${pending} 份尚未簽核`; }
  else { c.className = "cnt"; c.textContent = count ?? ""; }
  b.append(c);
  b.onclick = () => { location.hash = cat ? cat : view; };
  return b;
}
$("navSettings").onclick = () => { location.hash = "settings"; };
function markNav(){
  document.querySelectorAll(".nav[data-cat],.nav[data-view]").forEach(b => {
    const on = (b.dataset.cat && b.dataset.cat === CAT && VIEW === "cat") || (b.dataset.view && b.dataset.view === VIEW);
    if (on){
      b.setAttribute("aria-current", "page");
      if (window.innerWidth <= 900) b.scrollIntoView({ inline: "center", block: "nearest" });
    } else b.removeAttribute("aria-current");
  });
}
async function loadCounts(){
  try {
    const r = await api("counts"); if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    COUNTS = d.counts || {}; SETTINGS = d.settings || {}; CLIENT_COUNT = d.clientCount || 0;
    $("firmLine").textContent = `${SETTINGS.firm || "禾識會計師事務所"}・管理後台`;
    $("sFirm").value = SETTINGS.firm || "";
    renderNav();
  } catch (e) { if (!quiet(e)) toast("讀取資料失敗，請重新整理頁面"); }
}

/* ---------- 頁面切換（網址 #bookkeeping、#clients、#settings） ---------- */
function route(){
  const h = (location.hash || "").slice(1);
  if (h === "clients") return showView("clients");
  if (h === "settings") return showView("settings");
  showCat(catOf(h) ? h : "bookkeeping");
}
window.addEventListener("hashchange", () => { if (!$("app").hidden) route(); });
function showView(v){
  VIEW = v;
  $("viewCat").hidden = v !== "cat"; $("viewClients").hidden = v !== "clients"; $("viewSettings").hidden = v !== "settings";
  markNav();
  if (v === "clients") renderClients();
  window.scrollTo(0, 0);
}

/* ============ 合約模組 ============ */
async function showCat(cat){
  if (CAT !== cat){ closeEditor(); $("qText").value = ""; $("qYear").value = ""; }
  CAT = cat; showView("cat");
  const c = catOf(cat);
  $("catTitle").textContent = c.label;
  $("catTone").style.setProperty("--tone", `var(${c.tone})`);
  $("newPanel").hidden = cat === "uncat";
  $("rowsSigned").innerHTML = $("rowsPending").innerHTML = '<div class="empty">讀取中…</div>';
  await loadRows();
}
async function loadRows(){
  err("listErr", "");
  try {
    const r = await api("list", { query: "&cat=" + encodeURIComponent(CAT) });
    if (!r.ok) throw new Error(r.status);
    ROWS = (await r.json()).contracts || [];
  } catch (e) { if (!quiet(e)) err("listErr", "讀取清單失敗，請重新整理頁面。"); return; }
  fillYears(); renderRows();
}
function fillYears(){
  const sel = $("qYear"), keep = sel.value;
  const years = [...new Set([THIS_YEAR, ...ROWS.map(r => r.year).filter(Boolean)])].sort((a, b) => b - a);
  sel.innerHTML = "";
  const all = document.createElement("option"); all.value = ""; all.textContent = "全部年度"; sel.append(all);
  for (const y of years){ const o = document.createElement("option"); o.value = y; o.textContent = `${y} 年度`; sel.append(o); }
  sel.value = years.includes(+keep) ? keep : "";
}
$("qYear").onchange = renderRows;
$("qText").addEventListener("input", renderRows);
$("qClear").onclick = () => { $("qYear").value = ""; $("qText").value = ""; renderRows(); };

function filtered(){
  const y = $("qYear").value, q = $("qText").value.trim().toLowerCase();
  return ROWS.filter(r => (!y || String(r.year) === y) &&
    (!q || [r.name, r.short, r.taxId, r.title].some(v => (v || "").toLowerCase().includes(q))));
}
const linkFor = id => `${location.origin}/sign.html?c=${encodeURIComponent(id)}`;
const WINDOW_MS = 60 * 60 * 1000;
function resignState(c){
  if (!c.signedAt) return null;
  if (c.resignAllowed) return { key: "open", text: "已開放重簽" };
  const lock = Date.parse(c.firstSignedAt || c.signedAt) + WINDOW_MS;
  if (Date.now() <= lock) return { key: "window", text: `客戶可重簽至 ${fmtDateTime(new Date(lock)).slice(11)}` };
  return { key: "archived", text: "已歸檔" };
}

function renderRows(){
  const list = filtered();
  const signed = list.filter(r => r.signedAt), pending = list.filter(r => !r.signedAt);
  signed.sort((a, b) => (b.signedAt || "").localeCompare(a.signedAt || ""));
  $("nSigned").textContent = signed.length; $("nPending").textContent = pending.length;
  const total = list.length, rate = total ? Math.round(signed.length / total * 100) : 0;
  $("catStats").innerHTML = "";
  for (const [n, l] of [[total, "份合約"], [signed.length, "已簽核"], [pending.length, "尚未簽核"], [`${rate}%`, "完成率"]]){
    const s = document.createElement("span"); const b = document.createElement("b"); b.textContent = n; s.append(b, l); $("catStats").append(s);
  }
  fillRows($("rowsSigned"), signed, true);
  fillRows($("rowsPending"), pending, false);
  $("btnZip").disabled = !signed.length; $("btnExport").disabled = !pending.length;
}

function fillRows(box, rows, signed){
  box.innerHTML = "";
  if (!rows.length){
    const e = document.createElement("div"); e.className = "empty";
    e.textContent = ROWS.length ? "沒有符合條件的合約。" : (signed ? "還沒有客戶完成簽核。" : "目前沒有待簽的合約。按上方「新增合約」建立。");
    box.append(e); return;
  }
  const head = document.createElement("div"); head.className = "rowhead row";
  for (const t of ["客戶", "合約", signed ? "簽核狀態" : "建立日期", ""]){ const s = document.createElement("span"); s.textContent = t; head.append(s); }
  box.append(head);
  for (const c of rows){
    const row = document.createElement("div"); row.className = "row" + (HIGHLIGHT.has(c.id) ? " new" : "");
    const who = document.createElement("div"); who.className = "who";
    const b = document.createElement("b"); b.textContent = c.name;
    const sub = document.createElement("div"); sub.className = "sub";
    sub.textContent = [c.short, c.taxId ? `統編 ${c.taxId}` : ""].filter(Boolean).join("・") || "—";
    who.append(b, sub);
    const doc = document.createElement("div"); doc.className = "doc";
    doc.append(c.title);
    const ds = document.createElement("div"); ds.className = "sub"; ds.textContent = `${c.year || "—"} 年度`; doc.append(ds);
    const st = document.createElement("div"); st.className = "state";
    if (signed){
      const bd = document.createElement("span"); bd.className = "badge done"; bd.textContent = fmtDateTime(new Date(c.signedAt)); st.append(bd);
      const rs = resignState(c);
      if (rs){ const b2 = document.createElement("div"); b2.className = "sub"; b2.textContent = rs.text + (c.signCount > 1 ? `・簽了 ${c.signCount} 次` : ""); st.append(b2); }
    } else {
      st.textContent = fmtDate(new Date(c.created));
    }
    const acts = document.createElement("div"); acts.className = "acts";
    const link = linkFor(c.id);
    const box2 = document.createElement("input"); box2.className = "linkbox"; box2.readOnly = true; box2.value = link; box2.hidden = true; box2.setAttribute("aria-label", "客戶連結");
    const btn = (label, fn, cls) => { const x = document.createElement("button"); x.className = "small" + (cls ? " " + cls : ""); x.textContent = label; x.onclick = () => fn(x); acts.append(x); return x; };
    if (signed){
      btn("下載已簽 PDF", x => downloadPdf(c, "signed", x), "primary ink");
      const rs = resignState(c);
      if (rs && rs.key === "archived") btn("開放重簽", x => reopen(c, true, x));
      if (rs && rs.key === "open") btn("取消開放", x => reopen(c, false, x));
    } else {
      btn("複製連結", () => copyText(link, box2).then(ok => toast(ok ? "連結已複製，貼給客戶即可" : "已選取連結，請手動複製")), "primary ink");
    }
    const pv = document.createElement("a"); pv.textContent = "預覽"; pv.href = link + "&preview=1"; pv.target = "_blank"; pv.rel = "noopener"; acts.append(pv);
    btn("原始 PDF", x => downloadPdf(c, "pdf", x));
    btn("刪除", x => del(c, x), "danger");
    row.append(who, doc, st, acts, box2);
    box.append(row);
  }
}

async function downloadPdf(c, kind, btn){
  const label = btn.textContent; btn.disabled = true; btn.textContent = "下載中…";
  try {
    const r = await api(kind, { query: "&c=" + encodeURIComponent(c.id) });
    if (!r.ok) throw new Error(r.status);
    saveBlob(await r.blob(), pdfName(c, kind === "pdf" ? "_原始" : ""));
  } catch (e) { if (!quiet(e)) toast("下載失敗，請再試一次"); }
  finally { btn.disabled = false; btn.textContent = label; }
}
const pdfName = (c, suffix) => [cleanName(c.name), cleanName(c.title)].filter(Boolean).join("_") + (suffix || "") + ".pdf";
async function reopen(c, on, btn){
  btn.disabled = true;
  try {
    const r = await api("reopen", { method: "POST", query: `&c=${encodeURIComponent(c.id)}&on=${on ? 1 : 0}` });
    if (!r.ok) throw new Error(r.status);
    toast(on ? "已開放：客戶可以再簽一次，簽完會自動重新歸檔" : "已取消開放重簽", 3500);
    await loadRows();
  } catch (e) { btn.disabled = false; if (!quiet(e)) toast("操作失敗，請再試一次"); }
}
async function del(c, btn){
  if (!btn.dataset.armed){ btn.dataset.armed = "1"; btn.textContent = "確定刪除？"; setTimeout(() => { delete btn.dataset.armed; btn.textContent = "刪除"; }, 4000); return; }
  btn.disabled = true; btn.textContent = "刪除中…";
  try {
    const r = await api("delete", { method: "POST", query: "&c=" + encodeURIComponent(c.id) });
    if (!r.ok) throw new Error(r.status);
    toast("已刪除"); ROWS = ROWS.filter(x => x.id !== c.id); renderRows(); loadCounts();
  } catch (e) { btn.disabled = false; btn.textContent = "刪除"; if (!quiet(e)) toast("刪除失敗，請再試一次"); }
}

/* 匯出尚未簽核的連結（Excel 可直接開啟的 CSV） */
$("btnExport").onclick = () => {
  const rows = filtered().filter(r => !r.signedAt);
  const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["客戶名稱", "簡稱", "統一編號", "合約名稱", "年度", "簽署連結"].map(esc).join(",")];
  for (const r of rows) lines.push([r.name, r.short, r.taxId ? `="${r.taxId}"` : "", r.title, r.year, linkFor(r.id)].map((v, i) => i === 2 && v ? v : esc(v)).join(","));
  const y = $("qYear").value;
  saveBlob(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), `${catOf(CAT).label}${y ? "_" + y : ""}_尚未簽核連結.csv`);
};

/* 下載目前條件下所有已簽 PDF，打包成 ZIP */
$("btnZip").onclick = async () => {
  const rows = filtered().filter(r => r.signedAt);
  if (!rows.length || !window.JSZip) return;
  const btn = $("btnZip"), label = btn.textContent; btn.disabled = true;
  const zip = new JSZip(), used = new Set(); let done = 0, failed = 0;
  try {
    await mapLimitClient(rows, 4, async r => {
      try {
        const res = await api("signed", { query: "&c=" + encodeURIComponent(r.id) });
        if (!res.ok) throw new Error(res.status);
        let n = pdfName(r, ""), k = 2; while (used.has(n)) n = pdfName(r, `_${k++}`); used.add(n);
        zip.file(n, await res.arrayBuffer());
      } catch (e) { if (quiet(e)) throw e; failed++; }
      btn.textContent = `下載中 ${++done}/${rows.length}…`;
    });
    const blob = await zip.generateAsync({ type: "blob" });
    const y = $("qYear").value;
    saveBlob(blob, `${catOf(CAT).label}${y ? "_" + y : ""}_已簽核.zip`);
    if (failed) toast(`有 ${failed} 份下載失敗，其餘已打包`, 4000);
  } catch (e) { if (!quiet(e)) toast("打包失敗，請再試一次"); }
  finally { btn.disabled = false; btn.textContent = label; }
};
async function mapLimitClient(arr, n, fn){
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, arr.length) }, async () => { while (i < arr.length) await fn(arr[i++]); }));
}

/* ============ 新增合約（單一客戶／多位客戶公版） ============ */
let NEW_MODE = "single";
function openEditor(mode){
  resetEditor(); setNewMode(mode);
  $("editor").hidden = false; $("newBtns").hidden = true;
  (mode === "single" ? $("fName") : $("pickFilter")).focus();
}
function closeEditor(){ $("editor").hidden = true; $("newBtns").hidden = false; }
$("btnNewSingle").onclick = () => openEditor("single");
$("btnNewBatch").onclick = () => openEditor("batch");
$("btnCancelNew").onclick = closeEditor;
$("tabSingle").onclick = () => setNewMode("single");
$("tabBatch").onclick = () => setNewMode("batch");
function setNewMode(m){
  NEW_MODE = m;
  $("tabSingle").setAttribute("aria-selected", m === "single"); $("tabBatch").setAttribute("aria-selected", m === "batch");
  $("singleBox").hidden = m !== "single"; $("batchBox").hidden = m !== "batch";
  if (m === "batch") renderPick();
  updateSaveLabel(); updateFnPreview();
}
function resetEditor(){
  Object.assign(ED, { bytes: null, doc: null, page: 0, sig: null, date: null, mode: "sig", questions: [] });
  for (const id of ["fName", "fShort", "fTaxId", "fFile", "pickFilter"]) $(id).value = "";
  $("fTitle").value = catOf(CAT).label; $("fYear").value = THIS_YEAR;
  $("fDate").checked = true; $("fSummary").checked = false;
  $("placeTools").hidden = true; $("btnSave").disabled = true; $("saveProgress").hidden = true;
  err("fileErr", ""); err("saveErr", "");
  PICKED = new Set(); renderQEd(); setMode("sig");
}
function updateFnPreview(){
  const n = NEW_MODE === "batch" ? "各客戶名稱" : (cleanName($("fName").value) || "客戶名稱");
  const t = cleanName($("fTitle").value) || "合約名稱";
  $("fnPreview").textContent = `客戶下載的檔名會是：${n}_${t}.pdf`;
}
function updateSaveLabel(){
  $("btnSave").textContent = NEW_MODE === "batch" ? `產生 ${PICKED.size} 位客戶的連結` : "建立連結";
}
$("fTitle").addEventListener("input", updateFnPreview);
$("fName").addEventListener("input", () => {
  updateFnPreview();
  const hit = CLIENTS.find(c => c.name === $("fName").value.trim());
  if (hit){ $("fShort").value = hit.short || ""; $("fTaxId").value = hit.taxId || ""; }
});

/* 多位客戶：從客戶名單勾選 */
let PICKED = new Set();
const ckey = c => c.taxId || "n:" + c.name;
function renderPick(){
  const q = $("pickFilter").value.trim().toLowerCase(), box = $("pickList"); box.innerHTML = "";
  $("pickEmpty").hidden = CLIENTS.length > 0; box.hidden = !CLIENTS.length;
  const year = +$("fYear").value;
  const have = new Set(ROWS.filter(r => r.year === year).map(r => r.taxId || "n:" + r.name));
  for (const c of CLIENTS){
    if (q && ![c.name, c.short, c.taxId].some(v => (v || "").toLowerCase().includes(q))) continue;
    const k = ckey(c);
    const lab = document.createElement("label"); lab.className = "pickrow";
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = PICKED.has(k);
    cb.onchange = () => { if (cb.checked) PICKED.add(k); else PICKED.delete(k); updatePickCount(); };
    const nm = document.createElement("span"); nm.textContent = c.name + (c.short ? `（${c.short}）` : "");
    if (have.has(k)){ const d = document.createElement("span"); d.className = "dup"; d.textContent = `已有 ${year} 年度此類合約`; nm.append(d); }
    const t = document.createElement("span"); t.className = "tid"; t.textContent = c.taxId || "—";
    lab.append(cb, nm, t); box.append(lab);
  }
  updatePickCount();
}
function updatePickCount(){ $("pickCount").textContent = `已選 ${PICKED.size} 位`; updateSaveLabel(); }
$("pickFilter").addEventListener("input", renderPick);
$("fYear").addEventListener("input", () => { if (NEW_MODE === "batch") renderPick(); });
$("pickAll").onclick = () => { document.querySelectorAll("#pickList input").forEach(cb => { if (!cb.checked){ cb.checked = true; cb.onchange(); } }); };
$("pickNone").onclick = () => { PICKED = new Set(); renderPick(); };

const ED = { bytes: null, doc: null, page: 0, vw: 0, vh: 0, sig: null, date: null, mode: "sig", scale: 1, questions: [] };
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


/* ---------- 建立連結 ---------- */
function collectMeta(){
  const title = $("fTitle").value.trim(), year = +$("fYear").value;
  if (!title) throw ["請填合約名稱。", "fTitle"];
  if (!(year >= 1990 && year <= 2100)) throw ["請填西元年度，例如 2026。", "fYear"];
  if (!ED.bytes) throw ["請選擇 PDF。", "fFile"];
  if (ED.bytes.length > 4 * 1024 * 1024) throw ["PDF 超過 4 MB，請先壓縮（例如用 iLovePDF 的「壓縮 PDF」）再上傳。", "fFile"];
  const r = v => Math.round(v * 10) / 10;
  const questions = [];
  for (let i = 0; i < ED.questions.length; i++){
    const q = ED.questions[i], opts = q.options.filter(o => o.t.trim());
    if (!q.q.trim() && !opts.length) continue;
    if (!q.q.trim()) throw [`第 ${i + 1} 題還沒填題目。`, `qT${i}`];
    if (!opts.length) throw [`第 ${i + 1} 題至少要有一個選項。`];
    questions.push({ q: q.q.trim(), multi: !!q.multi, required: !!q.required,
      options: opts.map(o => ({ t: o.t.trim(), mark: o.mark ? { page: o.mark.page, x: r(o.mark.x), y: r(o.mark.y) } : null })) });
  }
  const summary = $("fSummary").checked;
  if (questions.length && !summary){
    const qi = questions.findIndex(q => q.options.some(o => !o.mark));
    if (qi >= 0){
      const oi = questions[qi].options.findIndex(o => !o.mark);
      throw [`第 ${qi + 1} 題的「${questions[qi].options[oi].t}」還沒標位置。請按「在 PDF 上標位置」點在方框上，不然客戶勾了也不會出現在 PDF 上。`];
    }
  }
  return { category: CAT, year, title, questions, summary,
    sig: { page: ED.sig.page, x: r(ED.sig.x), y: r(ED.sig.y), w: r(ED.sig.w), h: r(ED.sig.h) },
    date: ED.date ? { page: ED.date.page, x: r(ED.date.x), y: r(ED.date.y) } : null };
}

$("btnSave").onclick = async () => {
  err("saveErr", "");
  let meta;
  try { meta = collectMeta(); }
  catch (x) { if (Array.isArray(x)){ err("saveErr", x[0]); if (x[1]) $(x[1]).focus(); return; } throw x; }
  if (NEW_MODE === "single") return saveSingle(meta);
  return saveBatch(meta);
};

async function saveSingle(meta){
  const name = $("fName").value.trim(), short = $("fShort").value.trim(), taxId = $("fTaxId").value.replace(/\D/g, "");
  if (!name) { err("saveErr", "請填客戶名稱。"); $("fName").focus(); return; }
  if (taxId && taxId.length !== 8) { err("saveErr", "統一編號要是 8 碼數字，或留空。"); $("fTaxId").focus(); return; }
  const fd = new FormData();
  fd.append("meta", JSON.stringify({ ...meta, name, short, taxId }));
  fd.append("pdf", new Blob([ED.bytes], { type: "application/pdf" }), "contract.pdf");
  busy(true, "建立中…");
  try {
    const res = await api("create", { method: "POST", body: fd });
    if (res.status === 413) throw new Error("PDF 太大，請先壓縮到 4 MB 以內。");
    if (!res.ok) throw new Error("建立失敗，請再試一次。");
    const { contract } = await res.json();
    await finishCreate([contract], `已建立「${name}」的連結，按「複製連結」傳給客戶`);
  } catch (e) { if (!quiet(e)) err("saveErr", e.message || "建立失敗，請再試一次。"); }
  finally { busy(false); }
}

let dupArmed = false;
async function saveBatch(meta){
  const chosen = CLIENTS.filter(c => PICKED.has(ckey(c)));
  if (!chosen.length) { err("saveErr", "請至少勾選一位客戶。"); return; }
  const have = new Set(ROWS.filter(r => r.year === meta.year).map(r => r.taxId || "n:" + r.name));
  const dups = chosen.filter(c => have.has(ckey(c)));
  if (dups.length && !dupArmed){
    dupArmed = true; setTimeout(() => { dupArmed = false; }, 8000);
    err("saveErr", `有 ${dups.length} 位客戶已經有 ${meta.year} 年度的${catOf(CAT).label}（例如：${dups.slice(0, 3).map(c => c.short || c.name).join("、")}）。確定要再建一份，請再按一次「產生」。`);
    return;
  }
  dupArmed = false;
  busy(true, "上傳公版 PDF…");
  try {
    const fd = new FormData(); fd.append("pdf", new Blob([ED.bytes], { type: "application/pdf" }), "template.pdf");
    const t = await api("template", { method: "POST", body: fd });
    if (t.status === 413) throw new Error("PDF 太大，請先壓縮到 4 MB 以內。");
    if (!t.ok) throw new Error("上傳 PDF 失敗，請再試一次。");
    const { tplId } = await t.json();
    const made = [];
    for (let i = 0; i < chosen.length; i += 50){
      progress(`建立連結中 ${made.length}/${chosen.length}…`);
      const part = chosen.slice(i, i + 50);
      const r = await api("batch", { method: "POST", body: JSON.stringify({ tplId, meta, clients: part }) });
      if (!r.ok) throw new Error(`建立到第 ${made.length + 1} 位時失敗。已建立的 ${made.length} 位不受影響，請到清單確認後再補建其餘客戶。`);
      made.push(...(await r.json()).contracts);
    }
    await finishCreate(made, `已為 ${made.length} 位客戶建立連結。可按「匯出連結清單」一次取得全部連結。`);
  } catch (e) { if (!quiet(e)) err("saveErr", e.message || "建立失敗，請再試一次。"); }
  finally { busy(false); }
}
function busy(on, text){
  $("btnSave").disabled = on; $("btnCancelNew").disabled = on;
  if (on) progress(text); else { $("saveProgress").hidden = true; updateSaveLabel(); $("btnSave").disabled = !ED.bytes; }
}
function progress(t){ $("saveProgress").hidden = false; $("saveProgress").textContent = t; }
async function finishCreate(list, msg){
  HIGHLIGHT = new Set(list.map(c => c.id));
  closeEditor();
  $("qYear").value = ""; $("qText").value = "";
  await Promise.all([loadRows(), loadCounts()]);
  toast(msg, 5000);
  $("rowsPending").scrollIntoView({ block: "start", behavior: reduceMotion() ? "auto" : "smooth" });
  setTimeout(() => { HIGHLIGHT = new Set(); }, 60000);
}

/* ============ 客戶名單 ============ */
async function loadClients(){
  try { const r = await api("clients"); if (!r.ok) throw new Error(r.status); CLIENTS = (await r.json()).clients || []; }
  catch (e) { if (!quiet(e)) toast("讀取客戶名單失敗"); }
  fillClientOptions();
}
function fillClientOptions(){
  const dl = $("clientOptions"); dl.innerHTML = "";
  for (const c of CLIENTS){ const o = document.createElement("option"); o.value = c.name; o.label = [c.short, c.taxId].filter(Boolean).join("・"); dl.append(o); }
}
async function saveClients(list, okMsg, errId){
  err(errId, "");
  try {
    const r = await api("clients", { method: "POST", body: JSON.stringify({ clients: list }) });
    if (!r.ok) throw new Error(r.status);
    CLIENTS = (await r.json()).clients; CLIENT_COUNT = CLIENTS.length;
    fillClientOptions(); renderClients(); renderNav(); toast(okMsg);
    return true;
  } catch (e) { if (!quiet(e)) err(errId, "儲存失敗，請再試一次。"); return false; }
}
let EDITING = null;
function renderClients(){
  const q = $("clientFilter").value.trim().toLowerCase(), box = $("clientRows"); box.innerHTML = "";
  $("clientStats").innerHTML = ""; const s = document.createElement("span"); const b = document.createElement("b"); b.textContent = CLIENTS.length; s.append(b, "位客戶"); $("clientStats").append(s);
  const list = CLIENTS.map((c, i) => [c, i]).filter(([c]) => !q || [c.name, c.short, c.taxId].some(v => (v || "").toLowerCase().includes(q)));
  if (!list.length){ const e = document.createElement("div"); e.className = "empty"; e.textContent = CLIENTS.length ? "沒有符合的客戶。" : "還沒有客戶。按「從 Excel 貼上匯入」一次加入整份名單。"; box.append(e); return; }
  for (const [c, i] of list){
    const row = document.createElement("div"); row.className = "row crow";
    const acts = document.createElement("div"); acts.className = "acts";
    const mk = (label, fn, cls) => { const x = document.createElement("button"); x.className = "small" + (cls ? " " + cls : ""); x.textContent = label; x.onclick = () => fn(x); acts.append(x); };
    if (EDITING === i){
      const ins = ["name", "short", "taxId"].map(k => { const x = document.createElement("input"); x.value = c[k] || ""; x.setAttribute("aria-label", { name: "客戶名稱", short: "簡稱", taxId: "統一編號" }[k]); return x; });
      ins[2].inputMode = "numeric"; ins[2].maxLength = 8;
      row.append(...ins);
      mk("儲存", async () => {
        const v = { name: ins[0].value.trim(), short: ins[1].value.trim(), taxId: ins[2].value.replace(/\D/g, "") };
        if (!v.name) return toast("客戶名稱不能空白");
        if (v.taxId && v.taxId.length !== 8) return toast("統一編號要是 8 碼數字");
        const next = CLIENTS.slice(); next[i] = v; EDITING = null;
        await saveClients(next, "已更新", "clientErr");
      }, "primary ink");
      mk("取消", () => { EDITING = null; renderClients(); });
    } else {
      const n = document.createElement("div"); n.className = "who"; const nb = document.createElement("b"); nb.textContent = c.name; n.append(nb);
      const sh = document.createElement("div"); sh.textContent = c.short || "—";
      const t = document.createElement("div"); t.className = "tid"; t.textContent = c.taxId || "—";
      row.append(n, sh, t);
      mk("編輯", () => { EDITING = i; renderClients(); });
      mk("刪除", async x => {
        if (!x.dataset.armed){ x.dataset.armed = "1"; x.textContent = "確定刪除？"; setTimeout(() => { delete x.dataset.armed; x.textContent = "刪除"; }, 4000); return; }
        await saveClients(CLIENTS.filter((_, k) => k !== i), "已從名單刪除", "clientErr");
      }, "danger");
    }
    row.append(acts); box.append(row);
  }
}
$("clientFilter").addEventListener("input", renderClients);

$("btnAddClient").onclick = () => { $("addClientBox").hidden = false; $("importBox").hidden = true; $("cName").focus(); };
$("cCancel").onclick = () => { $("addClientBox").hidden = true; };
$("cSave").onclick = async () => {
  const v = { name: $("cName").value.trim(), short: $("cShort").value.trim(), taxId: $("cTax").value.replace(/\D/g, "") };
  if (!v.name) return err("addClientErr", "請填客戶名稱。");
  if (v.taxId && v.taxId.length !== 8) return err("addClientErr", "統一編號要是 8 碼數字，或留空。");
  if (v.taxId && CLIENTS.some(c => c.taxId === v.taxId)) return err("addClientErr", "名單裡已經有這個統一編號。");
  if (await saveClients([...CLIENTS, v], `已加入「${v.name}」`, "addClientErr")){
    for (const id of ["cName", "cShort", "cTax"]) $(id).value = "";
    $("addClientBox").hidden = true;
  }
};

/* 從 Excel 貼上／CSV：每列「客戶名稱、簡稱、統編」，可含標題列；統編可放在任何一欄 */
let IMPORT = [];
function parseClients(text){
  const out = []; let first = true;
  const HEAD = /^(客戶)?(名稱|全名)$|^簡稱$|^統(一)?編(號)?$|^公司名稱$/;
  for (const raw of text.replace(/\r/g, "").split("\n")){
    if (!raw.trim()) continue;
    const cells = (raw.includes("\t") ? raw.split("\t") : splitCsv(raw)).map(v => v.trim().replace(/^="?|"$/g, "").replace(/^"|"$/g, ""));
    const isHead = first && cells.some(v => HEAD.test(v));
    first = false;
    if (isHead) continue;   // 標題列
    let ti = cells.findIndex(v => /^\d{8}$/.test(v.replace(/[-\s]/g, "")));
    const taxId = ti >= 0 ? cells[ti].replace(/[-\s]/g, "") : "";
    const rest = cells.filter((_, k) => k !== ti && cells[k] !== "");
    if (!rest.length) continue;
    out.push({ name: rest[0], short: rest[1] || "", taxId });
  }
  return out;
}
function splitCsv(line){
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++){
    const ch = line[i];
    if (q){ if (ch === '"' && line[i + 1] === '"'){ cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ","){ out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur); return out;
}
function updateImportPreview(){
  IMPORT = parseClients($("importText").value);
  const noTax = IMPORT.filter(c => !c.taxId).length;
  $("importPreview").textContent = IMPORT.length
    ? `讀到 ${IMPORT.length} 位客戶${noTax ? `（其中 ${noTax} 位沒有統編）` : ""}。例如：${IMPORT.slice(0, 3).map(c => `${c.name}${c.taxId ? " " + c.taxId : ""}`).join("、")}`
    : "";
  $("importSave").disabled = !IMPORT.length;
}
$("btnImport").onclick = () => { $("importBox").hidden = false; $("addClientBox").hidden = true; $("importText").focus(); };
$("importCancel").onclick = () => { $("importBox").hidden = true; };
$("importText").addEventListener("input", updateImportPreview);
$("importFile").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const buf = await f.arrayBuffer();
  let text = new TextDecoder("utf-8").decode(buf);
  if (text.includes("�")) { try { text = new TextDecoder("big5").decode(buf); } catch {} }   // 舊版 Excel 存的中文 CSV
  $("importText").value = text.replace(/^﻿/, ""); updateImportPreview();
};
$("importSave").onclick = async () => {
  const replace = document.querySelector('input[name="importMode"]:checked').value === "replace";
  let next;
  if (replace) next = IMPORT;
  else {
    next = CLIENTS.slice();
    for (const c of IMPORT){
      const k = c.taxId ? next.findIndex(x => x.taxId === c.taxId) : next.findIndex(x => !x.taxId && x.name === c.name);
      if (k >= 0) next[k] = { ...next[k], ...c, short: c.short || next[k].short }; else next.push(c);
    }
  }
  $("importSave").disabled = true;
  if (await saveClients(next, `已匯入，名單共 ${next.length} 位`, "importErr")){
    $("importText").value = ""; $("importFile").value = ""; IMPORT = []; $("importPreview").textContent = ""; $("importBox").hidden = true;
  }
  $("importSave").disabled = !IMPORT.length;
};

/* ============ 系統設定 ============ */
$("btnSaveSettings").onclick = async () => {
  err("setErr", ""); $("btnSaveSettings").disabled = true;
  try {
    const r = await api("settings", { method: "POST", body: JSON.stringify({ firm: $("sFirm").value }) });
    if (!r.ok) throw new Error(r.status);
    toast("已儲存"); await loadCounts();
  } catch (e) { if (!quiet(e)) err("setErr", "儲存失敗，請再試一次。"); }
  finally { $("btnSaveSettings").disabled = false; }
};

/* 回到這個分頁時更新簽核狀態 */
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && KEY && !$("app").hidden && VIEW === "cat" && $("editor").hidden){ loadRows(); loadCounts(); }
});

if (KEY) api("ping").then(r => r.ok && enter()).catch(() => {});
else $("pwIn").focus();
