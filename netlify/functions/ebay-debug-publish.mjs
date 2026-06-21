// /.netlify/functions/ebay-debug-publish?condition=UNGRADED&imageUrl=...  (GET) — diagnostic.
// Runs ONLY the createOrReplaceInventoryItem step and returns eBay's full response.
import { getAccessToken, ebayFetch } from "../../ebay-lib.mjs";
function json(o, s) { return new Response(JSON.stringify(o, null, 2), { status: s || 200, headers: { "Content-Type": "application/json" } }); }

export default async (req) => {
  const url = new URL(req.url);
  const condition = url.searchParams.get("condition") || "UNGRADED";
  const imageUrl = url.searchParams.get("imageUrl") || "";
  let token;
  try { token = await getAccessToken(); } catch (e) { return json({ error: "not connected", detail: e.message }, 400); }

  const sku = "CF-DEBUG-" + Date.now();
  const product = {
    title: "2023 Panini Prizm Victor Wembanyama #136 Silver Prizm RC Spurs",
    description: "Test listing item (debug).",
    aspects: {
      "Sport": ["Basketball"],
      "Player/Athlete": ["Victor Wembanyama"],
      "Season": ["2023"],
      "Manufacturer": ["Panini"],
      "Set": ["Prizm"],
      "Card Number": ["136"],
    },
  };
  if (imageUrl) product.imageUrls = [imageUrl];

  const itemBody = { availability: { shipToLocationAvailability: { quantity: 1 } }, condition, product };
  const put = await ebayFetch(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, { method: "PUT", token, body: itemBody });
  return json({ sku, conditionTried: condition, status: put.status, ok: put.ok, ebayResponse: put.json, sent: itemBody });
};
