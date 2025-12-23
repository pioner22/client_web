const CACHE_VERSION = 1;
const CACHE_NAME = `yagodka_file_blob_cache_v${CACHE_VERSION}`;
const INDEX_VERSION = 1;
const MAX_ENTRIES = 80;

interface CacheIndexEntry {
  fileId: string;
  ts: number;
  size: number;
  mime: string | null;
}

function origin(): string {
  try {
    const o = typeof location !== "undefined" ? String(location.origin || "") : "";
    return o || "http://localhost";
  } catch {
    return "http://localhost";
  }
}

function normalizeId(raw: string): string | null {
  const id = String(raw || "").trim();
  return id ? id : null;
}

function requestUrl(userId: string, fileId: string): string {
  const uid = encodeURIComponent(userId);
  const fid = encodeURIComponent(fileId);
  return `${origin()}/__yagodka_cache__/files/${uid}/${fid}`;
}

function indexKey(userId: string): string | null {
  const uid = normalizeId(userId);
  if (!uid) return null;
  return `yagodka_file_blob_index_v${INDEX_VERSION}:${uid}`;
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function loadIndex(userId: string, storage?: Storage | null): CacheIndexEntry[] {
  const key = indexKey(userId);
  if (!key) return [];
  const st = storage ?? defaultStorage();
  if (!st) return [];
  try {
    const raw = st.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];
    if (parsed.v !== INDEX_VERSION) return [];
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    const out: CacheIndexEntry[] = [];
    for (const it of entries) {
      if (!it || typeof it !== "object") continue;
      const fileId = normalizeId((it as any).fileId);
      if (!fileId) continue;
      const ts = Number((it as any).ts ?? 0);
      const size = Number((it as any).size ?? 0);
      const mimeRaw = (it as any).mime;
      const mime = typeof mimeRaw === "string" && mimeRaw.trim() ? mimeRaw.trim() : null;
      out.push({
        fileId,
        ts: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
        size: Number.isFinite(size) && size > 0 ? Math.round(size) : 0,
        mime,
      });
      if (out.length >= MAX_ENTRIES * 2) break;
    }
    return out;
  } catch {
    return [];
  }
}

function saveIndex(userId: string, entries: CacheIndexEntry[], storage?: Storage | null): void {
  const key = indexKey(userId);
  if (!key) return;
  const st = storage ?? defaultStorage();
  if (!st) return;
  try {
    const payload = JSON.stringify({ v: INDEX_VERSION, entries: entries.slice(0, MAX_ENTRIES) });
    st.setItem(key, payload);
  } catch {
    // ignore
  }
}

function touchIndex(entries: CacheIndexEntry[], next: CacheIndexEntry): CacheIndexEntry[] {
  const now = Date.now();
  const entry: CacheIndexEntry = { ...next, ts: now };
  const out = [entry, ...entries.filter((e) => e.fileId !== entry.fileId)];
  return out.slice(0, MAX_ENTRIES);
}

async function cacheAvailable(): Promise<boolean> {
  try {
    if (typeof caches === "undefined") return false;
    if (!caches || typeof caches.open !== "function") return false;
    await caches.open(CACHE_NAME);
    return true;
  } catch {
    return false;
  }
}

export async function putCachedFileBlob(
  userId: string,
  fileId: string,
  blob: Blob,
  meta?: { mime?: string | null; size?: number }
): Promise<void> {
  const uid = normalizeId(userId);
  const fid = normalizeId(fileId);
  if (!uid || !fid) return;
  if (!(await cacheAvailable())) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    const url = requestUrl(uid, fid);
    const mime = typeof meta?.mime === "string" && meta.mime.trim() ? meta.mime.trim() : (blob.type || null);
    const size = Number(meta?.size ?? blob.size ?? 0) || 0;
    const headers: Record<string, string> = {};
    if (mime) headers["Content-Type"] = mime;
    if (size > 0) headers["Content-Length"] = String(Math.round(size));
    await cache.put(url, new Response(blob, { headers }));

    const idx = touchIndex(loadIndex(uid), { fileId: fid, ts: Date.now(), size: Math.round(size) || 0, mime });
    saveIndex(uid, idx);

    // Best-effort eviction (keep it tiny and deterministic).
    if (idx.length > MAX_ENTRIES) {
      const extra = idx.slice(MAX_ENTRIES);
      for (const e of extra) {
        try {
          await cache.delete(requestUrl(uid, e.fileId));
        } catch {
          // ignore
        }
      }
      saveIndex(uid, idx.slice(0, MAX_ENTRIES));
    }
  } catch {
    // ignore
  }
}

export async function getCachedFileBlob(
  userId: string,
  fileId: string
): Promise<{ blob: Blob; mime: string | null; size: number } | null> {
  const uid = normalizeId(userId);
  const fid = normalizeId(fileId);
  if (!uid || !fid) return null;
  if (!(await cacheAvailable())) return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const url = requestUrl(uid, fid);
    const res = await cache.match(url);
    if (!res) return null;
    const blob = await res.blob();
    const mimeHeader = res.headers.get("Content-Type");
    const mime = mimeHeader && mimeHeader.trim() ? mimeHeader.trim() : blob.type || null;
    const sizeHeader = res.headers.get("Content-Length");
    const sizeFromHeader = sizeHeader ? Number(sizeHeader) : NaN;
    const size = Number.isFinite(sizeFromHeader) && sizeFromHeader > 0 ? Math.round(sizeFromHeader) : blob.size || 0;
    return { blob, mime, size };
  } catch {
    return null;
  }
}

export function isImageLikeFile(name: string, mime?: string | null): boolean {
  const mt = String(mime || "").toLowerCase();
  if (mt.startsWith("image/")) return true;
  const n = String(name || "").toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|ico|svg|heic|heif)$/.test(n);
}
