// /.netlify/functions/vault  — durable server-side backup of the card vault.
// GET  -> { cards: [...] }   POST { cards:[...] } -> saves.
import { getStore } from "@netlify/blobs";
function json(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json" } }); }
export default async (req) => {
  const store = getStore("cardflip");
  if (req.method === "GET") {
    let v = null;
    try { v = await store.get("vault", { type: "json", consistency: "strong" }); } catch (e) {}
    const cards = Array.isArray(v) ? v : (v && Array.isArray(v.cards) ? v.cards : []);
    return json({ cards });
  }
  if (req.method === "POST") {
    let body; try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
    const cards = Array.isArray(body.cards) ? body.cards : [];
    try { await store.setJSON("vault", cards); } catch (e) { return json({ error: "save failed", detail: String(e && e.message || e) }, 500); }
    return json({ ok: true, count: cards.length });
  }
  return json({ error: "GET or POST" }, 405);
};
