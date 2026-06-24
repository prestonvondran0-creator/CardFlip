// /.netlify/functions/ebay-publish  (POST)
// Body: { sku, title, price, description, player, year, brand, set, cardNumber, variation, sport, team, isRookie, condition, imageUrl }
// Runs eBay's real 3-step Sell/Inventory flow: create inventory item -> create offer -> publish offer.
import { getAccessToken, ebayFetch, MARKETPLACE, uidFrom, store } from "../../ebay-lib.mjs";

const CURRENCY = process.env.EBAY_CURRENCY || "USD";

function fail(msg, detail) {
  return new Response(JSON.stringify({ error: msg, detail: detail || null }), {
    status: 400, headers: { "Content-Type": "application/json" },
  });
}
function errText(json) {
  if (json && json.errors && json.errors.length) return json.errors.map((e) => e.message).join("; ");
  return JSON.stringify(json);
}

export default async (req) => {
  if (req.method !== "POST") return fail("Use POST");

  let card;
  try { card = await req.json(); } catch { return fail("Bad JSON body"); }

  const uid = card.uid || uidFrom(req);
  let token;
  try { token = await getAccessToken(uid); }
  catch (e) { return fail("eBay not connected — connect your account first.", e.message); }
  const cfgKey = "ebay_cfg:" + (uid || "");

  const sku = (card.sku || "CF-" + Date.now()).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 50);
  const price = Number(card.price);
  if (!price || price <= 0) return fail("Missing or invalid price.");
  const title = (card.title || "Trading card").slice(0, 80);
  const isLot = !!card.isLot;

  // ---- 1+2. Seller policies + location (cached per user; resolved in parallel on first listing) ----
  let fulfillmentId, paymentId, returnId, locationKey;
  let cfg = null;
  try { cfg = await store().get(cfgKey, { type: "json" }); } catch {}
  if (cfg && cfg.fulfillmentId && cfg.paymentId && cfg.returnId && cfg.locationKey) {
    ({ fulfillmentId, paymentId, returnId, locationKey } = cfg);
  } else {
    try {
      const [fp, pp, rp, loc] = await Promise.all([
        ebayFetch(`/sell/account/v1/fulfillment_policy?marketplace_id=${MARKETPLACE}`, { token }),
        ebayFetch(`/sell/account/v1/payment_policy?marketplace_id=${MARKETPLACE}`, { token }),
        ebayFetch(`/sell/account/v1/return_policy?marketplace_id=${MARKETPLACE}`, { token }),
        ebayFetch(`/sell/inventory/v1/location`, { token }),
      ]);
      fulfillmentId = fp.json.fulfillmentPolicies?.[0]?.fulfillmentPolicyId;
      paymentId = pp.json.paymentPolicies?.[0]?.paymentPolicyId;
      returnId = rp.json.returnPolicies?.[0]?.returnPolicyId;
      locationKey = loc.json.locations?.[0]?.merchantLocationKey;
    } catch (e) { return fail("Couldn't read your eBay business policies or location.", e.message); }
    if (fulfillmentId && paymentId && returnId && locationKey) {
      try { await store().setJSON(cfgKey, { fulfillmentId, paymentId, returnId, locationKey }); } catch {}
    }
  }
  if (!fulfillmentId || !paymentId || !returnId) {
    return fail("Your eBay account needs business policies (payment, shipping, return). Create them in eBay › Account Settings › Business Policies, then try again.");
  }
  if (!locationKey) {
    return fail("Your eBay account needs an inventory location. Add one in eBay Seller Hub.");
  }

  // ---- 3. Category (defaults are correct for sports cards; skip taxonomy round-trip for speed) ----
  const categoryId = process.env.EBAY_CATEGORY_ID || (isLot ? "261329" : "261328"); // Singles 261328 / Lots 261329

  // ---- 4. Build + create the inventory item ----
  const aspects = {};
  const add = (k, v) => { if (v) aspects[k] = [String(v)]; };
  add("Player/Athlete", card.player);
  add("Season", card.year);
  add("Manufacturer", card.brand);
  add("Set", card.set);
  add("Card Number", card.cardNumber);
  add("Parallel/Variety", card.variation);
  add("Sport", card.sport);
  add("Team", card.team);
  add("Features", card.isRookie ? "Rookie" : undefined);

  // Trading-card REQUIRED structured condition (conditionDescriptors), mapped from the scan.
  const _cl = String(card.condition || "").toLowerCase();
  let cardCondValueId = "400010"; // Near mint or better (default)
  if (/poor|played|damag|crease|heavily/.test(_cl)) cardCondValueId = "400013";
  else if (/very good|\bvg\b/.test(_cl)) cardCondValueId = "400012";
  else if (/excellent|\bex\b/.test(_cl)) cardCondValueId = "400011";

  let imageUrls = [];
  if (Array.isArray(card.imageUrls)) imageUrls = card.imageUrls.filter(Boolean).slice(0, 12);
  if (!imageUrls.length && card.imageUrl) imageUrls.push(card.imageUrl);
  if (!imageUrls.length && process.env.EBAY_PLACEHOLDER_IMAGE) imageUrls.push(process.env.EBAY_PLACEHOLDER_IMAGE);

  const condition = process.env.EBAY_CONDITION || (isLot ? "USED_EXCELLENT" : "USED_VERY_GOOD");

  const itemBody = {
    availability: { shipToLocationAvailability: { quantity: 1 } },
    packageWeightAndSize: { packageType: "PACKAGE_THICK_ENVELOPE", weight: { value: Number(process.env.EBAY_PKG_OZ || card.packageOz || 3), unit: "OUNCE" } },
    condition,
    ...(isLot ? {} : { conditionDescriptors: [{ name: "40001", values: [cardCondValueId] }] }),
    product: {
      title,
      description: card.description || title,
      aspects,
      ...(imageUrls.length ? { imageUrls } : {}),
    },
  };
  const put = await ebayFetch(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, { method: "PUT", token, body: itemBody });
  if (!put.ok) return fail("eBay rejected the item: " + errText(put.json), put.json);

  // ---- 5. Create the offer ----
  const offerBody = {
    sku,
    marketplaceId: MARKETPLACE,
    format: "FIXED_PRICE",
    availableQuantity: 1,
    categoryId,
    listingDescription: card.description || title,
    listingPolicies: { fulfillmentPolicyId: fulfillmentId, paymentPolicyId: paymentId, returnPolicyId: returnId },
    pricingSummary: { price: { value: price.toFixed(2), currency: CURRENCY } },
    merchantLocationKey: locationKey,
  };
  const offer = await ebayFetch(`/sell/inventory/v1/offer`, { method: "POST", token, body: offerBody });
  let offerId = offer.json.offerId;
  if (!offer.ok) {
    // If an offer already exists for this SKU, eBay returns it in the error details.
    offerId = offer.json.errors?.[0]?.parameters?.find((p) => p.name === "offerId")?.value;
    if (!offerId) { try { await store().delete(cfgKey); } catch {} return fail("eBay rejected the offer: " + errText(offer.json), offer.json); }
  }

  // ---- 6. Publish ----
  const pub = await ebayFetch(`/sell/inventory/v1/offer/${offerId}/publish`, { method: "POST", token });
  if (!pub.ok) { try { await store().delete(cfgKey); } catch {} return fail("eBay couldn't publish the listing: " + errText(pub.json), pub.json); }

  const listingId = pub.json.listingId;
  return new Response(JSON.stringify({
    listingId,
    url: listingId ? "https://www.ebay.com/itm/" + listingId : null,
    offerId,
  }), { headers: { "Content-Type": "application/json" } });
};
