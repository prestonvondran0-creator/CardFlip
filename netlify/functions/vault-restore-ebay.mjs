// /.netlify/functions/vault-restore-ebay?apply=1  — rebuild vault from the seller's eBay inventory listings.
import { getAccessToken, ebayFetch, MARKETPLACE, store } from "../../ebay-lib.mjs";
function json(o, s) { return new Response(JSON.stringify(o, null, 2), { status: s || 200, headers: { "Content-Type": "application/json" } }); }

export default async (req) => {
  const url = new URL(req.url);
  const apply = url.searchParams.get("apply") === "1" || req.method === "POST";
  let token;
  try { token = await getAccessToken(); } catch (e) { return json({ error: "eBay not connected", detail: e.message }, 400); }

  let items = [], offset = 0;
  for (let guard = 0; guard < 15; guard++) {
    const r = await ebayFetch(`/sell/inventory/v1/inventory_item?limit=100&offset=${offset}`, { token });
    if (!r.ok) { if (offset === 0) return json({ error: "Couldn't read eBay inventory", detail: r.json }, 400); break; }
    const arr = r.json.inventoryItems || [];
    items = items.concat(arr);
    if (arr.length < 100) break;
    offset += 100;
  }

  const cards = [];
  for (const it of items) {
    const sku = it.sku || "";
    let price = 0, listingId = "", status = "";
    try {
      const o = await ebayFetch(`/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${MARKETPLACE}`, { token });
      const off = (o.json.offers || [])[0];
      if (off) { price = Number(off.pricingSummary && off.pricingSummary.price && off.pricingSummary.price.value) || 0; listingId = off.listingId || ""; status = off.status || ""; }
    } catch (e) {}
    const p = it.product || {};
    const asp = p.aspects || {};
    const g = k => (asp[k] && asp[k][0]) || "";
    cards.push({
      id: sku.replace(/^CF-/, "") || sku, sku,
      title: p.title || sku,
      price, suggestedPrice: price, low: 0, high: 0, comps: [],
      imageUrls: p.imageUrls || [], imageUrl: (p.imageUrls || [])[0] || "",
      player: g("Player/Athlete"), year: g("Season"), brand: g("Manufacturer"), set: g("Set"), cardNumber: g("Card Number"), variation: g("Parallel/Variety"), sport: g("Sport"), team: g("Team"),
      conditionEstimate: "Raw — Near Mint",
      status: (status === "PUBLISHED" || listingId) ? "listed" : "draft",
      ebayId: listingId, ebayUrl: listingId ? ("https://www.ebay.com/itm/" + listingId) : "",
      createdDate: new Date().toISOString(), acquiredDate: new Date().toISOString(), recovered: true
    });
  }

  let existing = [];
  try { const v = await store().get("vault", { type: "json", consistency: "strong" }); existing = Array.isArray(v) ? v : (v && v.cards) || []; } catch (e) {}
  const byId = {};
  existing.forEach(c => { if (c && c.id) byId[c.id] = c; });
  cards.forEach(c => { if (c && c.id && !byId[c.id]) byId[c.id] = c; });
  const merged = Object.values(byId);
  if (apply) { try { await store().setJSON("vault", merged); } catch (e) { return json({ error: "save failed", detail: String(e && e.message || e) }, 500); } }

  return json({ inventoryItemsFound: items.length, rebuilt: cards.length, totalAfterMerge: merged.length, applied: apply, sample: cards.slice(0, 8).map(c => ({ title: c.title, price: c.price, status: c.status })) });
};
