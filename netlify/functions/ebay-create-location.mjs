// /.netlify/functions/ebay-create-location  (GET or POST) — one-time helper.
// Creates an eBay Inventory API ship-from location so listings can publish.
// Params (query or JSON body): postalCode (or city+state), country (default US), key, name
import { getAccessToken, ebayFetch, uidFrom } from "../../ebay-lib.mjs";

function json(o, s) {
  return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json" } });
}

export default async (req) => {
  const url = new URL(req.url);
  const q = url.searchParams;
  let p = {};
  if (req.method === "POST") { try { p = await req.json(); } catch {} }

  const postalCode = (p.postalCode || q.get("postalCode") || "").trim();
  const city = (p.city || q.get("city") || "").trim();
  const state = (p.state || q.get("state") || "").trim();
  const country = (p.country || q.get("country") || "US").trim();
  const key = (p.key || q.get("key") || "cardflip-loc-1").replace(/[^A-Za-z0-9_-]/g, "");
  const name = (p.name || q.get("name") || "CardFlip Ship-From").trim();

  if (!postalCode && !(city && state)) return json({ error: "Provide postalCode (or city+state)" }, 400);

  let token;
  try { token = await getAccessToken(uidFrom(req)); } catch (e) { return json({ error: "eBay not connected", detail: e.message }, 400); }

  const address = { country };
  if (postalCode) address.postalCode = postalCode;
  if (city) address.city = city;
  if (state) address.stateOrProvince = state;

  const body = { location: { address }, name, merchantLocationStatus: "ENABLED", locationTypes: ["WAREHOUSE"] };
  const r = await ebayFetch(`/sell/inventory/v1/location/${encodeURIComponent(key)}`, { method: "POST", token, body });

  if (r.ok || r.status === 204) return json({ ok: true, merchantLocationKey: key });
  const msg = JSON.stringify(r.json || {});
  if (/already exists|25801/i.test(msg)) return json({ ok: true, note: "already exists", merchantLocationKey: key });
  return json({ error: "Couldn't create location", status: r.status, detail: r.json }, 400);
};
