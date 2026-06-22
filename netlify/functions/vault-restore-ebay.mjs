// /.netlify/functions/vault-restore-ebay?apply=1 — rebuild vault from PUBLISHED eBay listings.
import { getAccessToken, ebayFetch, MARKETPLACE, store } from "../../ebay-lib.mjs";
function json(o, s) { return new Response(JSON.stringify(o, null, 2), { status: s || 200, headers: { "Content-Type": "application/json" } }); }

export default async (req) => {
  const url = new URL(req.url);
  const apply = url.searchParams.get("apply") === "1" || req.method === "POST";
  let token;
  try { token = await getAccessToken(); } catch (e) { return json({ error: "eBay not connected", detail: e.message }, 400); }

  // gather inventory items (skip debug junk)
  let items = [], offset = 0;
  for (let guard = 0; guard < 6; guard++) {
    const r = await ebayFetch(`/sell/inventory/v1/inventory_item?limit=100&offset=${offset}`, { token });
    if (!r.ok) { if (offset === 0) return json({ error: "Couldn't read eBay inventory", detail: r.json }, 400); break; }
    const arr = (r.json.inventoryItems || []).filter(it => it.sku && !/^CF-DEBUG|^CF-DBG/i.test(it.sku));
    items = items.concat(arr);
    if ((r.json.inventoryItems || []).length < 100) break;
    offset += 100;
  }

  // fetch offers in parallel batches
  const offersBySku = {};
  async function getOffer(sku) {
    try { const o = await ebayFetch(`/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${MARKETPLACE}`, { token }); offersBySku[sku] = (o.json.offers || [])[0] || null; }
    catch (e) { offersBySku[sku] = null; }
  }
  for (let i = 0; i < items.length; i += 8) {
    await Promise.all(items.slice(i, i + 8).map(it => getOffer(it.sku)));
  }

  if (url.searchParams.get("all") === "1") {
    return json({ items: items.map(it => { const o = offersBySku[it.sku]; return { sku: it.sku, title: (it.product && it.product.title) || "", price: o && o.pricingSummary && o.pricingSummary.price ? Number(o.pricingSummary.price.value) : 0, listingId: (o && o.listingId) || "", status: (o && o.status) || "", img: (it.product && it.product.imageUrls && it.product.imageUrls[0]) || "" }; }) });
  }
  const cards = [];
  for (const it of items) {
    const off = offersBySku[it.sku];
    const listingId = off && off.listingId ? off.listingId : "";
    const status = off && off.status ? off.status : "";
    if (!listingId && status !== "PUBLISHED") continue; // only real, live listings
    const price = off ? (Number(off.pricingSummary && off.pricingSummary.price && off.pricingSummary.price.value) || 0) : 0;
    const p = it.product || {}; const asp = p.aspects || {}; const g = k => (asp[k] && asp[k][0]) || "";
    cards.push({
      id: it.sku.replace(/^CF-/, "") || it.sku, sku: it.sku, title: p.title || it.sku,
      price, suggestedPrice: price, low: 0, high: 0, comps: [],
      imageUrls: p.imageUrls || [], imageUrl: (p.imageUrls || [])[0] || "",
      player: g("Player/Athlete"), year: g("Season"), brand: g("Manufacturer"), set: g("Set"), cardNumber: g("Card Number"), variation: g("Parallel/Variety"), sport: g("Sport"), team: g("Team"),
      conditionEstimate: "Raw — Near Mint", status: "listed",
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

  return json({ inventoryScanned: items.length, listedRebuilt: cards.length, totalAfterMerge: merged.length, applied: apply, sample: cards.slice(0, 10).map(c => ({ title: c.title, price: c.price })) });
};
