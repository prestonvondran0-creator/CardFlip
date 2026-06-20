// /.netlify/functions/ebay-status -> { connected: boolean }
import { getTokens } from "../../ebay-lib.mjs";

export default async () => {
  let connected = false;
  try {
    const t = await getTokens();
    connected = !!(t && t.refresh_token);
  } catch { connected = false; }
  return new Response(JSON.stringify({ connected }), {
    headers: { "Content-Type": "application/json" },
  });
};
