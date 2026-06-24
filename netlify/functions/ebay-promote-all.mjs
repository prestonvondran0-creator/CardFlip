// /.netlify/functions/ebay-promote-all?uid=XXX (POST)
// Adds every PUBLISHED listing to the standing 13% Promoted Listings campaign.
// Idempotent: listings already promoted just report "already". Safe to re-run.
import { getAccessToken, ebayFetch, MARKETPLACE, uidFrom, ensurePromoCampaign, PROMO_BID } from "../../ebay-lib.mjs";

function json(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json" } }); }
async function pool(items, size, fn) {
  const out = []; let i = 0;
  async function w() { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }
  await Promise.all(Array.from({ length: Math.min(size, items.length || 1) }, w));
  return out;
}

export default async (req) => {
  const uid = uidFrom(req);
  let token;
  try { token = await getAccessToken(uid); }
  catch (e) { return json({ error: "eBay not connected", detail: e.message }, 400); }

  let campaignId;
  try { campaignId = await ensurePromoCampaign(token, uid); }
  catch (e) { return json({ error: "Couldn't set up the promotion campaign (your account may not be eligible for Promoted Listings yet).", detail: String(e && e.message || e) }, 400); }
  if (!campaignId) return json({ error: "No promotion campaign available" }, 400);

  // enumerate published listingIds
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

  const ids = (await pool(items, 8, async (sku) => {
    try {
      const r = await ebayFetch(`/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${MARKETPLACE}`, { token });
      const offers = (r.ok && r.json.offers) || [];
      const pub = offers.find(o => o.status === "PUBLISHED" || o.listing || o.listingId);
      const lid = pub && (pub.listingId || (pub.listing && pub.listing.listingId));
      return lid ? String(lid) : null;
    } catch (e) { return null; }
  })).filter(Boolean);

  // bulk add ads in chunks of 500
  let promoted = 0, already = 0, failed = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const ar = await ebayFetch(`/sell/marketing/v1/ad_campaign/${campaignId}/create_ads_by_listing_id`, { method: "POST", token, body: { bidPercentage: PROMO_BID, listingIds: chunk } });
    const resp = (ar.json && ar.json.responses) || [];
    if (resp.length) {
      for (const x of resp) {
        const code = x.statusCode || 0;
        if (code >= 200 && code < 300) promoted++;
        else if (x.errors && x.errors.some(e => /already/i.test((e.message || e.longMessage || "")))) already++;
        else failed++;
      }
    } else if (ar.ok) { promoted += chunk.length; }
    else { failed += chunk.length; }
  }

  return json({ ok: true, campaignId, bid: PROMO_BID, listings: ids.length, promoted, already, failed });
};
