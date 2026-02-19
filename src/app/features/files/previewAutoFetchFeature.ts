import type { Store } from "../../../stores/store";
import type { AppState, FileTransferEntry } from "../../../stores/types";

type AutoDownloadKind = "image" | "video" | "audio" | "file";

type RestoreTask = {
  fileId: string;
  kind: "image" | "video" | "audio";
  name: string;
  size: number;
  mime: string | null;
  direction: "in" | "out";
  peer: string;
  room: string | null;
  prefetch: boolean;
  restorePreview: boolean;
  retryWindowMs: number;
};

type PreviewTransferItem = {
  fileId: string;
  name: string;
  size: number;
  mime: string | null;
  direction: "in" | "out";
  peer: string;
  room: string | null;
};

type AutoDownloadCachePolicyFeatureLike = {
  isMediaLikeFile: (name: string, mime: string | null | undefined) => boolean;
  resolveAutoDownloadKind: (name: string, mime: string | null | undefined, hint?: string | null) => AutoDownloadKind;
  canAutoDownloadFullFile: (userId: string | null, kind: AutoDownloadKind, size: number) => boolean;
  shouldCachePreview: (name: string, mime: string | null | undefined, size: number) => boolean;
};

type CachedPreviewRestoreFeatureLike = {
  restoreCachedThumbsIntoStateBatch: (fileIds: string[]) => Promise<Set<string>>;
  restoreCachedPreviewsIntoTransfersBatch: (items: PreviewTransferItem[]) => Promise<Set<string>>;
};

type EnqueueFileGetOptions = { priority?: "high" | "prefetch"; silent?: boolean };

export interface PreviewAutoFetchFeatureDeps {
  store: Store<AppState>;
  chatHost: HTMLElement;
  conversationKey: (target: NonNullable<AppState["selected"]>) => string;
  convoSig: (msgs: any[]) => string;
  devicePrefetchAllowed: boolean;
  autoDownloadCachePolicyFeature: AutoDownloadCachePolicyFeatureLike;
  cachedPreviewRestoreFeature: CachedPreviewRestoreFeatureLike;
  getCachedMediaAspectRatio: (fileId: string) => number | null;
  clearFileThumb: (fileId: string) => void;
  updateTransferByFileId: (fileId: string, apply: (entry: FileTransferEntry) => FileTransferEntry) => void;
  enqueueFileGet: (fileId: string, opts?: EnqueueFileGetOptions) => void;
  previewPrefetchAttempted: Map<string, number>;
  previewAutoOverscan: number;
  previewAutoRestoreMaxBytes: number;
  previewAutoRetryMs: number;
  previewAutoFailRetryMs: number;
}

export interface PreviewAutoFetchFeature {
  scheduleWarmupCachedPreviews: () => void;
  scheduleAutoFetchVisiblePreviews: () => void;
  resetPreviewWarmup: () => void;
  hasPendingActivityForUpdate: () => boolean;
}

const WARMUP_DELAY_MS = 120;
const WARMUP_MAX_SCAN = 160;
const WARMUP_MAX_TASKS = 30;
const WARMUP_PREFETCH_MAX_BYTES = 24 * 1024 * 1024;

export function createPreviewAutoFetchFeature(
  deps: PreviewAutoFetchFeatureDeps
): PreviewAutoFetchFeature {
  const {
    store,
    chatHost,
    conversationKey,
    convoSig,
    devicePrefetchAllowed,
    autoDownloadCachePolicyFeature,
    cachedPreviewRestoreFeature,
    getCachedMediaAspectRatio,
    clearFileThumb,
    updateTransferByFileId,
    enqueueFileGet,
    previewPrefetchAttempted,
    previewAutoOverscan,
    previewAutoRestoreMaxBytes,
    previewAutoRetryMs,
    previewAutoFailRetryMs,
  } = deps;

  let previewWarmupTimer: number | null = null;
  let previewWarmupInFlight = false;
  let previewWarmupLastKey = "";
  let previewWarmupLastSig = "";
  let previewAutoFetchRaf: number | null = null;

  const shouldAutoFetchPreview = (
    name: string,
    mime: string | null,
    size: number,
    forceMedia = false,
    kindHint?: string | null
  ): boolean => {
    const hint = String(kindHint || "").trim().toLowerCase();
    const hintIsMedia = hint === "image" || hint === "video" || hint === "audio";
    if (!forceMedia && !hintIsMedia && !autoDownloadCachePolicyFeature.isMediaLikeFile(name, mime)) return false;
    const kind = autoDownloadCachePolicyFeature.resolveAutoDownloadKind(name, mime, hint);
    if (kind === "image" || kind === "video") return true;
    const st = store.get();
    return autoDownloadCachePolicyFeature.canAutoDownloadFullFile(st.selfId || null, kind, size);
  };

  const autoFetchVisiblePreviews = async () => {
    const st = store.get();
    if (!st.authed || st.conn !== "connected") return;
    if (st.page !== "main" || !st.selected) return;
    if (!st.selfId) return;
    if (document.visibilityState === "hidden") return;

    const now = Date.now();
    const convoKey = conversationKey(st.selected);
    if (convoKey && st.historyLoading?.[convoKey]) return;

    const hostRect = chatHost.getBoundingClientRect();
    const inlineVideos = chatHost.querySelectorAll("video.chat-file-video");
    if (inlineVideos.length) {
      for (const node of Array.from(inlineVideos)) {
        if (!(node instanceof HTMLVideoElement)) continue;
        if (node.paused) continue;
        const rect = node.getBoundingClientRect();
        if (rect.bottom < hostRect.top - previewAutoOverscan || rect.top > hostRect.bottom + previewAutoOverscan) {
          try {
            node.pause();
          } catch {
            // ignore
          }
        }
      }
    }

    const nodes = chatHost.querySelectorAll("button.chat-file-preview[data-file-id]");
    const audioNodes = chatHost.querySelectorAll("[data-file-kind='audio'][data-file-id]");
    if (!nodes.length && !audioNodes.length) return;

    const restoreTaskById = new Map<string, RestoreTask>();
    const upsertRestoreTask = (task: RestoreTask) => {
      const fid = String(task.fileId || "").trim();
      if (!fid) return;
      const prev = restoreTaskById.get(fid);
      if (!prev) {
        restoreTaskById.set(fid, { ...task, fileId: fid });
        return;
      }
      restoreTaskById.set(fid, {
        ...prev,
        kind: prev.kind || task.kind,
        prefetch: prev.prefetch || task.prefetch,
        restorePreview: prev.restorePreview || task.restorePreview,
        retryWindowMs: Math.min(prev.retryWindowMs, task.retryWindowMs),
      });
    };

    for (const node of Array.from(nodes)) {
      if (!(node instanceof HTMLButtonElement)) continue;
      const isFixed = node.getAttribute("data-media-fixed") === "1";
      const fileId = String(node.getAttribute("data-file-id") || "").trim();
      if (fileId) {
        const cachedRatio = getCachedMediaAspectRatio(fileId);
        if (cachedRatio && !node.style.aspectRatio && !isFixed) {
          node.style.aspectRatio = String(cachedRatio);
        }
      }

      const isEmpty = node.classList.contains("chat-file-preview-empty");
      const img = node.querySelector("img.chat-file-img");
      const video = node.querySelector("video.chat-file-video");
      const mediaFailed =
        (img instanceof HTMLImageElement && img.complete && img.naturalWidth === 0) ||
        (video instanceof HTMLVideoElement && Boolean(video.error));
      if (!isEmpty && !mediaFailed) continue;

      if (mediaFailed) {
        node.classList.add("chat-file-preview-empty");
        if (!node.querySelector(".chat-file-placeholder")) {
          const label = node.classList.contains("chat-file-preview-video") ? "Видео" : "Фото";
          const placeholder = document.createElement("div");
          placeholder.className = "chat-file-placeholder";
          placeholder.setAttribute("aria-hidden", "true");
          placeholder.textContent = label;
          node.appendChild(placeholder);
        }
        if (img instanceof HTMLImageElement) img.remove();
        if (video instanceof HTMLVideoElement) video.remove();
      }

      const rect = node.getBoundingClientRect();
      if (rect.bottom < hostRect.top - previewAutoOverscan || rect.top > hostRect.bottom + previewAutoOverscan) continue;
      if (!fileId) continue;
      const existing = st.fileTransfers.find((t) => String(t.id || "").trim() === fileId);
      if (existing?.status === "downloading") continue;

      const thumb = st.fileThumbs?.[fileId] || null;
      if (mediaFailed && thumb?.url) {
        clearFileThumb(fileId);
      }
      if (mediaFailed && existing?.url) {
        // Clear broken blob previews so the next fetch can replace them.
        updateTransferByFileId(fileId, (entry) => {
          if (entry.url && entry.url.startsWith("blob:")) {
            try {
              URL.revokeObjectURL(entry.url);
            } catch {
              // ignore
            }
          }
          return { ...entry, url: null };
        });
      }
      // NOTE: For outgoing videos on mobile UI we may have a blob `transfer.url`, but still render an empty preview
      // (we don't inline <video>). In that case we still want to fetch the real thumbnail.
      if (!isEmpty && (existing?.url || thumb?.url) && !mediaFailed) continue;

      const name = String(node.getAttribute("data-name") || "");
      const mimeRaw = node.getAttribute("data-mime");
      const mime = mimeRaw ? String(mimeRaw) : null;
      const size = Number(node.getAttribute("data-size") || 0) || 0;
      const kindHint =
        String(node.getAttribute("data-file-kind") || "").trim().toLowerCase() ||
        (node.classList.contains("chat-file-preview-video") ? "video" : "image");
      const previewKind = kindHint === "video" ? "video" : "image";
      const shouldPrefetch = devicePrefetchAllowed && shouldAutoFetchPreview(name, mime, size, false, kindHint);
      const isMediaHint = kindHint === "image" || kindHint === "video" || kindHint === "audio";
      const restorePreview = previewKind === "image" && (shouldPrefetch || !mime || size <= 0 || size <= previewAutoRestoreMaxBytes);
      const shouldAttemptRestore = isMediaHint && (previewKind === "image" || previewKind === "video");

      if (shouldAttemptRestore && convoKey) {
        const msgIdx = Number(node.getAttribute("data-msg-idx") || NaN);
        const msg = Number.isFinite(msgIdx) ? st.conversations[convoKey]?.[msgIdx] : null;
        const msgEl = node.closest(".msg");
        const msgKind = msg?.kind || (msgEl?.classList.contains("msg-out") ? "out" : "in");
        const direction = msgKind === "out" ? "out" : "in";
        const peer = msg
          ? String(msgKind === "out" ? (msg.to || msg.room || "") : (msg.from || "")) || "—"
          : "—";
        const room = typeof msg?.room === "string" ? msg.room : null;
        upsertRestoreTask({
          fileId,
          kind: previewKind,
          name: name || "файл",
          size,
          mime,
          direction,
          peer,
          room,
          prefetch: shouldPrefetch,
          restorePreview,
          retryWindowMs: mediaFailed ? previewAutoFailRetryMs : previewAutoRetryMs,
        });
        continue;
      }

      if (shouldPrefetch) {
        upsertRestoreTask({
          fileId,
          kind: previewKind,
          name: name || "файл",
          size,
          mime,
          direction: "in",
          peer: "—",
          room: null,
          prefetch: true,
          restorePreview,
          retryWindowMs: mediaFailed ? previewAutoFailRetryMs : previewAutoRetryMs,
        });
      }
    }

    for (const node of Array.from(audioNodes)) {
      if (!(node instanceof HTMLElement)) continue;
      const rect = node.getBoundingClientRect();
      if (rect.bottom < hostRect.top - previewAutoOverscan || rect.top > hostRect.bottom + previewAutoOverscan) continue;
      const fileId = String(node.getAttribute("data-file-id") || "").trim();
      if (!fileId) continue;
      const existing = st.fileTransfers.find((t) => String(t.id || "").trim() === fileId);
      if (existing?.status === "downloading") continue;
      if (existing?.url) continue;
      const name = String(node.getAttribute("data-name") || "Аудио");
      const mimeRaw = node.getAttribute("data-mime");
      const mime = mimeRaw ? String(mimeRaw) : null;
      const size = Number(node.getAttribute("data-size") || 0) || 0;
      const shouldPrefetch = devicePrefetchAllowed && shouldAutoFetchPreview(name, mime, size, true, "audio");
      const shouldAttemptRestore =
        Boolean(convoKey) && (shouldPrefetch || !mime || size <= 0 || size <= previewAutoRestoreMaxBytes);
      if (!shouldAttemptRestore || !convoKey) continue;

      const msgIdx = Number(node.getAttribute("data-msg-idx") || NaN);
      const msg = Number.isFinite(msgIdx) ? st.conversations[convoKey]?.[msgIdx] : null;
      const msgEl = node.closest(".msg");
      const msgKind = msg?.kind || (msgEl?.classList.contains("msg-out") ? "out" : "in");
      const direction = msgKind === "out" ? "out" : "in";
      const peer = msg
        ? String(msgKind === "out" ? (msg.to || msg.room || "") : (msg.from || "")) || "—"
        : "—";
      const room = typeof msg?.room === "string" ? msg.room : null;
      upsertRestoreTask({
        fileId,
        kind: "audio",
        name: name || "Аудио",
        size,
        mime,
        direction,
        peer,
        room,
        prefetch: shouldPrefetch,
        restorePreview: false,
        retryWindowMs: previewAutoRetryMs,
      });
    }

    const restoreTasks = Array.from(restoreTaskById.values());
    const mediaIds = restoreTasks
      .filter((t) => t.kind === "image" || t.kind === "video")
      .map((t) => t.fileId);
    const audioTasks = restoreTasks.filter((t) => t.kind === "audio");

    const restoredThumbIds = mediaIds.length
      ? await cachedPreviewRestoreFeature.restoreCachedThumbsIntoStateBatch(mediaIds)
      : new Set<string>();
    const imageTasksToRestore = restoreTasks.filter((t) => t.kind === "image" && t.restorePreview && !restoredThumbIds.has(t.fileId));
    const restoredMediaIds = imageTasksToRestore.length
      ? await cachedPreviewRestoreFeature.restoreCachedPreviewsIntoTransfersBatch(
          imageTasksToRestore.map((t) => ({
            fileId: t.fileId,
            name: t.name,
            size: t.size,
            mime: t.mime,
            direction: t.direction,
            peer: t.peer,
            room: t.room,
          }))
        )
      : new Set<string>();
    const restoredAudioIds = audioTasks.length
      ? await cachedPreviewRestoreFeature.restoreCachedPreviewsIntoTransfersBatch(
          audioTasks.map((t) => ({
            fileId: t.fileId,
            name: t.name,
            size: t.size,
            mime: t.mime,
            direction: t.direction,
            peer: t.peer,
            room: t.room,
          }))
        )
      : new Set<string>();

    const restoredIds = new Set<string>([...restoredThumbIds, ...restoredMediaIds, ...restoredAudioIds]);
    for (const t of restoreTasks) {
      if (restoredIds.has(t.fileId)) continue;
      const isVisibleMedia = t.kind === "image" || t.kind === "video";
      if (!t.prefetch && !isVisibleMedia) continue;
      const k = `${st.selfId}:${t.fileId}`;
      const lastAttempt = previewPrefetchAttempted.get(k) || 0;
      if (lastAttempt && now - lastAttempt < t.retryWindowMs) continue;
      previewPrefetchAttempted.set(k, now);
      enqueueFileGet(t.fileId, { priority: t.prefetch ? "prefetch" : "high", silent: true });
    }
  };

  const warmupCachedPreviewsForSelected = async (): Promise<void> => {
    if (previewWarmupInFlight) return;
    const st = store.get();
    if (!st.authed || !st.selfId) return;
    const uid = st.selfId;
    if (st.page !== "main") return;
    if (!st.selected) return;
    if (st.modal && st.modal.kind !== "context_menu") return;
    if (document.visibilityState === "hidden") return;

    const key = conversationKey(st.selected);
    if (!key) return;
    if (st.historyLoading[key]) return;

    const msgs = st.conversations[key] || [];
    if (!msgs.length) return;
    const sig = convoSig(msgs);
    if (key === previewWarmupLastKey && sig === previewWarmupLastSig) return;
    previewWarmupLastKey = key;
    previewWarmupLastSig = sig;

    previewWarmupInFlight = true;
    try {
      const tail = msgs.slice(Math.max(0, msgs.length - WARMUP_MAX_SCAN));
      const tasks: Array<Omit<RestoreTask, "retryWindowMs">> = [];
      const seen = new Set<string>();
      for (const m of tail.reverse()) {
        const att = m?.attachment;
        if (!att || att.kind !== "file") continue;
        const fid = typeof att.fileId === "string" ? att.fileId.trim() : "";
        if (!fid || seen.has(fid)) continue;

        const name = String(att.name || "");
        const mime = typeof att.mime === "string" ? att.mime : null;
        const size = Number(att.size ?? 0) || 0;
        const isMedia = autoDownloadCachePolicyFeature.isMediaLikeFile(name, mime);
        const kind = autoDownloadCachePolicyFeature.resolveAutoDownloadKind(name, mime, null);
        if (kind === "file") continue;
        const shouldPrefetch =
          devicePrefetchAllowed &&
          autoDownloadCachePolicyFeature.shouldCachePreview(name, mime, size) &&
          (kind !== "audio" || autoDownloadCachePolicyFeature.canAutoDownloadFullFile(uid, kind, size));
        const shouldAttemptRestore = isMedia && (shouldPrefetch || !mime || size <= 0 || size <= previewAutoRestoreMaxBytes);
        if (!shouldAttemptRestore) continue;
        if ((kind === "image" || kind === "video") && st.fileThumbs?.[fid]?.url) continue;
        const already = st.fileTransfers.find((t) => String(t.id || "").trim() === fid && Boolean(t.url));
        if (already) continue;

        seen.add(fid);
        tasks.push({
          fileId: fid,
          kind,
          name: name || "файл",
          size,
          mime,
          direction: m.kind === "out" ? "out" : "in",
          peer: String(m.kind === "out" ? (m.to || m.room || "") : (m.from || "")) || "—",
          room: typeof m.room === "string" ? m.room : null,
          prefetch: shouldPrefetch,
          restorePreview: kind === "image",
        });
        if (tasks.length >= WARMUP_MAX_TASKS) break;
      }

      const now = Date.now();
      const mediaTasks = tasks.filter((t) => t.kind === "image" || t.kind === "video");
      const mediaIds = mediaTasks.map((t) => t.fileId);
      const imageTasks = tasks.filter((t) => t.kind === "image");
      const audioTasks = tasks.filter((t) => t.kind === "audio");

      const restoredThumbIds = mediaIds.length
        ? await cachedPreviewRestoreFeature.restoreCachedThumbsIntoStateBatch(mediaIds)
        : new Set<string>();
      const imageTasksToRestore = imageTasks.filter((t) => t.restorePreview && !restoredThumbIds.has(t.fileId));
      const restoredMediaIds = imageTasksToRestore.length
        ? await cachedPreviewRestoreFeature.restoreCachedPreviewsIntoTransfersBatch(
            imageTasksToRestore.map((t) => ({
              fileId: t.fileId,
              name: t.name,
              size: t.size,
              mime: t.mime,
              direction: t.direction,
              peer: t.peer,
              room: t.room,
            }))
          )
        : new Set<string>();
      const restoredAudioIds = audioTasks.length
        ? await cachedPreviewRestoreFeature.restoreCachedPreviewsIntoTransfersBatch(
            audioTasks.map((t) => ({
              fileId: t.fileId,
              name: t.name,
              size: t.size,
              mime: t.mime,
              direction: t.direction,
              peer: t.peer,
              room: t.room,
            }))
          )
        : new Set<string>();

      const restoredIds = new Set<string>([...restoredThumbIds, ...restoredMediaIds, ...restoredAudioIds]);
      for (const t of tasks) {
        if (restoredIds.has(t.fileId)) continue;
        if (!t.prefetch) continue;
        try {
          const latest = store.get();
          const latestUid = latest.selfId;
          if (!latestUid) continue;
          if (latest.conn !== "connected") continue;
          // Only prefetch small media to avoid wasting traffic/storage.
          if (t.kind !== "video" && t.size > WARMUP_PREFETCH_MAX_BYTES) continue;
          const k = `${latestUid}:${t.fileId}`;
          const lastAttempt = previewPrefetchAttempted.get(k) || 0;
          if (lastAttempt && now - lastAttempt < previewAutoRetryMs) continue;
          previewPrefetchAttempted.set(k, now);
          enqueueFileGet(t.fileId, { priority: "prefetch", silent: true });
        } catch {
          // ignore
        }
      }
    } finally {
      previewWarmupInFlight = false;
    }
  };

  const scheduleWarmupCachedPreviews = () => {
    if (previewWarmupTimer !== null) return;
    previewWarmupTimer = window.setTimeout(() => {
      previewWarmupTimer = null;
      void warmupCachedPreviewsForSelected();
    }, WARMUP_DELAY_MS);
  };

  const scheduleAutoFetchVisiblePreviews = () => {
    if (previewAutoFetchRaf !== null) return;
    previewAutoFetchRaf = window.requestAnimationFrame(() => {
      previewAutoFetchRaf = null;
      void autoFetchVisiblePreviews();
    });
  };

  const resetPreviewWarmup = () => {
    previewWarmupLastKey = "";
    previewWarmupLastSig = "";
    previewWarmupInFlight = false;
    if (previewWarmupTimer !== null) {
      window.clearTimeout(previewWarmupTimer);
      previewWarmupTimer = null;
    }
  };

  const hasPendingActivityForUpdate = () => previewWarmupInFlight || previewAutoFetchRaf !== null;

  return {
    scheduleWarmupCachedPreviews,
    scheduleAutoFetchVisiblePreviews,
    resetPreviewWarmup,
    hasPendingActivityForUpdate,
  };
}
