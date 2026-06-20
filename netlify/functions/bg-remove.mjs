// /.netlify/functions/bg-remove  (POST)
// Body: { dataUrl }  -> returns { dataUrl } with the card on a clean white background.
// Uses remove.bg. Disabled (needsKey) until REMOVEBG_API_KEY is set in Netlify env vars.
function json(o, s) {
  return new Response(JSON.stringify(o), {
    status: s || 200,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const apiKey = process.env.REMOVEBG_API_KEY;
  if (!apiKey) {
    return json({
      error: "Background removal isn't set up yet. Add a REMOVEBG_API_KEY in Netlify (Site configuration > Environment variables) to turn it on.",
      needsKey: true,
    }, 503);
  }

  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad JSON body" }, 400); }
  const dataUrl = body && body.dataUrl ? String(body.dataUrl) : "";
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return json({ error: "Expected dataUrl (image/* base64)" }, 400);

  try {
    const form = new FormData();
    form.append("image_file_b64", m[2]);
    form.append("size", "auto");
    form.append("bg_color", "ffffff"); // clean white background for listings
    form.append("format", "jpg");
    const r = await fetch("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: { "X-Api-Key": apiKey },
      body: form,
    });
    if (!r.ok) {
      const t = await r.text();
      return json({ error: "Background removal failed (" + r.status + ")", detail: t.slice(0, 300) }, 502);
    }
    const buf = Buffer.from(await r.arrayBuffer());
    return json({ dataUrl: "data:image/jpeg;base64," + buf.toString("base64") });
  } catch (e) {
    return json({ error: "Background removal error", detail: String(e && e.message || e) }, 500);
  }
};
