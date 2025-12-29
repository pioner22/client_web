const STORAGE_PREFIX = "yagodka_last_read_v1:";

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

export function loadLastReadMarkers(userId: string): Record<string, number> {
  const uid = String(userId || "").trim();
  if (!uid) return {};
  try {
    const raw = localStorage.getItem(storageKey(uid));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const ts = Number(value);
      if (!Number.isFinite(ts) || ts <= 0) continue;
      out[key] = ts;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveLastReadMarkers(userId: string, map: Record<string, number>): void {
  const uid = String(userId || "").trim();
  if (!uid) return;
  try {
    localStorage.setItem(storageKey(uid), JSON.stringify(map || {}));
  } catch {
    // best-effort
  }
}
