import { store, json, pdfResponse, isPdf, ID_RE, MAX_SIGNED, canResign, ixKey, pdfKeyOf } from "../lib/common.mjs";

/* 客戶端 API（不用登入，靠連結裡的合約代碼辨識）
   GET  /api/c?c=<id>              合約資訊（標題、簽名位置、題目、簽署狀態）
   GET  /api/c?c=<id>&f=pdf        原始 PDF
   GET  /api/c?c=<id>&f=signed     客戶自己簽好的 PDF
   POST /api/c?c=<id>&f=signed     提交簽好的 PDF（傳回事務所後鎖定，除非後台開放重簽） */
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
      canResign: canResign(meta), firm: settings.firm || "" });
  }

  if (req.method === "GET" && f === "pdf") {
    const buf = await s.get(pdfKeyOf(meta), { type: "arrayBuffer" });
    return buf ? pdfResponse(buf) : json({ error: "not_found" }, 404);
  }

  if (req.method === "GET" && f === "signed") {
    const buf = await s.get(`signed/${id}`, { type: "arrayBuffer" });
    if (!buf) return json({ error: "not_found" }, 404);
    const name = `${meta.name}_${meta.title}.pdf`.replace(/[\\/:*?"<>|]/g, "");
    return pdfResponse(buf, name, url.searchParams.get("dl") === "1" ? "attachment" : "inline");
  }

  if (req.method === "POST" && f === "signed") {
    if (!canResign(meta)) return json({ error: "locked" }, 423);
    const len = Number(req.headers.get("content-length") || 0);
    if (len > MAX_SIGNED) return json({ error: "too_large" }, 413);
    const buf = await req.arrayBuffer();
    if (buf.byteLength > MAX_SIGNED) return json({ error: "too_large" }, 413);
    if (!isPdf(buf)) return json({ error: "not_pdf" }, 400);
    await s.set(`signed/${id}`, buf);
    const now = new Date().toISOString();
    const firstTime = !meta.signedAt;
    meta.resignAllowed = false;   // 提交後鎖定
    meta.signedAt = now;
    meta.signCount = (meta.signCount || 0) + 1;
    meta.signedSize = buf.byteLength;
    await s.setJSON(`contracts/${id}.json`, meta);
    if (firstTime) {   // 清單索引：從「尚未簽核」移到「已簽核完成」
      await s.set(ixKey(meta, true), "1");
      await s.delete(ixKey(meta, false));
    }
    return json({ ok: true, signedAt: now, canResign: false });
  }

  return json({ error: "bad_request" }, 400);
};

export const config = { path: "/api/c" };
