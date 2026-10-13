import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { store, json, pdfResponse, isPdf, cleanMeta, cleanClient, clientKey, mapLimit, ixKey, pdfKeyOf,
  CATEGORIES, ID_RE, MAX_PDF } from "../lib/common.mjs";

/* 管理後台 API。每個請求都要在 x-admin-key 標頭帶上管理密碼（Netlify 環境變數 ADMIN_PASSWORD）。
   ?a=ping                       確認密碼
   ?a=counts                     各類別的合約數與尚未簽核數
   ?a=list&cat=<類別>[&year=]     某類別的合約清單
   ?a=create        (POST form)  單一客戶：meta + pdf
   ?a=template      (POST form)  上傳公版 PDF，回傳 tplId
   ?a=batch         (POST json)  公版：{ tplId, meta, clients:[{name,short,taxId}] }，一次最多 50 位
   ?a=delete&c=     (POST)       刪除合約
   ?a=signed|pdf&c=              下載已簽／原始 PDF
   ?a=reopen&c=&on=1|0 (POST)    開放／取消開放重簽
   ?a=clients       (GET/POST)   客戶名單
   ?a=presets       (GET/POST)   設定範本（簽名框、日期、題目）；POST 帶 { preset } 新增或覆蓋，帶 { deleteId } 刪除
   ?a=settings      (POST)       事務所名稱
   ?a=logs                       登入紀錄（最近 500 筆）
   ?a=usage                      使用空間統計 */
const sha = s => createHash("sha256").update(String(s)).digest();
function authorized(req) {
  const pw = process.env.ADMIN_PASSWORD || "";
  const got = req.headers.get("x-admin-key") || "";
  return pw.length > 0 && timingSafeEqual(sha(pw), sha(got));
}
const fileName = m => `${m.name}_${m.title}.pdf`.replace(/[\\/:*?"<>|]/g, "");
const newId = () => randomBytes(18).toString("base64url");
const BATCH_MAX = 50;

/* 改版前建立的合約沒有類別與索引：第一次進後台時補上（歸到「未分類」） */
async function ensureIndex(s) {
  if (await s.get("ixv1")) return;
  const { blobs } = await s.list({ prefix: "contracts/" });
  await mapLimit(blobs, 20, async b => {
    const m = await s.get(b.key, { type: "json" });
    if (!m) return;
    if (!m.category) {
      m.category = "uncat";
      m.year = m.year || new Date(m.created || Date.now()).getFullYear();
      m.short = m.short || ""; m.taxId = m.taxId || "";
      await s.setJSON(b.key, m);
    }
    await s.set(ixKey(m, !!m.signedAt), "1");
  });
  await s.set("ixv1", "1");
}

/* 登入紀錄：時間、成功或失敗、IP、大概位置、瀏覽器，以及使用者自己設定的電腦名稱 */
async function logLogin(s, req, context, ok) {
  const g = (context && context.geo) || {};
  const loc = [g.city, g.subdivision && g.subdivision.name, g.country && g.country.name].filter(Boolean).join(", ");
  let device = "";
  try { device = decodeURIComponent(req.headers.get("x-device") || "").trim().slice(0, 40); } catch {}
  const entry = { at: new Date().toISOString(), ok, ip: (context && context.ip) || req.headers.get("x-nf-client-connection-ip") || "",
    loc, ua: (req.headers.get("user-agent") || "").slice(0, 300), device };
  const list = (await s.get("loginlog.json", { type: "json" })) || [];
  list.unshift(entry);
  await s.setJSON("loginlog.json", list.slice(0, 500));
}
const blobSize = async (s, key) => { const b = await s.get(key, { type: "arrayBuffer" }); return b ? b.byteLength : 0; };

async function newContract(s, base, client, pdfKey) {
  const id = newId();
  const rec = { id, ...base, name: client.name, short: client.short, taxId: client.taxId, code: client.code || "",
    created: new Date().toISOString(), signedAt: null, ...(pdfKey ? { pdfKey } : {}) };
  await s.setJSON(`contracts/${id}.json`, rec);
  await s.set(ixKey(rec, false), "1");
  return rec;
}

export default async (req, context) => {
  if (!process.env.ADMIN_PASSWORD) return json({ error: "no_password_set" }, 503);
  const url = new URL(req.url);
  const a = url.searchParams.get("a");
  const id = url.searchParams.get("c") || "";
  const s = store();
  const isLogin = a === "ping" && url.searchParams.get("login") === "1";
  if (!authorized(req)) {
    if (isLogin) { try { await logLogin(s, req, context, false); } catch {} }
    await new Promise(r => setTimeout(r, 400));   // 放慢猜密碼
    return json({ error: "unauthorized" }, 401);
  }

  if (a === "ping") {
    if (isLogin) { try { await logLogin(s, req, context, true); } catch {} }
    return json({ ok: true });
  }

  if (a === "logs" && req.method === "GET") {
    return json({ logs: (await s.get("loginlog.json", { type: "json" })) || [] });
  }

  /* 使用空間：合約設定裡記著各檔案大小；舊合約沒有記錄的，第一次統計時量一次並補上 */
  if (a === "usage" && req.method === "GET") {
    const { blobs } = await s.list({ prefix: "contracts/" });
    const metas = (await mapLimit(blobs, 20, b => s.get(b.key, { type: "json" }))).filter(Boolean);
    let own = 0, signed = 0, signedCount = 0;
    const tplKeys = new Set();
    await mapLimit(metas, 10, async m => {
      let dirty = false;
      if (m.pdfKey) tplKeys.add(m.pdfKey);
      else { if (m.pdfSize == null) { m.pdfSize = await blobSize(s, `pdf/${m.id}`); dirty = true; } own += m.pdfSize; }
      if (m.signedAt) {
        signedCount++;
        if (m.signedSize == null) { m.signedSize = await blobSize(s, `signed/${m.id}`); dirty = true; }
        signed += m.signedSize;
      }
      if (dirty) await s.setJSON(`contracts/${m.id}.json`, m);
    });
    const sizes = (await s.get("tplsizes.json", { type: "json" })) || {};
    let tpl = 0, tplDirty = false;
    for (const k of tplKeys) { if (sizes[k] == null) { sizes[k] = await blobSize(s, k); tplDirty = true; } tpl += sizes[k]; }
    if (tplDirty) await s.setJSON("tplsizes.json", sizes);
    const clients = (await s.get("clients.json", { type: "json" })) || [];
    const presets = (await s.get("presets.json", { type: "json" })) || [];
    return json({ contracts: metas.length, signedCount, own, tpl, tplCount: tplKeys.size, signed,
      total: own + tpl + signed, clients: clients.length, presets: presets.length, at: new Date().toISOString() });
  }

  if (a === "counts" && req.method === "GET") {
    await ensureIndex(s);
    const { blobs } = await s.list({ prefix: "ix/" });
    const counts = {};
    for (const b of blobs) {
      const [, cat, , st] = b.key.split("/");
      const c = counts[cat] || (counts[cat] = { total: 0, pending: 0 });
      c.total++; if (st === "p") c.pending++;
    }
    const settings = (await s.get("settings.json", { type: "json" })) || {};
    const clients = (await s.get("clients.json", { type: "json" })) || [];
    return json({ counts, settings, clientCount: clients.length });
  }

  if (a === "list" && req.method === "GET") {
    await ensureIndex(s);
    const cat = url.searchParams.get("cat") || "";
    if (!CATEGORIES.includes(cat)) return json({ error: "bad_request" }, 400);
    const year = url.searchParams.get("year");
    const prefix = `ix/${cat}/` + (year && /^\d{4}$/.test(year) ? `${year}/` : "");
    const { blobs } = await s.list({ prefix });
    const ids = [...new Set(blobs.map(b => b.key.split("/").pop()))];
    const items = (await mapLimit(ids, 40, i => s.get(`contracts/${i}.json`, { type: "json" }))).filter(Boolean);
    items.sort((x, y) => (y.created || "").localeCompare(x.created || ""));
    return json({ contracts: items });
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
    const { name, short, taxId, code, ...base } = meta;
    const rec = await newContract(s, { ...base, pdfSize: buf.byteLength }, { name, short, taxId, code }, null);
    await s.set(`pdf/${rec.id}`, buf);
    return json({ ok: true, contract: rec });
  }

  if (a === "template" && req.method === "POST") {
    let form;
    try { form = await req.formData(); } catch { return json({ error: "bad_request" }, 400); }
    const file = form.get("pdf");
    if (!file || typeof file.arrayBuffer !== "function") return json({ error: "no_pdf" }, 400);
    const buf = await file.arrayBuffer();
    if (buf.byteLength > MAX_PDF) return json({ error: "too_large" }, 413);
    if (!isPdf(buf)) return json({ error: "not_pdf" }, 400);
    const tplId = newId();
    await s.set(`tpl/${tplId}`, buf);
    const sizes = (await s.get("tplsizes.json", { type: "json" })) || {};
    sizes[`tpl/${tplId}`] = buf.byteLength;
    await s.setJSON("tplsizes.json", sizes);
    return json({ ok: true, tplId });
  }

  if (a === "batch" && req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
    if (!ID_RE.test(body.tplId || "")) return json({ error: "bad_request" }, 400);
    if (!(await s.get(`tpl/${body.tplId}`, { type: "arrayBuffer" }))) return json({ error: "no_template" }, 400);
    const clients = (Array.isArray(body.clients) ? body.clients : []).map(cleanClient).filter(Boolean);
    if (!clients.length || clients.length > BATCH_MAX) return json({ error: "bad_clients" }, 400);
    let base;
    try { base = cleanMeta({ ...body.meta, name: clients[0].name }); } catch { return json({ error: "bad_meta" }, 400); }
    delete base.name; delete base.short; delete base.taxId; delete base.code;
    const created = await mapLimit(clients, 10, c => newContract(s, base, c, `tpl/${body.tplId}`));
    return json({ ok: true, contracts: created });
  }

  if (a === "delete" && req.method === "POST") {
    if (!ID_RE.test(id)) return json({ error: "not_found" }, 404);
    const meta = await s.get(`contracts/${id}.json`, { type: "json" });
    if (!meta) return json({ ok: true });
    const jobs = [s.delete(`contracts/${id}.json`), s.delete(`signed/${id}`),
      s.delete(ixKey(meta, false)), s.delete(ixKey(meta, true))];
    if (!meta.pdfKey) jobs.push(s.delete(`pdf/${id}`));   // 公版 PDF 由其他客戶共用，不刪
    await Promise.all(jobs);
    return json({ ok: true });
  }

  if ((a === "signed" || a === "pdf") && req.method === "GET") {
    if (!ID_RE.test(id)) return json({ error: "not_found" }, 404);
    const meta = await s.get(`contracts/${id}.json`, { type: "json" });
    if (!meta) return json({ error: "not_found" }, 404);
    const buf = await s.get(a === "signed" ? `signed/${id}` : pdfKeyOf(meta), { type: "arrayBuffer" });
    if (!buf) return json({ error: "not_found" }, 404);
    return pdfResponse(buf, fileName(meta));
  }

  // 開放／取消開放重簽（已提交的合約，開放後客戶可再簽一次，提交後自動鎖定）
  if (a === "reopen" && req.method === "POST") {
    if (!ID_RE.test(id)) return json({ error: "not_found" }, 404);
    const meta = await s.get(`contracts/${id}.json`, { type: "json" });
    if (!meta) return json({ error: "not_found" }, 404);
    meta.resignAllowed = url.searchParams.get("on") === "1";
    await s.setJSON(`contracts/${id}.json`, meta);
    return json({ ok: true, contract: meta });
  }

  if (a === "clients") {
    if (req.method === "GET") return json({ clients: (await s.get("clients.json", { type: "json" })) || [] });
    if (req.method === "POST") {
      let body;
      try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
      const seen = new Set(), list = [];
      for (const c of (Array.isArray(body.clients) ? body.clients : []).slice(0, 3000).map(cleanClient)) {
        if (!c) continue;
        const k = clientKey(c);
        if (seen.has(k)) continue;
        seen.add(k); list.push(c);
      }
      await s.setJSON("clients.json", list);
      return json({ ok: true, clients: list });
    }
  }

  if (a === "presets") {
    const list = (await s.get("presets.json", { type: "json" })) || [];
    if (req.method === "GET") return json({ presets: list });
    if (req.method === "POST") {
      let body;
      try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
      let next = list;
      if (body.deleteId) next = list.filter(p => p.id !== body.deleteId);
      else {
        const p = body.preset || {};
        const name = typeof p.name === "string" ? p.name.trim().slice(0, 40) : "";
        if (!name) return json({ error: "bad_request" }, 400);
        let m;
        try { m = cleanMeta({ ...p, name: "範本", title: p.title || name }); } catch { return json({ error: "bad_meta" }, 400); }
        const rec = { id: ID_RE.test(p.id || "") ? p.id : newId(), name, category: m.category, title: typeof p.title === "string" ? p.title.trim().slice(0, 200) : "",
          sig: m.sig, sigLast: !!p.sigLast, date: m.date, dateLast: !!p.dateLast, nameAt: m.nameAt, nameLast: !!p.nameLast, questions: m.questions, summary: m.summary,
          updated: new Date().toISOString() };
        next = list.filter(x => x.id !== rec.id && !(x.name === rec.name && x.category === rec.category));
        next.unshift(rec);
        if (next.length > 100) next = next.slice(0, 100);
      }
      await s.setJSON("presets.json", next);
      return json({ ok: true, presets: next });
    }
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
