import { liftFileHttpTokenToBearer } from "./fileHttpAuth";

interface ProgressiveMediaParams {
  fileId?: string | null;
  url: string | null | undefined;
  name?: string | null;
  size?: number | null;
  mime?: string | null;
}

interface ProgressiveMediaRegistration {
  sourceId: string;
  proxyUrl: string;
  ts: number;
}

const MEDIA_PROXY_TTL_MS = 10 * 60 * 1000;
const MEDIA_PROXY_PATH = "__yagodka_media__/files";
const registrations = new Map<string, ProgressiveMediaRegistration>();

function makeSourceId(fileId: string): string {
  try {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return `${fileId}-${uuid}`;
  } catch {
    // ignore
  }
  return `${fileId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function cleanupRegistrations(): void {
  const now = Date.now();
  for (const [key, value] of registrations.entries()) {
    if (now - value.ts > MEDIA_PROXY_TTL_MS) registrations.delete(key);
  }
}

function buildProxyUrl(fileId: string, sourceId: string): string {
  const safeFileId = encodeURIComponent(fileId || "media");
  const params = new URLSearchParams({ sid: sourceId });
  try {
    return new URL(`./${MEDIA_PROXY_PATH}/${safeFileId}?${params.toString()}`, globalThis.location?.href || "./").toString();
  } catch {
    return `./${MEDIA_PROXY_PATH}/${safeFileId}?${params.toString()}`;
  }
}

function getServiceWorkerController(): ServiceWorker | null {
  try {
    const controller = globalThis.navigator?.serviceWorker?.controller ?? null;
    return controller && typeof controller.postMessage === "function" ? controller : null;
  } catch {
    return null;
  }
}

function hasAuthHeader(headers: Record<string, string>): boolean {
  return Object.keys(headers || {}).some((key) => key.toLowerCase() === "authorization");
}

export function resolveProgressiveMediaUrl(params: ProgressiveMediaParams): string | null {
  const rawUrl = String(params.url || "").trim();
  if (!rawUrl) return null;
  if (/^(blob|data):/i.test(rawUrl) || rawUrl.includes("/__yagodka_media__/files/")) return rawUrl;

  const lifted = liftFileHttpTokenToBearer(rawUrl);
  const cleanUrl = lifted.url || rawUrl;
  if (!hasAuthHeader(lifted.headers)) return cleanUrl;

  const controller = getServiceWorkerController();
  if (!controller) return null;

  cleanupRegistrations();
  const fileId = String(params.fileId || "media").trim() || "media";
  const key = `${fileId}:${cleanUrl}`;
  const existing = registrations.get(key);
  if (existing) {
    existing.ts = Date.now();
    controller.postMessage({
      type: "PWA_MEDIA_SOURCE_REGISTER",
      sourceId: existing.sourceId,
      fileId,
      url: cleanUrl,
      headers: lifted.headers,
      name: String(params.name || ""),
      size: Number(params.size || 0) || 0,
      mime: String(params.mime || ""),
    });
    return existing.proxyUrl;
  }

  const sourceId = makeSourceId(fileId);
  const proxyUrl = buildProxyUrl(fileId, sourceId);
  registrations.set(key, { sourceId, proxyUrl, ts: Date.now() });
  controller.postMessage({
    type: "PWA_MEDIA_SOURCE_REGISTER",
    sourceId,
    fileId,
    url: cleanUrl,
    headers: lifted.headers,
    name: String(params.name || ""),
    size: Number(params.size || 0) || 0,
    mime: String(params.mime || ""),
  });
  return proxyUrl;
}

export function __resetProgressiveMediaForTest(): void {
  registrations.clear();
}
