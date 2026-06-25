// Shared eBay helpers (token storage + refresh + API fetch).
// Used by the Netlify functions. Holds NO secrets in code — reads them from env vars.
// Multi-user: every seller's tokens are stored under their own uid namespace
// (ebay_tokens:<uid>). One eBay developer app can list on behalf of many sellers.
import { getStore } from "@netlify/blobs";

export const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
export const API_BASE = "https://api.ebay.com";
export const MARKETPLACE = process.env.EBAY_MARKETPLACE_ID || "EBAY_US";

// The scopes we need: read account policies + manage inventory/listings.
export const SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.marketing",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
].join(" ");

function basicAuth() {
  return "Basic " + Buffer.from(process.env.EBAY_CLIENT_ID + ":" + process.env.EBAY_CLIENT_SECRET).toString("base64");
}

export function store() {
  return getStore("cardflip");
}

// Per-user token key. Falsy uid falls back to the legacy global key so that
// anything created before multi-user keeps working during migration.
function tokKey(uid) {
  return uid ? ("ebay_tokens:" + uid) : "ebay_tokens";
}

export async function getTokens(uid) {
  return (await store().get(tokKey(uid), { type: "json" })) || null;
}

export async function saveTokens(uid, t) {
  await store().setJSON(tokKey(uid), t);
}

export async function clearTokens(uid) {
  await store().delete(tokKey(uid));
}

// Returns a valid access token for this user, refreshing if needed. Throws if not connected.
export async function getAccessToken(uid) {
  const t = await getTokens(uid);
  if (!t || !t.refresh_token) throw new Error("eBay not connected");
  if (t.access_token && t.expires_at && Date.now() < t.expires_at - 60000) return t.access_token;

  // Do NOT send scope on refresh: eBay returns a token with whatever scopes the refresh
  // token was actually granted. Requesting scopes beyond the grant errors out ("scope exceeds granted").
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: t.refresh_token,
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basicAuth() },
    body,
  });
  const d = await r.json();
  if (!r.ok) throw new Error("Token refresh failed: " + (d.error_description || JSON.stringify(d)));
  const next = { ...t, access_token: d.access_token, expires_at: Date.now() + d.expires_in * 1000 };
  await saveTokens(uid, next);
  return next.access_token;
}

// Authenticated eBay API call. Returns parsed JSON (or {} for empty 2xx).
export async function ebayFetch(path, { method = "GET", token, body, lang = "en-US" } = {}) {
  const r = await fetch(API_BASE + path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      "Content-Language": lang,
      "Accept-Language": lang,
      "X-EBAY-C-MARKETPLACE-ID": MARKETPLACE,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { ok: r.ok, status: r.status, json };
}

export function exchangeBasicAuth() { return basicAuth(); }

// Helper for functions: pull the uid from a request (query param or header).
export function uidFrom(req) {
  try {
    const u = new URL(req.url);
    return u.searchParams.get("uid") || req.headers.get("x-cf-uid") || "";
  } catch {
    return (req.headers && req.headers.get && req.headers.get("x-cf-uid")) || "";
  }
}

// Promoted Listings: ensure a standing 13% Cost-Per-Sale campaign exists for this seller.
export const PROMO_BID = process.env.EBAY_PROMO_BID || "13.0";
export async function ensurePromoCampaign(token, uid) {
  const key = "ebay_promo:" + (uid || "");
  const name = "CardFlip Promoted 13%";
  try { const c = await store().get(key, { type: "json" }); if (c && c.campaignId) return c.campaignId; } catch {}
  let id = "";
  try {
    const r = await ebayFetch(`/sell/marketing/v1/ad_campaign?limit=100`, { token });
    const arr = (r.ok && r.json.campaigns) || [];
    const ex = arr.find(c => c.campaignName === name);
    if (ex) id = ex.campaignId;
  } catch {}
  if (!id) {
    const body = { campaignName: name, fundingStrategy: { fundingModel: "COST_PER_SALE" }, marketplaceId: MARKETPLACE, startDate: new Date().toISOString() };
    const cr = await ebayFetch(`/sell/marketing/v1/ad_campaign`, { method: "POST", token, body });
    if (!cr.ok) throw new Error("campaign create failed: " + ((cr.json && cr.json.errors && cr.json.errors.map(e => e.longMessage || e.message).join("; ")) || JSON.stringify(cr.json)));
    const r2 = await ebayFetch(`/sell/marketing/v1/ad_campaign?limit=100`, { token });
    const arr2 = (r2.ok && r2.json.campaigns) || [];
    const ex2 = arr2.find(c => c.campaignName === name);
    id = ex2 ? ex2.campaignId : "";
  }
  if (id) { try { await store().setJSON(key, { campaignId: id }); } catch {} }
  return id;
}