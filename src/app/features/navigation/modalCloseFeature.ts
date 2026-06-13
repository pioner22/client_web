import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";
import { createChatStickyBottomState } from "../../../helpers/chat/stickyBottom";
import { getChatHistoryViewportRuntime, markChatPendingBottomStick } from "../../../helpers/chat/historyViewportRuntime";
import { HISTORY_VIRTUAL_WINDOW, getVirtualMaxStart } from "../../../helpers/chat/virtualHistory";
import { getConversationViewportKey } from "../../../helpers/navigation/mainConversationState";
import { closeModalState } from "../../../helpers/navigation/appShellState";

export interface ModalCloseFeatureDeps {
  store: Store<AppState>;
  chatHost?: HTMLElement | null;
  clearSendMenuDraft: () => void;
  closeCallModal: () => void;
  closeFileSendModalIfFileSend: () => boolean;
  clearMembersAddLookups: () => void;
}

export interface ModalCloseFeature {
  closeModal: () => void;
}

export function createModalCloseFeature(deps: ModalCloseFeatureDeps): ModalCloseFeature {
  const { store, chatHost, clearSendMenuDraft, closeCallModal, closeFileSendModalIfFileSend, clearMembersAddLookups } = deps;

  const shouldRestoreViewerTail = (prev: AppState, key: string): boolean => {
    if (!key) return false;
    const msgs = prev.conversations?.[key] || [];
    const currentStart = prev.historyVirtualStart?.[key];
    if (typeof currentStart !== "number" || !Number.isFinite(currentStart)) return false;
    const maxStart = getVirtualMaxStart(msgs.length, HISTORY_VIRTUAL_WINDOW);
    return currentStart >= Math.max(0, maxStart - HISTORY_VIRTUAL_WINDOW);
  };

  const closeFileViewerState = (prev: AppState): AppState => {
    const modal = prev.modal;
    const next = closeModalState(prev);
    if (!modal || modal.kind !== "file_viewer") return next;
    const modalKey = String(modal.chatKey || "").trim();
    const viewportKey = getConversationViewportKey(prev);
    const key = modalKey && viewportKey && modalKey === viewportKey ? modalKey : "";
    if (!key || !shouldRestoreViewerTail(prev, key)) return next;
    const historyVirtualStart = { ...(next.historyVirtualStart || {}) };
    delete historyVirtualStart[key];
    return { ...next, historyVirtualStart };
  };

  const markViewerTailRestore = (st: AppState): void => {
    const modal = st.modal;
    if (!chatHost || !modal || modal.kind !== "file_viewer") return;
    const modalKey = String(modal.chatKey || "").trim();
    const viewportKey = getConversationViewportKey(st);
    const key = modalKey && viewportKey && modalKey === viewportKey ? modalKey : "";
    if (!key || !shouldRestoreViewerTail(st, key)) return;
    markChatPendingBottomStick(chatHost, key, Date.now(), 2500);
    try {
      getChatHistoryViewportRuntime(chatHost).stickyBottom = createChatStickyBottomState(chatHost, key, true);
    } catch {
      // ignore
    }
  };

  const closeModal = () => {
    const st = store.get();
    if (!st.modal) return;
    if (st.modal.kind === "context_menu") {
      clearSendMenuDraft();
    }
    if (st.modal.kind === "call") {
      closeCallModal();
      return;
    }
    if (st.modal.kind === "file_send") {
      if (!closeFileSendModalIfFileSend()) {
        store.set((prev) => closeModalState(prev));
      }
      return;
    }
    if (st.modal.kind === "members_add") {
      clearMembersAddLookups();
    }
    if (st.modal.kind === "update") {
      store.set((prev) => closeModalState(prev, { dismissUpdate: true }));
    } else if (st.modal.kind === "file_viewer") {
      markViewerTailRestore(st);
      store.set((prev) => closeFileViewerState(prev));
    } else {
      store.set((prev) => closeModalState(prev));
    }
  };

  return {
    closeModal,
  };
}
