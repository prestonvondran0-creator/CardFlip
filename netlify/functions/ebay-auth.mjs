// /.netlify/functions/ebay-auth
// ?action=login&uid=XXX  -> redirects you to eBay's consent screen (uid carried in `state`)
// (eBay redirects back here with ?code=...&state=uid) -> exchanges code, stores tokens for that uid
// ?action=logout&uid=XXX -> clears that user's stored tokens
import { TOKEN_URL, SCOPES, saveTokens, clearTokens, exchangeBasicAuth, uidFrom } from "../../ebay-lib.mjs";

const CONSENT_URL = "https://auth.ebay.com/oauth2/authorize";

export default async (req) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const clientId = process.env.EBAY_CLIENT_ID;
  const ruName = process.env.EBAY_RUNAME; // the "redirect URL name" from your eBay app, NOT a raw URL
  const appUrl = process.env.APP_URL || url.origin;

  if (!clientId || !process.env.EBAY_CLIENT_SECRET || !ruName) {
    return new Response("Missing eBay env vars. Set EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_RUNAME in Netlify.", { status: 500 });
  }

  if (action === "logout") {
    await clearTokens(uidFrom(req));
    return Response.redirect(appUrl + "/?ebay=disconnected", 302);
  }

  // Step 2: eBay sent us back with an auth code -> exchange it for tokens.
  if (code) {
    const uid = state || "";
    const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: ruName });
    const r = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: exchangeBasicAuth() },
      body,
    });
    const d = await r.json();
    if (!r.ok) {
      return Response.redirect(appUrl + "/?ebay=error&msg=" + encodeURIComponent(d.error_description || "token exchange failed"), 302);
    }
    await saveTokens(uid, {
      refresh_token: d.refresh_token,
      access_token: d.access_token,
      expires_at: Date.now() + d.expires_in * 1000,
    });
    return Response.redirect(appUrl + "/?ebay=connected", 302);
  }

  // Step 1 (default / action=login): send the user to eBay to grant access.
  // The uid travels in `state` so the callback knows whose tokens to store.
  const uid = uidFrom(req);
  const consent = CONSENT_URL + "?" + new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: ruName,
    scope: SCOPES,
    prompt: "login",
    state: uid,
  });
  return Response.redirect(consent, 302);
};
