// /.netlify/functions/ebay-deletion
// eBay Marketplace Account Deletion / Closure notification endpoint.
// GET  -> validation handshake: returns SHA-256(challengeCode + verificationToken + endpoint)
// POST -> acknowledges deletion notifications with 200.
import { createHash } from "node:crypto";

const ENDPOINT =
  process.env.EBAY_DELETION_ENDPOINT ||
  "https://cardflip-app.netlify.app/.netlify/functions/ebay-deletion";

export default async (req) => {
  const verificationToken = process.env.EBAY_VERIFICATION_TOKEN || "";
  const url = new URL(req.url);

  if (req.method === "GET") {
    const challengeCode = url.searchParams.get("challenge_code");
    if (!challengeCode) {
      return new Response(JSON.stringify({ error: "missing challenge_code" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const hash = createHash("sha256");
    hash.update(challengeCode);
    hash.update(verificationToken);
    hash.update(ENDPOINT);
    const challengeResponse = hash.digest("hex");
    return new Response(JSON.stringify({ challengeResponse }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // POST = a real account-deletion notification. Acknowledge so eBay marks it delivered.
  return new Response("", { status: 200 });
};
