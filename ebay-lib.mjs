// Shared eBay helpers (token storage + refresh + API fetch).
// Used by the Netlify functions. Holds NO secrets in code — reads them from env vars.
import { getStore } from "@netlify/blobs";

export const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
export const API_BASE = "https://api.ebay.com";
export const MARKETPLACE = process.env.EBAY_MARKETPLACE_ID || "EBAY_US";

// The scopes we need: read account policies + manage inventory/listings.
export const SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
].join(" ");

function basicAuth() {
  return "Basic " + Buffer.from(process.env.EBAY_CLIENT_ID + ":" + process.env.EBAY_CLIENT_SECRET).toString("base64");
}

export function store() {
  return getStore("cardflip");
}

export async function getTokens() {
  return (await store().get("ebay_tokens", { type: "json" })) || null;
}

export async function saveTokens(t) {
  await store().setJSON("ebay_tokens", t);
}

export async function clearTokens() {
  await store().delete("ebay_tokens");
}

// Returns a valid access token, refreshing if needed. Throws if not connected.
export async function getAccessToken() {
  const t = await getTokens();
  if (!t || !t.refresh_token) throw new Error("eBay not connected");
  if (t.access_token && t.expires_at && Date.now() < t.expires_at - 60000) return t.access_token;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: t.refresh_token,
    scope: SCOPES,
  });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basicAuth() },
    body,
  });
  const d = await r.json();
  if (!r.ok) throw new Error("Token refresh failed: " + (d.error_description || JSON.stringify(d)));
  const next = { ...t, access_token: d.access_token, expires_at: Date.now() + d.expires_in * 1000 };
  await saveTokens(next);
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
