import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";

export interface ModalCloseFeatureDeps {
  store: Store<AppState>;
  clearSendMenuDraft: () => void;
  closeCallModal: () => void;
  closeFileSendModalIfFileSend: () => boolean;
  clearMembersAddLookups: () => void;
}

export interface ModalCloseFeature {
  closeModal: () => void;
}

export function createModalCloseFeature(deps: ModalCloseFeatureDeps): ModalCloseFeature {
  const { store, clearSendMenuDraft, closeCallModal, closeFileSendModalIfFileSend, clearMembersAddLookups } = deps;

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
        store.set({ modal: null });
      }
      return;
    }
    if (st.modal.kind === "members_add") {
      clearMembersAddLookups();
    }
    if (st.modal.kind === "update") {
      store.set({ modal: null, updateDismissedLatest: st.updateLatest });
    } else {
      store.set({ modal: null });
    }
  };

  return {
    closeModal,
  };
}
