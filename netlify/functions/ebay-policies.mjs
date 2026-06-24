// /.netlify/functions/ebay-policies?uid=XXX  (POST or GET)
// Creates/updates this seller's business policies the way CardFlip needs:
//   - Shipping: buyer-paid CALCULATED (buyer pays exact USPS cost; seller eats nothing)
//   - Returns: NOT accepted
//   - Payment: immediate payment required (shortest window eBay allows)
// Then pins these policy IDs (+ location) into the publish config cache so every listing uses them.
import { getAccessToken, ebayFetch, MARKETPLACE, uidFrom, store } from "../../ebay-lib.mjs";

function json(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json" } }); }
function errText(j) { return (j && j.errors && j.errors.length) ? j.errors.map(e => (e.longMessage || e.message) + (e.parameters ? (" [" + e.parameters.map(p => p.name + "=" + p.value).join(", ") + "]") : "")).join(" | ") : JSON.stringify(j); }
function noChange(j) { return !!(j && j.errors && j.errors.some(e => /same as in the system|no change|not modified|nothing to update/i.test((e.longMessage || e.message) || ""))); }

async function getOrCreate(token, kind, listKey, idKey, name, body) {
  const list = await ebayFetch(`/sell/account/v1/${kind}?marketplace_id=${MARKETPLACE}`, { token });
  const arr = (list.ok && list.json[listKey]) || [];
  const existing = arr.find(p => p && p.name === name);
  if (existing && existing[idKey]) {
    const up = await ebayFetch(`/sell/account/v1/${kind}/${existing[idKey]}`, { method: "PUT", token, body });
    if (!up.ok && up.status !== 204 && !noChange(up.json)) throw new Error(kind + " update failed: " + errText(up.json));
    return existing[idKey];
  }
  const cr = await ebayFetch(`/sell/account/v1/${kind}`, { method: "POST", token, body });
  if (!cr.ok) {
    const dup = cr.json && cr.json.errors && cr.json.errors[0] && cr.json.errors[0].parameters && cr.json.errors[0].parameters.find(pp => /duplicate/i.test(pp.name) && pp.value);
    if (dup) {
      const up = await ebayFetch(`/sell/account/v1/${kind}/${dup.value}`, { method: "PUT", token, body });
      if (!up.ok && up.status !== 204 && !noChange(up.json)) throw new Error(kind + " update(dup) failed: " + errText(up.json));
      return dup.value;
    }
    throw new Error(kind + " create failed: " + errText(cr.json));
  }
  return cr.json[idKey];
}

export default async (req) => {
  const uid = uidFrom(req);
  let token;
  try { token = await getAccessToken(uid); }
  catch (e) { return json({ error: "eBay not connected", detail: e.message }, 400); }

  const cat = [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }];
  const pkgOz = Number((new URL(req.url)).searchParams.get("oz")) || 3;

  try {
    const paymentId = await getOrCreate(token, "payment_policy", "paymentPolicies", "paymentPolicyId",
      "CardFlip Immediate Pay",
      { name: "CardFlip Immediate Pay", marketplaceId: MARKETPLACE, categoryTypes: cat, immediatePay: true });

    const returnId = await getOrCreate(token, "return_policy", "returnPolicies", "returnPolicyId",
      "CardFlip No Returns",
      { name: "CardFlip No Returns", marketplaceId: MARKETPLACE, categoryTypes: cat, returnsAccepted: false });

    const fName = "CardFlip Buyer-Paid Shipping";
    const baseF = { name: fName, marketplaceId: MARKETPLACE, categoryTypes: cat, handlingTime: { value: 1, unit: "DAY" }, globalShipping: false, localPickup: false, freightShipping: false, pickupDropOff: false };
    const svc = (code) => ({ sortOrder: 1, shippingCarrierCode: "USPS", shippingServiceCode: code, freeShipping: false });
    const flat = (code) => ({ sortOrder: 1, shippingCarrierCode: "USPS", shippingServiceCode: code, freeShipping: false, shippingCost: { value: "5.00", currency: "USD" } });
    const candidates = [
      { ...baseF, shippingOptions: [{ optionType: "DOMESTIC", costType: "CALCULATED", shippingServices: [svc("USPSGroundAdvantage")] }] },
      { ...baseF, shippingOptions: [{ optionType: "DOMESTIC", costType: "CALCULATED", shippingServices: [svc("USPSPriority")] }] },
      { ...baseF, shippingOptions: [{ optionType: "DOMESTIC", costType: "FLAT_RATE", shippingServices: [flat("USPSGroundAdvantage")] }] },
      { ...baseF, shippingOptions: [{ optionType: "DOMESTIC", costType: "FLAT_RATE", shippingServices: [flat("USPSPriority")] }] },
    ];
    let fulfillmentId = null, shipMode = "", lastShipErr = "";
    for (let ci = 0; ci < candidates.length; ci++) {
      try { fulfillmentId = await getOrCreate(token, "fulfillment_policy", "fulfillmentPolicies", "fulfillmentPolicyId", fName, candidates[ci]); shipMode = candidates[ci].shippingOptions[0].costType; break; }
      catch (e) { lastShipErr = (e && e.message) || String(e); }
    }
    if (!fulfillmentId) throw new Error("shipping policy: " + lastShipErr);

    let locationKey = "";
    try {
      const loc = await ebayFetch(`/sell/inventory/v1/location`, { token });
      locationKey = loc.json.locations?.[0]?.merchantLocationKey || "";
    } catch {}

    // Pin these into the publish config cache so every listing uses them.
    try { await store().setJSON("ebay_cfg:" + (uid || ""), { fulfillmentId, paymentId, returnId, locationKey }); } catch {}

    return json({ ok: true, fulfillmentId, paymentId, returnId, locationKey, pkgOz, shipMode });
  } catch (e) {
    return json({ error: "Couldn't set policies", detail: String(e && e.message || e) }, 500);
  }
};
