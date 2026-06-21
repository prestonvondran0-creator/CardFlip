// /.netlify/functions/ebay-debug-full?imageUrl=...  (GET) — full publish dry-run with cleanup.
import { getAccessToken, ebayFetch, MARKETPLACE } from "../../ebay-lib.mjs";
const CURRENCY = process.env.EBAY_CURRENCY || "USD";
function json(o, s) { return new Response(JSON.stringify(o, null, 2), { status: s || 200, headers: { "Content-Type": "application/json" } }); }

export default async (req) => {
  const url = new URL(req.url);
  const imageUrl = url.searchParams.get("imageUrl") || "";
  const steps = {};
  let token;
  try { token = await getAccessToken(); } catch (e) { return json({ error: "not connected", detail: e.message }, 400); }

  const sku = "CF-DBG-" + Date.now();
  const title = "2023 Panini Prizm Victor Wembanyama #136 Silver Prizm RC Spurs";

  // policies
  let fulfillmentId = process.env.EBAY_FULFILLMENT_POLICY_ID, paymentId = process.env.EBAY_PAYMENT_POLICY_ID, returnId = process.env.EBAY_RETURN_POLICY_ID;
  if (!fulfillmentId) { const r = await ebayFetch(`/sell/account/v1/fulfillment_policy?marketplace_id=${MARKETPLACE}`, { token }); fulfillmentId = r.json.fulfillmentPolicies?.[0]?.fulfillmentPolicyId; }
  if (!paymentId) { const r = await ebayFetch(`/sell/account/v1/payment_policy?marketplace_id=${MARKETPLACE}`, { token }); paymentId = r.json.paymentPolicies?.[0]?.paymentPolicyId; }
  if (!returnId) { const r = await ebayFetch(`/sell/account/v1/return_policy?marketplace_id=${MARKETPLACE}`, { token }); returnId = r.json.returnPolicies?.[0]?.returnPolicyId; }
  steps.policies = { fulfillmentId, paymentId, returnId };

  let locationKey = process.env.EBAY_LOCATION_KEY;
  if (!locationKey) { const r = await ebayFetch(`/sell/inventory/v1/location`, { token }); locationKey = r.json.locations?.[0]?.merchantLocationKey; }
  steps.locationKey = locationKey;

  let categoryId = process.env.EBAY_CATEGORY_ID;
  if (!categoryId) { const r = await ebayFetch(`/commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q=${encodeURIComponent(title)}`, { token }); categoryId = r.json.categorySuggestions?.[0]?.category?.categoryId; }
  if (!categoryId) categoryId = "261328";
  steps.categoryId = categoryId;

  const aspects = { "Sport": ["Basketball"], "Player/Athlete": ["Victor Wembanyama"], "Season": ["2023"], "Manufacturer": ["Panini"], "Set": ["Prizm"], "Card Number": ["136"], "Graded": ["No"], "Card Condition": ["Near Mint or Better"] };
  const product = { title, description: "Debug.", aspects };
  if (imageUrl) product.imageUrls = [imageUrl];
  const itemBody = { availability: { shipToLocationAvailability: { quantity: 1 } }, condition: "USED_VERY_GOOD", product };

  const put = await ebayFetch(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, { method: "PUT", token, body: itemBody });
  steps.item = { status: put.status, ok: put.ok, json: put.json };
  if (!put.ok) return json({ steps, sent: itemBody });

  const offerBody = { sku, marketplaceId: MARKETPLACE, format: "FIXED_PRICE", availableQuantity: 1, categoryId, listingDescription: "Debug.", listingPolicies: { fulfillmentPolicyId: fulfillmentId, paymentPolicyId: paymentId, returnPolicyId: returnId }, pricingSummary: { price: { value: "1.99", currency: CURRENCY } }, merchantLocationKey: locationKey };
  const offer = await ebayFetch(`/sell/inventory/v1/offer`, { method: "POST", token, body: offerBody });
  let offerId = offer.json.offerId || offer.json.errors?.[0]?.parameters?.find(p => p.name === "offerId")?.value;
  steps.offer = { status: offer.status, ok: offer.ok, offerId, json: offer.json };
  if (!offerId) return json({ steps });

  const pub = await ebayFetch(`/sell/inventory/v1/offer/${offerId}/publish`, { method: "POST", token });
  steps.publish = { status: pub.status, ok: pub.ok, json: pub.json };

  // cleanup
  if (pub.ok && pub.json.listingId) { await ebayFetch(`/sell/inventory/v1/offer/${offerId}/withdraw`, { method: "POST", token }); }
  await ebayFetch(`/sell/inventory/v1/offer/${offerId}`, { method: "DELETE", token });
  await ebayFetch(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, { method: "DELETE", token });
  steps.cleaned = true;

  return json({ steps, sentItem: itemBody });
};
