import { setCachedMediaAspectRatio } from "../../../helpers/chat/mediaAspectCache";
import { base64ToBytes } from "../../../helpers/files/base64";
import { resumableHttpDownload } from "../../../helpers/files/fileHttpDownload";
import { putCachedFileBlob } from "../../../helpers/files/fileBlobCache";
import { guessMimeTypeByName } from "../../../helpers/files/mimeGuess";
import type { Store } from "../../../stores/store";
import type { AppState, FileTransferEntry } from "../../../stores/types";
import type { PendingFileViewer, FileViewerModalState } from "./fileViewerFeature";

export interface DownloadState {
  fileId: string;
  name: string;
  size: number;
  from: string;
  room?: string | null;
  mime?: string | null;
  etag?: string | null;
  chunks: ArrayBuffer[];
  received: number;
  lastProgress: number;
  streamId?: string | null;
  streaming?: boolean;
}

type DeviceCapsLike = {
  constrained: boolean;
  slowNetwork: boolean;
};

type AutoDownloadKind = "image" | "video" | "audio" | "file";

type HttpFileUrlInfoLike = {
  url: string;
};

export interface FileDownloadFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => void;
  deviceCaps: DeviceCapsLike;
  downloadByFileId: Map<string, DownloadState>;
  disableFileHttp: (reason: string) => void;

  nextTransferId: () => string;
  updateTransferByFileId: (fileId: string, apply: (entry: FileTransferEntry) => FileTransferEntry) => void;

  resolveFileMeta: (fileId: string) => { name: string; size: number; mime: string | null };
  shouldCacheFile: (name: string, mime: string | null | undefined, size: number) => boolean;
  shouldCachePreview: (name: string, mime: string | null | undefined, size: number) => boolean;
  enforceFileCachePolicy: (userId: string, opts?: { force?: boolean }) => Promise<void>;
  thumbCacheId: (fileId: string) => string;
  canAutoDownloadFullFile: (userId: string | null, kind: AutoDownloadKind, size: number) => boolean;
  resolveAutoDownloadKind: (name: string, mime: string | null | undefined, hint?: string | null) => AutoDownloadKind;

  isSilentFileGet: (fileId: string) => boolean;
  clearSilentFileGet: (fileId: string) => void;
  clearFileAcceptRetry: (fileId: string) => void;
  clearFileGetNotFoundRetry: (fileId: string) => void;
  scheduleFileGetNotFoundRetry: (
    fileId: string,
    opts?: { priority?: "high" | "prefetch"; silent?: boolean; attempts?: number }
  ) => boolean;
  finishFileGet: (fileId: string) => void;
  touchFileGetTimeout: (fileId: string) => void;
  dropFileGetQueue: (fileId: string) => void;

  tryResolveHttpFileUrlWaiter: (msg: any) => boolean;
  requestFreshHttpDownloadUrl: (fileId: string) => Promise<HttpFileUrlInfoLike>;
  rejectHttpFileUrlWaiter: (fileId: string, reason: string) => void;

  scheduleThumbPollRetry: (fileId: string) => void;
  clearThumbPollRetry: (fileId: string) => void;
  setFileThumb: (
    fileId: string,
    url: string,
    mime: string | null,
    dims?: { w?: number | null; h?: number | null; mediaW?: number | null; mediaH?: number | null }
  ) => void;
  probeImageDimensions: (blob: Blob) => Promise<{ w: number | null; h: number | null }>;

  pendingFileDownloads: Map<string, { name: string }>;
  triggerBrowserDownload: (url: string, name: string) => void;

  takePendingFileViewer: (fileId: string) => PendingFileViewer | null;
  clearPendingFileViewer: (fileId: string) => void;
  buildFileViewerModalState: (params: {
    fileId?: string | null;
    url: string;
    name: string;
    size: number;
    mime: string | null;
    caption: string | null;
    chatKey: string | null;
    msgIdx: number | null;
  }) => FileViewerModalState;

  postStreamChunk: (streamId: string, bytes: Uint8Array) => boolean;
  postStreamEnd: (streamId: string) => void;
  postStreamError: (streamId: string, reason: string) => void;

  clearCachedPreviewAttempt: (userId: string, fileId: string) => void;
  clearPreviewPrefetchAttempt: (userId: string, fileId: string) => void;

  isUploadActive: (fileId: string) => boolean;
  abortUploadByFileId: (fileId: string) => void;
}

export interface FileDownloadFeature {
  handleMessage: (msg: any) => boolean;
}

export function createFileDownloadFeature(deps: FileDownloadFeatureDeps): FileDownloadFeature {
  const {
    store,
    send,
    deviceCaps,
    downloadByFileId,
    disableFileHttp,
    nextTransferId,
    updateTransferByFileId,
    resolveFileMeta,
    shouldCacheFile,
    shouldCachePreview,
    enforceFileCachePolicy,
    thumbCacheId,
    canAutoDownloadFullFile,
    resolveAutoDownloadKind,
    isSilentFileGet,
    clearSilentFileGet,
    clearFileAcceptRetry,
    clearFileGetNotFoundRetry,
    scheduleFileGetNotFoundRetry,
    finishFileGet,
    touchFileGetTimeout,
    dropFileGetQueue,
    tryResolveHttpFileUrlWaiter,
    requestFreshHttpDownloadUrl,
    rejectHttpFileUrlWaiter,
    scheduleThumbPollRetry,
    clearThumbPollRetry,
    setFileThumb,
    probeImageDimensions,
    pendingFileDownloads,
    triggerBrowserDownload,
    takePendingFileViewer,
    clearPendingFileViewer,
    buildFileViewerModalState,
    postStreamChunk,
    postStreamEnd,
    postStreamError,
    clearCachedPreviewAttempt,
    clearPreviewPrefetchAttempt,
    isUploadActive,
    abortUploadByFileId,
  } = deps;

  const httpDownloadInFlight = new Set<string>();
  const httpLegacyFallbackAttempted = new Set<string>();
  const debugHook = (kind: string, data?: any) => {
    try {
      const dbg = (globalThis as any).__yagodka_debug_monitor;
      if (!dbg || typeof dbg.push !== "function") return;
      dbg.push(String(kind || "file").trim() || "file", data);
    } catch {
      // ignore
    }
  };

  function handleFileDownloadBegin(msg: any): boolean {
    const fileId = String(msg?.file_id ?? "").trim();
    if (!fileId) return true;
    clearFileAcceptRetry(fileId);
    const name = String(msg?.name ?? "файл");
    const size = Number(msg?.size ?? 0) || 0;
    const from = String(msg?.from ?? "").trim() || "—";
    const room = typeof msg?.room === "string" ? msg.room : null;
    const mimeRaw = msg?.mime;
    const mime = typeof mimeRaw === "string" && mimeRaw.trim() ? mimeRaw.trim() : null;
    const silent = isSilentFileGet(fileId);
    const existing = downloadByFileId.get(fileId);
    const streamId = existing?.streamId ? String(existing.streamId) : null;
    const streaming = Boolean(existing?.streaming && streamId);
    debugHook("file.download.begin", {
      fileId,
      name,
      size,
      from,
      room: room || null,
      kind: msg?.kind ? String(msg.kind) : null,
      streaming,
      silent,
    });
    downloadByFileId.set(fileId, {
      fileId,
      name,
      size,
      from,
      room,
      mime,
      chunks: [],
      received: 0,
      lastProgress: 0,
      streamId: streamId || null,
      streaming,
    });
    store.set((prev) => {
      const transfers = [...prev.fileTransfers];
      const idx = transfers.findIndex((entry) => entry.id === fileId && entry.direction === "in");
      if (idx >= 0) {
        transfers[idx] = {
          ...transfers[idx],
          name,
          size,
          peer: from,
          room,
          mime: mime || transfers[idx].mime || null,
          status: "downloading",
          progress: 0,
        };
      } else {
        transfers.unshift({
          localId: nextTransferId(),
          id: fileId,
          name,
          size,
          mime,
          direction: "in",
          peer: from,
          room,
          status: "downloading",
          progress: 0,
        });
      }
      return {
        ...prev,
        fileTransfers: transfers,
        fileOffersIn: prev.fileOffersIn.filter((entry) => entry.id !== fileId),
        ...(silent ? {} : { status: `Скачивание: ${name}` }),
      };
    });
    return true;
  }

  function handleFileUrl(msg: any): boolean {
    const fileId = String(msg?.file_id ?? "").trim();
    const url = typeof msg?.url === "string" ? String(msg.url).trim() : "";
    const thumbUrl = typeof msg?.thumb_url === "string" ? String(msg.thumb_url).trim() : "";
    if (!fileId) return true;
    clearFileGetNotFoundRetry(fileId);
    const mwRaw = Number(msg?.media_w ?? 0);
    const mhRaw = Number(msg?.media_h ?? 0);
    const twRaw = Number(msg?.thumb_w ?? 0);
    const thRaw = Number(msg?.thumb_h ?? 0);
    const mediaW = Number.isFinite(mwRaw) && mwRaw > 0 ? Math.trunc(mwRaw) : null;
    const mediaH = Number.isFinite(mhRaw) && mhRaw > 0 ? Math.trunc(mhRaw) : null;
    const thumbW = Number.isFinite(twRaw) && twRaw > 0 ? Math.trunc(twRaw) : null;
    const thumbH = Number.isFinite(thRaw) && thRaw > 0 ? Math.trunc(thRaw) : null;

    if (tryResolveHttpFileUrlWaiter(msg)) return true;

    const silent = isSilentFileGet(fileId);
    if (!url && !(silent && thumbUrl)) {
      finishFileGet(fileId);
      return true;
    }
    clearFileAcceptRetry(fileId);
    try {
      const w = mediaW ?? thumbW ?? 0;
      const h = mediaH ?? thumbH ?? 0;
      if (w > 0 && h > 0) {
        setCachedMediaAspectRatio(fileId, w / Math.max(1, h));
      }
    } catch {
      // ignore
    }
    const metaFallback = resolveFileMeta(fileId);
    const name = typeof msg?.name === "string" && msg.name.trim() ? String(msg.name) : metaFallback.name;
    const size = Number(msg?.size ?? 0) || metaFallback.size || 0;
    const mimeRaw = msg?.mime;
    const mime = typeof mimeRaw === "string" && mimeRaw.trim() ? mimeRaw.trim() : metaFallback.mime;
    const thumbMimeRaw = msg?.thumb_mime;
    const thumbMime = typeof thumbMimeRaw === "string" && thumbMimeRaw.trim() ? String(thumbMimeRaw).trim() : null;
    debugHook("file.url", {
      fileId,
      hasUrl: Boolean(url),
      hasThumb: Boolean(thumbUrl),
      kind: msg?.kind ? String(msg.kind) : null,
      size,
      mime: mime || null,
    });

    if (silent && thumbUrl) {
      void (async () => {
        try {
          const res = await fetch(thumbUrl, { method: "GET", cache: "no-store" });
          if (!res.ok) throw new Error(`http_${res.status}`);
          const blob = await res.blob();
          const finalMime = thumbMime || blob.type || "image/jpeg";
          let w = thumbW;
          let h = thumbH;
          if ((!w || !h) && blob) {
            try {
              const probed = await probeImageDimensions(blob);
              w = w || probed.w || null;
              h = h || probed.h || null;
            } catch {
              // ignore
            }
          }
          try {
            if (w && h) {
              setCachedMediaAspectRatio(fileId, w / Math.max(1, h));
            }
          } catch {
            // ignore
          }
          const objectUrl = URL.createObjectURL(blob);
          setFileThumb(fileId, objectUrl, finalMime, { w, h, mediaW, mediaH });
          clearThumbPollRetry(fileId);
          try {
            const st = store.get();
            if (st.selfId && shouldCachePreview(name || "файл", finalMime, blob.size || 0)) {
              void putCachedFileBlob(st.selfId, thumbCacheId(fileId), blob, {
                name: name || "файл",
                mime: finalMime,
                size: blob.size || 0,
                w,
                h,
                mediaW,
                mediaH,
              });
              void enforceFileCachePolicy(st.selfId, { force: true });
            }
          } catch {
            // ignore
          }
        } catch (err) {
          const errMsg = err instanceof Error ? String(err.message || "") : String(err || "");
          debugHook("file.thumb.error", { fileId, reason: errMsg || "thumb_fetch_failed" });
          const shouldDisableHttp = err instanceof TypeError || errMsg === "http_404";
          if (shouldDisableHttp) disableFileHttp(errMsg || "thumb_fetch_failed");
          scheduleThumbPollRetry(fileId);
        } finally {
          clearSilentFileGet(fileId);
          finishFileGet(fileId);
        }
      })();
      return true;
    }

    if (silent && !thumbUrl) {
      try {
        const st = store.get();
        const kind = resolveAutoDownloadKind(name, mime, null);
        if (kind === "video") {
          scheduleThumbPollRetry(fileId);
          clearSilentFileGet(fileId);
          finishFileGet(fileId);
          return true;
        }
        const canDownload =
          kind === "image"
            ? shouldCachePreview(name || "файл", mime, size) || canAutoDownloadFullFile(st.selfId || null, kind, size)
            : canAutoDownloadFullFile(st.selfId || null, kind, size);
        if (!canDownload) {
          clearSilentFileGet(fileId);
          finishFileGet(fileId);
          return true;
        }
      } catch {
        // ignore
      }
    }

    if (httpDownloadInFlight.has(fileId)) return true;

    const existing = downloadByFileId.get(fileId);
    const streamId = existing?.streamId ? String(existing.streamId) : null;
    const streaming = Boolean(existing?.streaming && streamId);
    downloadByFileId.set(fileId, {
      fileId,
      name,
      size,
      from: existing?.from || "—",
      room: existing?.room ?? null,
      mime: mime ?? null,
      etag: existing?.etag ?? null,
      chunks: [],
      received: 0,
      lastProgress: 0,
      streamId: streamId || null,
      streaming,
    });
    updateTransferByFileId(fileId, (entry) => ({ ...entry, status: "downloading", progress: 0, ...(mime ? { mime } : {}) }));
    if (!silent) store.set({ status: `Скачивание: ${name || fileId}` });

    debugHook("file.http.start", {
      fileId,
      name,
      size,
      stream: streaming,
      silent,
      expectedMime: mime || null,
    });
    httpDownloadInFlight.add(fileId);
    void (async () => {
      try {
        const baseDelayMs = deviceCaps.slowNetwork ? 900 : deviceCaps.constrained ? 650 : 400;
        const download = downloadByFileId.get(fileId);
        if (!download) throw new Error("missing_download_state");

        const result = await resumableHttpDownload({
          url,
          offset: download.received,
          etag: download.etag ?? null,
          expectedSize: size || 0,
          maxRetries: 6,
          baseDelayMs,
          maxDelayMs: 8000,
          maxUrlRefresh: 2,
          refreshUrl: async () => (await requestFreshHttpDownloadUrl(fileId)).url,
          onReset: (reason) => {
            const cur = downloadByFileId.get(fileId);
            if (!cur) return;
            if (cur.streaming && cur.streamId) throw new Error(`http_download_reset_${reason}`);
            cur.chunks = [];
            cur.received = 0;
            cur.lastProgress = 0;
            cur.etag = null;
            debugHook("file.http.reset", { fileId, reason });
            updateTransferByFileId(fileId, (entry) => ({ ...entry, status: "downloading", progress: 0, ...(mime ? { mime } : {}) }));
          },
          onChunk: (chunk) => {
            const cur = downloadByFileId.get(fileId);
            if (!cur) throw new Error("missing_download_state");
            if (cur.streaming && cur.streamId) {
              const okPost = postStreamChunk(cur.streamId, chunk);
              if (!okPost) throw new Error("stream_post_failed");
              return;
            }
            const buf = (chunk.buffer as ArrayBuffer).slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
            cur.chunks.push(buf);
          },
          onProgress: ({ received, total }) => {
            const cur = downloadByFileId.get(fileId);
            if (!cur) return;
            cur.received = received;
            if (typeof total === "number" && Number.isFinite(total) && total > 0 && (!cur.size || cur.size <= 0)) {
              cur.size = Math.trunc(total);
            }
            touchFileGetTimeout(fileId);
            const denom = cur.size > 0 ? cur.size : typeof total === "number" && total > 0 ? total : 0;
            const pct = denom > 0 ? Math.min(100, Math.round((cur.received / denom) * 100)) : 0;
            if (pct !== cur.lastProgress) {
              cur.lastProgress = pct;
              updateTransferByFileId(fileId, (entry) => ({ ...entry, progress: pct, status: "downloading" }));
            }
          },
        });

        const final = downloadByFileId.get(fileId);
        if (!final) throw new Error("missing_download_state");
        final.etag = result.etag ?? null;
        debugHook("file.http.complete", {
          fileId,
          name,
          size: final.size,
          received: result.received,
          total: result.total,
          mime: final.mime || result.mime || null,
          streaming: Boolean(final.streaming),
          silent,
        });

        downloadByFileId.delete(fileId);
        clearSilentFileGet(fileId);
        finishFileGet(fileId);
        if (!silent) {
          try {
            send({ type: "file_downloaded", file_id: fileId });
          } catch {
            // ignore
          }
        }

        if (final.streaming && final.streamId) {
          postStreamEnd(final.streamId);
          updateTransferByFileId(fileId, (entry) => ({ ...entry, status: "complete", progress: 100, ...(mime ? { mime } : {}) }));
          if (!silent) store.set({ status: `Скачивание завершено: ${name}` });
          clearPendingFileViewer(fileId);
          return;
        }

        const finalMime = mime || final.mime || result.mime || guessMimeTypeByName(name);
        const blob = new Blob(final.chunks, { type: finalMime || undefined });
        const objectUrl = URL.createObjectURL(blob);
        updateTransferByFileId(fileId, (entry) => ({
          ...entry,
          status: "complete",
          progress: 100,
          url: objectUrl,
          ...(finalMime ? { mime: finalMime } : {}),
        }));
        if (!silent) store.set({ status: `Файл готов: ${name}` });
        try {
          const st = store.get();
          if (st.selfId && shouldCacheFile(name || "файл", finalMime, size || blob.size || 0)) {
            void putCachedFileBlob(st.selfId, fileId, blob, {
              name: name || "файл",
              mime: finalMime,
              size: size || blob.size || 0,
            });
            void enforceFileCachePolicy(st.selfId, { force: true });
            clearCachedPreviewAttempt(st.selfId, fileId);
          }
        } catch {
          // ignore
        }
        const pending = pendingFileDownloads.get(fileId);
        if (pending) {
          pendingFileDownloads.delete(fileId);
          triggerBrowserDownload(objectUrl, pending.name || name || "файл");
        }
        const pv = takePendingFileViewer(fileId);
        if (pv) {
          const viewerName = pv.name || name || "файл";
          const viewerSize = pv.size || size || blob.size || 0;
          const viewerMime = finalMime || pv.mime || null;
          store.set({
            modal: buildFileViewerModalState({
              fileId,
              url: objectUrl,
              name: viewerName,
              size: viewerSize,
              mime: viewerMime,
              caption: pv.caption || null,
              chatKey: pv.chatKey,
              msgIdx: pv.msgIdx,
            }),
          });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? String(err.message || "") : String(err || "");
        const canFallback =
          !silent &&
          !httpLegacyFallbackAttempted.has(fileId) &&
          (err instanceof TypeError ||
            /^http_\\d+$/.test(errMsg) ||
            errMsg === "incomplete_body" ||
            errMsg === "range_not_satisfiable");
        if (canFallback) {
          httpLegacyFallbackAttempted.add(fileId);
          debugHook("file.http.fallback", { fileId, reason: errMsg, mode: "file_get" });
          disableFileHttp(errMsg || "http_download_failed");
          const cur = downloadByFileId.get(fileId);
          if (cur) {
            cur.chunks = [];
            cur.received = 0;
            cur.lastProgress = 0;
            cur.etag = null;
          }
          updateTransferByFileId(fileId, (entry) => ({ ...entry, status: "downloading", progress: 0, error: null }));
          store.set({ status: `HTTP-скачивание недоступно (${errMsg || "download_failed"}). Резервный канал…` });
          try {
            send({ type: "file_get", file_id: fileId });
            touchFileGetTimeout(fileId);
            return;
          } catch {
            // ignore
          }
        }
        debugHook("file.http.error", {
          fileId,
          reason: errMsg,
          canFallback,
          silent,
          size: size || 0,
        });
        rejectHttpFileUrlWaiter(fileId, "download_failed");
        clearSilentFileGet(fileId);
        finishFileGet(fileId);
        pendingFileDownloads.delete(fileId);
        clearPendingFileViewer(fileId);
        const download = downloadByFileId.get(fileId);
        if (download?.streamId) postStreamError(download.streamId, "http_download_failed");
        downloadByFileId.delete(fileId);
        updateTransferByFileId(fileId, (entry) => ({ ...entry, status: "error", error: "download_failed" }));
        if (!silent) store.set({ status: "Ошибка файла: download_failed" });
      } finally {
        httpDownloadInFlight.delete(fileId);
      }
    })();
    return true;
  }

  function handleFileChunk(msg: any): boolean {
    const fileId = String(msg?.file_id ?? "").trim();
    const download = fileId ? downloadByFileId.get(fileId) : null;
    if (!download) return true;
    const data = typeof msg?.data === "string" ? msg.data : "";
    if (!data) return true;
    const bytes = base64ToBytes(data);
    if (!bytes) return true;
    const silent = isSilentFileGet(fileId);
    const chunkLen = bytes.length;
    if (download.streaming && download.streamId) {
      const ok = postStreamChunk(download.streamId, bytes);
      if (!ok) {
        postStreamError(download.streamId, "stream_post_failed");
        debugHook("file.http.stream_error", { fileId, reason: "stream_post_failed" });
        downloadByFileId.delete(fileId);
        clearSilentFileGet(fileId);
        finishFileGet(fileId);
        updateTransferByFileId(fileId, (entry) => ({ ...entry, status: "error", error: "stream_failed" }));
        if (!silent) store.set({ status: "Ошибка файла: stream_failed" });
        return true;
      }
    } else {
      const buf = (bytes.buffer as ArrayBuffer).slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      download.chunks.push(buf);
    }
    download.received += chunkLen;
    touchFileGetTimeout(fileId);
    const pct = download.size > 0 ? Math.min(100, Math.round((download.received / download.size) * 100)) : 0;
    if (pct !== download.lastProgress) {
      download.lastProgress = pct;
      updateTransferByFileId(fileId, (entry) => ({ ...entry, progress: pct, status: "downloading" }));
    }
    return true;
  }

  function handleFileDownloadComplete(msg: any): boolean {
    const fileId = String(msg?.file_id ?? "").trim();
    if (!fileId) return true;
    clearFileAcceptRetry(fileId);
    finishFileGet(fileId);
    const silent = isSilentFileGet(fileId);
    const download = downloadByFileId.get(fileId);
    if (download) {
      debugHook("file.download.complete", {
        fileId,
        name: download.name,
        size: download.size,
        streaming: Boolean(download.streaming),
        status: "legacy",
      });
      downloadByFileId.delete(fileId);
      clearSilentFileGet(fileId);
      const isStreaming = Boolean(download.streaming && download.streamId);
      if (isStreaming && download.streamId) {
        postStreamEnd(download.streamId);
        updateTransferByFileId(fileId, (entry) => ({
          ...entry,
          status: "complete",
          progress: 100,
          ...(download.mime ? { mime: download.mime } : {}),
        }));
        if (!silent) store.set({ status: `Скачивание завершено: ${download.name}` });
        clearPendingFileViewer(fileId);
        return true;
      }
      const finalMime = download.mime || guessMimeTypeByName(download.name);
      const blob = new Blob(download.chunks, { type: finalMime || undefined });
      const objectUrl = URL.createObjectURL(blob);
      updateTransferByFileId(fileId, (entry) => ({
        ...entry,
        status: "complete",
        progress: 100,
        url: objectUrl,
        ...(finalMime ? { mime: finalMime } : {}),
      }));
      if (!silent) store.set({ status: `Файл готов: ${download.name}` });
      try {
        const st = store.get();
        if (st.selfId && shouldCacheFile(download.name || "файл", finalMime, download.size || blob.size || 0)) {
          void putCachedFileBlob(st.selfId, fileId, blob, {
            name: download.name || "файл",
            mime: finalMime,
            size: download.size || blob.size || 0,
          });
          void enforceFileCachePolicy(st.selfId, { force: true });
          clearCachedPreviewAttempt(st.selfId, fileId);
        }
      } catch {
        // ignore
      }
      const pending = pendingFileDownloads.get(fileId);
      if (pending) {
        pendingFileDownloads.delete(fileId);
        triggerBrowserDownload(objectUrl, pending.name || download.name || "файл");
      }
      const pv = takePendingFileViewer(fileId);
      if (pv) {
        const viewerName = pv.name || download.name || "файл";
        const viewerSize = pv.size || download.size || blob.size || 0;
        const viewerMime = finalMime || pv.mime || null;
        store.set({
          modal: buildFileViewerModalState({
            fileId,
            url: objectUrl,
            name: viewerName,
            size: viewerSize,
            mime: viewerMime,
            caption: pv.caption || null,
            chatKey: pv.chatKey,
            msgIdx: pv.msgIdx,
          }),
        });
      }
    } else {
      clearSilentFileGet(fileId);
      updateTransferByFileId(fileId, (entry) => ({ ...entry, status: "complete", progress: 100 }));
    }
    return true;
  }

  function handleFileError(msg: any): boolean {
    const fileId = String(msg?.file_id ?? "").trim();
    const reason = String(msg?.reason ?? "ошибка");
    const peer = String(msg?.peer ?? "").trim();
    const detail = peer ? `${reason} (${peer})` : reason;
    const silent = fileId ? isSilentFileGet(fileId) : false;
    debugHook("file.error", { fileId, reason: detail, silent, peer: peer || null });
    if (fileId) {
      finishFileGet(fileId);
      dropFileGetQueue(fileId);
      const snap = store.get();
      const uid = snap.selfId;
      const transfer = snap.fileTransfers.find((t) => String(t.id || "").trim() === fileId) ?? null;
      if (uid) clearPreviewPrefetchAttempt(uid, fileId);
      pendingFileDownloads.delete(fileId);
      clearPendingFileViewer(fileId);
      const uploadActive = isUploadActive(fileId);
      if (reason === "not_found") {
        const waitingForUpload =
          uploadActive ||
          Boolean(transfer && transfer.direction === "out" && transfer.status === "uploading") ||
          Boolean(transfer && transfer.direction === "in" && (transfer.status === "offering" || transfer.status === "downloading"));
        if (waitingForUpload || silent) {
          const scheduled = scheduleFileGetNotFoundRetry(fileId, { priority: silent ? "prefetch" : "high", silent });
          if (transfer && transfer.status === "downloading") {
            updateTransferByFileId(fileId, (entry) => ({ ...entry, status: "offering", progress: 0, error: null }));
          } else if (transfer && transfer.status === "error") {
            updateTransferByFileId(fileId, (entry) => ({
              ...entry,
              status: entry.direction === "out" ? "uploading" : "offering",
              error: null,
            }));
          }
          if (!silent) {
            store.set({ status: uploadActive ? "Загрузка продолжается…" : "Ожидаем файл от отправителя" });
          }
          if (uploadActive || scheduled || silent) return true;
        }
      }
      clearSilentFileGet(fileId);
      abortUploadByFileId(fileId);
      const download = downloadByFileId.get(fileId);
      if (download?.streamId) postStreamError(download.streamId, detail);
      if (download) downloadByFileId.delete(fileId);
      clearFileAcceptRetry(fileId);
      updateTransferByFileId(fileId, (entry) => ({ ...entry, status: "error", error: detail }));
    }
    if (!silent) store.set({ status: `Ошибка файла: ${detail}` });
    return true;
  }

  return {
    handleMessage: (msg: any): boolean => {
      const t = String(msg?.type ?? "");
      if (t === "file_download_begin") return handleFileDownloadBegin(msg);
      if (t === "file_url") return handleFileUrl(msg);
      if (t === "file_chunk") return handleFileChunk(msg);
      if (t === "file_download_complete") return handleFileDownloadComplete(msg);
      if (t === "file_error") return handleFileError(msg);
      return false;
    },
  };
}
