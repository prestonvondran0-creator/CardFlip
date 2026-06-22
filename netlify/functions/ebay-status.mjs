// /.netlify/functions/ebay-status?uid=XXX -> { connected: boolean }
import { getTokens, uidFrom } from "../../ebay-lib.mjs";

export default async (req) => {
  let connected = false;
  try {
    const t = await getTokens(uidFrom(req));
    connected = !!(t && t.refresh_token);
  } catch { connected = false; }
  return new Response(JSON.stringify({ connected }), {
    headers: { "Content-Type": "application/json" },
  });
};
