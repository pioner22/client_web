import { conversationKey } from "../../../helpers/chat/conversationKey";
import type { Layout } from "../../../components/layout/types";
import type { Store } from "../../../stores/store";
import type { AppState, TargetRef } from "../../../stores/types";
import type { RenderActions } from "../../renderApp";

interface MainHistoryFeature {
  applyPrependAnchorAfterRender: (st: AppState) => void;
  applyPendingAutoScrollAfterRender: (st: AppState) => void;
  maybeBootstrapPrefetch: (st: AppState) => void;
}

interface MainVirtualHistoryFeature {
  maybeClampStartAtTop: (st: AppState) => boolean;
}

interface MainPreviewAutoFetchFeature {
  scheduleWarmupCachedPreviews: () => void;
  scheduleAutoFetchVisiblePreviews: () => void;
}

interface MainUserLocalStateHydrationFeature {
  maybeHydrateLocalState: () => boolean;
}

interface MainChatSearchSyncFeature {
  maybeSyncChatSearchState: () => boolean;
}

export interface MainRenderSubscriptionFeatureDeps {
  store: Store<AppState>;
  layout: Layout;
  actions: RenderActions;
  renderApp: (layout: Layout, state: AppState, actions: RenderActions) => void;
  getUserLocalStateHydrationFeature: () => MainUserLocalStateHydrationFeature | null;
  getChatSearchSyncFeature: () => MainChatSearchSyncFeature | null;
  syncNavOverlay: () => void;
  getHistoryFeature: () => MainHistoryFeature | null;
  getVirtualHistoryFeature: () => MainVirtualHistoryFeature | null;
  scheduleChatJumpVisibility: () => void;
  onMembersAddModalVisible: () => void;
  closeMobileSidebar: () => void;
  mobileSidebarMq: MediaQueryList;
  floatingSidebarMq: MediaQueryList;
  isMobileSidebarOpen: () => boolean;
  setMobileSidebarOpen: (open: boolean) => void;
  isFloatingSidebarOpen: () => boolean;
  setFloatingSidebarOpen: (open: boolean) => void;
  scheduleAutoApplyPwaUpdate: () => void;
  requestHistory: (target: TargetRef, opts?: { force?: boolean; deltaLimit?: number; prefetchBefore?: boolean }) => void;
  maybeSendMessageRead: (peerId: string, upToId?: number | null) => void;
  scheduleFocusComposer: () => void;
  previewAutoFetchFeature: MainPreviewAutoFetchFeature;
  scheduleHistoryWarmup: () => void;
  maybeAutoFillHistoryViewport: () => void;
  maybeAutoRetryHistory: () => void;
  convoSig: (msgs: any[]) => string;
}

export function installMainRenderSubscriptionFeature(deps: MainRenderSubscriptionFeatureDeps): void {
  const {
    store,
    layout,
    actions,
    renderApp,
    getUserLocalStateHydrationFeature,
    getChatSearchSyncFeature,
    syncNavOverlay,
    getHistoryFeature,
    getVirtualHistoryFeature,
    scheduleChatJumpVisibility,
    onMembersAddModalVisible,
    closeMobileSidebar,
    mobileSidebarMq,
    floatingSidebarMq,
    isMobileSidebarOpen,
    setMobileSidebarOpen,
    isFloatingSidebarOpen,
    setFloatingSidebarOpen,
    scheduleAutoApplyPwaUpdate,
    requestHistory,
    maybeSendMessageRead,
    scheduleFocusComposer,
    previewAutoFetchFeature,
    scheduleHistoryWarmup,
    maybeAutoFillHistoryViewport,
    maybeAutoRetryHistory,
    convoSig,
  } = deps;

  const initialSelected = store.get().selected;
  let prevAuthed = store.get().authed;
  let prevAutoFetchKey = initialSelected ? conversationKey(initialSelected) : "";
  let prevAutoFetchSig = prevAutoFetchKey ? convoSig(store.get().conversations[prevAutoFetchKey] ?? []) : "";
  let prevAutoFetchTransfersRef = store.get().fileTransfers;

  store.subscribe(() => {
    const st = store.get();
    if (getUserLocalStateHydrationFeature()?.maybeHydrateLocalState()) return;
    if (getChatSearchSyncFeature()?.maybeSyncChatSearchState()) return;
    renderApp(layout, st, actions);
    syncNavOverlay();
    getHistoryFeature()?.applyPrependAnchorAfterRender(st);
    if (getVirtualHistoryFeature()?.maybeClampStartAtTop(st)) return;
    getHistoryFeature()?.applyPendingAutoScrollAfterRender(st);
    scheduleChatJumpVisibility();
    if (st.modal?.kind === "members_add") {
      onMembersAddModalVisible();
    }
    if (st.modal && st.modal.kind !== "context_menu") {
      closeMobileSidebar();
    }
    if (st.page === "main" && !st.modal && !st.selected) {
      if (mobileSidebarMq.matches && !isMobileSidebarOpen()) {
        setMobileSidebarOpen(true);
      } else if (floatingSidebarMq.matches && !isFloatingSidebarOpen()) {
        setFloatingSidebarOpen(true);
      }
    }
    if (st.pwaUpdateAvailable) {
      scheduleAutoApplyPwaUpdate();
    }
    if (st.authed && !prevAuthed) {
      if (st.selected) {
        requestHistory(st.selected, { force: true, deltaLimit: 2000, prefetchBefore: true });
        if (st.selected.kind === "dm") {
          maybeSendMessageRead(st.selected.id);
        }
      }
      if (st.page === "main" && st.selected && !st.modal && !mobileSidebarMq.matches) {
        scheduleFocusComposer();
      }
    }
    if (st.authed && st.selfId) {
      previewAutoFetchFeature.scheduleWarmupCachedPreviews();
      previewAutoFetchFeature.scheduleAutoFetchVisiblePreviews();
      scheduleHistoryWarmup();
      maybeAutoFillHistoryViewport();
      maybeAutoRetryHistory();
    }
    if (st.authed && st.selfId && st.selected) {
      getHistoryFeature()?.maybeBootstrapPrefetch(st);
    }
    const selectedKey = st.selected ? conversationKey(st.selected) : "";
    const selectedSig = selectedKey ? convoSig(st.conversations[selectedKey] ?? []) : "";
    const autoFetchChanged =
      selectedKey !== prevAutoFetchKey ||
      selectedSig !== prevAutoFetchSig ||
      st.fileTransfers !== prevAutoFetchTransfersRef;
    prevAutoFetchKey = selectedKey;
    prevAutoFetchSig = selectedSig;
    prevAutoFetchTransfersRef = st.fileTransfers;
    if (st.page === "main" && selectedKey && autoFetchChanged) {
      previewAutoFetchFeature.scheduleAutoFetchVisiblePreviews();
      maybeAutoFillHistoryViewport();
    }
    prevAuthed = st.authed;
  });
}
