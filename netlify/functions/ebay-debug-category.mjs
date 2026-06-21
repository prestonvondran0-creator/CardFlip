// /.netlify/functions/ebay-debug-category?title=...&categoryId=...  (GET) — diagnostic.
import { getAccessToken, ebayFetch, MARKETPLACE } from "../../ebay-lib.mjs";
function json(o, s) { return new Response(JSON.stringify(o, null, 2), { status: s || 200, headers: { "Content-Type": "application/json" } }); }

export default async (req) => {
  const url = new URL(req.url);
  const title = url.searchParams.get("title") || "2023 Panini Prizm Basketball";
  let categoryId = url.searchParams.get("categoryId") || "";
  let token;
  try { token = await getAccessToken(); } catch (e) { return json({ error: "not connected", detail: e.message }, 400); }
  const out = { title };

  const sug = await ebayFetch(`/commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q=${encodeURIComponent(title)}`, { token });
  out.suggestion = sug.json && sug.json.categorySuggestions ? sug.json.categorySuggestions[0].category : sug.json;
  if (!categoryId) categoryId = (out.suggestion && out.suggestion.categoryId) || "261328";
  out.categoryIdUsed = categoryId;

  const filter = encodeURIComponent(`categoryIds:{${categoryId}}`);
  const cp = await ebayFetch(`/sell/metadata/v1/marketplace/${MARKETPLACE}/get_item_condition_policies?filter=${filter}`, { token });
  out.conditionPolicies = cp.ok ? cp.json : { status: cp.status, body: cp.json };

  const asp = await ebayFetch(`/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category?category_id=${categoryId}`, { token });
  if (asp.ok && asp.json && asp.json.aspects) {
    out.requiredAspects = asp.json.aspects
      .filter(a => a.aspectConstraint && a.aspectConstraint.aspectRequired)
      .map(a => ({ name: a.localizedAspectName, mode: a.aspectConstraint.aspectMode, values: (a.aspectValues || []).slice(0, 15).map(v => v.localizedValue) }));
  } else { out.requiredAspects = { status: asp.status, body: asp.json }; }

  return json(out);
};
