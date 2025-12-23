const CACHE_VERSION = 1;
const CACHE_NAME = `yagodka_file_blob_cache_v${CACHE_VERSION}`;
const INDEX_VERSION = 2;
const MAX_ENTRIES = 2000;

export interface FileCachePolicy {
  maxBytes?: number;
  ttlMs?: number;
}

export interface FileCacheStats {
  totalBytes: number;
  count: number;
  oldestTs: number;
  newestTs: number;
  removed: number;
}

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

function legacyIndexKey(userId: string): string | null {
  const uid = normalizeId(userId);
  if (!uid) return null;
  return `yagodka_file_blob_index_v1:${uid}`;
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
  const st = storage ?? defaultStorage();
  if (!st) return [];
  try {
    const legacyKey = legacyIndexKey(userId);
    const raw = (key ? st.getItem(key) : null) || (legacyKey ? st.getItem(legacyKey) : null);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];
    if (parsed.v !== 1 && parsed.v !== 2) return [];
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
  const st = storage ?? defaultStorage();
  if (!st) return;
  try {
    const payload = JSON.stringify({ v: INDEX_VERSION, entries: entries.slice(0, MAX_ENTRIES) });
    if (key) st.setItem(key, payload);
    const legacyKey = legacyIndexKey(userId);
    if (legacyKey) st.removeItem(legacyKey);
  } catch {
    // ignore
  }
}

function removeIndex(userId: string, storage?: Storage | null): void {
  const st = storage ?? defaultStorage();
  if (!st) return;
  try {
    const key = indexKey(userId);
    if (key) st.removeItem(key);
    const legacyKey = legacyIndexKey(userId);
    if (legacyKey) st.removeItem(legacyKey);
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

    const idx = touchIndex(loadIndex(uid), { fileId: fid, ts: Date.now(), size: Math.round(size) || 0, mime });
    saveIndex(uid, idx);

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

function sumIndexSize(entries: CacheIndexEntry[]): number {
  return entries.reduce((acc, e) => acc + (Number(e.size || 0) || 0), 0);
}

function statsFromIndex(entries: CacheIndexEntry[], removed: number): FileCacheStats {
  let oldestTs = 0;
  let newestTs = 0;
  for (const e of entries) {
    const ts = Number(e.ts || 0) || 0;
    if (!oldestTs || (ts && ts < oldestTs)) oldestTs = ts;
    if (!newestTs || ts > newestTs) newestTs = ts;
  }
  return {
    totalBytes: sumIndexSize(entries),
    count: entries.length,
    oldestTs,
    newestTs,
    removed,
  };
}

export function getFileCacheStats(userId: string): FileCacheStats {
  const uid = normalizeId(userId);
  if (!uid) return { totalBytes: 0, count: 0, oldestTs: 0, newestTs: 0, removed: 0 };
  const entries = loadIndex(uid);
  return statsFromIndex(entries, 0);
}

export async function clearFileCache(userId: string): Promise<void> {
  const uid = normalizeId(userId);
  if (!uid) return;
  if (!(await cacheAvailable())) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    const needle = `/__yagodka_cache__/files/${encodeURIComponent(uid)}/`;
    for (const req of keys) {
      if (String(req.url || "").includes(needle)) {
        try {
          await cache.delete(req);
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
  removeIndex(uid);
}

export async function cleanupFileCache(userId: string, policy: FileCachePolicy = {}): Promise<FileCacheStats> {
  const uid = normalizeId(userId);
  if (!uid) return { totalBytes: 0, count: 0, oldestTs: 0, newestTs: 0, removed: 0 };
  const entries = loadIndex(uid);
  if (!entries.length) return statsFromIndex([], 0);

  const maxBytes = Number(policy.maxBytes ?? 0) || 0;
  const ttlMs = Number(policy.ttlMs ?? 0) || 0;
  const now = Date.now();
  let kept = entries.slice();
  if (ttlMs > 0) {
    const minTs = now - ttlMs;
    kept = kept.filter((e) => Number(e.ts || 0) >= minTs);
  }

  if (maxBytes > 0) {
    kept.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
    const next: CacheIndexEntry[] = [];
    let total = 0;
    for (const e of kept) {
      const size = Number(e.size || 0) || 0;
      if (total + size <= maxBytes) {
        next.push(e);
        total += size;
      }
    }
    kept = next;
  }

  const keptIds = new Set(kept.map((e) => e.fileId));
  const removed = entries.filter((e) => !keptIds.has(e.fileId));

  if (removed.length && (await cacheAvailable())) {
    try {
      const cache = await caches.open(CACHE_NAME);
      for (const e of removed) {
        try {
          await cache.delete(requestUrl(uid, e.fileId));
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }

  saveIndex(uid, kept);
  return statsFromIndex(kept, removed.length);
}
