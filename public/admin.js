/* ============ 管理後台 ============ */
const CATS = [
  { id: "registration", label: "工商合約",       group: "合約",   tone: "--tone-teal"  },
  { id: "withholding",  label: "扣繳確認函",     group: "確認函", tone: "--tone-sage"  },
  { id: "provisional",  label: "暫繳確認函",     group: "確認函", tone: "--tone-khaki" },
  { id: "nonop",        label: "業外資訊確認函", group: "確認函", tone: "--tone-khaki" },
  { id: "settlement",   label: "結算申報確認函", group: "確認函", tone: "--tone-khaki" },
  { id: "uncat",        label: "未分類", group: "其他", tone: "--tone-grey", onlyIfAny: true },
];
const catOf = id => CATS.find(c => c.id === id);
const THIS_YEAR = new Date().getFullYear();

let KEY = ss.get("esign.key") || "";
let SETTINGS = {}, COUNTS = {}, CLIENTS = [], CLIENT_COUNT = 0;
let VIEW = null, CAT = null, ROWS = [], HIGHLIGHT = new Set();

async function api(a, { method = "GET", body, query = "" } = {}){
  const headers = { "x-admin-key": KEY };
  const dev = deviceName(); if (dev) headers["x-device"] = encodeURIComponent(dev);
  if (body && !(body instanceof FormData)) headers["content-type"] = "application/json";
  const r = await fetch(`/api/admin?a=${a}${query}`, { method, headers, body });
  if (r.status === 401){ logout("密碼不對，請重新輸入。"); throw new Error("unauthorized"); }
  if (r.status === 503){ logout("網站還沒設定管理密碼。請到 Netlify 的 Environment variables 新增 ADMIN_PASSWORD，再重新部署。"); throw new Error("no_password"); }
  return r;
}
const quiet = e => e && (e.message === "unauthorized" || e.message === "no_password");

/* ---------- 這台電腦的名稱（網頁讀不到電腦名稱，由使用者填寫並記在這台電腦） ---------- */
function deviceName(){ try { return localStorage.getItem("esign.device") || ""; } catch { return ""; } }
function setDeviceName(v){ try { if (v) localStorage.setItem("esign.device", v); else localStorage.removeItem("esign.device"); } catch {} }
$("devIn").value = deviceName();

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
  setDeviceName($("devIn").value.trim());
  try { const r = await api("ping", { query: "&login=1" }); if (r.ok){ ss.set("esign.key", KEY); $("pwIn").value = ""; await enter(); } }
  catch (e) { if (!quiet(e)) err("loginErr", "連不上網站，請稍後再試。"); }
  finally { $("btnLogin").disabled = false; }
}
$("btnLogin").onclick = login;
$("pwIn").addEventListener("keydown", e => { if (e.key === "Enter") login(); });
$("btnLogout").onclick = () => logout("已登出。");

async function enter(){
  $("loginView").hidden = true; $("app").hidden = false;
  await Promise.all([loadCounts(), loadClients(), loadPresets()]);
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

/* ---------- 頁面切換（網址 #registration、#clients、#settings） ---------- */
function route(){
  const h = (location.hash || "").slice(1);
  if (DRAFT && VIEW === "clients" && h !== "clients"){
    if (!confirm("客戶名單有未儲存的變更。要放棄這些變更並離開嗎？")){ history.replaceState(null, "", "#clients"); return; }
    DRAFT = null; EDITING = null;
  }
  if (h === "clients") return showView("clients");
  if (h === "settings") return showView("settings");
  showCat(catOf(h) ? h : CATS[0].id);
}
window.addEventListener("hashchange", () => { if (!$("app").hidden) route(); });
function showView(v){
  VIEW = v;
  $("viewCat").hidden = v !== "cat"; $("viewClients").hidden = v !== "clients"; $("viewSettings").hidden = v !== "settings";
  markNav();
  if (v === "clients") renderClients();
  if (v === "settings"){ let t = "general"; try { t = localStorage.getItem("esign.settab") || t; } catch {} showSetTab(t); }
  window.scrollTo(0, 0);
}

/* ============ 合約模組 ============ */
async function showCat(cat){
  if (CAT !== cat){ closeEditor(); $("qText").value = ""; $("qYear").value = ""; SEL.clear(); }
  CAT = cat; showView("cat");
  const c = catOf(cat);
  $("catTitle").textContent = c.label;
  $("catTone").style.setProperty("--tone", `var(${c.tone})`);
  $("newPanel").hidden = !!c.onlyIfAny;   // 未分類、已停用的模組只能查看，不能新增
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
    (!q || [r.name, r.short, r.taxId, r.title, r.code].some(v => (v || "").toLowerCase().includes(q))));
}
const linkFor = id => `${location.origin}/sign.html?c=${encodeURIComponent(id)}`;
/* 提交後即歸檔；管理人員開放重簽後，客戶可再提交一次 */
function resignState(c){
  if (!c.signedAt) return null;
  if (c.resignAllowed) return { key: "open", text: "已開放重簽" };
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
  updateBulk();
}

/* ---------- 全選／批次刪除 ---------- */
const SEL = new Set();
function updateBulk(){
  for (const id of [...SEL]) if (!ROWS.some(r => r.id === id)) SEL.delete(id);   // 已不存在的不算
  const list = filtered(), n = SEL.size;
  $("bulkBar").hidden = !n;
  if (!n) return;
  const nSigned = ROWS.filter(r => SEL.has(r.id) && r.signedAt).length;
  $("bulkInfo").textContent = `已選 ${n} 份合約` + (nSigned ? `（其中 ${nSigned} 份已簽署）` : "");
  const allIn = list.every(r => SEL.has(r.id));
  $("bulkAll").hidden = allIn;
  $("bulkAll").textContent = list.length === ROWS.length ? `全選本模組 ${list.length} 份` : `全選目前清單 ${list.length} 份`;
}
$("bulkAll").onclick = () => { for (const r of filtered()) SEL.add(r.id); renderRows(); };
$("bulkNone").onclick = () => { SEL.clear(); renderRows(); };
$("bulkDel").onclick = async () => {
  const ids = [...SEL]; if (!ids.length) return;
  const nSigned = ROWS.filter(r => SEL.has(r.id) && r.signedAt).length;
  const msg = `確定要刪除 ${ids.length} 份合約嗎？\n\n` +
    (nSigned ? `其中 ${nSigned} 份客戶已簽署，已簽 PDF 也會一起刪除。建議先按「下載全部已簽 PDF（ZIP）」備份。\n\n` : "") +
    "刪除後連結立即失效，而且無法復原。";
  if (!confirm(msg)) return;
  const b = $("bulkDel"); b.disabled = true; $("bulkAll").disabled = $("bulkNone").disabled = true;
  let done = 0;
  try {
    for (let i = 0; i < ids.length; i += 100){
      const part = ids.slice(i, i + 100);
      b.textContent = `刪除中 ${done}/${ids.length}…`;
      const r = await api("deleteMany", { method: "POST", body: JSON.stringify({ ids: part }) });
      if (!r.ok) throw new Error(r.status);
      done += part.length;
      const gone = new Set(part); ROWS = ROWS.filter(x => !gone.has(x.id)); part.forEach(id => SEL.delete(id));
    }
    toast(`已刪除 ${done} 份合約`);
  } catch (e) {
    if (!quiet(e)) toast(done ? `已刪除 ${done} 份，其餘刪除失敗，請再試一次` : "刪除失敗，請再試一次", 4000);
  } finally {
    b.disabled = false; b.textContent = "刪除所選"; $("bulkAll").disabled = $("bulkNone").disabled = false;
    renderRows(); loadCounts();
  }
};

function fillRows(box, rows, signed){
  box.innerHTML = "";
  if (!rows.length){
    const e = document.createElement("div"); e.className = "empty";
    e.textContent = ROWS.length ? "沒有符合條件的合約。" : (signed ? "還沒有客戶完成簽核。" : "目前沒有待簽的合約。按上方「新增合約」建立。");
    box.append(e); return;
  }
  const head = document.createElement("div"); head.className = "rowhead row ck";
  const all = document.createElement("input"); all.type = "checkbox"; all.className = "selbox";
  all.setAttribute("aria-label", signed ? "全選已簽核" : "全選尚未簽核");
  const nSel = rows.filter(c => SEL.has(c.id)).length;
  all.checked = nSel === rows.length; all.indeterminate = nSel > 0 && nSel < rows.length;
  all.onchange = () => { for (const c of rows) all.checked ? SEL.add(c.id) : SEL.delete(c.id); renderRows(); };
  head.append(all);
  for (const t of ["客戶", "合約", signed ? "簽核狀態" : "建立日期", ""]){ const s = document.createElement("span"); s.textContent = t; head.append(s); }
  box.append(head);
  for (const c of rows){
    const row = document.createElement("div"); row.className = "row ck" + (HIGHLIGHT.has(c.id) ? " new" : "") + (SEL.has(c.id) ? " sel" : "");
    const pick = document.createElement("input"); pick.type = "checkbox"; pick.className = "selbox"; pick.checked = SEL.has(c.id);
    pick.setAttribute("aria-label", `選取 ${c.name}`);
    pick.onchange = () => { pick.checked ? SEL.add(c.id) : SEL.delete(c.id); renderRows(); };
    row.append(pick);
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
    toast("已刪除"); ROWS = ROWS.filter(x => x.id !== c.id); SEL.delete(c.id); renderRows(); loadCounts();
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
  Object.assign(ED, { bytes: null, doc: null, page: 0, sig: null, date: null, nameAt: null, mode: "sig", questions: [] });
  for (const id of ["fName", "fShort", "fTaxId", "fFile", "pickFilter"]) $(id).value = "";
  $("fTitle").value = catOf(CAT).label; $("fYear").value = THIS_YEAR;
  $("fDate").checked = true; $("fSummary").checked = false; $("fNameOn").checked = false; $("fNameSize").value = "12";
  $("placeTools").hidden = true; $("btnSave").disabled = true; $("saveProgress").hidden = true;
  err("fileErr", ""); err("saveErr", "");
  PICKED = new Set(); renderQEd(); setMode("sig");
  ED.preset = null; $("presetName").value = ""; fillPresets();
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
$("fName").addEventListener("input", () => { if (ED.nameAt) drawMarks(); });
$("fName").addEventListener("input", () => {
  updateFnPreview();
  const hit = CLIENTS.find(c => c.name === $("fName").value.trim());
  if (hit){ $("fShort").value = hit.short || ""; $("fTaxId").value = hit.taxId || ""; }
  const y = +$("fYear").value;
  if (hit && statusOf(hit, y) === "終止") toast(`提醒：${hit.short || hit.name} 在 ${y} 年度的狀態是「終止」`, 4000);
});

/* 客戶比對：序號 > 統編 > 名稱 */
let PICKED = new Set();
const ckey = c => c.code ? "c:" + c.code : c.taxId ? "t:" + c.taxId : "n:" + c.name;
const keysOf = x => [x.code && "c:" + x.code, x.taxId && "t:" + x.taxId, "n:" + x.name].filter(Boolean);
function contractSet(year){ const set = new Set(); for (const r of ROWS) if (r.year === year) keysOf(r).forEach(k => set.add(k)); return set; }
const hasIn = (set, c) => keysOf(c).some(k => set.has(k));
const statusOf = (c, y) => (c.status && c.status[y]) || "";

/* 多位客戶：從客戶名單勾選；預設只列出合約年度「存續」的客戶 */
function renderPick(){
  const q = $("pickFilter").value.trim().toLowerCase(), box = $("pickList"); box.innerHTML = "";
  const year = +$("fYear").value, showAll = $("pickShowAll").checked;
  const have = contractSet(year);
  const anyStatus = CLIENTS.some(c => statusOf(c, year));
  const live = CLIENTS.filter(c => statusOf(c, year) === "存續").length;
  const gone = CLIENTS.filter(c => statusOf(c, year) === "終止").length;
  const unset = CLIENTS.length - live - gone;
  box.hidden = !CLIENTS.length;
  $("pickNote").textContent = !CLIENTS.length ? "客戶名單是空的。請先到左側「客戶名單」匯入客戶。"
    : !anyStatus ? `客戶名單還沒有 ${year} 年度的存續狀態，先列出全部 ${CLIENTS.length} 位。可到「客戶名單」設定 ${year} 年度狀態。`
    : showAll ? `列出全部 ${CLIENTS.length} 位（${year} 年度：存續 ${live}、終止 ${gone}、未設定 ${unset}）。`
    : `只列出 ${year} 年度「存續」的 ${live} 位客戶（另有終止 ${gone} 位、未設定 ${unset} 位，勾選「也顯示非存續客戶」可列出）。`;
  for (const c of CLIENTS){
    const st = statusOf(c, year);
    if (anyStatus && !showAll && st !== "存續") continue;
    if (q && ![c.code, c.name, c.short, c.taxId].some(v => (v || "").toLowerCase().includes(q))) continue;
    const k = ckey(c);
    const lab = document.createElement("label"); lab.className = "pickrow";
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = PICKED.has(k);
    cb.onchange = () => { if (cb.checked) PICKED.add(k); else PICKED.delete(k); updatePickCount(); };
    const code = document.createElement("span"); code.className = "code"; code.textContent = c.code || "";
    const nm = document.createElement("span"); nm.textContent = c.name + (c.short ? `（${c.short}）` : "");
    if (hasIn(have, c)){ const d = document.createElement("span"); d.className = "dup"; d.textContent = `已有 ${year} 年度此類合約`; nm.append(d); }
    const sc = document.createElement("span"); sc.className = "st " + (st === "存續" ? "live" : st === "終止" ? "gone" : "none"); sc.textContent = st || "—";
    const t = document.createElement("span"); t.className = "tid"; t.textContent = c.taxId || "—";
    lab.append(cb, code, nm, sc, t); box.append(lab);
  }
  updatePickCount();
}
$("pickShowAll").onchange = renderPick;
function updatePickCount(){ $("pickCount").textContent = `已選 ${PICKED.size} 位`; updateSaveLabel(); if (ED.nameAt) drawMarks(); }
$("pickFilter").addEventListener("input", renderPick);
$("fYear").addEventListener("input", () => { if (NEW_MODE === "batch") renderPick(); });
$("pickAll").onclick = () => { document.querySelectorAll("#pickList input").forEach(cb => { if (!cb.checked){ cb.checked = true; cb.onchange(); } }); };
$("pickNone").onclick = () => { PICKED = new Set(); renderPick(); };

const ED = { bytes: null, doc: null, page: 0, vw: 0, vh: 0, sig: null, date: null, nameAt: null, mode: "sig", scale: 1, questions: [] };
function setMode(m){
  ED.mode = m;
  $("modeSig").setAttribute("aria-pressed", m === "sig"); $("modeDate").setAttribute("aria-pressed", m === "date"); $("modeName").setAttribute("aria-pressed", m === "name");
  const key = typeof m === "object" ? `${m.qi}-${m.oi}${m.fill ? "-f" : ""}` : "";
  document.querySelectorAll("#qEd [data-mark]").forEach(b => b.setAttribute("aria-pressed", b.dataset.mark === key));
}
$("modeSig").onclick = () => setMode("sig");
$("modeDate").onclick = () => { if (!$("fDate").checked){ $("fDate").checked = true; ED.date = ED.date || defaultDate(); drawMarks(); } setMode("date"); };
$("fDate").onchange = e => { if (e.target.checked){ ED.date = ED.date || defaultDate(); } else { ED.date = null; if (ED.mode === "date") setMode("sig"); } drawMarks(); };
/* 客戶名稱：綠線是文字的起點（底線左端），每位客戶簽署時自動換成自己的完整名稱 */
const nameSize = () => +$("fNameSize").value || 12;
function defaultName(){ return { page: ED.page, x: Math.round(ED.vw * 0.18), y: 120, size: nameSize() }; }
$("modeName").onclick = () => { if (!ED.doc) return; if (!$("fNameOn").checked){ $("fNameOn").checked = true; } ED.nameAt = ED.nameAt || defaultName(); drawMarks(); setMode("name"); };
$("fNameOn").onchange = e => {
  if (e.target.checked){ if (ED.doc){ ED.nameAt = ED.nameAt || defaultName(); setMode("name"); toast("請在 PDF 上點一下要填客戶名稱的位置（底線的左端）"); } }
  else { ED.nameAt = null; if (ED.mode === "name") setMode("sig"); }
  drawMarks();
};
$("fNameSize").onchange = () => { if (ED.nameAt){ ED.nameAt.size = nameSize(); drawMarks(); } };
function sampleName(){
  if (NEW_MODE === "single" && $("fName").value.trim()) return $("fName").value.trim();
  if (NEW_MODE === "batch"){ const c = CLIENTS.find(c => PICKED.has(ckey(c))); if (c) return c.name; }
  return "○○○○股份有限公司";
}

$("fFile").onchange = async e => {
  const f = e.target.files[0]; err("fileErr",""); $("placeTools").hidden = true; $("btnSave").disabled = true;
  if (!f) return;
  const bytes = new Uint8Array(await f.arrayBuffer());
  try { await PDFLib.PDFDocument.load(bytes); }
  catch (x) {
    const enc = /encrypt/i.test(String(x && (x.name || x.message)));
    return err("fileErr", enc ? "這份 PDF 有密碼保護，請先移除保護再上傳。" : "讀不到這份 PDF，請確認檔案是否完整。");
  }
  ED.bytes = bytes; ED.sig = null; ED.date = null; ED.nameAt = null;
  ED.questions.forEach(q => { q.mark = null; q.options.forEach(o => { o.mark = null; o.inputMark = null; }); });
  ED.doc = await pdfjsLib.getDocument({ data: bytes.slice(), ...PDFJS_OPTS }).promise;
  const sel = $("fPage"); sel.innerHTML = "";
  for (let i = 1; i <= ED.doc.numPages; i++){ const o = document.createElement("option"); o.value = i - 1; o.textContent = `第 ${i} 頁` + (i === ED.doc.numPages ? "（最後一頁）" : ""); sel.append(o); }
  sel.value = ED.doc.numPages - 1;
  if (!$("fTitle").value){ $("fTitle").value = f.name.replace(/\.pdf$/i, ""); updateFnPreview(); }
  $("placeTools").hidden = false;
  await loadPage(ED.doc.numPages - 1);
  if (ED.preset) await applyPlacement(ED.preset);
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
  if ($("fNameOn").checked && !ED.nameAt) ED.nameAt = defaultName();
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
  const mn = $("markName"), na = ED.nameAt;
  mn.hidden = !na || na.page !== ED.page;
  if (na){ mn.textContent = sampleName(); Object.assign(mn.style, { left: na.x*k+"px", top: na.y*k+"px", fontSize: na.size*k+"px" }); }
  document.querySelectorAll("#place .optm").forEach(n => n.remove());
  ED.questions.forEach((q, qi) => q.options.forEach((o, oi) => {
    if (!o.mark || o.mark.page !== ED.page) return;
    const d = document.createElement("div"); d.className = "mark optm"; d.textContent = "✓";
    const lab = document.createElement("span"); lab.textContent = `${qi + 1}-${oi + 1} ${o.t || ""}`.trim(); d.append(lab);
    Object.assign(d.style, { left: o.mark.x*k+"px", top: o.mark.y*k+"px" });
    $("place").append(d);
  }));
  ED.questions.forEach((q, qi) => q.options.forEach((o, oi) => {
    if (!o.input || !o.inputMark || o.inputMark.page !== ED.page) return;
    const d = document.createElement("div"); d.className = "mark qtext optm";
    d.textContent = `${qi + 1}-${oi + 1} ${o.input === "number" ? "3" : "客戶填寫"}`;
    Object.assign(d.style, { left: o.inputMark.x*k+"px", top: o.inputMark.y*k+"px", fontSize: (o.inputMark.size || 11)*k+"px" });
    $("place").append(d);
  }));
  ED.questions.forEach((q, qi) => {
    if (!isTextQ(q) || !q.mark || q.mark.page !== ED.page) return;
    const d = document.createElement("div"); d.className = "mark qtext optm";
    d.textContent = `${qi + 1}. ${q.type === "number" ? "123,456" : "客戶填寫的文字"}`;
    Object.assign(d.style, { left: q.mark.x*k+"px", top: q.mark.y*k+"px", fontSize: (q.mark.size || 11)*k+"px" });
    $("place").append(d);
  });
  const parts = [`紅框（簽名）在第 ${s.page + 1} 頁`];
  if (ED.date) parts.push(`藍線（日期）在第 ${ED.date.page + 1} 頁`);
  if (ED.nameAt) parts.push(`綠線（客戶名稱）在第 ${ED.nameAt.page + 1} 頁`);
  $("placeStatus").textContent = parts.join("・") + "。切換「顯示第幾頁」可以到別頁放置。";
}
function placeAt(e){
  const r = $("place").getBoundingClientRect();
  const px = (e.clientX - r.left) / ED.scale, py = (e.clientY - r.top) / ED.scale;
  const m = ED.mode;
  if (m === "sig"){ ED.sig.page = ED.page; ED.sig.x = px - ED.sig.w/2; ED.sig.y = py - ED.sig.h/2; clampSig(); }
  else if (m === "date"){ ED.date = { page: ED.page, x: Math.min(Math.max(0, px), ED.vw - 60), y: Math.min(Math.max(14, py), ED.vh - 2) }; }
  else if (m === "name"){ ED.nameAt = { page: ED.page, x: Math.min(Math.max(0, px), ED.vw - 40), y: Math.min(Math.max(10, py), ED.vh - 2), size: nameSize() }; }
  else if (m.fill){ const o = ED.questions[m.qi] && ED.questions[m.qi].options[m.oi]; if (!o) return; o.inputMark = { page: ED.page, x: Math.min(Math.max(0, px), ED.vw - 30), y: Math.min(Math.max(8, py), ED.vh - 2), size: o.inputSize || 11 }; updateFillBtn(m.qi, m.oi); }
  else if (m.oi === "t"){ const q = ED.questions[m.qi]; if (!q) return; q.mark = { page: ED.page, x: Math.min(Math.max(0, px), ED.vw - 30), y: Math.min(Math.max(8, py), ED.vh - 2), size: q.size || 11 }; updateTextMarkBtn(m.qi); }
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
const isTextQ = q => q.type === "text" || q.type === "number";
function textMarkLabel(q){ return q.mark ? `填寫位置在第 ${q.mark.page + 1} 頁（重標）` : "在 PDF 上標填寫位置"; }
function updateTextMarkBtn(qi){
  const q = ED.questions[qi], b = document.querySelector(`#qEd [data-mark="${qi}-t"]`); if (b) b.textContent = textMarkLabel(q);
  const c = $(`qClr${qi}_t`); if (c) c.hidden = !q.mark;
}
function fillMarkLabel(o){ return o.inputMark ? `填寫位置在第 ${o.inputMark.page + 1} 頁（重標）` : "標填寫位置"; }
function updateFillBtn(qi, oi){
  const o = ED.questions[qi].options[oi], b = document.querySelector(`#qEd [data-mark="${qi}-${oi}-f"]`); if (b) b.textContent = fillMarkLabel(o);
  const c = $(`qClr${qi}_${oi}f`); if (c) c.hidden = !o.inputMark;
}
function renderQEd(){
  const box = $("qEd"); box.innerHTML = "";
  ED.questions.forEach((q, qi) => {
    const wrap = el("div", { className: "qed" });
    const qt = el("input", { type: "text", id: `qT${qi}`, value: q.q, placeholder: isTextQ(q) ? "題目，例如：本年度業外收入金額" : "題目，例如：本次委任的服務項目" });
    qt.setAttribute("aria-label", `第 ${qi + 1} 題題目`);
    qt.oninput = () => q.q = qt.value;
    const ty = el("select", { id: `qM${qi}` },
      el("option", { value: "single", textContent: "勾選：單選" }), el("option", { value: "multi", textContent: "勾選：可複選" }),
      el("option", { value: "text", textContent: "填寫：文字" }), el("option", { value: "number", textContent: "填寫：數字" }));
    ty.value = isTextQ(q) ? q.type : (q.multi ? "multi" : "single"); ty.setAttribute("aria-label", "題型");
    ty.onchange = () => {
      const v = ty.value;
      if (v === "text" || v === "number"){ q.type = v; q.multi = false; }
      else { q.type = "choice"; q.multi = v === "multi"; if (!q.options.length) q.options = [{ t: "", mark: null }, { t: "", mark: null }]; }
      if (typeof ED.mode === "object") setMode("sig");
      renderQEd(); drawMarks();
    };
    const rq = el("input", { type: "checkbox", id: `qR${qi}`, checked: q.required }); rq.onchange = () => q.required = rq.checked;
    const rql = el("label", { className: "ck", htmlFor: `qR${qi}` }, rq, "必填");
    const del = el("button", { className: "small danger", textContent: "刪除此題" });
    del.onclick = () => { ED.questions.splice(qi, 1); if (typeof ED.mode === "object") setMode("sig"); renderQEd(); drawMarks(); };
    wrap.append(el("div", { className: "r" }, el("strong", { textContent: `第 ${qi + 1} 題` }), ty, rql, del), el("div", { className: "r" }, qt));
    const opts = el("div", { className: "opts" });
    if (isTextQ(q)){
      // 客戶自行輸入：標出答案要寫在 PDF 的哪裡（底線左端）
      const mk = el("button", { className: "small", textContent: textMarkLabel(q) });
      mk.dataset.mark = `${qi}-t`; mk.setAttribute("aria-pressed", "false");
      mk.onclick = () => {
        if (!ED.doc){ toast("請先上傳 PDF"); return; }
        setMode({ qi, oi: "t" }); toast("在下方 PDF 頁面上點一下答案要寫的位置（底線的左端）", 3000);
        $("place").scrollIntoView({ block: "center", behavior: "smooth" });
      };
      const clr = el("button", { className: "small", id: `qClr${qi}_t`, textContent: "取消位置", hidden: !q.mark });
      clr.onclick = () => { q.mark = null; updateTextMarkBtn(qi); drawMarks(); };
      const sz = el("select", { id: `qS${qi}` }, ...[9, 10, 11, 12, 13, 14, 16].map(n => el("option", { value: String(n), textContent: `字級 ${n}` })));
      sz.value = String((q.mark && q.mark.size) || q.size || 11); sz.setAttribute("aria-label", "字級");
      sz.onchange = () => { q.size = +sz.value; if (q.mark) q.mark.size = q.size; drawMarks(); };
      opts.append(el("div", { className: "r" }, mk, clr, sz),
        el("p", { className: "small", textContent: q.type === "number"
          ? "客戶會看到一個輸入框，只能填數字（可含千分位逗號、小數點）。"
          : "客戶會看到一個輸入框，可輸入文字（最多 100 字）。" }));
    } else {
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
        const fsel = el("select", { id: `qF${qi}_${oi}` }, el("option", { value: "", textContent: "不需填寫" }),
          el("option", { value: "number", textContent: "勾選後填數字" }), el("option", { value: "text", textContent: "勾選後填文字" }));
        fsel.value = o.input || ""; fsel.setAttribute("aria-label", "勾選後是否要再填寫");
        fsel.onchange = () => { o.input = fsel.value || undefined; if (!o.input) o.inputMark = null; if (typeof ED.mode === "object") setMode("sig"); renderQEd(); drawMarks(); };
        opts.append(el("div", { className: "r" }, ot, mk, clr, fsel, rm));
        if (o.input){
          const fm = el("button", { className: "small", textContent: fillMarkLabel(o) });
          fm.dataset.mark = `${qi}-${oi}-f`; fm.setAttribute("aria-pressed", "false");
          fm.onclick = () => {
            if (!ED.doc){ toast("請先上傳 PDF"); return; }
            setMode({ qi, oi, fill: true }); toast(`在 PDF 上點一下「${o.t || "此選項"}」要填寫內容的位置（底線左端）`, 3000);
            $("place").scrollIntoView({ block: "center", behavior: "smooth" });
          };
          const fc = el("button", { className: "small", id: `qClr${qi}_${oi}f`, textContent: "取消位置", hidden: !o.inputMark });
          fc.onclick = () => { o.inputMark = null; updateFillBtn(qi, oi); drawMarks(); };
          const fz = el("select", {}, ...[9, 10, 11, 12, 13, 14, 16].map(n => el("option", { value: String(n), textContent: `字級 ${n}` })));
          fz.value = String((o.inputMark && o.inputMark.size) || o.inputSize || 11); fz.setAttribute("aria-label", "字級");
          fz.onchange = () => { o.inputSize = +fz.value; if (o.inputMark) o.inputMark.size = o.inputSize; drawMarks(); };
          opts.append(el("div", { className: "r fill-r" }, el("span", { className: "small", textContent: `↳ 勾「${o.t || "此選項"}」後要${o.input === "number" ? "填數字" : "填文字"}：` }), fm, fc, fz));
        }
      });
      const add = el("button", { className: "small", textContent: "＋ 新增選項" });
      add.onclick = () => { q.options.push({ t: "", mark: null }); renderQEd(); $(`qO${qi}_${q.options.length - 1}`).focus(); };
      opts.append(el("div", { className: "r" }, add));
    }
    wrap.append(opts); box.append(wrap);
  });
  setMode(ED.mode);
}
$("btnAddQ").onclick = () => {
  ED.questions.push({ q: "", type: "choice", multi: false, required: true, mark: null, options: [{ t: "", mark: null }, { t: "", mark: null }] });
  renderQEd(); $(`qT${ED.questions.length - 1}`).focus();
};


/* ---------- 設定範本：簽名框、日期位置、勾選題目（含打勾位置） ---------- */
let PRESETS = [];
async function loadPresets(){
  try { const r = await api("presets"); if (r.ok) PRESETS = (await r.json()).presets || []; } catch {}
}
const lastPresetKey = () => "esign.preset." + CAT;
function fillPresets(){
  const sel = $("presetSel"); sel.innerHTML = "";
  const none = document.createElement("option"); none.value = ""; none.textContent = "不使用範本"; sel.append(none);
  const mine = PRESETS.filter(p => p.category === CAT), others = PRESETS.filter(p => p.category !== CAT);
  for (const [label, list] of [[catOf(CAT) ? catOf(CAT).label : "本模組", mine], ["其他模組", others]]){
    if (!list.length) continue;
    const g = document.createElement("optgroup"); g.label = label;
    for (const p of list){ const o = document.createElement("option"); o.value = p.id; o.textContent = p.name + (p.category !== CAT && catOf(p.category) ? `（${catOf(p.category).label}）` : ""); g.append(o); }
    sel.append(g);
  }
  let last = ""; try { last = localStorage.getItem(lastPresetKey()) || ""; } catch {}
  sel.value = PRESETS.some(p => p.id === last) ? last : (mine[0] ? mine[0].id : "");
  $("btnDelPreset").hidden = !sel.value;
}
$("presetSel").onchange = () => { $("btnDelPreset").hidden = !$("presetSel").value; delete $("btnDelPreset").dataset.armed; $("btnDelPreset").textContent = "刪除此範本"; };
$("btnApplyPreset").onclick = async () => {
  const p = PRESETS.find(x => x.id === $("presetSel").value);
  if (!p) { ED.preset = null; toast("沒有選擇範本"); return; }
  try { localStorage.setItem(lastPresetKey(), p.id); } catch {}
  if (p.title) { $("fTitle").value = p.title; updateFnPreview(); }
  $("fSummary").checked = !!p.summary;
  ED.questions = p.questions.map(q => ({ q: q.q, type: q.type || "choice", multi: q.multi, required: q.required, mark: null,
    size: q.mark ? q.mark.size : undefined,
    options: q.options.map(o => ({ t: o.t, mark: null, input: o.input, inputMark: null, inputSize: o.inputMark ? o.inputMark.size : undefined })) }));
  ED.preset = p;
  renderQEd();
  if (ED.doc) { await applyPlacement(p); toast(`已套用「${p.name}」`); }
  else toast(`已套用「${p.name}」的題目。上傳 PDF 後會自動放好簽名框與打勾位置`, 4500);
  $("presetName").value = p.name;
};
/* 把範本的位置套到目前的 PDF：範本是在最後一頁簽名的，就放到這份 PDF 的最後一頁 */
async function applyPlacement(p){
  const last = ED.doc.numPages - 1;
  const map = pg => (p.sigLast && pg === p.sig.page) ? last : Math.min(pg, last);
  ED.sig = { ...p.sig, page: p.sigLast ? last : Math.min(p.sig.page, last) };
  $("fW").value = ED.sig.w; $("fH").value = ED.sig.h;
  ED.date = p.date ? { ...p.date, page: p.dateLast ? last : map(p.date.page) } : null;
  $("fDate").checked = !!p.date;
  ED.nameAt = p.nameAt ? { ...p.nameAt, page: p.nameLast ? last : map(p.nameAt.page) } : null;
  $("fNameOn").checked = !!p.nameAt; if (p.nameAt) $("fNameSize").value = String(p.nameAt.size || 12);
  p.questions.forEach((pq, qi) => {
    const q = ED.questions[qi]; if (!q) return;
    if (pq.mark) q.mark = { ...pq.mark, page: map(pq.mark.page) };
    pq.options.forEach((po, oi) => { const o = q.options[oi]; if (!o) return;
      o.mark = po.mark ? { ...po.mark, page: map(po.mark.page) } : null;
      o.inputMark = po.inputMark ? { ...po.inputMark, page: map(po.inputMark.page) } : null; });
  });
  $("fPage").value = ED.sig.page;
  await loadPage(ED.sig.page);
  clampSig(); renderQEd(); drawMarks();
}
$("btnSavePreset").onclick = async () => {
  const name = $("presetName").value.trim();
  if (!name) { toast("請先輸入範本名稱"); $("presetName").focus(); return; }
  if (!ED.doc || !ED.sig) { toast("請先上傳 PDF 並放好簽名框，再存成範本"); return; }
  const r = v => Math.round(v * 10) / 10, last = ED.doc.numPages - 1;
  const questions = ED.questions.filter(q => q.q.trim()).map(q => qOut(q, r));
  const preset = { id: (PRESETS.find(p => p.name === name && p.category === CAT) || {}).id, name, category: CAT, title: $("fTitle").value.trim(),
    sig: { page: ED.sig.page, x: r(ED.sig.x), y: r(ED.sig.y), w: r(ED.sig.w), h: r(ED.sig.h) }, sigLast: ED.sig.page === last,
    date: ED.date ? { page: ED.date.page, x: r(ED.date.x), y: r(ED.date.y) } : null, dateLast: !!ED.date && ED.date.page === last,
    nameAt: nameMeta(), nameLast: !!ED.nameAt && ED.nameAt.page === last,
    questions, summary: $("fSummary").checked };
  $("btnSavePreset").disabled = true;
  try {
    const res = await api("presets", { method: "POST", body: JSON.stringify({ preset }) });
    if (!res.ok) throw new Error(res.status);
    PRESETS = (await res.json()).presets;
    const saved = PRESETS.find(p => p.name === name && p.category === CAT);
    try { if (saved) localStorage.setItem(lastPresetKey(), saved.id); } catch {}
    fillPresets(); toast(preset.id ? `已更新範本「${name}」` : `已存成範本「${name}」`);
  } catch (e) { if (!quiet(e)) toast("儲存範本失敗，請再試一次"); }
  finally { $("btnSavePreset").disabled = false; }
};
$("btnDelPreset").onclick = async () => {
  const b = $("btnDelPreset"), id = $("presetSel").value; if (!id) return;
  if (!b.dataset.armed){ b.dataset.armed = "1"; b.textContent = "確定刪除？"; setTimeout(() => { delete b.dataset.armed; b.textContent = "刪除此範本"; }, 4000); return; }
  try {
    const res = await api("presets", { method: "POST", body: JSON.stringify({ deleteId: id }) });
    if (!res.ok) throw new Error(res.status);
    PRESETS = (await res.json()).presets; fillPresets(); toast("已刪除範本");
  } catch (e) { if (!quiet(e)) toast("刪除失敗，請再試一次"); }
};

const nameMeta = () => ED.nameAt ? { page: ED.nameAt.page, x: Math.round(ED.nameAt.x * 10) / 10, y: Math.round(ED.nameAt.y * 10) / 10, size: ED.nameAt.size } : null;
/* 題目送到伺服器的格式（勾選題含每個選項的打勾位置；填寫題含答案位置與字級） */
function qOut(q, r){
  const pt = m => m ? { page: m.page, x: r(m.x), y: r(m.y) } : null;
  if (isTextQ(q)) return { q: q.q.trim(), type: q.type, required: !!q.required, multi: false, options: [],
    mark: q.mark ? { ...pt(q.mark), size: q.mark.size || q.size || 11 } : null };
  return { q: q.q.trim(), type: "choice", multi: !!q.multi, required: !!q.required,
    options: q.options.filter(o => o.t.trim()).map(o => o.input
      ? { t: o.t.trim(), mark: pt(o.mark), input: o.input, inputMark: o.inputMark ? { ...pt(o.inputMark), size: o.inputMark.size || o.inputSize || 11 } : null }
      : { t: o.t.trim(), mark: pt(o.mark) }) };
}
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
    if (!q.q.trim() && (isTextQ(q) || !opts.length)) continue;
    if (!q.q.trim()) throw [`第 ${i + 1} 題還沒填題目。`, `qT${i}`];
    if (!isTextQ(q) && !opts.length) throw [`第 ${i + 1} 題至少要有一個選項。`];
    questions.push(qOut(q, r));
  }
  const summary = $("fSummary").checked;
  const tq = questions.findIndex(q => isTextQ(q) && !q.mark);
  for (let i = 0; i < questions.length && !summary; i++){
    const o = questions[i].options.find(o => o.input && !o.inputMark);
    if (o) throw [`第 ${i + 1} 題的「${o.t}」有填寫欄，但還沒標填寫位置。請按「標填寫位置」，不然客戶填的內容不會出現在 PDF 上。`];
  }
  if (tq >= 0 && !summary) throw [`第 ${tq + 1} 題「${questions[tq].q}」還沒標填寫位置。請按「在 PDF 上標填寫位置」，不然客戶填的內容不會出現在 PDF 上。`];
  if (questions.length && !summary){
    const qi = questions.findIndex(q => !isTextQ(q) && q.options.some(o => !o.mark));
    if (qi >= 0){
      const oi = questions[qi].options.findIndex(o => !o.mark);
      throw [`第 ${qi + 1} 題的「${questions[qi].options[oi].t}」還沒標位置。請按「在 PDF 上標位置」點在方框上，不然客戶勾了也不會出現在 PDF 上。`];
    }
  }
  return { category: CAT, year, title, questions, summary,
    sig: { page: ED.sig.page, x: r(ED.sig.x), y: r(ED.sig.y), w: r(ED.sig.w), h: r(ED.sig.h) },
    date: ED.date ? { page: ED.date.page, x: r(ED.date.x), y: r(ED.date.y) } : null, nameAt: nameMeta() };
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
  const hit = CLIENTS.find(c => c.name === name && (!taxId || !c.taxId || c.taxId === taxId));
  fd.append("meta", JSON.stringify({ ...meta, name, short, taxId, code: hit ? hit.code : "" }));
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
  const have = contractSet(meta.year);
  const dups = chosen.filter(c => hasIn(have, c));
  const notLive = chosen.filter(c => statusOf(c, meta.year) === "終止");
  const warns = [];
  if (dups.length) warns.push(`有 ${dups.length} 位客戶已經有 ${meta.year} 年度的${catOf(CAT).label}（例如：${dups.slice(0, 3).map(c => c.short || c.name).join("、")}）`);
  if (notLive.length) warns.push(`有 ${notLive.length} 位勾選的客戶在 ${meta.year} 年度是「終止」（例如：${notLive.slice(0, 3).map(c => c.short || c.name).join("、")}）`);
  if (warns.length && !dupArmed){
    dupArmed = true; setTimeout(() => { dupArmed = false; }, 8000);
    err("saveErr", warns.join("；") + "。確定要建立，請再按一次「產生」。");
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
/* 每位客戶：序號、名稱、簡稱、統編、組織型態，以及各年度狀態（存續／終止） */
async function loadClients(){
  try { const r = await api("clients"); if (!r.ok) throw new Error(r.status); CLIENTS = (await r.json()).clients || []; }
  catch (e) { if (!quiet(e)) toast("讀取客戶名單失敗"); }
  fillClientOptions();
}
function fillClientOptions(){
  const dl = $("clientOptions"); dl.innerHTML = "";
  for (const c of CLIENTS){ const o = document.createElement("option"); o.value = c.name; o.label = [c.code, c.short, c.taxId].filter(Boolean).join("・"); dl.append(o); }
}
async function saveClients(list, okMsg, errId){
  if (errId) err(errId, "");
  try {
    const r = await api("clients", { method: "POST", body: JSON.stringify({ clients: list }) });
    if (!r.ok) throw new Error(r.status);
    CLIENTS = (await r.json()).clients; CLIENT_COUNT = CLIENTS.length;
    fillClientOptions(); renderClients(); renderNav(); if (okMsg) toast(okMsg);
    return true;
  } catch (e) { if (!quiet(e)) { if (errId) err(errId, "儲存失敗，請再試一次。"); else toast("儲存失敗，請再試一次"); } return false; }
}

/* 年度下拉：今年、明年，以及名單裡出現過的年度 */
function fillClientYears(){
  const sel = $("cYear"), keep = sel.value || String(THIS_YEAR);
  const years = new Set([THIS_YEAR, THIS_YEAR + 1]);
  for (const c of CLIENTS) for (const y of Object.keys(c.status || {})) years.add(+y);
  sel.innerHTML = "";
  for (const y of [...years].sort((a, b) => b - a)){ const o = document.createElement("option"); o.value = y; o.textContent = `${y} 年度`; sel.append(o); }
  sel.value = keep;
}
const cYear = () => $("cYear").value || String(THIS_YEAR);

/* ---------- 編輯先存在草稿，按「儲存變更」才寫回 ---------- */
let EDITING = null, DRAFT = null;
const LIST = () => DRAFT || CLIENTS;
const plain = c => { const { _o, ...rest } = c; return rest; };
function mutate(fn){
  if (!DRAFT) DRAFT = CLIENTS.map(c => ({ ...c, status: { ...(c.status || {}) }, _o: JSON.stringify(c) }));
  fn(DRAFT); renderClients();
}
function dirtyInfo(){
  if (!DRAFT) return { changed: 0, added: 0, removed: 0, total: 0 };
  let changed = 0, added = 0;
  for (const c of DRAFT){ if (!c._o) added++; else if (c._o !== JSON.stringify(plain(c))) changed++; }
  const removed = CLIENTS.length - DRAFT.filter(c => c._o).length;
  return { changed, added, removed, total: changed + added + removed };
}
function updateSaveBar(){
  const d = dirtyInfo();
  if (DRAFT && !d.total) DRAFT = null;
  $("clientSaveBar").hidden = !DRAFT;
  if (DRAFT) $("dirtyText").textContent = "未儲存的變更：" + [d.changed && `修改 ${d.changed} 位`, d.added && `新增 ${d.added} 位`, d.removed && `刪除 ${d.removed} 位`].filter(Boolean).join("、");
}
$("btnSaveClients").onclick = async () => {
  if (!DRAFT) return;
  $("btnSaveClients").disabled = true;
  if (await saveClients(DRAFT.map(plain), "已儲存變更", "clientErr")){ DRAFT = null; EDITING = null; renderClients(); }
  $("btnSaveClients").disabled = false;
};
$("btnDiscard").onclick = () => { DRAFT = null; EDITING = null; renderClients(); toast("已放棄變更"); };
window.addEventListener("beforeunload", e => { if (DRAFT){ e.preventDefault(); e.returnValue = ""; } });

function renderClients(){
  fillClientYears();
  const L = LIST();
  const y = cYear(), q = $("clientFilter").value.trim().toLowerCase(), sf = $("cStatusFilter").value;
  $("cYearHead").textContent = `${y} 狀態`;
  const live = L.filter(c => statusOf(c, y) === "存續").length, gone = L.filter(c => statusOf(c, y) === "終止").length;
  $("clientStats").innerHTML = "";
  for (const [n, l] of [[L.length, "位客戶"], [live, `${y} 存續`], [gone, `${y} 終止`]]){
    const s = document.createElement("span"); const b = document.createElement("b"); b.textContent = n; s.append(b, l); $("clientStats").append(s);
  }
  // 新年度還沒設定狀態：提供「沿用前一年度」
  const prev = String(+y - 1);
  const prevLive = L.filter(c => statusOf(c, prev) === "存續");
  const show = L.length && !L.some(c => statusOf(c, y)) && prevLive.length;
  $("carryBox").hidden = !show;
  if (show){
    $("carryText").textContent = `${y} 年度還沒有設定客戶狀態。可以先沿用 ${prev} 年度：${prev} 年度存續的 ${prevLive.length} 位設為 ${y} 存續，其餘設為終止，之後再個別調整（記得按最下方「儲存變更」）。`;
    $("btnCarry").textContent = `沿用 ${prev} 年度狀態`;
  }

  const box = $("clientRows"); box.innerHTML = "";
  const list = L.map((c, i) => [c, i]).filter(([c]) => {
    const st = statusOf(c, y);
    if (sf === "none" ? st : (sf && st !== sf)) return false;
    return !q || [c.code, c.name, c.short, c.taxId, c.org].some(v => (v || "").toLowerCase().includes(q));
  });
  if (!list.length){ const e = document.createElement("div"); e.className = "empty"; e.textContent = L.length ? "沒有符合的客戶。" : "還沒有客戶。按「匯入 Excel 名單」一次加入整份名單。"; box.append(e); updateSaveBar(); return; }
  for (const [c, i] of list){
    const row = document.createElement("div");
    const isNew = DRAFT && !c._o, isChanged = DRAFT && c._o && c._o !== JSON.stringify(plain(c));
    row.className = "row crow" + (isNew || isChanged ? " dirty" : "");
    const acts = document.createElement("div"); acts.className = "acts";
    const mk = (label, fn, cls) => { const x = document.createElement("button"); x.className = "small" + (cls ? " " + cls : ""); x.textContent = label; x.onclick = () => fn(x); acts.append(x); };
    const stSel = document.createElement("select"); stSel.setAttribute("aria-label", `${c.name} ${y} 年度狀態`);
    for (const [v, t] of [["", "未設定"], ["存續", "存續"], ["終止", "終止"]]){ const o = document.createElement("option"); o.value = v; o.textContent = t; stSel.append(o); }
    stSel.value = statusOf(c, y);
    stSel.className = "st " + (stSel.value === "存續" ? "live" : stSel.value === "終止" ? "gone" : "none");
    stSel.onchange = () => mutate(D => { if (stSel.value) D[i].status[y] = stSel.value; else delete D[i].status[y]; });
    if (EDITING === i){
      const f = (k, label, w) => { const x = document.createElement("input"); x.value = c[k] || ""; x.setAttribute("aria-label", label); if (w) x.maxLength = w; return x; };
      const ins = [f("code", "序號", 20), f("name", "客戶名稱"), f("short", "簡稱"), f("taxId", "統一編號", 8), f("org", "組織型態")];
      ins[3].inputMode = "numeric"; ins[4].setAttribute("list", "orgOptions");
      row.append(...ins, stSel);
      mk("完成", () => {
        const v = { code: ins[0].value.trim(), name: ins[1].value.trim(), short: ins[2].value.trim(), taxId: ins[3].value.replace(/\D/g, ""), org: ins[4].value.trim() };
        if (!v.name) return toast("客戶名稱不能空白");
        if (v.taxId && v.taxId.length !== 8) return toast("統一編號要是 8 碼數字");
        EDITING = null;
        mutate(D => { Object.assign(D[i], v); });
      }, "primary ink");
      mk("取消", () => { EDITING = null; renderClients(); });
    } else {
      const code = document.createElement("div"); code.className = "code"; code.textContent = c.code || "—";
      const n = document.createElement("div"); n.className = "who"; const nb = document.createElement("b"); nb.textContent = c.name; n.append(nb);
      const sh = document.createElement("div"); sh.textContent = c.short || "—";
      const t = document.createElement("div"); t.className = "tid"; t.textContent = c.taxId || "—";
      const og = document.createElement("div"); og.className = "sub"; og.textContent = c.org || "—";
      row.append(code, n, sh, t, og, stSel);
      mk("編輯", () => { EDITING = i; renderClients(); });
      mk("刪除", x => {
        if (!x.dataset.armed){ x.dataset.armed = "1"; x.textContent = "確定刪除？"; setTimeout(() => { delete x.dataset.armed; x.textContent = "刪除"; }, 4000); return; }
        EDITING = null; mutate(D => { D.splice(i, 1); });
      }, "danger");
    }
    row.append(acts); box.append(row);
  }
  updateSaveBar();
}
$("clientFilter").addEventListener("input", renderClients);
$("cYear").onchange = renderClients;
$("cStatusFilter").onchange = renderClients;
$("btnCarry").onclick = () => {
  const y = cYear(), prev = String(+y - 1);
  mutate(D => { for (const c of D) c.status[y] = statusOf(c, prev) === "存續" ? "存續" : "終止"; });
  toast(`已套用 ${y} 年度狀態，請檢查後按最下方「儲存變更」`, 4000);
};

$("btnAddClient").onclick = () => {
  $("addClientBox").hidden = false; $("importBox").hidden = true;
  $("addClientYear").textContent = `新增的客戶會設為 ${cYear()} 年度「存續」，加入後請按最下方「儲存變更」。`;
  $("cName").focus();
};
$("cCancel").onclick = () => { $("addClientBox").hidden = true; };
$("cSave").onclick = () => {
  err("addClientErr", "");
  const v = { code: $("cCode").value.trim(), name: $("cName").value.trim(), short: $("cShort").value.trim(),
    taxId: $("cTax").value.replace(/\D/g, ""), org: $("cOrg").value.trim(), status: { [cYear()]: "存續" } };
  if (!v.name) return err("addClientErr", "請填客戶名稱。");
  if (v.taxId && v.taxId.length !== 8) return err("addClientErr", "統一編號要是 8 碼數字，或留空。");
  if (v.code && LIST().some(c => c.code === v.code)) return err("addClientErr", "名單裡已經有這個序號。");
  if (v.taxId && LIST().some(c => c.taxId === v.taxId)) return err("addClientErr", "名單裡已經有這個統一編號。");
  mutate(D => { D.push(v); });
  for (const id of ["cCode", "cName", "cShort", "cTax", "cOrg"]) $(id).value = "";
  $("addClientBox").hidden = true;
  toast(`已加入「${v.name}」，請按最下方「儲存變更」`, 4000);
};

/* ---------- 匯入：Excel 檔、CSV，或從 Excel 複製貼上 ---------- */
let IMPORT = [];
const COLS = [
  ["code", /^(序號|編號|客戶編號|代號|客戶代號)$/],
  ["name", /^(客戶名稱|名稱|公司名稱|客戶全名|全名)$/],
  ["short", /^(客戶簡稱|簡稱)$/],
  ["taxId", /^(統一編號|統編|統一編號\(統編\))$/],
  ["org", /^(組織型態|組織型式|組織)$/],
];
const normStatus = v => { v = String(v ?? "").trim(); return /^(存續|存在|有|是|Y|V|✓|O)$/i.test(v) ? "存續" : /^(終止|不存在|解約|停止|無|否|N|X)$/i.test(v) ? "終止" : ""; };
/* rows：二維陣列（第一列為標題）。沒有標題時，退回「名稱、簡稱、統編」三欄 */
function rowsToClients(rows){
  rows = rows.map(r => r.map(v => String(v ?? "").trim().replace(/^="?|"$/g, "").replace(/^"|"$/g, ""))).filter(r => r.some(Boolean));
  if (!rows.length) return [];
  const head = rows[0], map = {}, years = {};
  head.forEach((h, i) => {
    for (const [k, re] of COLS) if (re.test(h) && map[k] === undefined) map[k] = i;
    const y = h.replace(/\.0$/, ""); if (/^\d{4}$/.test(y) && +y >= 1990 && +y <= 2100) years[y] = i;
  });
  const out = [];
  if (map.name !== undefined){
    for (const r of rows.slice(1)){
      const c = { name: r[map.name] || "" };
      for (const k of ["code", "short", "taxId", "org"]) if (map[k] !== undefined) c[k] = r[map[k]] || "";
      if (c.taxId) c.taxId = c.taxId.replace(/\.0$/, "").replace(/\D/g, ""); if (c.taxId && c.taxId.length < 8) c.taxId = c.taxId.padStart(8, "0");
      c.status = {};
      for (const [y, i] of Object.entries(years)){ const st = normStatus(r[i]); if (st) c.status[y] = st; }
      if (c.name) out.push(c);
    }
    return out;
  }
  for (const r of rows){
    let ti = r.findIndex(v => /^\d{8}$/.test(v.replace(/[-\s]/g, "")));
    const taxId = ti >= 0 ? r[ti].replace(/[-\s]/g, "") : "";
    const rest = r.filter((v, k) => k !== ti && v !== "");
    if (rest.length) out.push({ name: rest[0], short: rest[1] || "", taxId, status: {} });
  }
  return out;
}
function textToRows(text){
  return text.replace(/\r/g, "").split("\n").filter(l => l.trim()).map(l => l.includes("\t") ? l.split("\t") : splitCsv(l));
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
function showImportPreview(){
  const n = IMPORT.length, noTax = IMPORT.filter(c => !c.taxId).length;
  const years = [...new Set(IMPORT.flatMap(c => Object.keys(c.status || {})))].sort();
  const yrs = years.map(y => `${y}：存續 ${IMPORT.filter(c => c.status[y] === "存續").length}、終止 ${IMPORT.filter(c => c.status[y] === "終止").length}`).join("；");
  $("importPreview").textContent = n
    ? `讀到 ${n} 位客戶${noTax ? `（其中 ${noTax} 位沒有統編）` : ""}。${yrs ? "年度狀態　" + yrs + "。" : ""}例如：${IMPORT.slice(0, 2).map(c => [c.code, c.name, c.taxId].filter(Boolean).join(" ")).join("、")}`
    : "讀不到客戶，請確認第一列有「客戶名稱」標題，或每列至少有客戶名稱。";
  $("importSave").disabled = !n;
}
$("btnImport").onclick = () => { $("importBox").hidden = false; $("addClientBox").hidden = true; };
$("importCancel").onclick = () => { $("importBox").hidden = true; };
$("importText").addEventListener("input", () => { IMPORT = rowsToClients(textToRows($("importText").value)); showImportPreview(); });
$("importFile").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  err("importErr", "");
  const buf = await f.arrayBuffer();
  if (/\.xlsx?$/i.test(f.name)){
    if (!window.XLSX) return err("importErr", "Excel 讀取元件還在載入，請稍等幾秒再選一次檔案。");
    try {
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
      IMPORT = rowsToClients(rows);
    } catch (x) { console.error(x); return err("importErr", "讀不到這個 Excel 檔，請另存成 .xlsx 再試一次。"); }
  } else {
    let text = new TextDecoder("utf-8").decode(buf);
    if (text.includes("�")) { try { text = new TextDecoder("big5").decode(buf); } catch {} }   // 舊版 Excel 存的中文 CSV
    IMPORT = rowsToClients(textToRows(text.replace(/^﻿/, "")));
  }
  $("importText").value = "";
  showImportPreview();
};
$("importSave").onclick = async () => {
  if (DRAFT) return err("importErr", "名單有未儲存的變更，請先按最下方「儲存變更」或「放棄變更」再匯入。");
  const replace = document.querySelector('input[name="importMode"]:checked').value === "replace";
  let next;
  if (replace) next = IMPORT;
  else {
    next = CLIENTS.map(c => ({ ...c, status: { ...(c.status || {}) } }));
    for (const c of IMPORT){
      const k = next.findIndex(x => (c.code && x.code === c.code) || (c.taxId && x.taxId === c.taxId) || (!c.code && !c.taxId && x.name === c.name));
      if (k >= 0){
        const o = next[k];
        next[k] = { code: c.code || o.code, name: c.name || o.name, short: c.short || o.short, taxId: c.taxId || o.taxId, org: c.org || o.org, status: { ...(o.status || {}), ...(c.status || {}) } };
      } else next.push(c);
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

/* ---------- 系統設定分頁 ---------- */
function showSetTab(t){
  if (!["general", "presets", "logs"].includes(t)) t = "general";
  try { localStorage.setItem("esign.settab", t); } catch {}
  document.querySelectorAll("#setTabs [data-tab]").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === t));
  $("tabGeneral").hidden = t !== "general"; $("tabPresets").hidden = t !== "presets"; $("tabLogs").hidden = t !== "logs";
  if (t === "general" && !USAGE) loadUsage();
  if (t === "presets") loadPresetMgr();
  if (t === "logs") loadLogs();
}
document.querySelectorAll("#setTabs [data-tab]").forEach(b => b.onclick = () => showSetTab(b.dataset.tab));

/* ---------- 範本管理 ---------- */
let PEDIT = null, PORIG = null;
async function loadPresetMgr(){
  if (!PEDIT) $("presetRows").innerHTML = '<div class="empty">讀取中…</div>';
  await loadPresets(); renderPresetRows();
}
function presetSummary(p){
  const parts = [p.sigLast ? "簽名：最後一頁" : `簽名：第 ${p.sig.page + 1} 頁`];
  if (p.date) parts.push("自動日期");
  if (p.nameAt) parts.push(`客戶名稱（${p.nameAt.size || 12} 級）`);
  const nText = p.questions.filter(isTextQ).length, nChoice = p.questions.length - nText;
  if (nChoice) parts.push(`${nChoice} 題勾選`);
  if (nText) parts.push(`${nText} 題填寫`);
  if (!p.questions.length) parts.push("無題目");
  if (p.summary) parts.push("附勾選結果頁");
  return parts.join("・");
}
function renderPresetRows(){
  const box = $("presetRows"); box.innerHTML = "";
  if (!PRESETS.length){ box.innerHTML = '<div class="empty">還沒有範本。到任一模組按「新增合約」，上傳 PDF 並放好簽名框後，按「另存為範本」即可建立。</div>'; return; }
  const order = id => { const i = CATS.findIndex(c => c.id === id); return i < 0 ? 99 : i; };
  const list = [...PRESETS].sort((a, b) => order(a.category) - order(b.category) || a.name.localeCompare(b.name, "zh-Hant"));
  for (const p of list){
    const c = catOf(p.category);
    const row = el("div", { className: "row prow" + (PEDIT && PEDIT.id === p.id ? " editing" : "") });
    row.append(
      el("div", { className: "who" }, el("b", { textContent: p.name }), el("div", { className: "sub", textContent: p.updated ? "更新於 " + fmtDateTime(new Date(p.updated)) : "" })),
      el("div", { className: "doc" }, el("div", { textContent: c ? c.label : "—" }), el("div", { className: "sub", textContent: p.title || "（未設定）" })),
      el("div", { className: "sub", textContent: presetSummary(p) }));
    const acts = el("div", { className: "acts" });
    const bE = el("button", { className: "small", textContent: "編輯" }); bE.onclick = () => openPresetEd(p.id);
    const bC = el("button", { className: "small", textContent: "複製" }); bC.onclick = () => copyPreset(p, bC);
    const bD = el("button", { className: "small danger", textContent: "刪除" }); bD.onclick = () => delPreset(p, bD);
    acts.append(bE, bC, bD); row.append(acts); box.append(row);
  }
}
async function postPreset(body){
  const res = await api("presets", { method: "POST", body: JSON.stringify(body) });
  if (res.status === 409) throw new Error("name_taken");
  if (!res.ok) throw new Error(res.status);
  PRESETS = (await res.json()).presets;
  if (CAT) fillPresets();
}
async function copyPreset(p, b){
  let name = `${p.name}（複本）`, i = 2;
  while (PRESETS.some(x => x.name === name && x.category === p.category)) name = `${p.name}（複本 ${i++}）`;
  const { id, updated, ...rest } = p;
  b.disabled = true;
  try { await postPreset({ preset: { ...rest, name: name.slice(0, 40) } }); renderPresetRows(); toast(`已複製為「${name}」`); }
  catch (e) { if (!quiet(e)) toast("複製失敗，請再試一次"); }
  finally { b.disabled = false; }
}
async function delPreset(p, b){
  if (!b.dataset.armed){ b.dataset.armed = "1"; b.textContent = "確定刪除？"; setTimeout(() => { delete b.dataset.armed; b.textContent = "刪除"; }, 4000); return; }
  b.disabled = true;
  try {
    await postPreset({ deleteId: p.id });
    if (PEDIT && PEDIT.id === p.id) closePresetEd();
    renderPresetRows(); toast(`已刪除範本「${p.name}」`);
  } catch (e) { b.disabled = false; if (!quiet(e)) toast("刪除失敗，請再試一次"); }
}
function openPresetEd(id){
  const p = PRESETS.find(x => x.id === id); if (!p) return;
  PORIG = p; PEDIT = JSON.parse(JSON.stringify(p));
  $("peHead").textContent = `編輯範本：${p.name}`;
  $("peName").value = p.name; $("peTitleIn").value = p.title || "";
  const sel = $("peCat"); sel.innerHTML = "";
  for (const c of CATS.filter(c => !c.onlyIfAny || c.id === p.category)) sel.append(el("option", { value: c.id, textContent: c.label }));
  sel.value = p.category;
  // 位置要在 PDF 上放，這裡只能關掉；原本沒有的不能在這裡打開
  $("peDate").checked = !!p.date; $("peDate").disabled = !p.date;
  $("peDate").closest("label").title = p.date ? "" : "這個範本沒有放日期位置，請到新增合約時放置";
  $("peNameOn").checked = !!p.nameAt; $("peNameOn").disabled = !p.nameAt;
  $("peNameOn").closest("label").title = p.nameAt ? "" : "這個範本沒有放客戶名稱位置，請到新增合約時放置";
  $("peNameSize").value = String(p.nameAt ? p.nameAt.size || 12 : 12); $("peNameSize").disabled = !p.nameAt;
  $("peSummary").checked = !!p.summary;
  err("peErr", ""); renderPeQs(); renderPresetRows();
  $("presetEd").hidden = false;
  $("presetEd").scrollIntoView({ block: "start", behavior: reduceMotion() ? "auto" : "smooth" });
  $("peName").focus({ preventScroll: true });
}
function closePresetEd(){ PEDIT = PORIG = null; $("presetEd").hidden = true; renderPresetRows(); }
$("peNameOn").onchange = e => { $("peNameSize").disabled = !e.target.checked; };
$("peCancel").onclick = closePresetEd;
const peCheck = (label, val, on) => { const i = el("input", { type: "checkbox", checked: !!val }); i.onchange = () => on(i.checked); return el("label", { className: "ck-inline" }, i, label); };
function renderPeQs(){
  const box = $("peQs"); box.innerHTML = "";
  if (!PEDIT.questions.length) box.append(el("p", { className: "small", textContent: "這個範本沒有勾選題目。" }));
  PEDIT.questions.forEach((q, qi) => {
    const card = el("div", { className: "pq" });
    const t = el("input", { value: q.q, placeholder: "題目", maxLength: 500, id: `peQ${qi}` }); t.oninput = () => { q.q = t.value; };
    const del = el("button", { className: "small danger", textContent: "刪除題目" }); del.onclick = () => { PEDIT.questions.splice(qi, 1); renderPeQs(); };
    const flags = el("div", { className: "pq-flags" }, peCheck("必填", q.required, v => { q.required = v; }));
    if (isTextQ(q)) flags.append(el("span", { className: "tag nreq", textContent: q.type === "number" ? "填寫：數字" : "填寫：文字" }),
      el("span", { className: "tag " + (q.mark ? "nreq" : "req"), textContent: q.mark ? `填寫位置在第 ${q.mark.page + 1} 頁` : "未標填寫位置" }));
    else flags.append(peCheck("可複選", q.multi, v => { q.multi = v; }));
    flags.append(del);
    card.append(el("div", { className: "pq-h" }, el("span", { className: "pq-n", textContent: `${qi + 1}.` }), t), flags);
    if (isTextQ(q)){ box.append(card); return; }
    q.options.forEach((o, oi) => {
      const oin = el("input", { value: o.t, placeholder: "選項文字", maxLength: 300, id: `peO${qi}-${oi}` }); oin.oninput = () => { o.t = oin.value; };
      const tag = el("span", { className: "tag " + (o.mark ? "nreq" : "req"), textContent: o.mark ? `已標第 ${o.mark.page + 1} 頁` : "未標位置" });
      const ftag = o.input ? el("span", { className: "tag " + (o.inputMark ? "nreq" : "req"), textContent: (o.input === "number" ? "附填數字" : "附填文字") + (o.inputMark ? "" : "（未標位置）") }) : "";
      const x = el("button", { className: "small", textContent: "✕", title: "刪除選項" }); x.setAttribute("aria-label", "刪除選項");
      x.onclick = () => { q.options.splice(oi, 1); renderPeQs(); };
      card.append(el("div", { className: "pq-o" }, oin, tag, ftag, x));
    });
    const add = el("button", { className: "small", textContent: "＋ 新增選項" });
    add.onclick = () => { q.options.push({ t: "", mark: null }); renderPeQs(); $(`peO${qi}-${q.options.length - 1}`).focus(); };
    card.append(add); box.append(card);
  });
}
$("peAddQ").onclick = () => { PEDIT.questions.push({ q: "", multi: false, required: true, options: [{ t: "", mark: null }] }); renderPeQs(); $(`peQ${PEDIT.questions.length - 1}`).focus(); };
$("peSave").onclick = async () => {
  err("peErr", "");
  const name = $("peName").value.trim(), category = $("peCat").value;
  if (!name) { err("peErr", "請填範本名稱。"); $("peName").focus(); return; }
  if (PRESETS.some(x => x.id !== PEDIT.id && x.name === name && x.category === category)) { err("peErr", `「${catOf(category).label}」已經有叫「${name}」的範本，請換一個名稱。`); $("peName").focus(); return; }
  const questions = [];
  for (let i = 0; i < PEDIT.questions.length; i++){
    const q = PEDIT.questions[i], opts = q.options.filter(o => o.t.trim());
    if (!q.q.trim() && (isTextQ(q) || !opts.length)) continue;
    if (!q.q.trim()) { err("peErr", `第 ${i + 1} 題還沒填題目。`); $(`peQ${i}`).focus(); return; }
    if (isTextQ(q)) { questions.push({ q: q.q.trim(), type: q.type, required: !!q.required, multi: false, options: [], mark: q.mark || null }); continue; }
    if (!opts.length) { err("peErr", `第 ${i + 1} 題至少要有一個選項。`); return; }
    questions.push({ q: q.q.trim(), type: "choice", multi: !!q.multi, required: !!q.required, options: opts.map(o => ({ ...o, t: o.t.trim() })) });
  }
  const summary = $("peSummary").checked;
  const preset = { ...PEDIT, name, category, title: $("peTitleIn").value.trim(), summary, questions,
    date: $("peDate").checked ? PORIG.date : null, dateLast: $("peDate").checked && !!PORIG.dateLast,
    nameAt: $("peNameOn").checked && PORIG.nameAt ? { ...PORIG.nameAt, size: +$("peNameSize").value } : null,
    nameLast: $("peNameOn").checked && !!PORIG.nameLast };
  delete preset.updated;
  $("peSave").disabled = true;
  try {
    await postPreset({ preset });
    const unmarked = !summary && questions.some(q => isTextQ(q) ? !q.mark : q.options.some(o => !o.mark || (o.input && !o.inputMark)));
    closePresetEd();
    toast(unmarked ? `已儲存「${name}」。有選項還沒標位置，套用後請在 PDF 上標好再建立連結` : `已儲存範本「${name}」`, unmarked ? 5000 : 2500);
  } catch (e) {
    if (e.message === "name_taken") err("peErr", "同一個模組已經有同名的範本，請換一個名稱。");
    else if (!quiet(e)) err("peErr", "儲存失敗，請再試一次。");
  } finally { $("peSave").disabled = false; }
};

/* ---------- 使用空間 ---------- */
let USAGE = null;
const fmtBytes = n => n >= 1048576 ? (n / 1048576).toFixed(n >= 104857600 ? 0 : 1) + " MB" : Math.max(0, Math.round(n / 1024)) + " KB";
async function loadUsage(){
  $("btnUsage").disabled = true; $("uTotalSub").textContent = "計算中…（合約多時需要幾秒）";
  try {
    const r = await api("usage"); if (!r.ok) throw new Error(r.status);
    const u = USAGE = await r.json();
    $("uTotal").textContent = fmtBytes(u.total);
    $("uTotalSub").textContent = `統計時間 ${fmtDateTime(new Date(u.at))}`;
    $("uOwn").textContent = fmtBytes(u.own);
    $("uTpl").textContent = `${fmtBytes(u.tpl)}（${u.tplCount} 份）`;
    $("uSigned").textContent = `${fmtBytes(u.signed)}（${u.signedCount} 份）`;
    $("uCount").textContent = `${u.contracts} 份（已簽 ${u.signedCount}、未簽 ${u.contracts - u.signedCount}）`;
    $("uMisc").textContent = `${u.clients} 位／${u.presets} 個`;
    const t = u.total || 1;
    $("uBarOwn").style.width = (u.own / t * 100) + "%"; $("uBarTpl").style.width = (u.tpl / t * 100) + "%"; $("uBarSigned").style.width = (u.signed / t * 100) + "%";
  } catch (e) { if (!quiet(e)) $("uTotalSub").textContent = "統計失敗，請再按一次「重新計算」。"; }
  finally { $("btnUsage").disabled = false; }
}
$("btnUsage").onclick = loadUsage;

/* ---------- 登入紀錄 ---------- */
let LOGS = [], LOG_SHOW = 50;
function uaText(ua){
  const os = /Windows/.test(ua) ? "Windows" : /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "其他";
  const br = /Edg\//.test(ua) ? "Edge" : /Line\//.test(ua) ? "LINE" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "瀏覽器";
  return `${br}／${os}`;
}
async function loadLogs(){
  try { const r = await api("logs"); if (!r.ok) throw new Error(r.status); LOGS = (await r.json()).logs || []; }
  catch (e) { if (!quiet(e)) { $("logRows").innerHTML = '<div class="empty">讀取登入紀錄失敗。</div>'; } return; }
  renderLogs();
}
function renderLogs(){
  const box = $("logRows"); box.innerHTML = "";
  const list = $("logFailOnly").checked ? LOGS.filter(l => !l.ok) : LOGS;
  if (!list.length){ box.innerHTML = $("logFailOnly").checked ? '<div class="empty">沒有登入失敗的紀錄。</div>' : '<div class="empty">還沒有紀錄。紀錄從這次更新後開始：請按左下角「登出」，再輸入密碼登入一次，就會出現第一筆。</div>'; $("logMoreWrap").hidden = true; return; }
  for (const l of list.slice(0, LOG_SHOW)){
    const row = document.createElement("div"); row.className = "row lrow";
    const cells = [
      ["t", fmtDateTime(new Date(l.at))],
      ["res " + (l.ok ? "ok" : "bad"), l.ok ? "成功" : "密碼錯誤"],
      ["", l.device || "（未填）"],
      ["", uaText(l.ua || "")],
      ["", l.loc || "—"],
      ["ip", l.ip || "—"],
    ];
    for (const [cls, text] of cells){ const d = document.createElement(cls.startsWith("res") ? "span" : "div"); if (cls) d.className = cls; d.textContent = text; if (cls === "") d.title = text; row.append(d); }
    box.append(row);
  }
  $("logMoreWrap").hidden = list.length <= LOG_SHOW;
}
$("logFailOnly").onchange = () => { LOG_SHOW = 50; renderLogs(); };
$("logMore").onclick = () => { LOG_SHOW += 100; renderLogs(); };
$("btnLogs").onclick = loadLogs;

/* 回到這個分頁時更新簽核狀態 */
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && KEY && !$("app").hidden && VIEW === "cat" && $("editor").hidden){ loadRows(); loadCounts(); }
});

if (KEY) api("ping").then(r => r.ok && enter()).catch(() => {});
else $("pwIn").focus();
