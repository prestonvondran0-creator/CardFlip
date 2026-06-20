# CardFlip — Get eBay Working (GitHub → Netlify)

**Why this is needed:** Drag-and-drop uploads your app but does NOT build the eBay
backend. That's why "Connect eBay" gives a 404. GitHub → Netlify builds the backend
automatically. You do this setup **once**, on a computer. After that you use the app on
your phone like normal — the web address works everywhere.

**Do this on a computer.** ~15 minutes. You do NOT test on the computer — once it's live,
you open the same link on your phone to use it.

**Have ready:** the `cardflip-app.zip` I gave you (download it to the computer), and your 3
eBay values from SETUP.md Part B — **App ID**, **Cert ID**, **RuName**. (If you haven't
made those yet, do SETUP.md Parts B & C first.)

---

## Step 1 — Unzip the app on the computer
1. Download `cardflip-app.zip` onto the computer.
2. Double-click to unzip it. You'll get a `cardflip-app` folder containing:
   `index.html`, `netlify.toml`, `package.json`, `ebay-lib.mjs`, and a `netlify` folder.
3. Keep this folder window open — you'll drag from it in Step 3.

---

## Step 2 — Make a GitHub account + empty repository
1. Go to **github.com** → sign up (free) or log in.
2. Click the **+** (top-right) → **New repository**.
3. Name it `cardflip`. Leave everything else default. Click **Create repository**.

---

## Step 3 — Upload the app files (this is the important part)
1. On the new repo page, click the link **"uploading an existing file"**.
2. Open the `cardflip-app` folder from Step 1. Select **everything INSIDE it** —
   `index.html`, `netlify.toml`, `package.json`, `ebay-lib.mjs`, AND the `netlify` folder —
   and drag them onto the GitHub page.
   - ✅ Drag the **contents**, not the `cardflip-app` folder itself.
   - ✅ After it loads, you should see `netlify/functions/ebay-auth.mjs` (and 2 more) in
     the file list. If you only see the folders but not those files, the upload didn't keep
     the structure — try again and make sure the `netlify` folder went up too.
3. Scroll down, click the green **Commit changes**.

---

## Step 4 — Connect Netlify to the repo
1. Go to **app.netlify.com** → **Add new site** → **Import an existing project**.
2. Choose **GitHub**, authorize it, then pick your **cardflip** repo.
3. Netlify reads its own settings from the file — just click **Deploy**. Don't change build
   settings.
4. Wait ~1 minute. You'll get a new web address like `something-12345.netlify.app`.
   **Write it down** — call it YOUR-SITE. (You can rename it later in Site configuration →
   Change site name.)

---

## Step 5 — Add your eBay keys (environment variables)
In Netlify: **Site configuration → Environment variables → Add a variable**. Add these 4
(type the names exactly):

| Name | Value |
|---|---|
| `EBAY_CLIENT_ID` | your eBay **App ID** |
| `EBAY_CLIENT_SECRET` | your eBay **Cert ID** |
| `EBAY_RUNAME` | your eBay **RuName** |
| `APP_URL` | `https://YOUR-SITE.netlify.app` |

Then **Deploys → Trigger deploy → Deploy site** so the keys take effect.

---

## Step 6 — Point eBay back at your site
1. Go to **developer.ebay.com** → your app → **User Tokens → Add/Edit eBay Redirect URL**.
2. Set **"Your auth accepted URL"** to exactly:
   `https://YOUR-SITE.netlify.app/.netlify/functions/ebay-auth`
3. Save.

---

## Step 7 — Confirm the backend is alive
In Netlify, open the **Functions** tab. You should see:
`ebay-auth`, `ebay-status`, `ebay-publish`.
✅ If they're listed, the backend deployed. ❌ If empty, the upload in Step 3 lost the
`netlify/functions` files — redo Step 3.

---

## Step 8 — Use it on your phone
1. On your phone, open `https://YOUR-SITE.netlify.app` in Safari.
2. **Share → Add to Home Screen.**
3. Open the app → tap **AI** pill → connect your Claude key (scanning works immediately).
4. Tap **Connect eBay** → you should now go to eBay's login (no more 404) → authorize →
   it sends you back to the app, connected.
5. Scan a cheap card → price it → **List on eBay** → it publishes live.

---

### Notes
- The old drag-drop site (`incandescent-kulfi-036599`) can be deleted once this one works.
- This is real/production eBay — listings are live and fees apply. Test with one cheap card.
- If an eBay publish fails, the app shows eBay's exact error message — send me that text
  and I'll fix it.
- Photos aren't hosted yet, so the first listing may publish without your photo. We can add
  image hosting next.
