export function getGatewayUrl(): string {
  const u = String(import.meta.env.VITE_GATEWAY_URL ?? "").trim();
  if (u) return u;

  // Production default: same host, /ws, matching page scheme (https -> wss).
  try {
    const loc = globalThis.location;
    if (loc && typeof loc.host === "string" && loc.host) {
      const proto = loc.protocol === "https:" ? "wss:" : "ws:";
      return `${proto}//${loc.host}/ws`;
    }
  } catch {
    // ignore
  }

  // Dev/CLI fallback.
  return "ws://127.0.0.1:8787/ws";
}
