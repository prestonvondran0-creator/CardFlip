// /.netlify/functions/vault-recover?uid=XXX  (GET, read-only)
// Rebuilds a user's vault from their PUBLISHED eBay listings, using that uid's eBay
// token. Does NOT write the server vault — returns {cards}; the client saves them.
// Safe fallback if a device loses its local data: reconnect eBay, then recover.
import { getAccessToken, ebayFetch, MARKETPLACE, uidFrom } from "../../ebay-lib.mjs";

function json(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json" } }); }

async function pool(items, size, fn) {
  const out = []; let i = 0;
  async function worker() { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); } }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

export default async (req) => {
  const uid = uidFrom(req);
  let token;
  try { token = await getAccessToken(uid); }
  catch (e) { return json({ error: "eBay not connected", detail: e.message }, 400); }

  let items = [], offset = 0;
  try {
    for (let page = 0; page < 12; page++) {
      const r = await ebayFetch(`/sell/inventory/v1/inventory_item?limit=100&offset=${offset}`, { token });
      if (!r.ok) break;
      const batch = r.json.inventoryItems || [];
      items = items.concat(batch);
      if (batch.length < 100) break;
      offset += 100;
    }
  } catch (e) { return json({ error: "couldn't read inventory", detail: String(e && e.message || e) }, 500); }

  items = items.filter(it => it && it.sku && !/^CF-DBG|^CF-DEBUG/i.test(it.sku));

  const built = await pool(items, 8, async (it) => {
    try {
      const r = await ebayFetch(`/sell/inventory/v1/offer?sku=${encodeURIComponent(it.sku)}&marketplace_id=${MARKETPLACE}`, { token });
      const offers = (r.ok && r.json.offers) || [];
      const pub = offers.find(o => o.status === "PUBLISHED");
      if (!pub) return null;
      const listingId = pub.listingId || (pub.listing && pub.listing.listingId) || "";
      const price = Number(pub.pricingSummary && pub.pricingSummary.price && pub.pricingSummary.price.value) || 0;
      const prod = it.product || {};
      const imgs = Array.isArray(prod.imageUrls) ? prod.imageUrls.filter(Boolean) : [];
      return {
        id: String(it.sku).replace(/^CF-/, ""),
        sku: it.sku,
        title: prod.title || it.sku,
        price: price,
        suggestedPrice: price,
        imageUrls: imgs,
        imageUrl: imgs[0] || "",
        thumb: imgs[0] || "",
        status: "listed",
        ebayId: listingId,
        ebayUrl: listingId ? ("https://www.ebay.com/itm/" + listingId) : "",
        recovered: true,
        createdDate: new Date().toISOString(),
      };
    } catch (e) { return null; }
  });

  let cards = built.filter(Boolean);

  // best-effort: pull recent SOLD orders (needs sell.fulfillment scope) so the vault reflects sales
  let sold = 0;
  try {
    const or = await ebayFetch(`/sell/fulfillment/v1/order?limit=200`, { token });
    const orders = (or.ok && or.json.orders) || [];
    for (const o of orders) {
      for (const li of (o.lineItems || [])) {
        const sku = li.sku || "";
        const id = sku ? String(sku).replace(/^CF-/, "") : ("order-" + (li.lineItemId || Math.random().toString(36).slice(2)));
        const price = Number(li.lineItemCost && li.lineItemCost.value) || Number(li.total && li.total.value) || 0;
        cards.push({ id, sku, title: li.title || sku, player: "", price, suggestedPrice: price, status: "sold", soldPrice: price, soldDate: o.creationDate || new Date().toISOString(), recovered: true });
        sold++;
      }
    }
  } catch (e) {}

  return json({ cards, scanned: items.length, recovered: cards.length, sold });
};
