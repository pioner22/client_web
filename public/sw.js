/* Fallback service worker (production builds overwrite this file during `npm run build`). */
const CACHE_PREFIX = "yagodka-web-cache-fallback-";
const CACHE = `${CACHE_PREFIX}v1`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) =>
        c.addAll([
          "./",
          "./index.html",
          "./manifest.webmanifest",
          "./icons/icon.svg",
          "./icons/icon-192.png",
          "./icons/icon-512.png",
          "./skins/skins.json",
          "./skins/default.css",
          "./skins/amber.css",
          "./skins/green.css",
          "./skins/showcase.css",
        ])
      )
      .catch(() => {})
  );
  // Do NOT skipWaiting() automatically: apply updates only on user confirmation.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
      } catch {}
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  const data = event && event.data ? event.data : null;
  if (!data || typeof data !== "object") return;
  if (data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (!req || req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      try {
        // App shell: for navigations, prefer cached index.html to avoid mixing versions.
        if (req.mode === "navigate" || req.destination === "document") {
          const cachedIndex = await caches.match("./index.html");
          if (cachedIndex) return cachedIndex;
        }
        const res = await fetch(req);
        if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone())).catch(() => {});
        return res;
      } catch {
        if (cached) return cached;
        throw new Error("offline");
      }
    })()
  );
});
