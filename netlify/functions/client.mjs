import { store, json, pdfResponse, isPdf, ID_RE, MAX_SIGNED } from "../lib/common.mjs";

/* 客戶端 API（不用登入，靠連結裡的合約代碼辨識）
   GET  /api/c?c=<id>            合約資訊（標題、簽名位置、題目…）
   GET  /api/c?c=<id>&f=pdf      原始 PDF
   POST /api/c?c=<id>&f=signed   上傳簽好的 PDF（自動傳回事務所） */
export default async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("c") || "";
  const f = url.searchParams.get("f") || "meta";
  if (!ID_RE.test(id)) return json({ error: "not_found" }, 404);

  const s = store();
  const meta = await s.get(`contracts/${id}.json`, { type: "json" });
  if (!meta) return json({ error: "not_found" }, 404);

  if (req.method === "GET" && f === "meta") {
    const settings = (await s.get("settings.json", { type: "json" })) || {};
    const { name, title, sig, date, questions, summary, signedAt } = meta;
    return json({ name, title, sig, date, questions: questions || [], summary, signedAt: signedAt || null,
      firm: settings.firm || "", line: settings.line || "" });
  }

  if (req.method === "GET" && f === "pdf") {
    const buf = await s.get(`pdf/${id}`, { type: "arrayBuffer" });
    return buf ? pdfResponse(buf) : json({ error: "not_found" }, 404);
  }

  if (req.method === "POST" && f === "signed") {
    const len = Number(req.headers.get("content-length") || 0);
    if (len > MAX_SIGNED) return json({ error: "too_large" }, 413);
    const buf = await req.arrayBuffer();
    if (buf.byteLength > MAX_SIGNED) return json({ error: "too_large" }, 413);
    if (!isPdf(buf)) return json({ error: "not_pdf" }, 400);
    await s.set(`signed/${id}`, buf);
    meta.signedAt = new Date().toISOString();
    meta.signCount = (meta.signCount || 0) + 1;
    await s.setJSON(`contracts/${id}.json`, meta);
    return json({ ok: true, signedAt: meta.signedAt });
  }

  return json({ error: "bad_request" }, 400);
};

export const config = { path: "/api/c" };
