import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";

export interface TopbarActionsFeatureDeps {
  store: Store<AppState>;
  overlay: HTMLElement;
  headerLeft: HTMLElement;
  headerRight: HTMLElement;
  closeModal: () => void;
  onSetPageMain: () => void;
  onOpenChatSearch: () => void;
  onCloseChatSearch: () => void;
  onLogout: () => void;
  onAuthOpen: () => void;
  onClearSelectedTarget: () => void;
  onToggleSidebar: () => void;
  onStartCall: (mode: "audio" | "video") => void;
  onOpenChatTopbarMenu: (anchor: HTMLElement) => void;
}

export interface TopbarActionsFeature {
  installEventListeners: () => void;
}

export function createTopbarActionsFeature(deps: TopbarActionsFeatureDeps): TopbarActionsFeature {
  const {
    store,
    overlay,
    headerLeft,
    headerRight,
    closeModal,
    onSetPageMain,
    onOpenChatSearch,
    onCloseChatSearch,
    onLogout,
    onAuthOpen,
    onClearSelectedTarget,
    onToggleSidebar,
    onStartCall,
    onOpenChatTopbarMenu,
  } = deps;

  let listenersInstalled = false;

  const onOverlayClick = (e: Event) => {
    const modal = store.get().modal;
    const kind = modal?.kind;
    if (kind !== "context_menu" && kind !== "file_viewer") return;
    if (e.target !== overlay) return;
    if (kind === "file_viewer" && modal && modal.kind === "file_viewer") {
      const openedAt = modal.openedAtMs;
      const openedAtMs = typeof openedAt === "number" && Number.isFinite(openedAt) ? openedAt : 0;
      if (openedAtMs > 0) {
        const age = Date.now() - openedAtMs;
        if (age >= 0 && age < 420) {
          e.preventDefault();
          return;
        }
      }
    }
    e.preventDefault();
    closeModal();
  };

  const onHeaderLeftClick = (e: Event) => {
    const btn = (e.target as HTMLElement | null)?.closest("button[data-action]") as HTMLButtonElement | null;
    if (!btn) return;
    const action = String(btn.dataset.action || "");
    if (action === "nav-back") {
      e.preventDefault();
      const st = store.get();
      if (st.modal) return;
      onSetPageMain();
      return;
    }
    if (action === "chat-search-open") {
      e.preventDefault();
      onOpenChatSearch();
      return;
    }
    if (action === "chat-search-close") {
      e.preventDefault();
      onCloseChatSearch();
      return;
    }
    if (action === "auth-logout") {
      e.preventDefault();
      onLogout();
      return;
    }
    if (action === "auth-open") {
      e.preventDefault();
      onAuthOpen();
      return;
    }
    if (action === "chat-back") {
      e.preventDefault();
      const st = store.get();
      if (st.modal) return;
      onClearSelectedTarget();
      return;
    }
    if (action !== "sidebar-toggle") return;
    e.preventDefault();
    if (store.get().modal) return;
    onToggleSidebar();
  };

  const onHeaderRightClick = (e: Event) => {
    const btn = (e.target as HTMLElement | null)?.closest("button[data-action]") as HTMLButtonElement | null;
    if (!btn) return;
    const action = String(btn.dataset.action || "");
    if (action === "call-start-audio") {
      e.preventDefault();
      onStartCall("audio");
      return;
    }
    if (action === "call-start-video") {
      e.preventDefault();
      onStartCall("video");
      return;
    }
    if (action !== "chat-topbar-menu") return;
    e.preventDefault();
    const st = store.get();
    if (st.modal) return;
    if (!st.selected || st.page !== "main") return;
    onOpenChatTopbarMenu(btn);
  };

  const installEventListeners = () => {
    if (listenersInstalled) return;
    listenersInstalled = true;
    overlay.addEventListener("click", onOverlayClick);
    headerLeft.addEventListener("click", onHeaderLeftClick);
    headerRight.addEventListener("click", onHeaderRightClick);
  };

  return { installEventListeners };
}
