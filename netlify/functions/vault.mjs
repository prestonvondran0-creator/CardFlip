// /.netlify/functions/vault  — durable server-side backup of each user's card vault.
// Multi-user: each user's vault is stored under their own uid (vault:<uid>).
// GET  ?uid=XXX            -> { cards: [...] }
// POST { uid, cards:[...] } -> saves that user's vault.
import { getStore } from "@netlify/blobs";
function json(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json" } }); }
function vkey(uid) { return uid ? ("vault:" + uid) : "vault"; }
export default async (req) => {
  const store = getStore("cardflip");
  const url = new URL(req.url);
  if (req.method === "GET") {
    const uid = url.searchParams.get("uid") || req.headers.get("x-cf-uid") || "";
    let v = null;
    try { v = await store.get(vkey(uid), { type: "json", consistency: "strong" }); } catch (e) {}
    const cards = Array.isArray(v) ? v : (v && Array.isArray(v.cards) ? v.cards : []);
    return json({ cards });
  }
  if (req.method === "POST") {
    let body; try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
    const uid = body.uid || url.searchParams.get("uid") || req.headers.get("x-cf-uid") || "";
    const cards = Array.isArray(body.cards) ? body.cards : [];
    try { await store.setJSON(vkey(uid), cards); } catch (e) { return json({ error: "save failed", detail: String(e && e.message || e) }, 500); }
    return json({ ok: true, count: cards.length });
  }
  return json({ error: "GET or POST" }, 405);
};
