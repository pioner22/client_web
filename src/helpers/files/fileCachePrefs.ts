const PREFS_VERSION = 1;
const GB = 1024 * 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;

export interface FileCachePrefs {
  maxBytes: number;
  autoCleanMs: number;
  lastCleanAt: number;
}

export const CACHE_SIZE_PRESETS = [
  { label: "1 ГБ", bytes: 1 * GB },
  { label: "5 ГБ", bytes: 5 * GB },
  { label: "10 ГБ", bytes: 10 * GB },
  { label: "30 ГБ", bytes: 30 * GB },
];

export const CACHE_CLEAN_PRESETS = [
  { label: "Не очищать", ms: 0 },
  { label: "Раз в сутки", ms: 1 * DAY },
  { label: "Раз в неделю", ms: 7 * DAY },
  { label: "Раз в месяц", ms: 30 * DAY },
];

const DEFAULT_PREFS: FileCachePrefs = {
  maxBytes: 5 * GB,
  autoCleanMs: 7 * DAY,
  lastCleanAt: 0,
};

function storageKey(userId: string): string | null {
  const id = String(userId || "").trim();
  if (!id) return null;
  return `yagodka_file_cache_prefs_v${PREFS_VERSION}:${id}`;
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function normalizePrefs(raw: unknown): FileCachePrefs {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PREFS };
  const obj = raw as any;
  const maxBytes = Number(obj.maxBytes ?? DEFAULT_PREFS.maxBytes);
  const autoCleanMs = Number(obj.autoCleanMs ?? DEFAULT_PREFS.autoCleanMs);
  const lastCleanAt = Number(obj.lastCleanAt ?? 0);
  const allowedMax = new Set(CACHE_SIZE_PRESETS.map((p) => p.bytes));
  const allowedClean = new Set(CACHE_CLEAN_PRESETS.map((p) => p.ms));
  return {
    maxBytes: allowedMax.has(maxBytes) ? maxBytes : DEFAULT_PREFS.maxBytes,
    autoCleanMs: allowedClean.has(autoCleanMs) ? autoCleanMs : DEFAULT_PREFS.autoCleanMs,
    lastCleanAt: Number.isFinite(lastCleanAt) && lastCleanAt > 0 ? Math.round(lastCleanAt) : 0,
  };
}

export function loadFileCachePrefs(userId: string): FileCachePrefs {
  const key = storageKey(userId);
  if (!key) return { ...DEFAULT_PREFS };
  const st = defaultStorage();
  if (!st) return { ...DEFAULT_PREFS };
  try {
    const raw = st.getItem(key);
    if (!raw) return { ...DEFAULT_PREFS };
    return normalizePrefs(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function saveFileCachePrefs(userId: string, prefs: FileCachePrefs): void {
  const key = storageKey(userId);
  if (!key) return;
  const st = defaultStorage();
  if (!st) return;
  try {
    const payload = JSON.stringify(normalizePrefs(prefs));
    st.setItem(key, payload);
  } catch {
    // ignore
  }
}

