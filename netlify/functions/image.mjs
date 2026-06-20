// /.netlify/functions/image?key=...  (GET) — serves a stored image publicly.
import { getStore } from "@netlify/blobs";

export default async (req) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (!key) return new Response("Missing key", { status: 400 });

  try {
    const store = getStore("cardflip-images");
    const res = await store.getWithMetadata(key, { type: "arrayBuffer" });
    if (!res || !res.data) return new Response("Not found", { status: 404 });
    const ct = (res.metadata && res.metadata.contentType) || "image/jpeg";
    return new Response(res.data, {
      status: 200,
      headers: {
        "Content-Type": ct,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    return new Response("Error: " + String(e && e.message || e), { status: 500 });
  }
};
