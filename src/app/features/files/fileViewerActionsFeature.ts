import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";

export interface FileViewerActionsFeatureDeps {
  store: Store<AppState>;
  showToast: (message: string, opts?: { kind?: "info" | "success" | "warn" | "error" }) => void;
  closeModal: () => void;
  sendMessageDelete: (messageId: number) => void;
}

export interface FileViewerActionsFeature {
  shareFromFileViewer: () => Promise<void>;
  deleteFromFileViewer: () => void;
}

export function createFileViewerActionsFeature(deps: FileViewerActionsFeatureDeps): FileViewerActionsFeature {
  const { store, showToast, closeModal, sendMessageDelete } = deps;

  const shareFromFileViewer = async () => {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "file_viewer") return;
    const url = String(modal.url || "").trim();
    const name = String(modal.name || "файл").trim() || "файл";
    if (!url) return;

    const copyLink = async () => {
      try {
        await navigator.clipboard.writeText(url);
        showToast("Ссылка скопирована", { kind: "success" });
      } catch {
        showToast("Не удалось скопировать ссылку", { kind: "warn" });
      }
    };

    const shareUrl = async () => {
      try {
        await navigator.share({ title: name, url });
        return true;
      } catch {
        return false;
      }
    };

    const shareFile = async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return false;
        const blob = await res.blob();
        const mime = String(modal.mime || blob.type || "").trim() || "application/octet-stream";
        const file = new File([blob], name, { type: mime });
        const canShare = typeof navigator.canShare === "function" ? navigator.canShare({ files: [file] }) : false;
        if (!canShare) return false;
        await navigator.share({ title: name, files: [file] });
        return true;
      } catch {
        return false;
      }
    };

    if (typeof navigator.share !== "function") {
      await copyLink();
      return;
    }

    const shared = url.startsWith("blob:") ? await shareFile() : (await shareUrl()) || (await shareFile());
    if (!shared) await copyLink();
  };

  const deleteFromFileViewer = () => {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "file_viewer") return;
    const chatKey = modal.chatKey ? String(modal.chatKey) : "";
    const msgIdx = typeof modal.msgIdx === "number" && Number.isFinite(modal.msgIdx) ? Math.trunc(modal.msgIdx) : null;
    if (!chatKey || msgIdx === null) return;
    const conv = st.conversations[chatKey] || [];
    if (msgIdx < 0 || msgIdx >= conv.length) return;
    const msg = conv[msgIdx];
    const msgId = typeof msg?.id === "number" && Number.isFinite(msg.id) ? msg.id : 0;
    const canAct = st.conn === "connected" && st.authed;
    const canOwner = Boolean(msg && msg.kind === "out" && st.selfId && String(msg.from) === String(st.selfId));
    if (!canAct || !canOwner || msgId <= 0) return;
    closeModal();
    sendMessageDelete(msgId);
    store.set({ status: "Удаляем сообщение…" });
  };

  return {
    shareFromFileViewer,
    deleteFromFileViewer,
  };
}
