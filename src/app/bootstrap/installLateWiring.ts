import { conversationKey } from "../../helpers/chat/conversationKey";
import { saveChatFoldersForUser } from "../../helpers/chat/folders";
import { savePinsForUser } from "../../helpers/chat/pins";
import { savePinnedMessagesForUser } from "../../helpers/chat/pinnedMessages";
import { copyText } from "../../helpers/dom/copyText";
import { loadAutoDownloadPrefs, saveAutoDownloadPrefs } from "../../helpers/files/autoDownloadPrefs";
import { setNotifyInAppEnabled, setNotifySoundEnabled } from "../../helpers/notify/notifyPrefs";
import { autosizeInput } from "../../helpers/ui/autosizeInput";
import { createContextMenuAdapterActionsFeature } from "../features/contextMenu/contextMenuAdapterActionsFeature";
import { createRoomModerationActionsFeature } from "../features/contextMenu/roomModerationActionsFeature";
import { createFileActionsFeature } from "../features/files/fileActionsFeature";
import { createHotkeyActionsFeature } from "../features/hotkeys/hotkeyActionsFeature";
import { createHotkeyAdapterActionsFeature } from "../features/hotkeys/hotkeyAdapterActionsFeature";
import { createHotkeysFeature } from "../features/hotkeys/hotkeysFeature";
import { installEditingEndSyncFeature } from "../features/history/editingEndSyncFeature";
import { createAuthUiActionsFeature } from "../features/auth/authUiActionsFeature";
import { createActionsAccountFeature } from "../features/navigation/actionsAccountFeature";
import { createActionsCustomAdapterFeature } from "../features/navigation/actionsCustomAdapterFeature";
import { createActionsUiOpenersFeature } from "../features/navigation/actionsUiOpenersFeature";
import { installMainRenderSubscriptionFeature } from "../features/navigation/mainRenderSubscriptionFeature";
import { createPageSetDispatchFeature } from "../features/navigation/pageSetDispatchFeature";
import { installSidebarChatContextInteractionsFeature } from "../features/navigation/sidebarChatContextInteractionsFeature";
import { createNotifyActionsFeature } from "../features/pwa/notifyActionsFeature";
import { createPwaUpdateFeature } from "../features/pwa/pwaUpdateFeature";
import { installHistoryCachePersistFeature } from "../features/persistence/historyCachePersistFeature";
import { flushDrafts, flushOutbox, scheduleSaveHistoryCache } from "../features/persistence/localPersistenceTimers";
import { applyRestartStateSnapshot } from "../features/persistence/restartStateRestoreFeature";
import { createRestartStateFeature } from "../features/persistence/restartStateFeature";
import { createUserLocalStateHydrationFeature } from "../features/persistence/userLocalStateHydrationFeature";
import { createProfileActionsFeature } from "../features/profile/profileActionsFeature";
import { createChatSearchSyncFeature } from "../features/search/chatSearchSyncFeature";
import { createSearchHistoryActionsFeature } from "../features/search/searchHistoryActionsFeature";
import { createSearchInputActionsFeature } from "../features/search/searchInputActionsFeature";
import { searchableMessagesForSelected } from "../features/search/searchableMessagesFeature";
import { formatSearchHistorySenderLabel, formatSearchHistoryShareText, formatSearchHistoryTargetLabel, formatSearchServerShareText } from "../features/search/searchShareFormatters";
import { createSidebarPreferencesActionsFeature } from "../features/sidebar/sidebarPreferencesActionsFeature";
import { renderApp } from "../renderApp";

export function installLateWiring(deps: any) {
  const {
    store,
    gateway,
    root,
    layout,
    coarsePointerMq,
    mobileSidebarMq,
    floatingSidebarMq,
    isMobileSidebarOpen,
    setMobileSidebarOpen,
    isFloatingSidebarOpen,
    setFloatingSidebarOpen,
    setMobileSidebarTab,
    isChatMessageSelectable,
    setChatSelectionValueAtIdx,
    setChatSelectionAnchorIdx,
    setSuppressMsgSelectToggleClickUntil,
    setSuppressChatClickUntil,
    getSuppressChatClickUntil,
    setMsgContextSelection,
    getLastUserInputAt,
    markUserInput,
    contextMenuFeature,
    contextMenuActionsFeature,
    emojiPopoverFeature,
    avatarFeature,
    outboxFeature,
    fileDownloadActions,
    fileOffers,
    fileSendModalFeature,
    autoDownloadCachePolicyFeature,
    fileViewer,
    openChatSearch,
    closeChatSearch,
    closeRightPanel,
    closeMobileSidebar,
    closeModal,
    callAccept,
    callDecline,
    setPage,
    logout,
    openGroupCreateModal,
    openBoardCreateModal,
    debugHud,
    openConfirmModal,
    openActionModal,
    showToast,
    scheduleFocusComposer,
    requestFreshHttpDownloadUrl,
    clearComposerHelper,
    composerHelperDraftFeature,
    composerSendMenuFeature,
    composerSendMenuActionsFeature,
    sendChat,
    selectTarget,
    openUserPage,
    openGroupPage,
    openBoardPage,
    openMembersAddModal,
    openMembersRemoveModal,
    openRenameModal,
    maybeSendMessageRead,
    toggleChatSelection,
    jumpToChatMsgIdx,
    setChatSearchQuery,
    buildHelperDraft,
    beginEditingMessage,
    roomInfoSubmitFeature,
    authFeature,
    setSkin,
    setTheme,
    pwaShareFeature,
    pwaNotifyFeature,
    enablePush,
    disablePush,
    createGroup,
    createBoard,
    membersAddSubmit,
    membersRemoveSubmit,
    renameSubmit,
    sendScheduleSubmit,
    sendScheduleWhenOnlineSubmit,
    forwardViewerSelectionActionsFeature,
    modalSubmitFeature,
    authRequestsFeature,
    groupBoardJoinFeature,
    roomInviteResponsesFeature,
    publishBoardPost,
    openChatFromSearch,
    membersChipsFeature,
    historyFeature,
    virtualHistoryFeature,
    syncNavOverlay,
    scheduleChatJumpVisibility,
    requestHistory,
    previewAutoFetchFeature,
    scheduleHistoryWarmup,
    maybeAutoFillHistoryViewport,
    maybeAutoRetryHistory,
    convoSig,
    normalizeChatSearchFilter,
    sameChatSearchCounts,
    sameNumberArray,
    armBoardScheduleTimer,
    scheduleBoardEditorPreview,
    initSkins,
  } = deps as any;

  const restartStateFeature = createRestartStateFeature();

  const pwaUpdateFeature = createPwaUpdateFeature({
    store,
    send: (payload) => gateway.send(payload),
    flushBeforeReload: () => {
      flushDrafts(store);
      flushOutbox(store);
      restartStateFeature.save(store.get());
    },
    getLastUserInputAt,
    hasPendingHistoryActivityForUpdate: () => historyFeature?.hasPendingActivityForUpdate() ?? false,
    hasPendingPreviewActivityForUpdate: () => previewAutoFetchFeature.hasPendingActivityForUpdate(),
  });
  pwaUpdateFeature.installEventListeners();

  async function applyPwaUpdateNow(opts?: { mode?: "auto" | "manual"; buildId?: string }) {
    await pwaUpdateFeature?.applyPwaUpdateNow(opts);
  }

  function forceUpdateReload(reason?: string) {
    pwaUpdateFeature?.forceUpdateReload(reason);
  }

  async function forcePwaUpdate() {
    await pwaUpdateFeature?.forcePwaUpdate();
  }

  function scheduleAutoApplyPwaUpdate(delayMs = 800) {
    pwaUpdateFeature?.scheduleAutoApplyPwaUpdate(delayMs);
  }

  const hotkeyActionsFeature = createHotkeyActionsFeature({
    store,
    send: (payload) => gateway.send(payload),
    closeMobileSidebar,
    closeModal,
    setPage,
    logout,
    openGroupCreateModal,
    openBoardCreateModal,
    toggleDebugHud: () => {
      debugHud.toggle();
      return debugHud.isEnabled();
    },
  });

  const hotkeyAdapterActionsFeature = createHotkeyAdapterActionsFeature({
    onHotkey: hotkeyActionsFeature.handleHotkey,
    onManualPwaUpdate: () => {
      void applyPwaUpdateNow({ mode: "manual" });
    },
    onFileViewerNavigate: fileViewer.navigate,
    onOpenChatSearch: openChatSearch,
    onCloseMobileSidebar: closeMobileSidebar,
    onCloseModal: closeModal,
    onCloseChatSearch: closeChatSearch,
    onCloseRightPanel: closeRightPanel,
    onSetMainPage: () => setPage("main"),
    isMobileSidebarOpen,
    isFloatingSidebarOpen,
  });

  const hotkeysFeature = createHotkeysFeature({
    store,
    hotkeysRoot: layout.hotkeys,
    ...hotkeyAdapterActionsFeature,
  });
  hotkeysFeature.installEventListeners();

  installSidebarChatContextInteractionsFeature({
    store,
    sidebar: layout.sidebar,
    sidebarBody: layout.sidebarBody,
    chat: layout.chat,
    chatHost: layout.chatHost,
    coarsePointerMq,
    mobileSidebarMq,
    isMobileSidebarOpen,
    setMobileSidebarTab,
    isChatMessageSelectable,
    setChatSelectionValueAtIdx,
    setChatSelectionAnchorIdx,
    setSuppressMsgSelectToggleClickUntil,
    setSuppressChatClickUntil,
    getSuppressChatClickUntil,
    setMsgContextSelection,
    openContextMenu: (target, x, y) => {
      contextMenuFeature?.openContextMenu(target, x, y);
    },
    onReplySwipeCommit: (swipeKey, swipeIdx) => {
      const st = store.get();
      if (st.editing || !st.selected || !swipeKey) return;
      const key = conversationKey(st.selected);
      if (!key || key !== swipeKey) return;
      const conv = st.conversations[key] || null;
      const msg = conv && swipeIdx >= 0 && swipeIdx < conv.length ? conv[swipeIdx] : null;
      const draft = msg ? buildHelperDraft(st, key, msg) : null;
      if (!draft) return;
      setSuppressChatClickUntil(Date.now() + 800);
      store.set({ replyDraft: draft, forwardDraft: null });
      scheduleFocusComposer();
    },
  });

  const roomModerationActionsFeature = createRoomModerationActionsFeature({
    store,
    send: (payload) => gateway.send(payload),
    openConfirmModal,
    showToast,
    saveRoomInfo: roomInfoSubmitFeature.saveRoomInfo,
  });

  const sidebarPreferencesActionsFeature = createSidebarPreferencesActionsFeature({
    store,
    sidebarBody: layout.sidebarBody,
    send: (payload) => gateway.send(payload),
    saveChatFoldersForUser,
  });

  const authUiActionsFeature = createAuthUiActionsFeature({
    store,
    logout,
    authLoginFromDom: () => authFeature?.authLoginFromDom(),
    authRegisterFromDom: () => authFeature?.authRegisterFromDom(),
    closeModal,
    forceUpdateReload,
    applyPwaUpdateNow: () => applyPwaUpdateNow({ mode: "manual" }),
    setSkin,
    setTheme,
  });

  const searchInputActionsFeature = createSearchInputActionsFeature({
    store,
    send: (payload) => gateway.send(payload),
    markUserInput,
  });

  const searchHistoryActionsFeature = createSearchHistoryActionsFeature({
    store,
    send: (payload) => gateway.send(payload),
    savePinsForUser,
    savePinnedMessagesForUser,
  });

  const fileActionsFeature = createFileActionsFeature({
    store,
    getFileOffers: () => fileOffers,
    getFileSendModal: () => fileSendModalFeature,
    saveAutoDownloadPrefs,
    loadAutoDownloadPrefs,
    onAutoDownloadPrefsReloaded: (uid, prefs) => {
      autoDownloadCachePolicyFeature.setAutoDownloadPrefsCache(uid, prefs);
    },
  });

  const profileActionsFeature = createProfileActionsFeature({
    store,
    send: (payload) => gateway.send(payload),
    markUserInput,
    buildSearchServerShareText: (state, items) => formatSearchServerShareText(state, items),
    tryAppendShareTextToSelected: (text) => Boolean(pwaShareFeature?.tryAppendShareTextToSelected(text)),
    copyText,
    getAvatarFeature: () => avatarFeature,
  });

  const notifyActionsFeature = createNotifyActionsFeature({
    store,
    enablePush,
    disablePush,
    setNotifyInAppEnabled,
    setNotifySoundEnabled,
    syncNotifyPrefsToServiceWorker: () => {
      pwaNotifyFeature?.syncNotifyPrefsToServiceWorker();
    },
    forcePwaUpdate,
  });

  const actionsCustomAdapterFeature = createActionsCustomAdapterFeature({
    store,
    formatSearchHistoryShareText,
    tryAppendShareTextToSelected: (text) => Boolean(pwaShareFeature?.tryAppendShareTextToSelected(text)),
    copyText,
    handleContextMenuAction: async (itemId: string) => await contextMenuActionsFeature?.handleContextMenuAction(itemId),
  });
  const pageSetDispatchFeature = createPageSetDispatchFeature({
    store,
    setPage,
    send: (payload) => gateway.send(payload),
  });
  const actionsUiOpenersFeature = createActionsUiOpenersFeature({
    setPage,
    openSidebarToolsContextMenu: (x: number, y: number) => contextMenuFeature?.openContextMenu({ kind: "sidebar_tools", id: "main" }, x, y),
  });
  const actionsAccountFeature = createActionsAccountFeature({
    authUiActions: authUiActionsFeature,
    profileActions: profileActionsFeature,
    notifyActions: notifyActionsFeature,
  });
  const actions = {
    onSelectTarget: selectTarget,
    onOpenUser: openUserPage,
    onCloseRightPanel: closeRightPanel,
    onOpenActionModal: openActionModal,
    onOpenHelp: actionsUiOpenersFeature.onOpenHelp,
    onOpenGroupCreate: openGroupCreateModal,
    onOpenBoardCreate: openBoardCreateModal,
    onSetPage: pageSetDispatchFeature.handleSetPage,
    onOpenSidebarToolsMenu: actionsUiOpenersFeature.onOpenSidebarToolsMenu,
    onRoomMemberRemove: roomModerationActionsFeature.onRoomMemberRemove,
    onBlockToggle: roomModerationActionsFeature.onBlockToggle,
    onRoomWriteToggle: roomModerationActionsFeature.onRoomWriteToggle,
    onRoomRefresh: roomModerationActionsFeature.onRoomRefresh,
    onRoomInfoSave: roomModerationActionsFeature.onRoomInfoSave,
    onRoomLeave: roomModerationActionsFeature.onRoomLeave,
    onRoomDisband: roomModerationActionsFeature.onRoomDisband,
    onSetMobileSidebarTab: setMobileSidebarTab,
    onSetSidebarChatFilter: sidebarPreferencesActionsFeature.onSetSidebarChatFilter,
    onSetSidebarFolderId: sidebarPreferencesActionsFeature.onSetSidebarFolderId,
    onSetSidebarQuery: sidebarPreferencesActionsFeature.onSetSidebarQuery,
    onToggleSidebarArchive: sidebarPreferencesActionsFeature.onToggleSidebarArchive,
    ...actionsAccountFeature,
    onCallAccept: callAccept,
    onCallDecline: callDecline,
    onGroupCreate: createGroup,
    onBoardCreate: createBoard,
    onMembersAdd: membersAddSubmit,
    onMembersRemove: membersRemoveSubmit,
    onRename: renameSubmit,
    onSendSchedule: sendScheduleSubmit,
    onSendScheduleWhenOnline: sendScheduleWhenOnlineSubmit,
    onForwardSend: forwardViewerSelectionActionsFeature.sendForwardToTargets,
    onInviteUser: modalSubmitFeature.inviteUserSubmit,
    onAuthRequest: authRequestsFeature.requestAuth,
    onAuthAccept: authRequestsFeature.acceptAuth,
    onAuthDecline: authRequestsFeature.declineAuth,
    onAuthCancel: authRequestsFeature.cancelAuth,
    onGroupJoin: groupBoardJoinFeature.joinGroup,
    onBoardJoin: groupBoardJoinFeature.joinBoard,
    onGroupInviteAccept: groupBoardJoinFeature.acceptGroupInvite,
    onGroupInviteDecline: groupBoardJoinFeature.declineGroupInvite,
    onGroupJoinAccept: roomInviteResponsesFeature.acceptGroupJoin,
    onGroupJoinDecline: roomInviteResponsesFeature.declineGroupJoin,
    onBoardInviteJoin: roomInviteResponsesFeature.joinBoardFromInvite,
    onBoardInviteDecline: roomInviteResponsesFeature.declineBoardInvite,
    onFileSendConfirm: fileActionsFeature.onFileSendConfirm,
    onFileViewerNavigate: fileViewer.navigate,
    onFileViewerJump: fileViewer.jumpFromViewer,
    onFileViewerShare: () => void forwardViewerSelectionActionsFeature.shareFromFileViewer(),
    onFileViewerForward: forwardViewerSelectionActionsFeature.forwardFromFileViewer,
    onFileViewerDelete: forwardViewerSelectionActionsFeature.deleteFromFileViewer,
    onFileViewerOpenAt: fileViewer.openAtIndex,
    onFileSend: fileActionsFeature.onFileSend,
    onFileOfferAccept: fileActionsFeature.onFileOfferAccept,
    onFileOfferReject: fileActionsFeature.onFileOfferReject,
    onClearCompletedFiles: fileActionsFeature.onClearCompletedFiles,
    onAutoDownloadPrefsSave: fileActionsFeature.onAutoDownloadPrefsSave,
    onSearchQueryChange: searchInputActionsFeature.onSearchQueryChange,
    onSearchSubmit: searchInputActionsFeature.onSearchSubmit,
    onBoardPostPublish: publishBoardPost,
    onOpenHistoryHit: openChatFromSearch,
    onSearchPinToggle: searchHistoryActionsFeature.onSearchPinToggle,
    onSearchHistoryDelete: searchHistoryActionsFeature.onSearchHistoryDelete,
    onSearchHistoryForward: actionsCustomAdapterFeature.onSearchHistoryForward,
    onContextMenuAction: actionsCustomAdapterFeature.onContextMenuAction,
    onConfirmModal: modalSubmitFeature.confirmSubmit,
  };

  applyRestartStateSnapshot({
    store,
    restartStateFeature,
    input: layout.input,
    autosizeInput,
  });

  installEditingEndSyncFeature({
    store,
    input: layout.input,
    autosizeInput,
    scheduleBoardEditorPreview,
  });

  const userLocalStateHydrationFeature = createUserLocalStateHydrationFeature({
    store,
    input: layout.input,
    autosizeInput,
    armBoardScheduleTimer,
    syncOutboxFromServiceWorker: (userId) => outboxFeature?.syncFromServiceWorker(userId),
  });

  const chatSearchSyncFeature = createChatSearchSyncFeature({
    store,
    searchableMessagesForSelected,
    normalizeChatSearchFilter,
    sameChatSearchCounts,
    sameNumberArray,
  });

  installMainRenderSubscriptionFeature({
    store,
    layout,
    actions,
    renderApp,
    getUserLocalStateHydrationFeature: () => userLocalStateHydrationFeature,
    getChatSearchSyncFeature: () => chatSearchSyncFeature,
    syncNavOverlay,
    getHistoryFeature: () => historyFeature,
    getVirtualHistoryFeature: () => virtualHistoryFeature,
    scheduleChatJumpVisibility,
    onMembersAddModalVisible: () => {
      membersChipsFeature?.renderMembersAddChips();
      membersChipsFeature?.drainMembersAddLookups();
    },
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
  });

  installHistoryCachePersistFeature({
    store,
    isHistoryCacheLoadedFor: (userId: string) => Boolean(userLocalStateHydrationFeature?.isHistoryCacheLoadedFor(userId)),
    scheduleSaveHistoryCache,
  });

  renderApp(layout, store.get(), actions);

  void initSkins();
  gateway.connect();

  // Remove the boot screen only after the app is ready enough to render UI.
  try {
    const boot = root.querySelector(".boot");
    if (boot) boot.remove();
  } catch {
    // ignore
  }

  try {
    window.dispatchEvent(new Event("yagodka:booted"));
  } catch {
    // ignore
  }

  return { userLocalStateHydrationFeature, chatSearchSyncFeature };
}
