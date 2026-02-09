import { conversationKey } from "../../../helpers/chat/conversationKey";
import { isImageLikeFile } from "../../../helpers/files/fileBlobCache";
import { isVideoLikeFile } from "../../../helpers/files/isVideoLikeFile";
import type { Store } from "../../../stores/store";
import type { AppState, ChatMessage } from "../../../stores/types";

export type FileViewerModalState = Extract<AppState["modal"], { kind: "file_viewer" }>;

export interface FileViewerModalParams {
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
  openFromMessageIndex: (chatKey: string, msgIdx: number, fallback?: FileViewerOpenFallback) => Promise<void>;
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

  function buildModalState(params: FileViewerModalParams): FileViewerModalState {
    const st = store.get();
    const chatKey = params.chatKey ? String(params.chatKey) : null;
    const msgIdx = Number.isFinite(params.msgIdx) ? Math.trunc(Number(params.msgIdx)) : null;
    const msgs = chatKey ? st.conversations[chatKey] || [] : [];
    const prevIdx = chatKey && msgIdx !== null ? findNeighborMediaIndex(st, msgs, msgIdx, -1) : null;
    const nextIdx = chatKey && msgIdx !== null ? findNeighborMediaIndex(st, msgs, msgIdx, 1) : null;
    return {
      kind: "file_viewer",
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

  async function openFromMessageIndex(chatKey: string, msgIdx: number, fallback?: FileViewerOpenFallback): Promise<void> {
    const st = store.get();
    const msgs = st.conversations[chatKey] || [];
    if (!Number.isFinite(msgIdx) || msgIdx < 0 || msgIdx >= msgs.length) return;
    const msg = msgs[msgIdx];
    const att = msg?.attachment;
    if (!att || att.kind !== "file") return;
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
    if (!(isImageLikeFile(name, mime) || isVideoLikeFile(name, mime) || hasThumb)) return;
    const autoplay = isVideoLikeFile(name, mime);
    const rawCaption = String(msg.text || "").trim();
    const captionText = rawCaption && !rawCaption.startsWith("[file]") ? rawCaption : String(fallback?.caption || "").trim();
    const caption = captionText ? captionText : null;
    const url = entry?.url || fallback?.url || null;
    if (url) {
      store.set({ modal: buildModalState({ url, name, size, mime, caption, autoplay, chatKey, msgIdx }) });
      return;
    }
    if (!fileId) {
      store.set({ status: "Файл пока недоступен" });
      return;
    }
    const opened = await tryOpenFileViewerFromCache(fileId, { name, size, mime, caption, chatKey, msgIdx });
    if (opened) return;
    const latest = store.get();
    if (latest.conn !== "connected") {
      store.set({ status: "Нет соединения" });
      return;
    }
    if (!latest.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    try {
      const info = await requestFreshHttpDownloadUrl(fileId);
      const nextMime = mime || info.mime || null;
      const nextAutoplay = autoplay || isVideoLikeFile(name || info.name || "", nextMime);
      store.set({
        modal: buildModalState({
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
      return;
    } catch {
      // Fallback: download into cache and open when ready (slow but offline-friendly).
      setPendingFileViewer({ fileId, name, size, mime, caption, chatKey, msgIdx });
      enqueueFileGet(fileId, { priority: "high" });
      store.set({ status: `Скачивание: ${name}` });
    }
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
    navigate,
    openAtIndex,
    jumpFromViewer,
  };
}
