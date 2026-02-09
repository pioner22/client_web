import { createLayout } from "../components/layout/createLayout";
import { getGatewayUrl } from "../config/env";
import { APP_MSG_MAX_LEN } from "../config/app";
import { Store } from "../stores/store";
import { el } from "../helpers/dom/el";
import { copyText } from "../helpers/dom/copyText";
import type {
  ActionModalPayload,
  AppState,
  ChatMessage,
  MessageHelperDraft,
  ConfirmAction,
  ContextMenuTargetKind,
  FileTransferEntry,
  LastReadMarker,
  MobileSidebarTab,
  PageKind,
  SearchResultEntry,
  SidebarChatFilter,
  TargetRef,
} from "../stores/types";
import { conversationKey, dmKey, roomKey } from "../helpers/chat/conversationKey";
import { messageSelectionKey } from "../helpers/chat/chatSelection";
import { getCachedMediaAspectRatio } from "../helpers/chat/mediaAspectCache";
import {
  createChatSearchCounts,
  type ChatSearchFilter,
} from "../helpers/chat/chatSearch";
import { saveArchivedForUser, toggleArchived } from "../helpers/chat/archives";
import { saveChatFoldersForUser } from "../helpers/chat/folders";
import { savePinsForUser, togglePin } from "../helpers/chat/pins";
import {
  savePinnedMessagesForUser,
} from "../helpers/chat/pinnedMessages";
import { putCachedFileBlob } from "../helpers/files/fileBlobCache";
import { loadAutoDownloadPrefs, saveAutoDownloadPrefs, type AutoDownloadPrefs } from "../helpers/files/autoDownloadPrefs";
import { setNotifyInAppEnabled, setNotifySoundEnabled } from "../helpers/notify/notifyPrefs";
import { installNotificationSoundUnlock } from "../helpers/notify/notifySound";
import { getTabNotifier } from "../helpers/notify/tabNotifier";
import { getOrCreateInstanceId } from "../helpers/device/clientTags";
import { applyTheme } from "../helpers/theme/theme";
import { applyMessageView } from "../helpers/ui/messageView";
import { isMobileLikeUi } from "../helpers/ui/mobileLike";
import { saveLastActiveTarget } from "../helpers/ui/lastActiveTarget";
import { saveLastReadMarkers } from "../helpers/ui/lastReadMarkers";
import { autosizeInput } from "../helpers/ui/autosizeInput";
import { applyLegacyIdMask } from "../helpers/id/legacyIdMask";
import { createInitialState } from "./createInitialState";
import { handleServerMessage } from "./handleServerMessage";
import { installLateWiring } from "./bootstrap/installLateWiring";
import { createGatewayClientFeature } from "./features/net/gatewayClientFeature";
import { createCallsFeature, type CallsFeature } from "./features/calls/callsFeature";
import { createFileViewerFeature, type FileViewerFeature, type PendingFileViewer } from "./features/files/fileViewerFeature";
import { createFileViewerActionsFeature } from "./features/files/fileViewerActionsFeature";
import type { FileDownloadActionsFeature } from "./features/files/fileDownloadActionsFeature";
import { createFileDownloadFeature, type FileDownloadFeature } from "./features/files/fileDownloadFeature";
import { createFileOffersFeature, type FileOffersFeature } from "./features/files/fileOffersFeature";
import type { FileGetFeature } from "./features/files/fileGetFeature";
import { createFileUploadFeature, type FileUploadFeature } from "./features/files/fileUploadFeature";
import { createFileSendModalFeature, type FileSendModalFeature } from "./features/files/fileSendModalFeature";
import { createFileActionsFeature } from "./features/files/fileActionsFeature";
import { createComposerFileInputFeature } from "./features/files/composerFileInputFeature";
import { createComposerAttachButtonFeature } from "./features/files/composerAttachButtonFeature";
import { initFileTransferBootstrap } from "./features/files/fileTransferBootstrap";
import { createPreviewAutoFetchFeature } from "./features/files/previewAutoFetchFeature";
import { createLocalVideoThumbFeature, type LocalVideoThumbFeature } from "./features/files/localVideoThumbFeature";
import { probeImageDimensions } from "./features/files/probeImageDimensions";
import { createHistoryFeature, type HistoryFeature } from "./features/history/historyFeature";
import { createChatJumpFeature } from "./features/history/chatJumpFeature";
import { createPinnedMessagesUiFeature } from "./features/history/pinnedMessagesUiFeature";
import { createChatSelectionStateFeature } from "./features/history/chatSelectionStateFeature";
import { createChatSelectionCopyDownloadFeature } from "./features/history/chatSelectionCopyDownloadFeature";
import { createChatSelectionSendDeleteFeature } from "./features/history/chatSelectionSendDeleteFeature";
import { createChatSelectionPinFeature } from "./features/history/chatSelectionPinFeature";
import { installEditingEndSyncFeature } from "./features/history/editingEndSyncFeature";
import { createReadReceiptsFeature } from "./features/history/readReceiptsFeature";
import { createHotkeyActionsFeature } from "./features/hotkeys/hotkeyActionsFeature";
import { createHotkeyAdapterActionsFeature } from "./features/hotkeys/hotkeyAdapterActionsFeature";
import { createHotkeysFeature } from "./features/hotkeys/hotkeysFeature";
import { createVirtualHistoryFeature, type VirtualHistoryFeature } from "./features/history/virtualHistoryFeature";
import { createContextMenuFeature, type ContextMenuFeature } from "./features/contextMenu/contextMenuFeature";
import { createContextMenuActionsFeature, type ContextMenuActionsFeature } from "./features/contextMenu/contextMenuActionsFeature";
import { createContextMenuAdapterActionsFeature } from "./features/contextMenu/contextMenuAdapterActionsFeature";
import { createRoomModerationActionsFeature } from "./features/contextMenu/roomModerationActionsFeature";
import {
  flushDrafts,
  flushFileTransfers,
  flushHistoryCache,
  flushOutbox,
  scheduleSaveDrafts,
  scheduleSaveFileTransfers,
  scheduleSaveHistoryCache,
  scheduleSaveOutbox,
  scheduleSavePinnedMessages,
} from "./features/persistence/localPersistenceTimers";
import { installHistoryCachePersistFeature } from "./features/persistence/historyCachePersistFeature";
import { installPresenceLifecycleFeature } from "./features/persistence/presenceLifecycleFeature";
import { createRestartStateFeature } from "./features/persistence/restartStateFeature";
import { applyRestartStateSnapshot } from "./features/persistence/restartStateRestoreFeature";
import { createUserLocalStateHydrationFeature, type UserLocalStateHydrationFeature } from "./features/persistence/userLocalStateHydrationFeature";
import { createMembersChipsFeature, type MembersChipsFeature } from "./features/members/membersChipsFeature";
import { createOutboxFeature, OUTBOX_SCHEDULE_GRACE_MS, type OutboxFeature } from "./features/outbox/outboxFeature";
import { createSidebarPreferencesActionsFeature } from "./features/sidebar/sidebarPreferencesActionsFeature";
import { createSidebarOverlayFeature, type SidebarOverlayFeature } from "./features/sidebar/sidebarOverlayFeature";
import {
  formatSearchHistorySenderLabel,
  formatSearchHistoryShareText,
  formatSearchHistoryTargetLabel,
  formatSearchServerShareText,
} from "./features/search/searchShareFormatters";
import { createSearchInputActionsFeature } from "./features/search/searchInputActionsFeature";
import { createSearchHistoryActionsFeature } from "./features/search/searchHistoryActionsFeature";
import { createChatSearchSyncFeature, type ChatSearchSyncFeature } from "./features/search/chatSearchSyncFeature";
import { createChatSearchUiFeature } from "./features/search/chatSearchUiFeature";
import { createOpenChatFromSearchFeature } from "./features/search/openChatFromSearchFeature";
import { searchableMessagesForSelected } from "./features/search/searchableMessagesFeature";
import { createProfileActionsFeature } from "./features/profile/profileActionsFeature";
import { avatarKindForTarget, createAvatarFeature, type AvatarFeature } from "./features/avatar/avatarFeature";
import { createAuthFeature, type AuthFeature } from "./features/auth/authFeature";
import { createLogoutFeature, type LogoutFeature } from "./features/auth/logoutFeature";
import { createAuthUiActionsFeature } from "./features/auth/authUiActionsFeature";
import { createPwaNotifyFeature, type PwaNotifyFeature } from "./features/pwa/pwaNotifyFeature";
import { createPwaPushFeature, type PwaPushFeature } from "./features/pwa/pwaPushFeature";
import { createPwaShareFeature, type PwaShareFeature } from "./features/pwa/pwaShareFeature";
import { createPwaUpdateFeature, type PwaUpdateFeature } from "./features/pwa/pwaUpdateFeature";
import { createPwaInstallPromptFeature } from "./features/pwa/pwaInstallPromptFeature";
import { createNotifyActionsFeature } from "./features/pwa/notifyActionsFeature";
import { createActionModalRoutingFeature } from "./features/navigation/actionModalRoutingFeature";
import { createChatTargetSelectionFeature } from "./features/navigation/chatTargetSelectionFeature";
import { createPageSetDispatchFeature } from "./features/navigation/pageSetDispatchFeature";
import { createActionsUiOpenersFeature } from "./features/navigation/actionsUiOpenersFeature";
import { createActionsAccountFeature } from "./features/navigation/actionsAccountFeature";
import { createChatSurfaceEventsFeature } from "./features/navigation/chatSurfaceEventsFeature";
import { createChatHostEventsFeature } from "./features/navigation/chatHostEventsFeature";
import { createModalOpenersFeature } from "./features/navigation/modalOpenersFeature";
import { createModalCloseFeature } from "./features/navigation/modalCloseFeature";
import { createRoomCreateSubmitFeature } from "./features/navigation/roomCreateSubmitFeature";
import { createRoomMembersSubmitFeature } from "./features/navigation/roomMembersSubmitFeature";
import { createRoomInfoSubmitFeature } from "./features/navigation/roomInfoSubmitFeature";
import { createModalSubmitFeature } from "./features/navigation/modalSubmitFeature";
import { createAuthRequestsFeature } from "./features/navigation/authRequestsFeature";
import { createGroupBoardJoinFeature } from "./features/navigation/groupBoardJoinFeature";
import { createComposerHelperDraftFeature } from "./features/navigation/composerHelperDraftFeature";
import { createComposerSendMenuFeature } from "./features/navigation/composerSendMenuFeature";
import { createForwardActionsFeature } from "./features/navigation/forwardActionsFeature";
import { createSendButtonMenuGestureFeature } from "./features/navigation/sendButtonMenuGestureFeature";
import { createComposerSendMenuActionsFeature } from "./features/navigation/composerSendMenuActionsFeature";
import { createBoardScheduleInputActionsFeature } from "./features/navigation/boardScheduleInputActionsFeature";
import { createBoardToolInputActionsFeature } from "./features/navigation/boardToolInputActionsFeature";
import { createBoardEditorToggleInputActionFeature } from "./features/navigation/boardEditorToggleInputActionFeature";
import { createBoardEditorPreviewSyncFeature, type BoardEditorPreviewSyncFeature } from "./features/navigation/boardEditorPreviewSyncFeature";
import { createBoardPostScheduleFeature, type BoardPostScheduleFeature } from "./features/navigation/boardPostScheduleFeature";
import { createSendChatFeature, type SendChatFeature, type SendChatOpts } from "./features/navigation/sendChatFeature";
import { createComposerInputActionsFeature } from "./features/navigation/composerInputActionsFeature";
import { createActionsCustomAdapterFeature } from "./features/navigation/actionsCustomAdapterFeature";
import { createComposerInputSyncFeature } from "./features/navigation/composerInputSyncFeature";
import { createComposerInputStateFeature } from "./features/navigation/composerInputStateFeature";
import { createIosComposerNavLockFeature } from "./features/navigation/iosComposerNavLockFeature";
import { createComposerViewportResizeAutosizeFeature } from "./features/navigation/composerViewportResizeAutosizeFeature";
import { createComposerInputKeydownFeature } from "./features/navigation/composerInputKeydownFeature";
import { createComposerHelperMenuFeature } from "./features/navigation/composerHelperMenuFeature";
import { createForwardViewerSelectionActionsFeature } from "./features/navigation/forwardViewerSelectionActionsFeature";
import { createRoomInviteResponsesFeature } from "./features/navigation/roomInviteResponsesFeature";
import { createScheduleSubmitFeature } from "./features/navigation/scheduleSubmitFeature";
import { createTopbarActionsFeature } from "./features/navigation/topbarActionsFeature";
import { createPageNavigationFeature } from "./features/navigation/pageNavigationFeature";
import { installPreviewOutboxWatchersFeature } from "./features/navigation/previewOutboxWatchersFeature";
import { installMainRenderSubscriptionFeature } from "./features/navigation/mainRenderSubscriptionFeature";
import { createDeviceCaps } from "./features/navigation/deviceCaps";
import { applyConversationLimits, computeRoomUnread } from "./features/navigation/chatConversationMetrics";
import { installSidebarChatContextInteractionsFeature } from "./features/navigation/sidebarChatContextInteractionsFeature";
import { createThemeSkinActionsFeature } from "./features/navigation/themeSkinActionsFeature";
import { renderApp } from "./renderApp";
import { applyIosInputAssistantWorkaround, isIOS, isStandaloneDisplayMode } from "../helpers/ui/iosInputAssistant";
import { installDebugHud } from "../helpers/ui/debugHud";
import { installSidebarLeftResize } from "../helpers/ui/sidebarLeftResize";
import { renderBoardPost } from "../helpers/boards/boardPost";
import { maxBoardScheduleDelayMs, saveBoardScheduleForUser } from "../helpers/boards/boardSchedule";
import { createEmojiPopoverFeature, type EmojiPopoverFeature } from "./features/emoji/emojiPopoverFeature";
import { createToastFeature } from "./features/ui/toastFeature";

const ROOM_INFO_MAX = 2000;

export function mountApp(root: HTMLElement) {
  const store = new Store<AppState>(createInitialState());
  applyTheme(store.get().theme);
  applyMessageView(store.get().messageView);
  const handleMessageViewResize = () => applyMessageView(store.get().messageView);
  window.addEventListener("resize", handleMessageViewResize);
  window.visualViewport?.addEventListener("resize", handleMessageViewResize);
  const iosStandalone = isIOS() && isStandaloneDisplayMode();
  const layout = createLayout(root, { iosStandalone });
  const debugHud = installDebugHud({ mount: root, chatHost: layout.chatHost, getState: () => store.get() });
  installSidebarLeftResize(layout.sidebar, layout.sidebarResizeHandle);
  installNotificationSoundUnlock();
  const tabNotifier = getTabNotifier(getOrCreateInstanceId);
  tabNotifier.install();
  let callsFeature: CallsFeature | null = null;
  let fileGet: FileGetFeature | null = null;
  let fileDownload: FileDownloadFeature | null = null;
  let fileDownloadActions: FileDownloadActionsFeature | null = null;
  let fileOffers: FileOffersFeature | null = null;
  let fileUpload: FileUploadFeature | null = null;
  let fileSendModalFeature: FileSendModalFeature | null = null;
  let contextMenuFeature: ContextMenuFeature | null = null;
  let contextMenuActionsFeature: ContextMenuActionsFeature | null = null;
  let historyFeature: HistoryFeature | null = null;
  let virtualHistoryFeature: VirtualHistoryFeature | null = null;
  let sidebarOverlay: SidebarOverlayFeature | null = null;
  let avatarFeature: AvatarFeature | null = null;
  let authFeature: AuthFeature | null = null;
  let logoutFeature: LogoutFeature | null = null;
  let outboxFeature: OutboxFeature | null = null;
  let membersChipsFeature: MembersChipsFeature | null = null;
  let localVideoThumbFeature: LocalVideoThumbFeature | null = null;
  let pwaUpdateFeature: PwaUpdateFeature | null = null;
  let pwaNotifyFeature: PwaNotifyFeature | null = null;
  let pwaPushFeature: PwaPushFeature | null = null;
  let pwaShareFeature: PwaShareFeature | null = null;
  let emojiPopoverFeature: EmojiPopoverFeature | null = null;
  let boardEditorPreviewSyncFeature: BoardEditorPreviewSyncFeature | null = null;
  let boardPostScheduleFeature: BoardPostScheduleFeature | null = null;
  let sendChatFeature: SendChatFeature | null = null;
  let chatSearchSyncFeature: ChatSearchSyncFeature | null = null;
  let userLocalStateHydrationFeature: UserLocalStateHydrationFeature | null = null;

  function scheduleBoardEditorPreview() {
    boardEditorPreviewSyncFeature?.scheduleBoardEditorPreview();
  }
  const toastFeature = createToastFeature({ store, toastHost: layout.toastHost });
  toastFeature.installEventListeners();
  const { clearToast, showToast } = toastFeature;
  installPresenceLifecycleFeature({
    store,
    flushHistoryCache: () => flushHistoryCache(store),
    flushFileTransfers: () => flushFileTransfers(store),
    flushOutbox: () => flushOutbox(store),
  });
  const deviceCaps = createDeviceCaps();

  function maybeApplyIosInputAssistant(target: EventTarget | null) {
    if (!iosStandalone) return;
    const t = target instanceof HTMLElement ? target : null;
    if (!t) return;
    const node =
      t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement
        ? t
        : (t.closest("input,textarea") as HTMLInputElement | HTMLTextAreaElement | null);
    if (!node) return;
    const modeAttr = node.getAttribute("data-ios-assistant");
    if (modeAttr === "off") return;
    if (node instanceof HTMLInputElement) {
      const type = String(node.type || "text").toLowerCase();
      if (["password", "file", "checkbox", "radio", "button", "submit", "reset", "hidden", "range", "color"].includes(type)) return;
    }
    applyIosInputAssistantWorkaround(node, modeAttr === "strict" ? "strict" : "predictive");
  }

  let chatSelectionAnchorIdx: number | null = null;
  let suppressMsgSelectToggleClickUntil = 0;
  let msgContextSelection: { key: string; idx: number; text: string } | null = null;

  const chatSelectionStateFeature = createChatSelectionStateFeature({
    store,
    resetSelectionAnchor: () => {
      chatSelectionAnchorIdx = null;
    },
  });

  function isChatMessageSelectable(msg: ChatMessage | null | undefined): msg is ChatMessage {
    return chatSelectionStateFeature.isChatMessageSelectable(msg);
  }

  function clearChatSelection() {
    chatSelectionStateFeature.clearChatSelection();
  }

  function toggleChatSelection(key: string, msg: ChatMessage) {
    chatSelectionStateFeature.toggleChatSelection(key, msg);
  }

  function addChatSelectionRange(key: string, fromIdx: number, toIdx: number) {
    chatSelectionStateFeature.addChatSelectionRange(key, fromIdx, toIdx);
  }

  function setChatSelectionRangeValue(key: string, fromIdx: number, toIdx: number, value: boolean) {
    chatSelectionStateFeature.setChatSelectionRangeValue(key, fromIdx, toIdx, value);
  }

  function setChatSelectionValueAtIdx(key: string, idx: number, value: boolean) {
    chatSelectionStateFeature.setChatSelectionValueAtIdx(key, idx, value);
  }

  function resolveChatSelection(st: AppState): { key: string; messages: ChatMessage[]; ids: string[] } | null {
    return chatSelectionStateFeature.resolveChatSelection(st);
  }

  maybeApplyIosInputAssistant(layout.input);

  // iOS standalone (PWA): стараемся применить workaround ДО focus, т.к. WebKit решает,
  // какую "панель" показывать над клавиатурой, в момент фокуса.
  if (iosStandalone) {
    document.addEventListener("pointerdown", (e) => maybeApplyIosInputAssistant(e.target), true);
    document.addEventListener("touchstart", (e) => maybeApplyIosInputAssistant(e.target), true);
    document.addEventListener("focusin", (e) => maybeApplyIosInputAssistant(e.target), true);
  }

  pwaShareFeature = createPwaShareFeature({
    store,
    input: layout.input,
    autosizeInput,
    scheduleSaveDrafts: () => scheduleSaveDrafts(store),
    showToast,
    canSendFiles: () => Boolean(fileUpload),
    sendFile: (file, target, caption) => fileUpload?.sendFile(file, target, caption),
  });
  pwaShareFeature.installEventListeners();

  window.addEventListener("yagodka:pwa-stream-ready", (e: Event) => {
    const ev = e as CustomEvent;
    const detail = ev?.detail as any;
    fileDownloadActions?.handlePwaStreamReady(detail);
  });
  pwaNotifyFeature = createPwaNotifyFeature({ store, setPage, selectTarget });
  pwaNotifyFeature.installEventListeners();

  pwaPushFeature = createPwaPushFeature({ store, send: (payload) => gateway.send(payload) });
  pwaPushFeature.installAutoSync();

  async function enablePush(): Promise<void> {
    await pwaPushFeature?.enablePush();
  }

  async function disablePush(): Promise<void> {
    await pwaPushFeature?.disablePush();
  }
  const lastReadSentAt = new Map<string, number>();
  const lastReadSavedAt = new Map<string, number>();
  let lastUserInputAt = Date.now();
  const markUserActivity = () => {
    lastUserInputAt = Date.now();
  };

  const recordRoomLastReadEntry = (key: string, msg: ChatMessage | null) => {
    const k = String(key || "").trim();
    if (!k || !k.startsWith("room:")) return;
    if (!msg) return;
    const st = store.get();
    if (!st.selfId) return;
    const ts = Number(msg.ts ?? 0);
    const id = Number(msg.id ?? 0);
    const prevEntry = st.lastRead?.[k] || {};
    const nextEntry = { ...prevEntry };
    let changed = false;
    if (Number.isFinite(id) && id > 0 && (!prevEntry.id || id > prevEntry.id)) {
      nextEntry.id = id;
      changed = true;
    }
    if (Number.isFinite(ts) && ts > 0 && (!prevEntry.ts || ts > prevEntry.ts)) {
      nextEntry.ts = ts;
      changed = true;
    }
    if (!changed) return;
    const now = Date.now();
    const lastSave = lastReadSavedAt.get(k) ?? 0;
    if (now - lastSave < 1200) return;
    lastReadSavedAt.set(k, now);
    const next = { ...(st.lastRead || {}), [k]: nextEntry };
    store.set({ lastRead: next });
    saveLastReadMarkers(st.selfId, next);
    const roomId = k.slice("room:".length);
    if (roomId && nextEntry.id) {
      maybeSendRoomRead(roomId, nextEntry.id);
    }
  };

  const maybeRecordLastRead = (key: string) => {
    const k = String(key || "").trim();
    if (!k || !k.startsWith("room:")) return;
    const st = store.get();
    const conv = st.conversations[k] || [];
    const last = conv.length ? conv[conv.length - 1] : null;
    recordRoomLastReadEntry(k, last);
  };
  // PWA auto-update: treat any pointer interaction as “activity” so we don’t reload while the user clicks/opens menus.
  window.addEventListener("pointerdown", markUserActivity, { capture: true, passive: true });
  window.addEventListener("mousedown", markUserActivity, { capture: true, passive: true });
  window.addEventListener("contextmenu", markUserActivity, { capture: true });
  window.addEventListener("wheel", markUserActivity, { capture: true, passive: true });
  window.addEventListener("touchstart", markUserActivity, { capture: true, passive: true });
  const fileTransferBootstrap = initFileTransferBootstrap({
    store,
    deviceCaps,
    send: (payload) => gateway.send(payload),
    scheduleSaveFileTransfers: () => scheduleSaveFileTransfers(store),
    isUploadActive: (fileId: string) => fileUpload?.isUploadActive(fileId) ?? false,
  });
  const downloadByFileId = fileTransferBootstrap.downloadByFileId;
  const FILE_UPLOAD_MAX_CONCURRENCY = fileTransferBootstrap.fileUploadMaxConcurrency;
  const isFileHttpDisabled = fileTransferBootstrap.isFileHttpDisabled;
  const disableFileHttp = fileTransferBootstrap.disableFileHttp;
  fileDownloadActions = fileTransferBootstrap.fileDownloadActions;
  fileGet = fileTransferBootstrap.fileGet;
  const cachedPreviewsAttempted = fileTransferBootstrap.cachedPreviewsAttempted;
  const cachedThumbsAttempted = fileTransferBootstrap.cachedThumbsAttempted;
  const previewPrefetchAttempted = fileTransferBootstrap.previewPrefetchAttempted;
  const FILE_THUMB_MAX_ENTRIES = fileTransferBootstrap.fileThumbMaxEntries;
  const thumbCacheId = fileTransferBootstrap.thumbCacheId;
  const autoDownloadCachePolicyFeature = fileTransferBootstrap.autoDownloadCachePolicyFeature;
  const cachedPreviewRestoreFeature = fileTransferBootstrap.cachedPreviewRestoreFeature;
  const fileTransferStateFeature = fileTransferBootstrap.fileTransferStateFeature;
  const fileViewerCacheFeature = fileTransferBootstrap.fileViewerCacheFeature;
  const PREVIEW_AUTO_OVERSCAN = fileTransferBootstrap.previewAutoOverscan;
  const PREVIEW_AUTO_RESTORE_MAX_BYTES = fileTransferBootstrap.previewAutoRestoreMaxBytes;
  const PREVIEW_AUTO_RETRY_MS = fileTransferBootstrap.previewAutoRetryMs;
  const PREVIEW_AUTO_FAIL_RETRY_MS = fileTransferBootstrap.previewAutoFailRetryMs;
  virtualHistoryFeature = createVirtualHistoryFeature({ store, chatHost: layout.chatHost, deviceCaps });
  historyFeature = createHistoryFeature({
    store,
    send: (payload) => gateway.send(payload),
    deviceCaps,
    chatHost: layout.chatHost,
    scrollToBottom: (key) => scrollChatToBottom(key),
  });
  const drainFileGetQueue = () => fileGet?.drain();
  const enqueueFileGet = (fileId: string, opts?: { priority?: "high" | "prefetch"; silent?: boolean }) =>
    fileGet?.enqueue(fileId, opts);
  const finishFileGet = (fileId: string) => fileGet?.finish(fileId);
  const touchFileGetTimeout = (fileId: string) => fileGet?.touch(fileId);
  const dropFileGetQueue = (fileId: string) => fileGet?.dropQueue(fileId);
  const clearFileGetNotFoundRetry = (fileId: string) => fileGet?.clearNotFoundRetry(fileId);
  const scheduleFileGetNotFoundRetry = (
    fileId: string,
    opts?: { priority?: "high" | "prefetch"; silent?: boolean; attempts?: number }
  ): boolean => fileGet?.scheduleNotFoundRetry(fileId, opts) ?? false;
  const clearFileAcceptRetry = (fileId: string) => fileGet?.clearAcceptRetry(fileId);
  const scheduleFileAcceptRetry = (fileId: string, attempts = 0) => fileGet?.scheduleAcceptRetry(fileId, attempts);
  const requestFreshHttpDownloadUrl = (fileId: string) =>
    fileGet?.requestFreshHttpDownloadUrl(fileId) ?? Promise.reject(new Error("file_get_unavailable"));
  const tryResolveHttpFileUrlWaiter = (msg: any) => fileGet?.tryResolveHttpWaiterFromFileUrl(msg) ?? false;
  const rejectHttpFileUrlWaiter = (fileId: string, reason: string) =>
    fileGet?.rejectHttpWaiter(fileId, new Error(reason));
  const isSilentFileGet = (fileId: string) => fileGet?.isSilent(fileId) ?? false;
  const markSilentFileGet = (fileId: string) => fileGet?.markSilent(fileId);
  const clearSilentFileGet = (fileId: string) => fileGet?.clearSilent(fileId);
  let pendingFileViewer: PendingFileViewer | null = null;
  let transferSeq = 0;
  let localChatMsgSeq = 0;
  const composerHelperDraftFeature = createComposerHelperDraftFeature({ store });
  const composerSendMenuFeature = createComposerSendMenuFeature({
    store,
    getComposerRawText: () => String(layout.input.value || ""),
    markUserActivity,
  });
  const forwardActionsFeature = createForwardActionsFeature({
    store,
    showToast,
    closeModal,
    buildHelperDraft,
    sendChat,
    resolveChatSelection,
  });
  const fileViewerActionsFeature = createFileViewerActionsFeature({
    store,
    showToast,
    closeModal,
    sendMessageDelete: (messageId: number) => {
      gateway.send({ type: "message_delete", id: messageId });
    },
  });
  const chatSelectionCopyDownloadFeature = createChatSelectionCopyDownloadFeature({
    store,
    resolveChatSelection,
    copyText,
    showToast,
    beginDownload: (fileId: string) => {
      void fileDownloadActions?.beginDownload(fileId);
    },
  });
  const chatSelectionSendDeleteFeature = createChatSelectionSendDeleteFeature({
    store,
    resolveChatSelection,
    messageSelectionKey,
    showToast,
    scheduleSaveOutbox: () => scheduleSaveOutbox(store),
    drainOutbox: () => outboxFeature?.drainOutbox(),
    sendMessageDelete: (messageId: number) => {
      gateway.send({ type: "message_delete", id: messageId });
    },
    savePinnedMessages: (userId: string, pinned: Record<string, number[]>) => {
      savePinnedMessagesForUser(userId, pinned);
    },
    outboxScheduleGraceMs: OUTBOX_SCHEDULE_GRACE_MS,
  });
  const chatSelectionPinFeature = createChatSelectionPinFeature({
    store,
    resolveChatSelection,
    savePinnedMessages: (userId: string, pinned: Record<string, number[]>) => {
      savePinnedMessagesForUser(userId, pinned);
    },
  });
  const boardScheduleInputActionsFeature = createBoardScheduleInputActionsFeature({
    store,
    input: layout.input,
    boardScheduleInput: layout.boardScheduleInput,
    appMsgMaxLen: APP_MSG_MAX_LEN,
    maxBoardScheduleDelayMs,
    saveBoardScheduleForUser,
    armBoardScheduleTimer,
    scheduleSaveDrafts: () => scheduleSaveDrafts(store),
    autosizeInput,
    scheduleBoardEditorPreview,
    showToast,
  });
  const boardToolInputActionsFeature = createBoardToolInputActionsFeature({
    input: layout.input,
  });
  const boardEditorToggleInputActionFeature = createBoardEditorToggleInputActionFeature({
    store,
    scheduleBoardEditorPreview,
    scheduleFocusComposer,
  });
  const previewAutoFetchFeature = createPreviewAutoFetchFeature({
    store,
    chatHost: layout.chatHost,
    conversationKey,
    convoSig,
    devicePrefetchAllowed: deviceCaps.prefetchAllowed,
    autoDownloadCachePolicyFeature,
    cachedPreviewRestoreFeature,
    getCachedMediaAspectRatio,
    clearFileThumb,
    updateTransferByFileId,
    enqueueFileGet: (fileId, opts) => void enqueueFileGet(fileId, opts),
    previewPrefetchAttempted,
    previewAutoOverscan: PREVIEW_AUTO_OVERSCAN,
    previewAutoRestoreMaxBytes: PREVIEW_AUTO_RESTORE_MAX_BYTES,
    previewAutoRetryMs: PREVIEW_AUTO_RETRY_MS,
    previewAutoFailRetryMs: PREVIEW_AUTO_FAIL_RETRY_MS,
  });

  function clearFileThumb(fileId: string) {
    localVideoThumbFeature?.clearFileThumb(fileId);
  }

  function setFileThumb(
    fileId: string,
    url: string,
    mime: string | null,
    meta?: { w?: number | null; h?: number | null; mediaW?: number | null; mediaH?: number | null }
  ) {
    localVideoThumbFeature?.setFileThumb(fileId, url, mime, meta);
  }

  const clearThumbPollRetry = (fileId: string) => {
    localVideoThumbFeature?.clearThumbPollRetry(fileId);
  };

  const scheduleThumbPollRetry = (fileId: string) => {
    localVideoThumbFeature?.scheduleThumbPollRetry(fileId);
  };

  const maybeSetLocalOutgoingVideoPoster = (fileId: string, file: File) => {
    localVideoThumbFeature?.maybeSetLocalOutgoingVideoPoster(fileId, file);
  };

  localVideoThumbFeature = createLocalVideoThumbFeature({
    store,
    prefetchAllowed: deviceCaps.prefetchAllowed,
    constrained: deviceCaps.constrained,
    slowNetwork: deviceCaps.slowNetwork,
    fileThumbMaxEntries: FILE_THUMB_MAX_ENTRIES,
    thumbCacheId,
    enqueueFileGet: (fileId, opts) => {
      enqueueFileGet(fileId, opts);
    },
    shouldCachePreview: (name, mime, size) => autoDownloadCachePolicyFeature.shouldCachePreview(name, mime, size),
    enforceFileCachePolicy: (userId, opts) => autoDownloadCachePolicyFeature.enforceFileCachePolicy(userId, opts),
    putCachedFileBlob,
  });

  const mobileSidebarMq = window.matchMedia("(max-width: 600px)");
  const floatingSidebarMq = window.matchMedia("(min-width: 601px) and (max-width: 925px)");
  const rightOverlayMq = window.matchMedia("(min-width: 601px) and (max-width: 1275px)");
  const coarsePointerMq = window.matchMedia("(pointer: coarse)");
  const anyFinePointerMq = window.matchMedia("(any-pointer: fine)");
  const hoverMq = window.matchMedia("(hover: hover)");
  sidebarOverlay = createSidebarOverlayFeature({
    store,
    navOverlay: layout.navOverlay,
    sidebar: layout.sidebar,
    sidebarBody: layout.sidebarBody,
    chatHost: layout.chatHost,
    mobileSidebarMq,
    floatingSidebarMq,
    rightOverlayMq,
    hoverMq,
    anyFinePointerMq,
    isMobileLikeUi,
    scrollChatToBottom,
    closeRightPanel,
  });
  sidebarOverlay.installEventListeners();
  window.addEventListener("pagehide", () => {
    flushDrafts(store);
    flushFileTransfers(store);
    flushHistoryCache(store);
  });
  window.addEventListener("beforeunload", () => {
    flushDrafts(store);
    flushFileTransfers(store);
    flushHistoryCache(store);
  });

  function nextLocalChatMsgId(): number {
    localChatMsgSeq += 1;
    return -localChatMsgSeq;
  }

  function tryFocusComposer(): boolean {
    const st = store.get();
    if (st.page !== "main") return false;
    if (st.modal) return false;
    if (layout.input.disabled) return false;
    try {
      layout.input.focus({ preventScroll: true });
      const end = layout.input.value.length;
      layout.input.setSelectionRange(end, end);
    } catch {
      try {
        layout.input.focus();
      } catch {
        // ignore
      }
    }
    return document.activeElement === layout.input;
  }

  function scheduleFocusComposer(): void {
    if (tryFocusComposer()) return;
    queueMicrotask(() => {
      if (tryFocusComposer()) return;
      // Браузер может вернуть фокус на кликнутую кнопку после нашего обработчика.
      // Как последний шанс — повторяем фокус на следующем кадре (и на мобилке тоже).
      window.requestAnimationFrame(() => {
        if (tryFocusComposer()) return;
        window.setTimeout(() => void tryFocusComposer(), 0);
      });
    });
  }

  let chatJumpRaf: number | null = null;
  let suppressChatClickUntil = 0;

  const getMaxScrollTop = (host: HTMLElement) => Math.max(0, host.scrollHeight - host.clientHeight);

  const updateChatJumpVisibility = () => {
    chatJumpRaf = null;
    const btn = layout.chatJump;
    if (!btn) return;
    const key = String(layout.chatHost.getAttribute("data-chat-key") || "");
    const st = store.get();
    const badge = layout.chatJumpBadge;
    if (badge) {
      let unread = 0;
      if (st.selected?.kind === "dm") {
        unread = st.friends.find((f) => f.id === st.selected?.id)?.unread ?? 0;
      } else {
        unread = computeRoomUnread(key, st);
      }
      if (unread > 0) {
        badge.textContent = unread > 999 ? "999+" : String(unread);
        badge.classList.remove("hidden");
      } else {
        badge.textContent = "";
        badge.classList.add("hidden");
      }
    }
    if (!key) {
      btn.classList.add("hidden");
      return;
    }
    const host = layout.chatHost;
    const atBottom = host.scrollTop >= getMaxScrollTop(host) - 24;
    btn.classList.toggle("hidden", atBottom);
  };
  const scheduleChatJumpVisibility = () => {
    if (chatJumpRaf !== null) return;
    chatJumpRaf = window.requestAnimationFrame(updateChatJumpVisibility);
  };

  function markChatAutoScroll(key: string, waitForHistory = false) {
    historyFeature?.markChatAutoScroll(key, waitForHistory);
  }

  function scrollChatToBottom(key: string) {
    const k = String(key || "").trim();
    if (!k) return;
    const host = layout.chatHost;
    const hostState = host as any;
    hostState.__stickBottom = { key: k, active: true, at: Date.now() };
    const stickNow = () => {
      if (String(host.getAttribute("data-chat-key") || "") !== k) return;
      const st = hostState.__stickBottom;
      if (!st || st.key !== k || !st.active) return;
      host.scrollTop = Math.max(0, host.scrollHeight - host.clientHeight);
      maybeRecordLastRead(k);
    };
    queueMicrotask(stickNow);
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(stickNow);
    } else {
      stickNow();
    }
    scheduleChatJumpVisibility();
  }

  function maybeAutoLoadMoreHistory(payload: { scrollTop: number; scrollingUp: boolean; lastUserScrollAt: number }) {
    historyFeature?.maybeAutoLoadMoreOnScroll(payload);
  }

  function maybeAutoFillHistoryViewport() {
    historyFeature?.maybeFillViewport();
  }

  function maybeAutoRetryHistory() {
    historyFeature?.maybeAutoRetrySelected();
  }

  function maybeUpdateVirtualWindow(scrollTop: number) {
    virtualHistoryFeature?.maybeUpdateVirtualWindow(scrollTop);
  }

  const chatHostEventsFeature = createChatHostEventsFeature({
    store,
    layout,
    getMaxScrollTop,
    scheduleChatJumpVisibility,
    maybeRecordLastRead,
    maybeAutoLoadMoreHistory,
    maybeUpdateVirtualWindow,
    maybeAutoFillHistoryViewport,
    scheduleAutoFetchVisiblePreviews: () => previewAutoFetchFeature.scheduleAutoFetchVisiblePreviews(),
    recordRoomLastReadEntry,
    maybeSendMessageRead,
  });
  chatHostEventsFeature.install();
  const ensureVideoMutedDefault = chatHostEventsFeature.ensureVideoMutedDefault;


  let fileViewer: FileViewerFeature;
  const tryOpenFileViewerFromCache = (
    fileId: string,
    meta: { name: string; size: number; mime: string | null; caption?: string | null; chatKey?: string | null; msgIdx?: number | null }
  ): Promise<boolean> =>
    fileViewerCacheFeature.tryOpenFileViewerFromCache(fileId, meta, fileViewer.buildModalState);

  fileViewer = createFileViewerFeature({
    store,
    closeModal,
    jumpToChatMsgIdx,
    requestFreshHttpDownloadUrl,
    tryOpenFileViewerFromCache,
    enqueueFileGet,
    setPendingFileViewer: (next) => {
      pendingFileViewer = next;
    },
  });

  fileOffers = createFileOffersFeature({
    store,
    send: (payload) => gateway.send(payload),
    isFileHttpDisabled,
    nextTransferId,
    markSilentFileGet,
    scheduleSaveFileTransfers: () => scheduleSaveFileTransfers(store),
    showToast,
    tabNotifier,
    recordRoomLastReadEntry,
    maybeSendMessageRead,
  });

  fileDownload = createFileDownloadFeature({
    store,
    send: (payload) => gateway.send(payload),
    deviceCaps,
    downloadByFileId,
    disableFileHttp,
    nextTransferId,
    updateTransferByFileId,
    resolveFileMeta: (fileId) => fileDownloadActions!.resolveFileMeta(fileId),
    shouldCacheFile: (name, mime, size) => autoDownloadCachePolicyFeature.shouldCacheFile(name, mime, size),
    shouldCachePreview: (name, mime, size) => autoDownloadCachePolicyFeature.shouldCachePreview(name, mime, size),
    enforceFileCachePolicy: (userId, opts) => autoDownloadCachePolicyFeature.enforceFileCachePolicy(userId, opts),
    thumbCacheId,
    canAutoDownloadFullFile: (userId, kind, size) => autoDownloadCachePolicyFeature.canAutoDownloadFullFile(userId, kind, size),
    resolveAutoDownloadKind: (name, mime, hint) => autoDownloadCachePolicyFeature.resolveAutoDownloadKind(name, mime, hint),
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
    pendingFileDownloads: fileDownloadActions!.pendingFileDownloads,
    triggerBrowserDownload: fileDownloadActions!.triggerBrowserDownload,
    takePendingFileViewer: (fileId) => {
      const fid = String(fileId || "").trim();
      if (!fid) return null;
      if (!pendingFileViewer || pendingFileViewer.fileId !== fid) return null;
      const pv = pendingFileViewer;
      pendingFileViewer = null;
      return pv;
    },
    clearPendingFileViewer: (fileId) => {
      const fid = String(fileId || "").trim();
      if (!fid) return;
      if (pendingFileViewer && pendingFileViewer.fileId === fid) pendingFileViewer = null;
    },
    buildFileViewerModalState: fileViewer.buildModalState,
    postStreamChunk: fileDownloadActions!.postStreamChunk,
    postStreamEnd: (streamId) => void fileDownloadActions!.postStreamEnd(streamId),
    postStreamError: (streamId, error) => void fileDownloadActions!.postStreamError(streamId, error),
    clearCachedPreviewAttempt: (userId, fileId) => {
      const uid = String(userId || "").trim();
      const fid = String(fileId || "").trim();
      if (!uid || !fid) return;
      cachedPreviewsAttempted.delete(`${uid}:${fid}`);
    },
    clearPreviewPrefetchAttempt: (userId, fileId) => {
      const uid = String(userId || "").trim();
      const fid = String(fileId || "").trim();
      if (!uid || !fid) return;
      previewPrefetchAttempted.delete(`${uid}:${fid}`);
    },
    isUploadActive: (fileId) => fileUpload?.isUploadActive(fileId) ?? false,
    abortUploadByFileId: (fileId) => fileUpload?.abortUploadByFileId(fileId),
  });


  const chatSurfaceEventsFeature = createChatSurfaceEventsFeature({
    store,
    layout,
    getSuppressChatClickUntil: () => suppressChatClickUntil,
    getSuppressMsgSelectToggleClickUntil: () => suppressMsgSelectToggleClickUntil,
    ensureVideoMutedDefault,
    fileViewer,
    tryOpenFileViewerFromCache,
    setPendingFileViewer: (next) => {
      pendingFileViewer = next;
    },
    enqueueFileGet,
    getChatSelectionAnchorIdx: () => chatSelectionAnchorIdx,
    setChatSelectionAnchorIdx: (idx) => {
      chatSelectionAnchorIdx = idx;
    },
    isChatMessageSelectable,
    toggleChatSelection,
    addChatSelectionRange,
    setChatSelectionRangeValue,
    clearChatSelection,
    closeModal,
    openUserPage,
    isMobileLikeUi,
    openRightPanel,
    closeRightPanel,
    openGroupPage,
    openBoardPage,
    requestMoreHistory,
    retryHistoryForSelected: () => {
      const st = store.get();
      if (!st.selected) return;
      historyFeature?.forceRetrySelected(st.selected);
    },
    pinnedMessagesUiActions: {
      unpinActiveForSelected: () => pinnedMessagesUiFeature.unpinActiveForSelected(),
      jumpToActiveForSelected: () => pinnedMessagesUiFeature.jumpToActiveForSelected(),
      activatePrevForSelected: () => pinnedMessagesUiFeature.activatePrevForSelected(),
      activateNextForSelected: () => pinnedMessagesUiFeature.activateNextForSelected(),
    },
    openChatSearch,
    closeChatSearch,
    stepChatSearch,
    setChatSearchDate,
    setChatSearchFilter,
    toggleChatSearchResults,
    handleSearchResultClick: (btn) => chatSearchUiFeature.handleSearchResultClick(btn),
    jumpToBottom: () => chatJumpFeature.jumpToBottom(scheduleChatJumpVisibility),
    closeMobileSidebar,
    authRequestsActions: {
      acceptAuth: (peer) => authRequestsFeature.acceptAuth(peer),
      declineAuth: (peer) => authRequestsFeature.declineAuth(peer),
      cancelAuth: (peer) => authRequestsFeature.cancelAuth(peer),
    },
    groupBoardJoinActions: {
      acceptGroupInvite: (groupId) => groupBoardJoinFeature.acceptGroupInvite(groupId),
      declineGroupInvite: (groupId) => groupBoardJoinFeature.declineGroupInvite(groupId),
    },
    roomInviteResponsesActions: {
      acceptGroupJoin: (groupId, peer) => roomInviteResponsesFeature.acceptGroupJoin(groupId, peer),
      declineGroupJoin: (groupId, peer) => roomInviteResponsesFeature.declineGroupJoin(groupId, peer),
      joinBoardFromInvite: (boardId) => roomInviteResponsesFeature.joinBoardFromInvite(boardId),
      declineBoardInvite: (boardId) => roomInviteResponsesFeature.declineBoardInvite(boardId),
    },
    send: (payload) => gateway.send(payload),
    showToast,
    fileOffersAccept: (fileId) => {
      fileOffers?.accept(fileId);
    },
    beginFileDownload: (fileId) => {
      void fileDownloadActions?.beginDownload(fileId);
    },
    forwardViewerSelectionActions: {
      handleChatSelectionForward: () => forwardViewerSelectionActionsFeature.handleChatSelectionForward(),
      handleChatSelectionCopy: () => forwardViewerSelectionActionsFeature.handleChatSelectionCopy(),
      handleChatSelectionDownload: () => forwardViewerSelectionActionsFeature.handleChatSelectionDownload(),
      handleChatSelectionSendNow: () => forwardViewerSelectionActionsFeature.handleChatSelectionSendNow(),
      handleChatSelectionDelete: () => forwardViewerSelectionActionsFeature.handleChatSelectionDelete(),
      handleChatSelectionPin: () => forwardViewerSelectionActionsFeature.handleChatSelectionPin(),
    },
    coarsePointerMq,
    anyFinePointerMq,
    buildHelperDraft,
    scheduleFocusComposer,
    markUserInput: () => {
      lastUserInputAt = Date.now();
    },
    setChatSearchQuery,
    openEmojiPopoverForReaction: (target) => {
      emojiPopoverFeature?.openForReaction(target);
    },
  });
  chatSurfaceEventsFeature.install();

  createPwaInstallPromptFeature({
    showToast,
    setPage,
  }).installEventListeners();

  function syncNavOverlay() {
    sidebarOverlay?.syncNavOverlay();
  }

  function isMobileSidebarOpen(): boolean {
    return Boolean(sidebarOverlay?.isMobileSidebarOpen());
  }

  function isFloatingSidebarOpen(): boolean {
    return Boolean(sidebarOverlay?.isFloatingSidebarOpen());
  }

  function setMobileSidebarOpen(open: boolean, opts?: { suppressStickBottomRestore?: boolean }) {
    sidebarOverlay?.setMobileSidebarOpen(open, opts);
  }

  function setFloatingSidebarOpen(open: boolean, opts?: { suppressStickBottomRestore?: boolean }) {
    sidebarOverlay?.setFloatingSidebarOpen(open, opts);
  }

  function closeMobileSidebar(opts?: { suppressStickBottomRestore?: boolean }) {
    sidebarOverlay?.closeMobileSidebar(opts);
  }

  function setMobileSidebarTab(tab: MobileSidebarTab) {
    sidebarOverlay?.setMobileSidebarTab(tab);
  }

  function startCall(mode: "audio" | "video") {
    if (!callsFeature) {
      showToast("Подождите…", { kind: "info", timeoutMs: 3000 });
      return;
    }
    callsFeature.startCall(mode);
  }

  createTopbarActionsFeature({
    store,
    overlay: layout.overlay,
    headerLeft: layout.headerLeft,
    headerRight: layout.headerRight,
    closeModal,
    onSetPageMain: () => setPage("main"),
    onOpenChatSearch: openChatSearch,
    onCloseChatSearch: closeChatSearch,
    onLogout: logout,
    onAuthOpen: () =>
      store.set((prev) => ({
        ...prev,
        authMode: prev.authRememberedId ? "login" : "register",
        modal: { kind: "auth" },
      })),
    onClearSelectedTarget: clearSelectedTarget,
    onToggleSidebar: () => {
      if (mobileSidebarMq.matches) {
        setMobileSidebarOpen(!isMobileSidebarOpen());
        return;
      }
      if (floatingSidebarMq.matches) {
        setFloatingSidebarOpen(!isFloatingSidebarOpen());
      }
    },
    onStartCall: startCall,
    onOpenChatTopbarMenu: (anchor) => {
      const sel = store.get().selected;
      if (!sel) return;
      const rect = anchor.getBoundingClientRect();
      const x = Math.round(rect.left + rect.width / 2);
      const y = Math.round(rect.bottom - 2);
      contextMenuFeature?.openContextMenu({ kind: sel.kind, id: sel.id }, x, y);
    },
  }).installEventListeners();

  const themeSkinActionsFeature = createThemeSkinActionsFeature({ store });
  const { initSkins, setTheme, setSkin } = themeSkinActionsFeature;

  const { gateway } = createGatewayClientFeature({
    store,
    getGatewayUrl,
    handleSearchResultMessage: (msg) => membersChipsFeature?.handleSearchResultMessage(msg) ?? false,
    handleHistoryResultMessage: (msg) => {
      historyFeature?.handleHistoryResultMessage(msg);
    },
    clearPendingHistoryRequests,
    handleCallsMessage: (msg) => callsFeature?.handleMessage(msg) ?? false,
    handleFileUploadMessage: (msg) => fileUpload?.handleMessage(msg) ?? false,
    handleFileMessage,
    dispatchServerMessage: (msg, gw) => handleServerMessage(msg, store.get(), gw, (p) => store.set(p)),
    scheduleSaveOutbox: () => scheduleSaveOutbox(store),
    onAuthed: () => {
      const st = store.get();
      if (st.selected) requestHistory(st.selected, { force: true, deltaLimit: 2000, prefetchBefore: true });
      outboxFeature?.drainOutbox();
    },
    onDisconnected: () => {
      authFeature?.resetAutoAuthAttempt();
      historyFeature?.onDisconnect();
    },
    maybeAutoAuthOnConnected: () => authFeature?.maybeAutoAuthOnConnected(),
  });

  authFeature = createAuthFeature({
    store,
    send: (payload) => gateway.send(payload),
  });

  const resetPreviewWarmup = () => {
    previewAutoFetchFeature.resetPreviewWarmup();
  };

  const resetLoadedForUser = () => {
    userLocalStateHydrationFeature?.resetLoadedForUser();
  };

  const resetInput = () => {
    try {
      layout.input.value = "";
      autosizeInput(layout.input);
    } catch {
      // ignore
    }
  };

  const reconnectGateway = () => {
    // Сбрасываем серверную авторизацию через переподключение.
    gateway.close();
    // Важно: после manual-close шлюз не делает авто-reconnect, поэтому сразу подключаемся заново.
    // Иначе пользователю приходится делать ручной refresh, чтобы снова войти.
    gateway.connect();
  };

  logoutFeature = createLogoutFeature({
    store,
    send: (payload) => gateway.send(payload),
    clearToast,
    resetAutoAuthAttempt: () => authFeature?.resetAutoAuthAttempt(),
    onHistoryLogout: () => historyFeature?.onLogout(),
    onPwaPushLogout: () => pwaPushFeature?.onLogout(),
    resetFileGet: () => fileGet?.reset(),
    resetFileDownloadActions: () => fileDownloadActions?.reset(),
    resetPreviewWarmup,
    resetLoadedForUser,
    clearBoardScheduleTimer,
    resetInput,
    reconnectGateway,
    lastReadSentAt,
    cachedPreviewsAttempted,
    cachedThumbsAttempted,
    previewPrefetchAttempted,
  });

  avatarFeature = createAvatarFeature({
    store,
    send: (payload) => gateway.send(payload),
  });

  outboxFeature = createOutboxFeature({
    store,
    send: (payload) => gateway.send(payload),
  });

  membersChipsFeature = createMembersChipsFeature({
    store,
    chatHost: layout.chat,
    sendSearch: (query) => gateway.send({ type: "search", query }),
  });
  membersChipsFeature.installEventListeners();

  callsFeature = createCallsFeature({
    store,
    send: (payload) => gateway.send(payload),
    showToast,
    tabNotifier,
    formatTargetLabel: formatSearchHistoryTargetLabel,
    formatSenderLabel: formatSearchHistorySenderLabel,
  });

  fileUpload = createFileUploadFeature({
    store,
    send: (payload) => gateway.send(payload),
    fileUploadMaxConcurrency: FILE_UPLOAD_MAX_CONCURRENCY,
    isFileHttpDisabled,
    disableFileHttp,
    nextTransferId,
    markChatAutoScroll,
    updateTransferByLocalId,
    updateTransferByFileId,
    updateConversationFileMessage,
    removeConversationFileMessage,
    onFileIdResolved: (fileId, file) => {
      try {
        maybeSetLocalOutgoingVideoPoster(fileId, file);
      } catch {
        // ignore
      }
      try {
        const st = store.get();
        if (st.selfId && autoDownloadCachePolicyFeature.shouldCacheFile(file.name || "файл", file.type || null, file.size || 0)) {
          void putCachedFileBlob(st.selfId, fileId, file, {
            name: file.name || "файл",
            mime: file.type || null,
            size: file.size || 0,
          });
          void autoDownloadCachePolicyFeature.enforceFileCachePolicy(st.selfId, { force: true });
          cachedPreviewsAttempted.delete(`${st.selfId}:${fileId}`);
        }
      } catch {
        // ignore
      }
    },
  });

  fileSendModalFeature = createFileSendModalFeature({
    store,
    input: layout.input,
    autosizeInput,
    sendFile: (file, target, caption) => fileUpload?.sendFile(file, target, caption),
  });

  contextMenuFeature = createContextMenuFeature({
    store,
    markUserActivity,
    isChatMessageSelectable,
    getSelectedMessageText: (selKey, idx) =>
      msgContextSelection && msgContextSelection.key === selKey && msgContextSelection.idx === idx ? msgContextSelection.text : "",
  });

  const pageNavigationFeature = createPageNavigationFeature({
    store,
    footer: layout.footer,
    mobileSidebarMq,
    floatingSidebarMq,
    resetGroupCreateMembers: () => membersChipsFeature?.resetCreateMembers("group_create"),
    resetBoardCreateMembers: () => membersChipsFeature?.resetCreateMembers("board_create"),
    closeEmojiPopover: () => emojiPopoverFeature?.close(),
    closeMobileSidebar: () => closeMobileSidebar(),
    setMobileSidebarOpen,
    setFloatingSidebarOpen,
    send: (payload) => gateway.send(payload),
  });
  pageNavigationFeature.installFooterNav();

  function setPage(page: PageKind) {
    pageNavigationFeature.setPage(page);
  }

  function openUserPage(id: string) {
    pageNavigationFeature.openUserPage(id);
  }

  function openGroupPage(id: string) {
    pageNavigationFeature.openGroupPage(id);
  }

  function openBoardPage(id: string) {
    pageNavigationFeature.openBoardPage(id);
  }

  function openRightPanel(target: TargetRef) {
    pageNavigationFeature.openRightPanel(target);
  }

  function closeRightPanel() {
    pageNavigationFeature.closeRightPanel();
  }

  function requestHistory(t: TargetRef, opts?: { force?: boolean; deltaLimit?: number; prefetchBefore?: boolean }) {
    historyFeature?.requestHistory(t, opts);
  }

  function enqueueHistoryPreview(t: TargetRef) {
    historyFeature?.enqueueHistoryPreview(t);
  }

  installPreviewOutboxWatchersFeature({
    store,
    drainFileGetQueue,
    enqueueHistoryPreview,
    drainOutbox: () => outboxFeature?.drainOutbox(),
    scheduleSavePinnedMessages: () => scheduleSavePinnedMessages(store),
  });

  function requestMoreHistory() {
    historyFeature?.requestMoreHistory();
  }

  function scheduleHistoryWarmup() {
    historyFeature?.scheduleWarmup();
  }

  function clearPendingHistoryRequests() {
    historyFeature?.clearPendingRequests();
  }

  const readReceiptsFeature = createReadReceiptsFeature({
    store,
    send: (payload) => gateway.send(payload),
    lastReadSentAt,
    lastReadSavedAt,
  });

  function maybeSendMessageRead(peerId: string, upToId?: number | null) {
    readReceiptsFeature.maybeSendMessageRead(peerId, upToId);
  }

  function maybeSendRoomRead(roomId: string, upToId: number) {
    readReceiptsFeature.maybeSendRoomRead(roomId, upToId);
  }

  const chatTargetSelectionFeature = createChatTargetSelectionFeature({
    store,
    input: layout.input,
    coarsePointerMq,
    anyFinePointerMq,
    hoverMq,
    mobileSidebarMq,
    floatingSidebarMq,
    closeEmojiPopover: () => emojiPopoverFeature?.close(),
    closeMobileSidebar,
    setMobileSidebarOpen,
    setFloatingSidebarOpen,
    autosizeInput,
    scheduleBoardEditorPreview,
    scheduleFocusComposer,
    markChatAutoScroll,
    applyConversationLimits,
    requestHistory,
    maybeSendMessageRead,
    scheduleSaveDrafts: () => scheduleSaveDrafts(store),
    saveLastActiveTarget,
  });

  function selectTarget(t: TargetRef) {
    chatTargetSelectionFeature.selectTarget(t);
  }

  function clearSelectedTarget() {
    chatTargetSelectionFeature.clearSelectedTarget();
  }

  function scrollToChatMsgIdx(idx: number) {
    chatJumpFeature.scrollToChatMsgIdx(idx);
  }

  const chatJumpFeature = createChatJumpFeature({
    chatRoot: layout.chat,
    chatHost: layout.chatHost,
  });

  const pinnedMessagesUiFeature = createPinnedMessagesUiFeature({
    store,
    chatRoot: layout.chat,
    persistPinnedMessages: savePinnedMessagesForUser,
  });

  function jumpToChatMsgIdx(idx: number) {
    chatJumpFeature.jumpToChatMsgIdx(idx);
  }

  const chatSearchUiFeature = createChatSearchUiFeature({
    store,
    chatRoot: layout.chat,
    showToast,
    scheduleFocusComposer,
    jumpToChatMsgIdx,
    scrollToChatMsgIdx,
    ensureIndexVisible: (key, total, idx, searchActive) =>
      virtualHistoryFeature?.ensureIndexVisible(key, total, idx, searchActive),
    getSearchableMessages: searchableMessagesForSelected,
  });

  const openChatFromSearchFeature = createOpenChatFromSearchFeature({
    store,
    selectTarget,
    scrollToChatMsgIdx,
  });

  function openChatFromSearch(target: TargetRef, query: string, msgIdx?: number) {
    openChatFromSearchFeature.openChatFromSearch(target, query, msgIdx);
  }

  function setChatSearchDate(value: string) {
    chatSearchUiFeature.setChatSearchDate(value);
  }

  function closeChatSearch() {
    chatSearchUiFeature.closeChatSearch();
  }

  function openChatSearch() {
    chatSearchUiFeature.openChatSearch();
  }

  function setChatSearchQuery(query: string) {
    chatSearchUiFeature.setChatSearchQuery(query);
  }

  function setChatSearchFilter(next: ChatSearchFilter) {
    chatSearchUiFeature.setChatSearchFilter(next);
  }

  function toggleChatSearchResults(force?: boolean) {
    chatSearchUiFeature.toggleChatSearchResults(force);
  }

  function setChatSearchPos(pos: number) {
    chatSearchUiFeature.setChatSearchPos(pos);
  }

  function stepChatSearch(dir: 1 | -1) {
    chatSearchUiFeature.stepChatSearch(dir);
  }

  function focusChatSearch(selectAll = false) {
    chatSearchUiFeature.focusChatSearch(selectAll);
  }

  const actionModalRoutingFeature = createActionModalRoutingFeature({
    store,
    closeMobileSidebar: () => closeMobileSidebar(),
    setPage,
    selectTarget,
    scrollToChatMsgIdx,
  });

  const modalOpenersFeature = createModalOpenersFeature({
    store,
    closeMobileSidebar: () => closeMobileSidebar(),
    resetCreateMembers: (scope) => {
      membersChipsFeature?.resetCreateMembers(scope);
    },
  });

  const roomCreateSubmitFeature = createRoomCreateSubmitFeature({
    store,
    send: (payload) => gateway.send(payload),
    roomInfoMax: ROOM_INFO_MAX,
    getMembersChipsFeature: () => membersChipsFeature,
  });

  const roomMembersSubmitFeature = createRoomMembersSubmitFeature({
    store,
    send: (payload) => gateway.send(payload),
    getMembersChipsFeature: () => membersChipsFeature,
  });

  const roomInfoSubmitFeature = createRoomInfoSubmitFeature({
    store,
    send: (payload) => gateway.send(payload),
    roomInfoMax: ROOM_INFO_MAX,
  });

  const modalSubmitFeature = createModalSubmitFeature({
    store,
    send: (payload) => gateway.send(payload),
  });

  const authRequestsFeature = createAuthRequestsFeature({
    store,
    send: (payload) => gateway.send(payload),
  });

  const groupBoardJoinFeature = createGroupBoardJoinFeature({
    store,
    send: (payload) => gateway.send(payload),
  });

  const roomInviteResponsesFeature = createRoomInviteResponsesFeature({
    store,
    send: (payload) => gateway.send(payload),
  });

  const scheduleSubmitFeature = createScheduleSubmitFeature({
    store,
    closeModal,
    sendChat,
    showToast,
    scheduleSaveOutbox: () => scheduleSaveOutbox(store),
    drainOutbox: () => outboxFeature?.drainOutbox(),
  });

  function normalizeChatSearchFilter(filter: ChatSearchFilter, counts: ReturnType<typeof createChatSearchCounts>): ChatSearchFilter {
    if (filter === "all") return "all";
    return counts[filter] > 0 ? filter : "all";
  }

  function sameChatSearchCounts(a: ReturnType<typeof createChatSearchCounts>, b: ReturnType<typeof createChatSearchCounts>): boolean {
    return a.all === b.all && a.media === b.media && a.files === b.files && a.links === b.links && a.audio === b.audio;
  }

  function sameNumberArray(a: number[], b: number[]): boolean {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  function openActionModal(payload: ActionModalPayload) {
    actionModalRoutingFeature.openActionModal(payload);
  }

  function openGroupCreateModal() {
    modalOpenersFeature.openGroupCreateModal();
  }

  function openBoardCreateModal() {
    modalOpenersFeature.openBoardCreateModal();
  }

  function openMembersAddModal(targetKind: "group" | "board", targetId: string) {
    modalOpenersFeature.openMembersAddModal(targetKind, targetId);
  }

  function openMembersRemoveModal(targetKind: "group" | "board", targetId: string) {
    modalOpenersFeature.openMembersRemoveModal(targetKind, targetId);
  }

  function openRenameModal(targetKind: "group" | "board", targetId: string) {
    modalOpenersFeature.openRenameModal(targetKind, targetId);
  }

  function openConfirmModal(payload: {
    title: string;
    message: string;
    action: ConfirmAction;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  }) {
    modalOpenersFeature.openConfirmModal(payload);
  }

  function createGroup() {
    roomCreateSubmitFeature.createGroup();
  }

  function createBoard() {
    roomCreateSubmitFeature.createBoard();
  }

  function membersAddSubmit() {
    roomMembersSubmitFeature.membersAddSubmit();
  }

  function membersRemoveSubmit() {
    roomMembersSubmitFeature.membersRemoveSubmit();
  }

  function renameSubmit() {
    roomMembersSubmitFeature.renameSubmit();
  }

  function sendScheduleSubmit() {
    scheduleSubmitFeature.sendScheduleSubmit();
  }

  function sendScheduleWhenOnlineSubmit() {
    scheduleSubmitFeature.sendScheduleWhenOnlineSubmit();
  }

  function nextTransferId() {
    transferSeq += 1;
    return `ft-${Date.now()}-${transferSeq}`;
  }

  window.addEventListener(
    "storage",
    (e) => {
      autoDownloadCachePolicyFeature.syncAutoDownloadPrefsFromStorageKey(e.key);
    },
    { passive: true }
  );

  function convoSig(msgs: any[]): string {
    const last = msgs && msgs.length ? msgs[msgs.length - 1] : null;
    const lastKey = last ? String((last.id ?? last.ts ?? "") as any) : "";
    return `${msgs?.length || 0}:${lastKey}`;
  }

  function updateTransferByLocalId(localId: string, apply: (entry: FileTransferEntry) => FileTransferEntry) {
    fileTransferStateFeature.updateTransferByLocalId(localId, apply);
  }

  function updateTransferByFileId(fileId: string, apply: (entry: FileTransferEntry) => FileTransferEntry) {
    fileTransferStateFeature.updateTransferByFileId(fileId, apply);
  }

  function updateConversationFileMessage(key: string, localId: string, apply: (msg: any) => any) {
    fileTransferStateFeature.updateConversationFileMessage(key, localId, apply);
  }

  function removeConversationFileMessage(key: string, localId: string) {
    fileTransferStateFeature.removeConversationFileMessage(key, localId);
  }

  function handleFileMessage(msg: any): boolean {
    if (fileOffers?.handleMessage(msg)) return true;
    return fileDownload?.handleMessage(msg) ?? false;
  }

  function logout() {
    logoutFeature?.logout();
  }

  function cancelEditing() {
    const st = store.get();
    const editing = st.editing;
    if (!editing) return;
    const selKey = st.selected ? conversationKey(st.selected) : "";
    const restore = editing.key && editing.key === selKey ? editing.prevDraft || "" : "";
    store.set((prev) => ({ ...prev, editing: null, input: restore }));
    try {
      layout.input.value = restore;
      autosizeInput(layout.input);
      layout.input.focus();
    } catch {
      // ignore
    }
    scheduleSaveDrafts(store);
  }

  function clearComposerHelper() {
    composerHelperDraftFeature.clearComposerHelper();
  }

  function buildHelperDraft(st: AppState, key: string, msg: ChatMessage): MessageHelperDraft | null {
    return composerHelperDraftFeature.buildHelperDraft(st, key, msg);
  }

  function helperDraftToRef(draft: MessageHelperDraft | null): ChatMessage["reply"] {
    return composerHelperDraftFeature.helperDraftToRef(draft);
  }

  function beginEditingMessage(key: string, msgId: number, text: string) {
    const k = String(key || "").trim();
    const id = Number.isFinite(Number(msgId)) ? Math.trunc(Number(msgId)) : 0;
    if (!k || id <= 0) return;
    clearComposerHelper();
    const body = String(text ?? "");
    const prevDraft = layout.input.value || "";
    store.set((prev) => ({ ...prev, editing: { key: k, id, prevDraft }, input: body }));
    try {
      layout.input.value = body;
      autosizeInput(layout.input);
      layout.input.focus();
      const pos = layout.input.value.length;
      layout.input.selectionStart = pos;
      layout.input.selectionEnd = pos;
    } catch {
      // ignore
    }
  }

  function sendChat(opts?: SendChatOpts) {
    sendChatFeature?.sendChat(opts);
  }

  sendChatFeature = createSendChatFeature({
    store,
    input: layout.input,
    appMsgMaxLen: APP_MSG_MAX_LEN,
    send: (payload) => gateway.send(payload),
    autosizeInput,
    scheduleBoardEditorPreview,
    markChatAutoScroll,
    helperDraftToRef,
    scheduleSaveOutbox: () => scheduleSaveOutbox(store),
    scheduleSaveDrafts: () => scheduleSaveDrafts(store),
    drainOutbox: () => {
      outboxFeature?.drainOutbox();
    },
  });

  function openBoardPostModal(boardId: string) {
    boardPostScheduleFeature?.openBoardPostModal(boardId);
  }

  function publishBoardPost(text: string) {
    boardPostScheduleFeature?.publishBoardPost(text);
  }

  function clearBoardScheduleTimer() {
    boardPostScheduleFeature?.clearBoardScheduleTimer();
  }

  function armBoardScheduleTimer() {
    boardPostScheduleFeature?.armBoardScheduleTimer();
  }

  boardPostScheduleFeature = createBoardPostScheduleFeature({
    store,
    appMsgMaxLen: APP_MSG_MAX_LEN,
    send: (payload) => gateway.send(payload),
    markUserInput: () => {
      lastUserInputAt = Date.now();
    },
    markChatAutoScroll,
    scheduleSaveOutbox: () => scheduleSaveOutbox(store),
    showToast,
    saveBoardScheduleForUser,
  });

  emojiPopoverFeature = createEmojiPopoverFeature({
    store,
    inputWrap: layout.inputWrap,
    input: layout.input,
    emojiButton: layout.emojiBtn,
    send: (payload: any) => gateway.send(payload),
  });
  emojiPopoverFeature.installEventListeners();

  boardEditorPreviewSyncFeature = createBoardEditorPreviewSyncFeature({
    store,
    input: layout.input,
    previewBody: layout.boardEditorPreviewBody,
    renderBoardPost,
  });

  const composerInputStateFeature = createComposerInputStateFeature({
    store,
    input: layout.input,
    inputWrap: layout.inputWrap,
    autosizeInput,
  });
  const iosComposerNavLockFeature = createIosComposerNavLockFeature({ input: layout.input });
  const composerViewportResizeAutosizeFeature = createComposerViewportResizeAutosizeFeature({
    input: layout.input,
    autosizeInput,
  });
  const composerInputKeydownFeature = createComposerInputKeydownFeature({
    store,
    input: layout.input,
    isEmojiPopoverOpen: () => Boolean(emojiPopoverFeature?.isOpen()),
    closeEmojiPopover: () => {
      emojiPopoverFeature?.close();
    },
    sendChat,
    cancelEditing,
    clearComposerHelper,
    closeBoardComposer: () => {
      store.set((prev) => (prev.boardComposerOpen ? { ...prev, boardComposerOpen: false } : prev));
    },
  });

  layout.input.addEventListener("input", () => {
    lastUserInputAt = Date.now();
    composerInputStateFeature.handleInputEvent();
    scheduleBoardEditorPreview();
  });
  layout.input.addEventListener("focus", () => {
    composerInputStateFeature.handleFocus();
    iosComposerNavLockFeature.applyLock();
  });
  layout.input.addEventListener("blur", () => {
    composerInputStateFeature.handleBlur();
    iosComposerNavLockFeature.restoreLock();
  });

  layout.boardScheduleInput.addEventListener("input", () => store.set((prev) => prev));
  layout.boardScheduleInput.addEventListener("change", () => store.set((prev) => prev));

  composerViewportResizeAutosizeFeature.bind();
  composerInputKeydownFeature.bind();

  layout.boardPublishBtn.addEventListener("click", () => sendChat());

  const composerHelperMenuFeature = createComposerHelperMenuFeature({
    store,
    markUserActivity,
    resolveComposerHelperDraft: (st: AppState) => composerHelperDraftFeature.resolveComposerHelperDraft(st),
  });

  const composerSendMenuActionsFeature = createComposerSendMenuActionsFeature({ composerSendMenuFeature });
  const sendButtonMenuGestureFeature = createSendButtonMenuGestureFeature({
    store,
    openSendMenu: composerSendMenuActionsFeature.openSendMenu,
  });

  const forwardViewerSelectionActionsFeature = createForwardViewerSelectionActionsFeature({
    forwardActions: forwardActionsFeature,
    fileViewerActions: fileViewerActionsFeature,
    chatSelectionCopyDownload: chatSelectionCopyDownloadFeature,
    chatSelectionSendDelete: chatSelectionSendDeleteFeature,
    chatSelectionPin: chatSelectionPinFeature,
  });

  const composerInputActionsFeature = createComposerInputActionsFeature({
    cancelEditing,
    openComposerHelperMenu: composerHelperMenuFeature.openComposerHelperMenu,
    clearComposerHelper,
  });
  const composerFileInputFeature = createComposerFileInputFeature({
    store,
    input: layout.input,
    inputWrap: layout.inputWrap,
    openFileSendModal: (files: File[]) => {
      const st = store.get();
      if (!st.selected) return;
      fileSendModalFeature?.openFileSendModal(files, st.selected);
    },
  });
  const composerAttachButtonFeature = createComposerAttachButtonFeature({
    store,
    attachBtn: layout.attachBtn,
    openFileSendModal: (files: File[], target: TargetRef) => {
      fileSendModalFeature?.openFileSendModal(files, target);
    },
  });

  sendButtonMenuGestureFeature.bind(layout.sendBtn);
  composerFileInputFeature.bind();
  composerAttachButtonFeature.bind();
  layout.inputWrap.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;

    const sendBtn = target?.closest("button[data-action='composer-send']") as HTMLButtonElement | null;
    if (sendBtn) {
      if (sendButtonMenuGestureFeature.consumeSuppressedSendClick(e)) return;
      e.preventDefault();
      if (!sendBtn.disabled) sendChat();
      return;
    }

    if (composerInputActionsFeature.handleComposerInputWrapClick(target, e)) return;

    if (boardEditorToggleInputActionFeature.handleBoardEditorToggleInputWrapClick(target, e)) return;

    if (boardScheduleInputActionsFeature.handleBoardScheduleInputWrapClick(target, e)) return;

    if (boardToolInputActionsFeature.handleBoardToolInputWrapClick(target, e)) return;
  });

  const modalCloseFeature = createModalCloseFeature({
    store,
    clearSendMenuDraft: () => composerSendMenuFeature.clearSendMenuDraft(),
    closeCallModal: () => {
      callsFeature?.closeCallModal();
    },
    closeFileSendModalIfFileSend: () => fileSendModalFeature?.closeModalIfFileSend() ?? false,
    clearMembersAddLookups: () => {
      membersChipsFeature?.clearMembersAddLookups();
    },
  });

  function closeModal() {
    modalCloseFeature.closeModal();
  }

  const composerInputSyncFeature = createComposerInputSyncFeature({
    input: layout.input,
    setPendingInputValue: composerInputStateFeature.setPendingInputValue,
    scheduleAutosize: composerInputStateFeature.scheduleAutosize,
    scheduleBoardEditorPreview,
    updateComposerTypingUi: composerInputStateFeature.updateComposerTypingUi,
    commitInputUpdate: composerInputStateFeature.commitInputUpdate,
    applyInputFallback: (nextInput) => {
      store.set({ input: nextInput });
      scheduleSaveDrafts(store);
    },
  });

  const contextMenuAdapterActionsFeature = createContextMenuAdapterActionsFeature({
    beginFileDownload: (fileId: string) => {
      void fileDownloadActions?.beginDownload(fileId);
    },
    openEmojiPopoverForReaction: (target) => {
      emojiPopoverFeature?.openForReaction(target);
    },
    acceptAuth: (peer: string) => authRequestsFeature.acceptAuth(peer),
    declineAuth: (peer: string) => authRequestsFeature.declineAuth(peer),
    cancelAuth: (peer: string) => authRequestsFeature.cancelAuth(peer),
    pickAvatarFor: (kind: any, id: string) => avatarFeature?.pickAvatarFor(kind, id),
    removeAvatar: (kind: any, id: string) => avatarFeature?.removeAvatar(kind, id),
    drainOutbox: () => outboxFeature?.drainOutbox(),
    ensureVirtualHistoryIndexVisible: (key: string, convLen: number, idx: number, searchActive: boolean) =>
      virtualHistoryFeature?.ensureIndexVisible(key, convLen, idx, searchActive),
  });

  contextMenuActionsFeature = createContextMenuActionsFeature({
    store,
    send: (payload: any) => gateway.send(payload),
    closeModal,
    clearMsgContextSelection: () => (msgContextSelection = null),
    getMsgContextSelection: () => msgContextSelection,
    showToast,
    clearComposerHelper,
    resolveComposerHelperDraft: (st: AppState) => composerHelperDraftFeature.resolveComposerHelperDraft(st),
    scheduleFocusComposer,
    getComposerText: composerInputSyncFeature.getComposerText,
    applyComposerInput: composerInputSyncFeature.applyComposerInput,
    getSendMenuDraft: () => composerSendMenuFeature.getSendMenuDraft(),
    buildSendMenuDraftFromComposer: composerSendMenuActionsFeature.buildSendMenuDraftFromComposer,
    sendChat,
    openSendScheduleModalWithDraft: composerSendMenuActionsFeature.openSendScheduleModalWithDraft,
    setPage,
    openGroupCreateModal,
    openBoardCreateModal,
    logout,
    openUserPage,
    openGroupPage,
    openBoardPage,
    selectTarget,
    isChatMessageSelectable,
    toggleChatSelection,
    setChatSelectionAnchorIdx: (idx: number | null) => (chatSelectionAnchorIdx = idx),
    closeMobileSidebar,
    requestFreshHttpDownloadUrl,
    beginFileDownload: contextMenuAdapterActionsFeature.beginFileDownload,
    openChatSearch,
    setChatSearchQuery,
    openEmojiPopoverForReaction: contextMenuAdapterActionsFeature.openEmojiPopoverForReaction,
    jumpToChatMsgIdx,
    buildHelperDraft,
    openForwardModal: forwardViewerSelectionActionsFeature.openForwardModal,
    beginEditingMessage,
    openMembersAddModal,
    openMembersRemoveModal,
    openRenameModal,
    openConfirmModal,
    maybeSendMessageRead,
    acceptAuth: contextMenuAdapterActionsFeature.acceptAuth,
    declineAuth: contextMenuAdapterActionsFeature.declineAuth,
    cancelAuth: contextMenuAdapterActionsFeature.cancelAuth,
    copyText,
    pickAvatarFor: contextMenuAdapterActionsFeature.pickAvatarFor,
    removeAvatar: contextMenuAdapterActionsFeature.removeAvatar,
    drainOutbox: contextMenuAdapterActionsFeature.drainOutbox,
    ensureVirtualHistoryIndexVisible: contextMenuAdapterActionsFeature.ensureVirtualHistoryIndexVisible,
  });


  const late = installLateWiring({
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
    setChatSelectionAnchorIdx: (idx: number | null) => {
      chatSelectionAnchorIdx = idx;
    },
    setSuppressMsgSelectToggleClickUntil: (until: number) => {
      suppressMsgSelectToggleClickUntil = until;
    },
    setSuppressChatClickUntil: (until: number) => {
      suppressChatClickUntil = until;
    },
    getSuppressChatClickUntil: () => suppressChatClickUntil,
    setMsgContextSelection: (selection: { key: string; idx: number; text: string } | null) => {
      msgContextSelection = selection;
    },
    getLastUserInputAt: () => lastUserInputAt,
    markUserInput: markUserActivity,
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
    callAccept: (callId: string) => callsFeature?.acceptCall(callId),
    callDecline: (callId: string) => callsFeature?.declineCall(callId),
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
    openForwardModal: forwardViewerSelectionActionsFeature.openForwardModal,
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
  });
  userLocalStateHydrationFeature = late.userLocalStateHydrationFeature;
  chatSearchSyncFeature = late.chatSearchSyncFeature;
}
