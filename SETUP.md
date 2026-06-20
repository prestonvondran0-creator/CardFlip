# CardFlip — Setup Guide (live, personal use)

This package is the full app **plus** a tiny eBay backend so listings publish for real.

```
cardflip-app/
├─ index.html                  ← the app (self-contained)
├─ netlify.toml                ← Netlify config
├─ package.json                ← backend dependency
├─ ebay-lib.mjs                ← shared eBay helper
└─ netlify/functions/
   ├─ ebay-auth.mjs            ← eBay login / token exchange / logout
   ├─ ebay-status.mjs          ← reports connected/not
   └─ ebay-publish.mjs         ← creates + publishes the listing
```

There are 4 parts. Do them in order. Total: ~30–45 min the first time.

---

## PART A — Claude (scanning + pricing)  ·  ~2 min
You can do this any time, right in the app.
1. Open the app → tap the **AI** pill (top-right).
2. Follow the in-app steps: create a key at **console.anthropic.com**, add a payment method (pay-as-you-go), paste the key, **Test & connect**.
3. While there, turn on **Web Search** (Console → Settings/Features) so comps use real recent sales instead of an estimate.

That alone makes scanning + pricing fully work. eBay is parts B–D.

---

## PART B — Create your eBay developer app  ·  ~10 min
1. Go to **developer.ebay.com** → sign in with your eBay account → **Register** as a developer.
2. Open **My Account → Application Keysets**. Use the **Production** keyset (not Sandbox).
3. Copy your **App ID (Client ID)** and **Cert ID (Client Secret)**.
4. Click **User Tokens → Get a Token from eBay via Your Application → Add eBay Redirect URL**.
   - Set **Your auth accepted URL** to:
     `https://YOUR-SITE.netlify.app/.netlify/functions/ebay-auth`
     (you'll know YOUR-SITE after Part D — you can come back and edit this.)
   - Set **Your privacy policy URL** to your site root (any page is fine for personal use).
   - Save. eBay generates a **RuName** (looks like `Your-App-Name-abc123`). Copy it.

You now have 3 values: **App ID**, **Cert ID**, **RuName**.

---

## PART C — Prep your eBay seller account  ·  ~10 min
eBay won't publish a listing until these exist (one-time):
1. **Business policies** — eBay → Account → **Business policies** (or Seller Hub → Account). Create one each:
   - a **Payment** policy, a **Shipping/Fulfillment** policy, a **Return** policy.
2. **Inventory location** — Seller Hub → set a ship-from location/address.

The backend auto-detects these. (If you have several and want to force specific ones, you can set their IDs as env vars later — see "Optional env vars".)

---

## PART D — Deploy to Netlify (app + backend)  ·  ~10 min
Netlify needs to build the functions, so use Git or the CLI (plain drag-and-drop won't bundle functions).

**Easiest: GitHub + Netlify**
1. Put this folder in a GitHub repo (github.com → New repository → upload these files).
2. app.netlify.com → **Add new site → Import an existing project** → pick the repo → Deploy.

**Or: Netlify CLI** (needs Node installed)
```
npm install -g netlify-cli
cd cardflip-app
netlify deploy --prod
```

**Then set environment variables** (Netlify → Site configuration → Environment variables):
| Variable | Value |
|---|---|
| `EBAY_CLIENT_ID` | your eBay **App ID** |
| `EBAY_CLIENT_SECRET` | your eBay **Cert ID** |
| `EBAY_RUNAME` | your eBay **RuName** |
| `APP_URL` | `https://YOUR-SITE.netlify.app` |

Redeploy after adding them. Go back to **Part B** and make sure the eBay redirect URL points at your real `YOUR-SITE.netlify.app`.

**Optional env vars** (only if auto-detect picks the wrong thing):
`EBAY_CATEGORY_ID`, `EBAY_FULFILLMENT_POLICY_ID`, `EBAY_PAYMENT_POLICY_ID`, `EBAY_RETURN_POLICY_ID`, `EBAY_LOCATION_KEY`, `EBAY_CONDITION` (default `USED_VERY_GOOD`), `EBAY_PLACEHOLDER_IMAGE` (a public image URL), `EBAY_MARKETPLACE_ID` (default `EBAY_US`).

---

## PART E — Use it
1. Open `https://YOUR-SITE.netlify.app` in Safari → **Share → Add to Home Screen**.
2. Open the app → setup guide appears → connect Claude, then tap **Connect eBay** → authorize on eBay's page.
3. Scan a card → price it → **List on eBay** → it publishes live. The card detail then shows **View live listing ↗**.

---

## Known limits (v1 — we can iterate)
- **Photos:** the scanned image isn't hosted anywhere public yet, so listings publish without your photo (eBay may want one — set `EBAY_PLACEHOLDER_IMAGE`, or we add image hosting next).
- **Condition / category / aspects** vary by card type; if eBay rejects a publish, the app shows eBay's exact reason so we can map it.
- This is **production** eBay — listings are real and fees apply. Test with one cheap card first.
- Your eBay secret lives only in Netlify env vars (server-side), never in the app.
