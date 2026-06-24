// /.netlify/functions/ebay-apply-all?uid=XXX  (POST)
// Re-applies the cached CardFlip policies (buyer-paid shipping, no returns, immediate pay)
// to all PUBLISHED listings. Preserves each listing's price (pricingSummary untouched).
// Idempotent: skips offers already on the right policies. Safe to re-run until remaining=0.
import { getAccessToken, ebayFetch, MARKETPLACE, uidFrom, store } from "../../ebay-lib.mjs";

function json(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json" } }); }
function errText(j) { return (j && j.errors && j.errors.length) ? j.errors.map(e => (e.longMessage || e.message)).join("; ") : JSON.stringify(j); }
async function pool(items, size, fn) {
  const out = []; let i = 0;
  async function w() { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }
  await Promise.all(Array.from({ length: Math.min(size, items.length || 1) }, w));
  return out;
}

export default async (req) => {
  const uid = uidFrom(req);
  const url = new URL(req.url);
  const cap = Math.max(1, Math.min(40, Number(url.searchParams.get("cap")) || 20));
  let token;
  try { token = await getAccessToken(uid); }
  catch (e) { return json({ error: "eBay not connected", detail: e.message }, 400); }

  let cfg = null;
  try { cfg = await store().get("ebay_cfg:" + (uid || ""), { type: "json" }); } catch {}
  if (!cfg || !cfg.fulfillmentId || !cfg.paymentId || !cfg.returnId) {
    return json({ error: "Set your listing policies first (the Set listing policies button)." }, 400);
  }
  const target = { fulfillmentPolicyId: cfg.fulfillmentId, paymentPolicyId: cfg.paymentId, returnPolicyId: cfg.returnId };

  // 1. enumerate inventory item skus
  let items = [], offset = 0;
  try {
    for (let page = 0; page < 12; page++) {
      const r = await ebayFetch(`/sell/inventory/v1/inventory_item?limit=100&offset=${offset}`, { token });
      if (!r.ok) break;
      const batch = r.json.inventoryItems || [];
      items = items.concat(batch.map(it => it.sku).filter(Boolean));
      if (batch.length < 100) break;
      offset += 100;
    }
  } catch (e) { return json({ error: "couldn't read inventory", detail: String(e && e.message || e) }, 500); }
  items = items.filter(sku => !/^CF-DBG|^CF-DEBUG/i.test(sku));

  // 2. find published offers needing update
  const found = await pool(items, 8, async (sku) => {
    try {
      const r = await ebayFetch(`/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${MARKETPLACE}`, { token });
      const offers = (r.ok && r.json.offers) || [];
      const pub = offers.find(o => o.status === "PUBLISHED" || o.listing || o.listingId);
      if (!pub || !pub.offerId) return null;
      const lp = pub.listingPolicies || {};
      const ok = lp.fulfillmentPolicyId === target.fulfillmentPolicyId && lp.paymentPolicyId === target.paymentPolicyId && lp.returnPolicyId === target.returnPolicyId;
      return { sku, offer: pub, ok };
    } catch (e) { return null; }
  });
  const live = found.filter(Boolean);
  const need = live.filter(x => !x.ok);
  const alreadyOk = live.length - need.length;

  // 3. update up to `cap` offers
  const todo = need.slice(0, cap);
  const failed = [];
  let updated = 0;

  async function putOffer(offer) {
    const body = { ...offer }; delete body.offerId; delete body.listing; delete body.status; delete body.listingId;
    body.listingPolicies = { ...(body.listingPolicies || {}), ...target };
    return ebayFetch(`/sell/inventory/v1/offer/${offer.offerId}`, { method: "PUT", token, body });
  }
  async function ensureWeight(sku) {
    try {
      const ir = await ebayFetch(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, { token });
      if (!ir.ok) return false;
      const item = ir.json || {};
      if (item.packageWeightAndSize && item.packageWeightAndSize.weight) return true;
      item.packageWeightAndSize = { packageType: "PACKAGE_THICK_ENVELOPE", weight: { value: 3, unit: "OUNCE" } };
      delete item.sku; delete item.locale;
      const up = await ebayFetch(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, { method: "PUT", token, body: item });
      return up.ok;
    } catch (e) { return false; }
  }

  await pool(todo, 6, async (x) => {
    try {
      let r = await putOffer(x.offer);
      if (!r.ok && /weight|dimension|calculat|shipping/i.test(errText(r.json))) {
        await ensureWeight(x.sku);
        r = await putOffer(x.offer);
      }
      if (r.ok || r.status === 204) updated++;
      else failed.push({ sku: x.sku, err: errText(r.json) });
    } catch (e) { failed.push({ sku: x.sku, err: String(e && e.message || e) }); }
  });

  return json({ ok: true, publishedScanned: live.length, alreadyOk, updated, failed: failed.slice(0, 10), failedCount: failed.length, remaining: need.length - updated });
};
