import { getAccessToken, ebayFetch, MARKETPLACE } from "../../ebay-lib.mjs";
function json(o, s) { return new Response(JSON.stringify(o, null, 2), { status: s || 200, headers: { "Content-Type": "application/json" } }); }
export default async (req) => {
  const url = new URL(req.url);
  const title = url.searchParams.get("title") || "20 card lot";
  let categoryId = url.searchParams.get("categoryId") || "";
  let token; try { token = await getAccessToken(); } catch (e) { return json({ error: "not connected", detail: e.message }, 400); }
  const out = { title };
  const sug = await ebayFetch(`/commerce/taxonomy/v1/category_tree/0/get_category_suggestions?q=${encodeURIComponent(title)}`, { token });
  out.suggestion = sug.json && sug.json.categorySuggestions ? { id: sug.json.categorySuggestions[0].category.categoryId, name: sug.json.categorySuggestions[0].category.categoryName } : sug.json;
  if (!categoryId) categoryId = (out.suggestion && out.suggestion.id) || "261328";
  out.categoryIdUsed = categoryId;
  const cp = await ebayFetch(`/sell/metadata/v1/marketplace/${MARKETPLACE}/get_item_condition_policies?filter=${encodeURIComponent("categoryIds:{" + categoryId + "}")}`, { token });
  out.conditions = cp.ok && cp.json.itemConditionPolicies ? cp.json.itemConditionPolicies.map(p => ({ required: p.itemConditionRequired, conds: (p.itemConditions || []).map(c => c.conditionId + "=" + c.conditionDescription) })) : cp.json;
  const asp = await ebayFetch(`/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category?category_id=${categoryId}`, { token });
  out.requiredAspects = asp.ok && asp.json.aspects ? asp.json.aspects.filter(a => a.aspectConstraint && a.aspectConstraint.aspectRequired).map(a => a.localizedAspectName) : (asp.json.errors || asp.json);
  return json(out);
};
