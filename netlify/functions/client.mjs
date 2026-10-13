import { store, json, pdfResponse, isPdf, ID_RE, MAX_SIGNED, canResign, ixKey, pdfKeyOf } from "../lib/common.mjs";

/* 客戶端 API（不用登入，靠連結裡的合約代碼辨識）
   GET  /api/c?c=<id>              合約資訊（標題、簽名位置、題目、簽署狀態）
   GET  /api/c?c=<id>&f=pdf        原始 PDF
   GET  /api/c?c=<id>&f=signed     客戶自己簽好的 PDF
   POST /api/c?c=<id>&f=answers    提交前先存這次的答案（開放重簽時會自動帶入，客戶只要改需要更正的題目）
   POST /api/c?c=<id>&f=signed     提交簽好的 PDF（傳回事務所後鎖定，除非後台開放重簽） */

/* 只留下與題目對得上的答案：填寫題是字串；勾選題是 { s: 勾選的選項, f: { 選項序號: 附帶填寫的內容 } } */
function cleanAnswers(raw, questions) {
  if (!Array.isArray(raw)) return null;
  const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  return (questions || []).map((q, i) => {
    const a = raw[i];
    if (q.type === "text" || q.type === "number") return str(a, q.type === "number" ? 24 : 100);
    const sel = (a && Array.isArray(a.s) ? a.s : []).filter(j => Number.isInteger(j) && j >= 0 && j < q.options.length);
    const s = q.multi ? [...new Set(sel)] : sel.slice(0, 1);
    const f = {};
    for (const j of s) if (q.options[j].input && a.f) { const v = str(a.f[j], 100); if (v) f[j] = v; }
    return { s, f };
  });
}
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
    const { name, title, sig, date, nameAt, questions, summary, signedAt, answers } = meta;
    return json({ name, title, sig, date, nameAt: nameAt || null, questions: questions || [], summary, signedAt: signedAt || null,
      answers: signedAt && answers ? answers : null,
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

  if (req.method === "POST" && f === "answers") {
    if (!canResign(meta)) return json({ error: "locked" }, 423);
    let body; try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
    const answers = cleanAnswers(body && body.answers, meta.questions);
    if (!answers) return json({ error: "bad_request" }, 400);
    meta.answers = answers;
    await s.setJSON(`contracts/${id}.json`, meta);
    return json({ ok: true });
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
