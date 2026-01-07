import { splitBuildId } from "../version/buildId";

const ACTIVE_BUILD_ID_KEY = "yagodka_active_build_id_v1";

export function loadActiveBuildId(currentVersion: string): string {
  const current = splitBuildId(currentVersion);
  if (!current.version) return currentVersion;
  try {
    const raw = String(localStorage.getItem(ACTIVE_BUILD_ID_KEY) || "").trim();
    if (!raw) return currentVersion;
    const stored = splitBuildId(raw);
    if (!stored.version || stored.version !== current.version) return currentVersion;
    return raw;
  } catch {
    return currentVersion;
  }
}

export function storeActiveBuildId(buildId: string): void {
  const raw = String(buildId || "").trim();
  if (!raw) return;
  const parsed = splitBuildId(raw);
  if (!parsed.version) return;
  try {
    localStorage.setItem(ACTIVE_BUILD_ID_KEY, raw);
  } catch {
    // ignore
  }
}
