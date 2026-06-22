// /.netlify/functions/ebay-publish  (POST)
// Body: { sku, title, price, description, player, year, brand, set, cardNumber, variation, sport, team, isRookie, condition, imageUrl }
// Runs eBay's real 3-step Sell/Inventory flow: create inventory item -> create offer -> publish offer.
import { getAccessToken, ebayFetch, MARKETPLACE, uidFrom } from "../../ebay-lib.mjs";

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

  let token;
  try { token = await getAccessToken(card.uid || uidFrom(req)); }
  catch (e) { return fail("eBay not connected — connect your account first.", e.message); }

  const sku = (card.sku || "CF-" + Date.now()).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 50);
  const price = Number(card.price);
  if (!price || price <= 0) return fail("Missing or invalid price.");
  const title = (card.title || "Trading card").slice(0, 80);
  const isLot = !!card.isLot;

  // ---- 1. Resolve seller policies (env override, else first available) ----
  let fulfillmentId = process.env.EBAY_FULFILLMENT_POLICY_ID;
  let paymentId = process.env.EBAY_PAYMENT_POLICY_ID;
  let returnId = process.env.EBAY_RETURN_POLICY_ID;
  try {
    if (!fulfillmentId) {
      const r = await ebayFetch(`/sell/account/v1/fulfillment_policy?marketplace_id=${MARKETPLACE}`, { token });
      fulfillmentId = r.json.fulfillmentPolicies?.[0]?.fulfillmentPolicyId;
    }
    if (!paymentId) {
      const r = await ebayFetch(`/sell/account/v1/payment_policy?marketplace_id=${MARKETPLACE}`, { token });
      paymentId = r.json.paymentPolicies?.[0]?.paymentPolicyId;
    }
    if (!returnId) {
      const r = await ebayFetch(`/sell/account/v1/return_policy?marketplace_id=${MARKETPLACE}`, { token });
      returnId = r.json.returnPolicies?.[0]?.returnPolicyId;
    }
  } catch (e) { return fail("Couldn't read your eBay business policies.", e.message); }
  if (!fulfillmentId || !paymentId || !returnId) {
    return fail("Your eBay account needs business policies (payment, shipping, return). Create them in eBay › Account Settings › Business Policies, then try again.");
  }

  // ---- 2. Resolve inventory location (env override, else first available) ----
  let locationKey = process.env.EBAY_LOCATION_KEY;
  if (!locationKey) {
    try {
      const r = await ebayFetch(`/sell/inventory/v1/location`, { token });
      locationKey = r.json.locations?.[0]?.merchantLocationKey;
    } catch (e) { return fail("Couldn't read your eBay inventory locations.", e.message); }
  }
  if (!locationKey) {
    return fail("Your eBay account needs an inventory location. Add one in eBay Seller Hub, or set EBAY_LOCATION_KEY.");
  }

  // ---- 3. Category (env override, else Taxonomy suggestion from the title) ----
  let categoryId = process.env.EBAY_CATEGORY_ID;
  if (!categoryId) {
    try {
      const r = await ebayFetch(`/commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q=${encodeURIComponent(title)}`, { token });
      categoryId = r.json.categorySuggestions?.[0]?.category?.categoryId;
    } catch { /* fall through to default */ }
  }
  if (!categoryId) categoryId = isLot ? "261329" : "261328"; // Sports Trading Card Singles (US) — override with EBAY_CATEGORY_ID

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
    if (!offerId) return fail("eBay rejected the offer: " + errText(offer.json), offer.json);
  }

  // ---- 6. Publish ----
  const pub = await ebayFetch(`/sell/inventory/v1/offer/${offerId}/publish`, { method: "POST", token });
  if (!pub.ok) return fail("eBay couldn't publish the listing: " + errText(pub.json), pub.json);

  const listingId = pub.json.listingId;
  return new Response(JSON.stringify({
    listingId,
    url: listingId ? "https://www.ebay.com/itm/" + listingId : null,
    offerId,
  }), { headers: { "Content-Type": "application/json" } });
};
