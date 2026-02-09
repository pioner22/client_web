import { DEFAULT_AUTO_DOWNLOAD_PREFS, loadAutoDownloadPrefs, type AutoDownloadPrefs } from "../../../helpers/files/autoDownloadPrefs";
import { cleanupFileCache, isImageLikeFile } from "../../../helpers/files/fileBlobCache";
import { loadFileCachePrefs, saveFileCachePrefs } from "../../../helpers/files/fileCachePrefs";
import { isVideoLikeFile } from "../../../helpers/files/isVideoLikeFile";
import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";

type AutoDownloadKind = "image" | "video" | "audio" | "file";
type FileCachePrefs = { maxBytes: number; autoCleanMs: number; lastCleanAt: number };

export interface AutoDownloadCachePolicyFeatureDeps {
  store: Store<AppState>;
  previewAutoMaxBytes: number;
}

export interface AutoDownloadCachePolicyFeature {
  setAutoDownloadPrefsCache: (userId: string, prefs: AutoDownloadPrefs) => void;
  syncAutoDownloadPrefsFromStorageKey: (key: string | null | undefined) => void;
  resolveAutoDownloadKind: (name: string, mime: string | null | undefined, hint?: string | null) => AutoDownloadKind;
  canAutoDownloadFullFile: (userId: string | null, kind: AutoDownloadKind, size: number) => boolean;
  enforceFileCachePolicy: (userId: string, opts?: { force?: boolean }) => Promise<void>;
  shouldCachePreview: (name: string, mime: string | null | undefined, size: number) => boolean;
  shouldCacheFile: (name: string, mime: string | null | undefined, size: number) => boolean;
  isMediaLikeFile: (name: string, mime: string | null | undefined) => boolean;
}

const VIDEO_NAME_HINT_RE =
  /^(?:video|vid|movie|clip|screencast|screen[_\-\s]?(?:rec|record|recording)|видео|ролик)([_\-\s]|\d|$)/;
const AUDIO_NAME_HINT_RE =
  /^(?:audio|voice|sound|music|song|track|record|rec|memo|note|voice[_\-\s]?note|аудио|звук|музык|песня|голос|запис|диктофон|заметк)([_\-\s]|\d|$)/;

function normalizeFileName(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const noQuery = raw.split(/[?#]/)[0];
  const leaf = noQuery.split(/[\\/]/).pop() || "";
  return leaf.trim().toLowerCase();
}

export function createAutoDownloadCachePolicyFeature(
  deps: AutoDownloadCachePolicyFeatureDeps
): AutoDownloadCachePolicyFeature {
  const { store, previewAutoMaxBytes } = deps;

  let autoDownloadPrefsUserId = "";
  let autoDownloadPrefsCache: AutoDownloadPrefs = { ...DEFAULT_AUTO_DOWNLOAD_PREFS };

  const getFileCachePrefsForUser = (userId: string | null): FileCachePrefs | null => {
    const uid = String(userId || "").trim();
    if (!uid) return null;
    try {
      return loadFileCachePrefs(uid);
    } catch {
      return null;
    }
  };

  const setAutoDownloadPrefsCache = (userId: string, prefs: AutoDownloadPrefs) => {
    const uid = String(userId || "").trim();
    if (!uid) return;
    autoDownloadPrefsUserId = uid;
    autoDownloadPrefsCache = prefs;
  };

  const syncAutoDownloadPrefsFromStorageKey = (key: string | null | undefined) => {
    const k = typeof key === "string" ? key : "";
    if (!k.startsWith("yagodka_auto_download_prefs_v")) return;
    const st = store.get();
    const uid = st.selfId ? String(st.selfId).trim() : "";
    if (!uid) return;
    if (!k.endsWith(`:${uid}`)) return;
    try {
      autoDownloadPrefsUserId = uid;
      autoDownloadPrefsCache = loadAutoDownloadPrefs(uid);
    } catch {
      // ignore
    }
  };

  const getAutoDownloadPrefsForUser = (userId: string | null): AutoDownloadPrefs => {
    const uid = String(userId || "").trim();
    if (!uid) return DEFAULT_AUTO_DOWNLOAD_PREFS;
    if (uid !== autoDownloadPrefsUserId) {
      autoDownloadPrefsUserId = uid;
      try {
        autoDownloadPrefsCache = loadAutoDownloadPrefs(uid);
      } catch {
        autoDownloadPrefsCache = { ...DEFAULT_AUTO_DOWNLOAD_PREFS };
      }
    }
    return autoDownloadPrefsCache;
  };

  const isMediaLikeFile = (name: string, mime: string | null | undefined): boolean => {
    const mt = String(mime || "").toLowerCase();
    if (mt.startsWith("image/") || mt.startsWith("video/") || mt.startsWith("audio/")) return true;
    const n = normalizeFileName(name);
    if (isImageLikeFile(n, mt)) return true;
    if (VIDEO_NAME_HINT_RE.test(n) || AUDIO_NAME_HINT_RE.test(n)) return true;
    return /\.(mp4|m4v|mov|webm|ogv|mkv|mp3|m4a|aac|wav|ogg|opus|flac)$/.test(n);
  };

  const resolveAutoDownloadKind = (
    name: string,
    mime: string | null | undefined,
    hint?: string | null
  ): AutoDownloadKind => {
    const h = String(hint || "").trim().toLowerCase();
    if (h === "image" || h === "video" || h === "audio") return h;
    if (isImageLikeFile(name, mime)) return "image";
    if (isVideoLikeFile(name, mime)) return "video";
    if (isMediaLikeFile(name, mime)) return "audio";
    return "file";
  };

  const autoDownloadCapBytes = (userId: string | null, kind: AutoDownloadKind): number => {
    const prefs = getAutoDownloadPrefsForUser(userId);
    const raw = kind === "image" ? prefs.photoMaxBytes : kind === "video" ? prefs.videoMaxBytes : prefs.fileMaxBytes;
    const max = Math.max(0, Number(raw ?? 0) || 0);
    if (!max) return 0;
    return Math.min(previewAutoMaxBytes, max);
  };

  const canAutoDownloadFullFile = (userId: string | null, kind: AutoDownloadKind, size: number): boolean => {
    const bytes = Number(size ?? 0) || 0;
    if (bytes <= 0) return false;
    const cap = autoDownloadCapBytes(userId, kind);
    if (cap <= 0) return false;
    return bytes <= cap;
  };

  const enforceFileCachePolicy = async (userId: string, opts: { force?: boolean } = {}): Promise<void> => {
    const uid = String(userId || "").trim();
    if (!uid) return;
    const prefs = getFileCachePrefsForUser(uid);
    if (!prefs) return;
    const now = Date.now();
    const due = prefs.autoCleanMs > 0 && now - prefs.lastCleanAt >= prefs.autoCleanMs;
    if (!opts.force && !due && !(prefs.maxBytes > 0)) return;
    await cleanupFileCache(uid, { maxBytes: prefs.maxBytes, ttlMs: prefs.autoCleanMs });
    if (due) {
      prefs.lastCleanAt = now;
      saveFileCachePrefs(uid, prefs);
    }
  };

  const shouldCachePreview = (name: string, mime: string | null | undefined, size: number): boolean => {
    const st = store.get();
    const prefs = getFileCachePrefsForUser(st.selfId || null);
    if (!prefs || prefs.maxBytes <= 0) return false;
    const bytes = Number(size ?? 0) || 0;
    if (bytes <= 0) return false;
    if (!isMediaLikeFile(name, mime)) return false;
    const mb = 1024 * 1024;
    const kind = resolveAutoDownloadKind(name, mime, null);
    const hardCap = kind === "video" ? 6 * mb : 24 * mb;
    const cap = Math.min(hardCap, prefs.maxBytes > 0 ? prefs.maxBytes : hardCap);
    return bytes <= cap;
  };

  const shouldCacheFile = (name: string, mime: string | null | undefined, size: number): boolean => {
    const st = store.get();
    const prefs = getFileCachePrefsForUser(st.selfId || null);
    if (!prefs || prefs.maxBytes <= 0) return false;
    const bytes = Number(size ?? 0) || 0;
    if (bytes <= 0) return false;
    if (bytes > prefs.maxBytes) return false;
    return Boolean(name || mime);
  };

  return {
    setAutoDownloadPrefsCache,
    syncAutoDownloadPrefsFromStorageKey,
    resolveAutoDownloadKind,
    canAutoDownloadFullFile,
    enforceFileCachePolicy,
    shouldCachePreview,
    shouldCacheFile,
    isMediaLikeFile,
  };
}
