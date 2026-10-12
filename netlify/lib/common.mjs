import { getStore } from "@netlify/blobs";

/* 所有資料都放在 Netlify Blobs 的 "esign" 儲存區：
   contracts/<id>.json  合約設定（客戶名稱、標題、簽名位置、題目、簽署時間）
   pdf/<id>             原始 PDF
   signed/<id>          客戶簽好的 PDF
   settings.json        事務所名稱、LINE ID */
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

/* 重簽管控：第一次簽完 1 小時內可以重簽（覆蓋，保留最新）；
   超過 1 小時就歸檔，要管理人員在後台按「開放重簽」才可以再簽一次。 */
export const RESIGN_WINDOW_MS = 60 * 60 * 1000;
export function lockAt(meta) {
  if (!meta.signedAt) return null;
  return Date.parse(meta.firstSignedAt || meta.signedAt) + RESIGN_WINDOW_MS;
}
export function canResign(meta, now = Date.now()) {
  if (!meta.signedAt || meta.resignAllowed) return true;
  return now <= lockAt(meta);
}

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
  return { name, title, sig, date, questions, summary: m.summary !== false };
}
