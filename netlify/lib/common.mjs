import { getStore } from "@netlify/blobs";

/* 所有資料都放在 Netlify Blobs 的 "esign" 儲存區：
   contracts/<id>.json            合約設定（客戶、類別、年度、標題、簽名位置、題目、簽署時間）
   pdf/<id>                       單一客戶上傳的原始 PDF
   tpl/<tplId>                    公版 PDF（多位客戶共用，合約設定裡的 pdfKey 指向它）
   signed/<id>                    客戶簽好的 PDF
   ix/<類別>/<年度>/<p|s>/<id>      清單索引（p＝尚未簽核、s＝已簽核），列清單時只讀這些鍵名
   clients.json                   客戶名單
   settings.json                  事務所名稱 */
export const store = () => getStore({ name: "esign", consistency: "strong" });

export const ID_RE = /^[A-Za-z0-9_-]{16,40}$/;
export const MAX_PDF = 4 * 1024 * 1024;        // 原始 PDF 上限
export const MAX_SIGNED = 4.5 * 1024 * 1024;   // 簽好的 PDF 上限（多了簽名與勾選結果頁）

export function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

export function pdfResponse(buf, filename, disposition = "attachment") {
  const headers = { "content-type": "application/pdf", "cache-control": "no-store" };
  if (filename) headers["content-disposition"] = `${disposition}; filename="signed.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`;
  return new Response(buf, { headers });
}

export function isPdf(buf) {
  if (!buf || buf.byteLength < 100) return false;
  const h = new Uint8Array(buf, 0, 5);
  return String.fromCharCode(...h) === "%PDF-";
}

/* 重簽管控：客戶按「提交」把簽好的 PDF 傳回後就鎖定，不能再重簽；
   要重簽必須由管理人員在後台按「開放重簽」（開放一次，客戶再提交後又自動鎖定）。 */
export function canResign(meta) {
  return !meta.signedAt || !!meta.resignAllowed;
}

/* 合約類別（左側模組）；uncat 是改版前建立、沒有類別的舊合約 */
export const CATEGORIES = ["bookkeeping", "registration", "withholding", "provisional", "nonop", "settlement", "uncat"];
export const ixKey = (m, signed) => `ix/${m.category || "uncat"}/${m.year || 0}/${signed ? "s" : "p"}/${m.id}`;
export const pdfKeyOf = m => m.pdfKey || `pdf/${m.id}`;
export const TAXID_RE = /^\d{8}$/;

/* 依序處理一批工作，同時最多 n 個 */
export async function mapLimit(arr, n, fn) {
  const out = new Array(arr.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, arr.length) }, async () => {
    while (i < arr.length) { const k = i++; out[k] = await fn(arr[k], k); }
  }));
  return out;
}

/* 客戶名單的一筆：{ code 序號, name 名稱, short 簡稱, taxId 統編, org 組織型態, status: { "2026": "存續" | "終止" } }
   名稱必填；統編只留數字，Excel 吃掉的前導 0 補回 8 碼 */
export const STATUS = ["存續", "終止"];
export function cleanClient(c) {
  const t = (v, n) => (typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, n) : "");
  const name = t(c?.name, 100);
  if (!name) return null;
  let taxId = t(c?.taxId, 20).replace(/\D/g, "");
  taxId = taxId && taxId.length <= 8 ? taxId.padStart(8, "0") : "";
  const status = {};
  if (c?.status && typeof c.status === "object")
    for (const [y, v] of Object.entries(c.status).slice(0, 30))
      if (/^\d{4}$/.test(y) && STATUS.includes(v)) status[y] = v;
  return { code: t(c?.code, 20), name, short: t(c?.short, 40), taxId, org: t(c?.org, 20), status };
}
export const clientKey = c => c.code ? "c:" + c.code : c.taxId ? "t:" + c.taxId : "n:" + c.name;

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v, lo, hi) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);
const pt = (o, pages) => {
  if (!o || typeof o !== "object") return null;
  const page = num(o.page, 0, pages), x = num(o.x, 0, 5000), y = num(o.y, 0, 5000);
  return page === null || x === null || y === null ? null : { page: Math.round(page), x, y };
};

/* 管理後台送來的合約設定：只留下認得的欄位，數字限制在合理範圍 */
export function cleanMeta(m) {
  if (!m || typeof m !== "object") throw new Error("bad_meta");
  const name = str(m.name, 100), title = str(m.title, 200);
  if (!name || !title) throw new Error("bad_meta");
  const s = m.sig || {};
  const sig = { page: Math.round(num(s.page, 0, 999) ?? -1), x: num(s.x, 0, 5000), y: num(s.y, 0, 5000), w: num(s.w, 10, 2000), h: num(s.h, 10, 2000) };
  if (sig.page < 0 || [sig.x, sig.y, sig.w, sig.h].some(v => v === null)) throw new Error("bad_meta");
  const date = m.date ? pt(m.date, 999) : null;
  const questions = (Array.isArray(m.questions) ? m.questions : []).slice(0, 30).map(q => ({
    q: str(q && q.q, 500),
    multi: !!(q && q.multi),
    required: !!(q && q.required),
    options: (Array.isArray(q && q.options) ? q.options : []).slice(0, 30)
      .map(o => ({ t: str(o && o.t, 300), mark: o && o.mark ? pt(o.mark, 999) : null }))
      .filter(o => o.t),
  })).filter(q => q.q && q.options.length);
  const category = CATEGORIES.includes(m.category) ? m.category : "uncat";
  const year = Math.round(num(m.year, 1990, 2100) ?? new Date().getFullYear());
  const client = cleanClient({ name, short: m.short, taxId: m.taxId, code: m.code });
  return { name, short: client.short, taxId: client.taxId, code: client.code, category, year, title, sig, date, questions, summary: m.summary === true };
}
