/* 共用小工具 */
const $ = id => document.getElementById(id);
const pad2 = n => String(n).padStart(2, "0");
const fmtDate = d => `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
const fmtDateTime = d => `${fmtDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const cleanName = s => (s || "").trim().replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ");
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
function toast(m, ms){ const t = $("toast"); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, ms || 2600); }
function err(id, m){ const e = $(id); e.textContent = m || ""; e.hidden = !m; }
const ss = {
  get(k){ try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v){ try { sessionStorage.setItem(k, v); } catch {} },
  del(k){ try { sessionStorage.removeItem(k); } catch {} },
};
function copyText(text, fallbackEl){
  return navigator.clipboard.writeText(text).then(() => true).catch(() => {
    if (fallbackEl){ fallbackEl.hidden = false; fallbackEl.focus(); fallbackEl.select && fallbackEl.select(); }
    return false;
  });
}
function saveBlob(blob, name){
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
