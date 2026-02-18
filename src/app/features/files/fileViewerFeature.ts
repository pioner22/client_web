import { conversationKey } from "../../../helpers/chat/conversationKey";
import { isImageLikeFile } from "../../../helpers/files/fileBlobCache";
import { isVideoLikeFile } from "../../../helpers/files/isVideoLikeFile";
import type { Store } from "../../../stores/store";
import type { AppState, ChatMessage } from "../../../stores/types";

export type FileViewerModalState = Extract<AppState["modal"], { kind: "file_viewer" }>;

export interface FileViewerModalParams {
  fileId?: string | null;
  url: string;
  name: string;
  size: number;
  mime: string | null;
  caption: string | null;
  autoplay?: boolean;
  chatKey: string | null;
  msgIdx: number | null;
}

export interface FileViewerOpenFallback {
  kindHint?: "image" | "video";
  url?: string | null;
  name?: string;
  size?: number;
  mime?: string | null;
  caption?: string | null;
  fileId?: string | null;
}

export interface HttpFileUrlInfo {
  url: string;
  name?: string;
  size?: number;
  mime?: string | null;
}

export interface PendingFileViewer {
  fileId: string;
  name: string;
  size: number;
  mime: string | null;
  caption: string | null;
  chatKey: string | null;
  msgIdx: number | null;
}

export interface FileViewerFeatureDeps {
  store: Store<AppState>;
  closeModal: () => void;
  jumpToChatMsgIdx: (idx: number) => void;
  requestFreshHttpDownloadUrl: (fileId: string) => Promise<HttpFileUrlInfo>;
  tryOpenFileViewerFromCache: (
    fileId: string,
    meta: {
      name: string;
      size: number;
      mime: string | null;
      caption?: string | null;
      chatKey?: string | null;
      msgIdx?: number | null;
    }
  ) => Promise<boolean>;
  enqueueFileGet: (fileId: string, opts?: { priority?: "high" | "prefetch"; silent?: boolean }) => void;
  setPendingFileViewer: (state: PendingFileViewer) => void;
}

export interface FileViewerFeature {
  buildModalState: (params: FileViewerModalParams) => FileViewerModalState;
  openFromMessageIndex: (chatKey: string, msgIdx: number, fallback?: FileViewerOpenFallback) => Promise<boolean>;
  recoverCurrent: () => Promise<void>;
  navigate: (dir: "prev" | "next") => void;
  openAtIndex: (msgIdx: number) => void;
  jumpFromViewer: () => void;
}

function isVisualMediaMessage(st: AppState, msg: ChatMessage | null | undefined): boolean {
  if (!msg || msg.kind === "sys") return false;
  const att = msg.attachment;
  if (!att || att.kind !== "file") return false;
  const fileId = typeof att.fileId === "string" && att.fileId.trim() ? att.fileId.trim() : "";
  const localId = typeof att.localId === "string" && att.localId.trim() ? att.localId.trim() : "";
  const entry = fileId
    ? st.fileTransfers.find((t) => String(t.id || "").trim() === fileId)
    : localId
      ? st.fileTransfers.find((t) => String(t.localId || "").trim() === localId)
      : null;
  const name = String(att.name || entry?.name || "файл");
  const mime = (att.mime ?? entry?.mime) || null;
  const hasThumb = Boolean(fileId && st.fileThumbs?.[fileId]?.url);
  return isImageLikeFile(name, mime) || isVideoLikeFile(name, mime) || hasThumb;
}

function findNeighborMediaIndex(st: AppState, msgs: ChatMessage[], startIdx: number, direction: -1 | 1): number | null {
  if (!Number.isFinite(startIdx) || startIdx < 0 || startIdx >= msgs.length) return null;
  for (let i = startIdx + direction; i >= 0 && i < msgs.length; i += direction) {
    const msg = msgs[i];
    if (!msg || msg.kind === "sys") continue;
    if (isVisualMediaMessage(st, msg)) return i;
  }
  return null;
}

export function createFileViewerFeature(deps: FileViewerFeatureDeps): FileViewerFeature {
  const {
    store,
    closeModal,
    jumpToChatMsgIdx,
    requestFreshHttpDownloadUrl,
    tryOpenFileViewerFromCache,
    enqueueFileGet,
    setPendingFileViewer,
  } = deps;

  const debugHook = (kind: string, data?: any) => {
    try {
      const dbg = (globalThis as any).__yagodka_debug_monitor;
      if (!dbg || typeof dbg.push !== "function") return;
      dbg.push(String(kind || "file.viewer").trim() || "file.viewer", data);
    } catch {
      // ignore
    }
  };

  function buildModalState(params: FileViewerModalParams): FileViewerModalState {
    const st = store.get();
    const chatKey = params.chatKey ? String(params.chatKey) : null;
    const msgIdx = Number.isFinite(params.msgIdx) ? Math.trunc(Number(params.msgIdx)) : null;
    const msgs = chatKey ? st.conversations[chatKey] || [] : [];
    const prevIdx = chatKey && msgIdx !== null ? findNeighborMediaIndex(st, msgs, msgIdx, -1) : null;
    const nextIdx = chatKey && msgIdx !== null ? findNeighborMediaIndex(st, msgs, msgIdx, 1) : null;
    const fileId = params.fileId ? String(params.fileId).trim() : "";
    return {
      kind: "file_viewer",
      ...(fileId ? { fileId } : {}),
      url: params.url,
      name: params.name,
      size: params.size,
      mime: params.mime,
      caption: params.caption,
      ...(params.autoplay ? { autoplay: true } : {}),
      chatKey,
      msgIdx,
      prevIdx,
      nextIdx,
    };
  }

  async function openFromMessageIndex(chatKey: string, msgIdx: number, fallback?: FileViewerOpenFallback): Promise<boolean> {
    const st = store.get();
    const msgs = st.conversations[chatKey] || [];
    if (!Number.isFinite(msgIdx) || msgIdx < 0 || msgIdx >= msgs.length) {
      debugHook("file.viewer.open.skip", { chatKey, msgIdx, reason: "bad_idx" });
      return false;
    }
    const msg = msgs[msgIdx];
    const att = msg?.attachment;
    if (!att || att.kind !== "file") {
      debugHook("file.viewer.open.skip", { chatKey, msgIdx, reason: "no_file_attachment" });
      return false;
    }
    const fileIdRaw =
      typeof att.fileId === "string" && att.fileId.trim() ? att.fileId.trim() : String(fallback?.fileId || "").trim();
    const fileId = fileIdRaw || null;
    const localId = typeof att.localId === "string" && att.localId.trim() ? att.localId.trim() : null;
    const entry = fileId
      ? st.fileTransfers.find((t) => String(t.id || "").trim() === fileId)
      : localId
        ? st.fileTransfers.find((t) => String(t.localId || "").trim() === localId)
        : null;

    const name = String(att.name || entry?.name || fallback?.name || "файл");
    const size = Number(att.size || entry?.size || fallback?.size || 0) || 0;
    const mime = (att.mime ?? entry?.mime ?? fallback?.mime) || null;
    const hasThumb = Boolean(fileId && st.fileThumbs?.[fileId]?.url);
    const kindHint = fallback?.kindHint === "image" || fallback?.kindHint === "video" ? fallback.kindHint : null;
    const hintedMedia = kindHint === "image" || kindHint === "video";
    if (!(hintedMedia || isImageLikeFile(name, mime) || isVideoLikeFile(name, mime) || hasThumb)) {
      debugHook("file.viewer.open.skip", { chatKey, msgIdx, fileId, reason: "not_media_like", kindHint });
      return false;
    }
    debugHook("file.viewer.open.start", {
      chatKey,
      msgIdx,
      fileId,
      hasThumb,
      hasTransferUrl: Boolean(entry?.url),
      hasFallbackUrl: Boolean(fallback?.url),
      name: name ? String(name).slice(0, 80) : null,
      size: Number.isFinite(size) ? size : 0,
      mime: mime ? String(mime).slice(0, 80) : null,
    });
    const autoplay = isVideoLikeFile(name, mime);
    const rawCaption = String(msg.text || "").trim();
    const captionText = rawCaption && !rawCaption.startsWith("[file]") ? rawCaption : String(fallback?.caption || "").trim();
    const caption = captionText ? captionText : null;
    const url = entry?.url || fallback?.url || null;
    if (url) {
      debugHook("file.viewer.open.direct_url", {
        chatKey,
        msgIdx,
        fileId,
        source: entry?.url ? "transfer" : "fallback",
      });
      store.set({ modal: buildModalState({ fileId, url, name, size, mime, caption, autoplay, chatKey, msgIdx }) });
      return true;
    }
    if (!fileId) {
      debugHook("file.viewer.open.blocked", { chatKey, msgIdx, reason: "no_file_id" });
      store.set({ status: "Файл пока недоступен" });
      return true;
    }
    const opened = await tryOpenFileViewerFromCache(fileId, { name, size, mime, caption, chatKey, msgIdx });
    debugHook("file.viewer.open.cache", { chatKey, msgIdx, fileId, ok: Boolean(opened) });
    if (opened) return true;
    const latest = store.get();
    if (latest.conn !== "connected") {
      debugHook("file.viewer.open.blocked", { chatKey, msgIdx, fileId, reason: "no_conn" });
      store.set({ status: "Нет соединения" });
      return true;
    }
    if (!latest.authed) {
      debugHook("file.viewer.open.blocked", { chatKey, msgIdx, fileId, reason: "not_authed" });
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return true;
    }
    try {
      debugHook("file.viewer.open.http_url", { chatKey, msgIdx, fileId, phase: "start" });
      const info = await requestFreshHttpDownloadUrl(fileId);
      const nextMime = mime || info.mime || null;
      const nextAutoplay = autoplay || isVideoLikeFile(name || info.name || "", nextMime);
      debugHook("file.viewer.open.http_url", {
        chatKey,
        msgIdx,
        fileId,
        phase: "ok",
        hasMime: Boolean(nextMime),
        autoplay: Boolean(nextAutoplay),
      });
      store.set({
        modal: buildModalState({
          fileId,
          url: info.url,
          name: name || info.name || "файл",
          size: size || info.size || 0,
          mime: nextMime,
          caption,
          autoplay: nextAutoplay,
          chatKey,
          msgIdx,
        }),
      });
      return true;
    } catch (err) {
      const errMsg = err instanceof Error ? String(err.message || "") : String(err || "");
      debugHook("file.viewer.open.http_url", { chatKey, msgIdx, fileId, phase: "fail", reason: errMsg || "http_url_failed" });
      // Fallback: download into cache and open when ready (slow but offline-friendly).
      setPendingFileViewer({ fileId, name, size, mime, caption, chatKey, msgIdx });
      enqueueFileGet(fileId, { priority: "high" });
      debugHook("file.viewer.open.fallback_file_get", { chatKey, msgIdx, fileId, priority: "high" });
      store.set({ status: `Скачивание: ${name}` });
      return true;
    }
  }

  const viewerRecover = new Map<string, { lastReloadAt: number; lastDownloadAt: number }>();
  const RECOVER_RELOAD_GAP_MS = 4200;
  const RECOVER_DOWNLOAD_GAP_MS = 6500;

  async function recoverCurrent(): Promise<void> {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "file_viewer") return;
    if (st.conn !== "connected") {
      debugHook("file.viewer.recover.blocked", { reason: "no_conn" });
      store.set({ status: "Нет соединения" });
      return;
    }
    if (!st.authed) {
      debugHook("file.viewer.recover.blocked", { reason: "not_authed" });
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }

    const modalFileId = typeof modal.fileId === "string" ? modal.fileId.trim() : "";
    const chatKey = modal.chatKey ? String(modal.chatKey) : "";
    const msgIdx = typeof modal.msgIdx === "number" && Number.isFinite(modal.msgIdx) ? Math.trunc(modal.msgIdx) : null;

    const derivedFileId = (() => {
      if (!chatKey || msgIdx === null) return "";
      const msgs = st.conversations[chatKey] || [];
      const msg = msgs[msgIdx];
      const att = msg?.attachment;
      if (!att || att.kind !== "file") return "";
      return typeof att.fileId === "string" ? att.fileId.trim() : "";
    })();
    const fileId = modalFileId || derivedFileId;
    if (!fileId) return;

    const name = String(modal.name || "файл");
    const size = Number(modal.size || 0) || 0;
    const mime = (modal.mime ?? null) || null;
    const rawCaption = String(modal.caption || "").trim();
    const caption = rawCaption && !rawCaption.startsWith("[file]") ? rawCaption : null;

    debugHook("file.viewer.recover.start", {
      fileId,
      hasModalFileId: Boolean(modalFileId),
      hasDerivedFileId: Boolean(derivedFileId),
      chatKey: chatKey || null,
      msgIdx,
      name: name ? String(name).slice(0, 80) : null,
      size: Number.isFinite(size) ? size : 0,
      mime: mime ? String(mime).slice(0, 80) : null,
    });

    const opened = await tryOpenFileViewerFromCache(fileId, {
      name,
      size,
      mime,
      caption,
      chatKey: chatKey || null,
      msgIdx,
    });
    debugHook("file.viewer.recover.cache", { fileId, ok: Boolean(opened) });
    if (opened) return;

    const now = Date.now();
    const prev = viewerRecover.get(fileId) || { lastReloadAt: 0, lastDownloadAt: 0 };
    const canReload = !prev.lastReloadAt || now - prev.lastReloadAt >= RECOVER_RELOAD_GAP_MS;
    if (canReload) {
      viewerRecover.set(fileId, { ...prev, lastReloadAt: now });
      try {
        debugHook("file.viewer.recover.http_url", { fileId, phase: "start" });
        const info = await requestFreshHttpDownloadUrl(fileId);
        const nextMime = mime || info.mime || null;
        const nextAutoplay = isVideoLikeFile(name || info.name || "", nextMime);
        const latest = store.get();
        const latestModal = latest.modal;
        if (!latestModal || latestModal.kind !== "file_viewer") return;
        const latestFileId = typeof latestModal.fileId === "string" ? latestModal.fileId.trim() : "";
        if (latestFileId && latestFileId !== fileId) return;
        debugHook("file.viewer.recover.http_url", { fileId, phase: "ok", hasMime: Boolean(nextMime), autoplay: Boolean(nextAutoplay) });
        store.set({
          modal: buildModalState({
            fileId,
            url: info.url,
            name: name || info.name || "файл",
            size: size || info.size || 0,
            mime: nextMime,
            caption,
            autoplay: nextAutoplay,
            chatKey: chatKey || null,
            msgIdx,
          }),
        });
        return;
      } catch (err) {
        const errMsg = err instanceof Error ? String(err.message || "") : String(err || "");
        debugHook("file.viewer.recover.http_url", { fileId, phase: "fail", reason: errMsg || "http_url_failed" });
        // fall through to download
      }
    }

    const canDownload = !prev.lastDownloadAt || now - prev.lastDownloadAt >= RECOVER_DOWNLOAD_GAP_MS;
    if (canDownload) viewerRecover.set(fileId, { ...prev, lastDownloadAt: now });
    setPendingFileViewer({ fileId, name, size, mime, caption, chatKey: chatKey || null, msgIdx });
    enqueueFileGet(fileId, { priority: "high" });
    debugHook("file.viewer.recover.file_get", { fileId, canReload, canDownload, priority: "high" });
    store.set({ status: `Скачивание: ${name || fileId}` });
  }

  function navigate(dir: "prev" | "next") {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "file_viewer") return;
    const chatKey = modal.chatKey ? String(modal.chatKey) : "";
    const targetIdx = dir === "prev" ? modal.prevIdx : modal.nextIdx;
    if (!chatKey || typeof targetIdx !== "number" || !Number.isFinite(targetIdx)) return;
    void openFromMessageIndex(chatKey, targetIdx);
  }

  function openAtIndex(msgIdx: number) {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "file_viewer") return;
    const chatKey = modal.chatKey ? String(modal.chatKey) : "";
    if (!chatKey) return;
    if (!Number.isFinite(msgIdx)) return;
    void openFromMessageIndex(chatKey, Math.trunc(msgIdx));
  }

  function jumpFromViewer() {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "file_viewer") return;
    const chatKey = modal.chatKey ? String(modal.chatKey) : "";
    const msgIdx = typeof modal.msgIdx === "number" && Number.isFinite(modal.msgIdx) ? Math.trunc(modal.msgIdx) : null;
    if (!chatKey || msgIdx === null) return;
    const selectedKey = st.selected ? conversationKey(st.selected) : "";
    if (!selectedKey || selectedKey !== chatKey) return;
    closeModal();
    window.setTimeout(() => jumpToChatMsgIdx(msgIdx), 0);
  }

  return {
    buildModalState,
    openFromMessageIndex,
    recoverCurrent,
    navigate,
    openAtIndex,
    jumpFromViewer,
  };
}
