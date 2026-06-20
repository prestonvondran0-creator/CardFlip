// /.netlify/functions/image-store  (POST)
// Body: { dataUrl: "data:image/jpeg;base64,..." }
// Stores the image in Netlify Blobs and returns a public URL the listing can use.
import { getStore } from "@netlify/blobs";

function json(o, s) {
  return new Response(JSON.stringify(o), {
    status: s || 200,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad JSON body" }, 400); }

  const dataUrl = body && body.dataUrl ? String(body.dataUrl) : "";
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return json({ error: "Expected dataUrl (image/* base64)" }, 400);

  const contentType = m[1];
  const bytes = Buffer.from(m[2], "base64");
  if (!bytes.length) return json({ error: "Empty image" }, 400);
  if (bytes.length > 8_000_000) return json({ error: "Image too large (max ~8MB)" }, 413);

  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  const key = "img/" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10) + "." + ext;

  try {
    const store = getStore("cardflip-images");
    await store.set(key, Uint8Array.from(bytes).buffer, { metadata: { contentType } });
  } catch (e) {
    return json({ error: "Couldn't store image", detail: String(e && e.message || e) }, 500);
  }

  const host = req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const base = (process.env.APP_URL || (proto + "://" + host)).replace(/\/+$/, "");
  const url = base + "/.netlify/functions/image?key=" + encodeURIComponent(key);
  return json({ url, key });
};
