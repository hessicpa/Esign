import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { store, json, pdfResponse, isPdf, cleanMeta, ID_RE, MAX_PDF } from "../lib/common.mjs";

/* 管理後台 API。每個請求都要在 x-admin-key 標頭帶上管理密碼，
   密碼設定在 Netlify 的環境變數 ADMIN_PASSWORD。
   ?a=ping | list | create | delete | signed | pdf | reopen | settings */
const sha = s => createHash("sha256").update(String(s)).digest();
function authorized(req) {
  const pw = process.env.ADMIN_PASSWORD || "";
  const got = req.headers.get("x-admin-key") || "";
  return pw.length > 0 && timingSafeEqual(sha(pw), sha(got));
}
const fileName = m => `${m.name}_${m.title}.pdf`.replace(/[\\/:*?"<>|]/g, "");

export default async (req) => {
  if (!process.env.ADMIN_PASSWORD) return json({ error: "no_password_set" }, 503);
  if (!authorized(req)) {
    await new Promise(r => setTimeout(r, 400));   // 放慢猜密碼
    return json({ error: "unauthorized" }, 401);
  }
  const url = new URL(req.url);
  const a = url.searchParams.get("a");
  const id = url.searchParams.get("c") || "";
  const s = store();

  if (a === "ping") return json({ ok: true });

  if (a === "list" && req.method === "GET") {
    const { blobs } = await s.list({ prefix: "contracts/" });
    const items = (await Promise.all(blobs.map(b => s.get(b.key, { type: "json" })))).filter(Boolean);
    items.sort((x, y) => (y.created || "").localeCompare(x.created || ""));
    const settings = (await s.get("settings.json", { type: "json" })) || {};
    return json({ contracts: items, settings });
  }

  if (a === "create" && req.method === "POST") {
    let form;
    try { form = await req.formData(); } catch { return json({ error: "bad_request" }, 400); }
    let meta;
    try { meta = cleanMeta(JSON.parse(String(form.get("meta") || ""))); } catch { return json({ error: "bad_meta" }, 400); }
    const file = form.get("pdf");
    if (!file || typeof file.arrayBuffer !== "function") return json({ error: "no_pdf" }, 400);
    const buf = await file.arrayBuffer();
    if (buf.byteLength > MAX_PDF) return json({ error: "too_large" }, 413);
    if (!isPdf(buf)) return json({ error: "not_pdf" }, 400);
    const newId = randomBytes(18).toString("base64url");
    const rec = { id: newId, ...meta, created: new Date().toISOString(), signedAt: null };
    await s.set(`pdf/${newId}`, buf);
    await s.setJSON(`contracts/${newId}.json`, rec);
    return json({ ok: true, contract: rec });
  }

  if (a === "delete" && req.method === "POST") {
    if (!ID_RE.test(id)) return json({ error: "not_found" }, 404);
    await Promise.all([s.delete(`contracts/${id}.json`), s.delete(`pdf/${id}`), s.delete(`signed/${id}`)]);
    return json({ ok: true });
  }

  if ((a === "signed" || a === "pdf") && req.method === "GET") {
    if (!ID_RE.test(id)) return json({ error: "not_found" }, 404);
    const meta = await s.get(`contracts/${id}.json`, { type: "json" });
    const buf = await s.get(`${a === "signed" ? "signed" : "pdf"}/${id}`, { type: "arrayBuffer" });
    if (!meta || !buf) return json({ error: "not_found" }, 404);
    return pdfResponse(buf, fileName(meta));
  }

  // 開放／取消開放重簽（超過 1 小時已歸檔的合約，開放後客戶可再簽一次）
  if (a === "reopen" && req.method === "POST") {
    if (!ID_RE.test(id)) return json({ error: "not_found" }, 404);
    const meta = await s.get(`contracts/${id}.json`, { type: "json" });
    if (!meta) return json({ error: "not_found" }, 404);
    meta.resignAllowed = url.searchParams.get("on") === "1";
    await s.setJSON(`contracts/${id}.json`, meta);
    return json({ ok: true, contract: meta });
  }

  if (a === "settings" && req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
    const clean = v => (typeof v === "string" ? v.trim().slice(0, 100) : "");
    const settings = { firm: clean(body.firm) };
    await s.setJSON("settings.json", settings);
    return json({ ok: true, settings });
  }

  return json({ error: "bad_request" }, 400);
};

export const config = { path: "/api/admin" };
