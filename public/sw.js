/* Fallback service worker (production builds overwrite this file during `npm run build`). */
const CACHE_PREFIX = "yagodka-web-cache-fallback-";
const CACHE = `${CACHE_PREFIX}v1`;
const RUNTIME_CACHE = `${CACHE_PREFIX}runtime-v1`;
const RUNTIME_LIMIT = 140;
const RUNTIME_EXT_RE = /\.(js|css|jpe?g|png|gif|webp|avif|svg|ico|woff2?|ttf|otf|wasm|webmanifest)(?:\?.*)?$/i;
const RUNTIME_PATH_RE = /^\/(assets|icons|skins)\//i;
const RUNTIME_SPECIAL = new Set(["/manifest.webmanifest", "/sw.js"]);
const SHARE_PATH_RE = /\/share\/?$/i;
const SHARE_FALLBACK_ID = "__broadcast__";
const shareQueue = new Map();

function isStaticAssetUrl(url) {
  const path = url.pathname || "/";
  if (RUNTIME_SPECIAL.has(path)) return true;
  if (RUNTIME_PATH_RE.test(path)) return true;
  return RUNTIME_EXT_RE.test(path);
}

async function trimRuntimeCache(cache) {
  try {
    const keys = await cache.keys();
    if (keys.length <= RUNTIME_LIMIT) return;
    const overflow = keys.length - RUNTIME_LIMIT;
    for (let i = 0; i < overflow; i += 1) {
      const req = keys[i];
      await cache.delete(req);
    }
  } catch {}
}

function normalizeSharePayload(formData) {
  const files = [];
  try {
    for (const f of formData.getAll("files") || []) {
      if (f && typeof f === "object" && typeof f.arrayBuffer === "function") files.push(f);
    }
  } catch {}
  const title = String(formData.get("title") || "").trim();
  const text = String(formData.get("text") || "").trim();
  const url = String(formData.get("url") || "").trim();
  return { files, title, text, url };
}

function enqueueShare(clientId, payload) {
  const key = clientId || SHARE_FALLBACK_ID;
  const arr = shareQueue.get(key) || [];
  arr.push(payload);
  shareQueue.set(key, arr.slice(-8));
}

async function postShareToClient(client, payloads) {
  if (!client || !payloads || !payloads.length) return;
  for (const payload of payloads) {
    try {
      client.postMessage({ type: "PWA_SHARE", payload });
    } catch {}
  }
}

async function flushShareQueue(client) {
  if (!client) return;
  const own = shareQueue.get(client.id) || [];
  const fallback = shareQueue.get(SHARE_FALLBACK_ID) || [];
  if (!own.length && !fallback.length) return;
  shareQueue.delete(client.id);
  shareQueue.delete(SHARE_FALLBACK_ID);
  await postShareToClient(client, [...own, ...fallback]);
}

async function handleShareFetch(event) {
  try {
    const formData = await event.request.formData();
    const payload = normalizeSharePayload(formData);
    const clientId = event.resultingClientId || "";
    enqueueShare(clientId, payload);
    if (clientId) {
      const client = await self.clients.get(clientId);
      if (client) await flushShareQueue(client);
    } else {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (clients && clients.length) {
        for (const c of clients) {
          await flushShareQueue(c);
        }
      }
    }
  } catch {}
  return Response.redirect("./", 303);
}

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
        await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k)));
      } catch {}
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  const data = event && event.data ? event.data : null;
  if (!data || typeof data !== "object") return;
  if (data.type === "SKIP_WAITING") self.skipWaiting();
  if (data.type === "PWA_SHARE_READY") {
    const source = event && event.source;
    if (source && typeof source.id === "string") flushShareQueue(source);
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (!req) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (SHARE_PATH_RE.test(url.pathname)) {
    if (req.method === "POST") {
      event.respondWith(handleShareFetch(event));
    }
    return;
  }

  if (req.method !== "GET") return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      try {
        // App shell: for navigations, prefer cached index.html to avoid mixing versions.
        if (req.mode === "navigate" || req.destination === "document") {
          const cachedIndex = await caches.match("./index.html");
          if (cachedIndex) return cachedIndex;
        }
        if (!isStaticAssetUrl(url)) return fetch(req);
        const runtime = await caches.open(RUNTIME_CACHE);
        const cachedRuntime = await runtime.match(req);
        if (cachedRuntime) return cachedRuntime;
        const res = await fetch(req);
        if (res && res.ok) {
          runtime.put(req, res.clone()).catch(() => {});
          trimRuntimeCache(runtime);
        }
        return res;
      } catch {
        if (cached) return cached;
        throw new Error("offline");
      }
    })()
  );
});
