export function getGatewayUrl(): string {
  const u = String(import.meta.env.VITE_GATEWAY_URL ?? "").trim();
  if (u) return u;

  try {
    const loc = globalThis.location;
    if (!loc || typeof loc.hostname !== "string" || !loc.hostname) throw new Error("no location");

    const proto = loc.protocol === "https:" ? "wss:" : "ws:";

    // Dev default: Vite/preview runs on a separate port; gateway is usually on :8787.
    // Use current hostname so LAN devices can connect (e.g. phone to 192.168.x.x:8787).
    if (import.meta.env.DEV || (loc.port && loc.port !== "80" && loc.port !== "443")) {
      return `${proto}//${loc.hostname}:8787/ws`;
    }

    // Production default: same host (no extra port), /ws, matching page scheme (https -> wss).
    if (typeof loc.host === "string" && loc.host) {
      return `${proto}//${loc.host}/ws`;
    }
  } catch {
    // ignore
  }

  // Dev/CLI fallback.
  return "ws://127.0.0.1:8787/ws";
}
