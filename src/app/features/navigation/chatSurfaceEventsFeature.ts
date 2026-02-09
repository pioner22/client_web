import { conversationKey } from "../../../helpers/chat/conversationKey";
import { messageSelectionKey } from "../../../helpers/chat/chatSelection";
import { isVideoLikeFile } from "../../../helpers/files/isVideoLikeFile";
import type { ChatSearchFilter } from "../../../helpers/chat/chatSearch";
import type { Layout } from "../../../components/layout/types";
import type { Store } from "../../../stores/store";
import type { AppState, ChatMessage, MessageHelperDraft, TargetRef } from "../../../stores/types";
import type { FileViewerFeature, PendingFileViewer, FileViewerModalState } from "../files/fileViewerFeature";

export interface ChatSurfaceEventsFeatureDeps {
  store: Store<AppState>;
  layout: Pick<Layout, "chat" | "chatSelectionBar">;
  getSuppressChatClickUntil: () => number;
  getSuppressMsgSelectToggleClickUntil: () => number;
  ensureVideoMutedDefault: (video: HTMLVideoElement) => void;
  fileViewer: FileViewerFeature;
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
  setPendingFileViewer: (next: PendingFileViewer | null) => void;
  enqueueFileGet: (fileId: string, opts?: { priority?: "high" | "prefetch"; silent?: boolean }) => void;
  getChatSelectionAnchorIdx: () => number | null;
  setChatSelectionAnchorIdx: (idx: number | null) => void;
  isChatMessageSelectable: (msg: ChatMessage | null | undefined) => msg is ChatMessage;
  toggleChatSelection: (key: string, msg: ChatMessage) => void;
  addChatSelectionRange: (key: string, fromIdx: number, toIdx: number) => void;
  setChatSelectionRangeValue: (key: string, fromIdx: number, toIdx: number, value: boolean) => void;
  clearChatSelection: () => void;
  closeModal: () => void;
  openUserPage: (uid: string) => void;
  isMobileLikeUi: () => boolean;
  openRightPanel: (target: TargetRef) => void;
  closeRightPanel: () => void;
  openGroupPage: (id: string) => void;
  openBoardPage: (id: string) => void;
  requestMoreHistory: () => void;
  retryHistoryForSelected: () => void;
  pinnedMessagesUiActions: {
    unpinActiveForSelected: () => boolean;
    jumpToActiveForSelected: () => boolean;
    activatePrevForSelected: () => boolean;
    activateNextForSelected: () => boolean;
  };
  openChatSearch: () => void;
  closeChatSearch: () => void;
  stepChatSearch: (dir: 1 | -1) => void;
  setChatSearchDate: (value: string) => void;
  setChatSearchFilter: (filter: ChatSearchFilter) => void;
  toggleChatSearchResults: () => void;
  handleSearchResultClick: (btn: HTMLButtonElement) => boolean;
  jumpToBottom: () => void;
  closeMobileSidebar: () => void;
  authRequestsActions: {
    acceptAuth: (peer: string) => void;
    declineAuth: (peer: string) => void;
    cancelAuth: (peer: string) => void;
  };
  groupBoardJoinActions: {
    acceptGroupInvite: (groupId: string) => void;
    declineGroupInvite: (groupId: string) => void;
  };
  roomInviteResponsesActions: {
    acceptGroupJoin: (groupId: string, peer: string) => void;
    declineGroupJoin: (groupId: string, peer: string) => void;
    joinBoardFromInvite: (boardId: string) => void;
    declineBoardInvite: (boardId: string) => void;
  };
  send: (payload: any) => void;
  showToast: (message: string, opts?: any) => void;
  fileOffersAccept: (fileId: string) => void;
  beginFileDownload: (fileId: string) => void;
  forwardViewerSelectionActions: {
    handleChatSelectionForward: () => void;
    handleChatSelectionCopy: () => Promise<void>;
    handleChatSelectionDownload: () => Promise<void>;
    handleChatSelectionSendNow: () => void;
    handleChatSelectionDelete: () => void;
    handleChatSelectionPin: () => void;
  };
  coarsePointerMq: MediaQueryList;
  anyFinePointerMq: MediaQueryList;
  buildHelperDraft: (st: AppState, key: string, msg: ChatMessage) => MessageHelperDraft | null;
  scheduleFocusComposer: () => void;
  markUserInput: () => void;
  setChatSearchQuery: (value: string) => void;
  openEmojiPopoverForReaction: (target: { key: string; msgId: number }) => void;
}

export interface ChatSurfaceEventsFeature {
  install: () => void;
}

export function createChatSurfaceEventsFeature(deps: ChatSurfaceEventsFeatureDeps): ChatSurfaceEventsFeature {
  const {
    store,
    layout,
    getSuppressChatClickUntil,
    getSuppressMsgSelectToggleClickUntil,
    ensureVideoMutedDefault,
    fileViewer,
    tryOpenFileViewerFromCache,
    setPendingFileViewer,
    enqueueFileGet,
    getChatSelectionAnchorIdx,
    setChatSelectionAnchorIdx,
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
    retryHistoryForSelected,
    pinnedMessagesUiActions,
    openChatSearch,
    closeChatSearch,
    stepChatSearch,
    setChatSearchDate,
    setChatSearchFilter,
    toggleChatSearchResults,
    handleSearchResultClick,
    jumpToBottom,
    closeMobileSidebar,
    authRequestsActions,
    groupBoardJoinActions,
    roomInviteResponsesActions,
    send,
    showToast,
    fileOffersAccept,
    beginFileDownload,
    forwardViewerSelectionActions,
    coarsePointerMq,
    anyFinePointerMq,
    buildHelperDraft,
    scheduleFocusComposer,
    markUserInput,
    setChatSearchQuery,
    openEmojiPopoverForReaction,
  } = deps;

  const chatSelectionAnchor = {
    get: getChatSelectionAnchorIdx,
    set: setChatSelectionAnchorIdx,
  };

  const requireConnectedAndAuthed = (st: AppState): boolean => {
    if (st.conn !== "connected") {
      store.set({ status: "Нет соединения" });
      return false;
    }
    if (!st.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return false;
    }
    return true;
  };

  const buildFileViewerState = (params: {
    url: string;
    name: string;
    size: number;
    mime: string | null;
    caption: string | null;
    autoplay?: boolean;
    chatKey: string | null;
    msgIdx: number | null;
  }): FileViewerModalState => fileViewer.buildModalState(params);

  const install = () => {
    layout.chat.addEventListener("click", (e) => {
      const target = e.target as HTMLElement | null;

      if (Date.now() < getSuppressChatClickUntil()) {
        const row = target?.closest("[data-msg-idx]");
        if (row) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }

      const mediaToggle = target?.closest("[data-action='media-toggle']") as HTMLElement | null;
      if (mediaToggle) {
        const preview = mediaToggle.closest("button.chat-file-preview") as HTMLButtonElement | null;
        const video = preview?.querySelector("video.chat-file-video") as HTMLVideoElement | null;
        if (video) {
          e.preventDefault();
          e.stopPropagation();
          if (video.paused) {
            ensureVideoMutedDefault(video);
            if (preview) preview.setAttribute("data-video-state", "playing");
            void video
              .play()
              .then(() => {
                if (preview) preview.setAttribute("data-video-state", video.paused ? "paused" : "playing");
              })
              .catch(() => {
                if (preview) preview.setAttribute("data-video-state", "paused");
                try {
                  const idxRaw = String(preview?.getAttribute("data-msg-idx") || "").trim();
                  const msgIdx = idxRaw ? Number(idxRaw) : NaN;
                  const st = store.get();
                  const chatKey = st.selected ? conversationKey(st.selected) : "";
                  if (!chatKey || !Number.isFinite(msgIdx)) return;
                  const url = String(preview?.getAttribute("data-url") || "").trim() || null;
                  const fileId = String(preview?.getAttribute("data-file-id") || "").trim() || null;
                  const name = String(preview?.getAttribute("data-name") || "файл");
                  const size = Number(preview?.getAttribute("data-size") || 0) || 0;
                  const mimeRaw = preview?.getAttribute("data-mime");
                  const mime = mimeRaw ? String(mimeRaw) : null;
                  const captionRaw = preview?.getAttribute("data-caption");
                  const captionText = captionRaw ? String(captionRaw).trim() : "";
                  const caption = captionText || null;
                  void fileViewer.openFromMessageIndex(chatKey, Math.trunc(msgIdx), { url, name, size, mime, caption, fileId });
                } catch {
                  // ignore
                }
              });
          } else {
            video.pause();
            if (preview) preview.setAttribute("data-video-state", "paused");
          }
        }
        return;
      }

      const msgSelectBtn = target?.closest("button[data-action='msg-select-toggle']") as HTMLButtonElement | null;
      if (msgSelectBtn) {
        if (Date.now() < getSuppressMsgSelectToggleClickUntil()) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        const st = store.get();
        const key = st.selected ? conversationKey(st.selected) : "";
        if (!key) return;
        const idxRaw = String(msgSelectBtn.getAttribute("data-msg-idx") || "").trim();
        const idx = Number.isFinite(Number(idxRaw)) ? Math.trunc(Number(idxRaw)) : -1;
        const conv = key ? st.conversations[key] : null;
        const msg = conv && idx >= 0 && idx < conv.length ? conv[idx] : null;
        if (!msg) return;
        if (!isChatMessageSelectable(msg)) return;
        e.preventDefault();
        e.stopPropagation();
        const groupStartRaw = String(msgSelectBtn.getAttribute("data-msg-group-start") || "").trim();
        const groupEndRaw = String(msgSelectBtn.getAttribute("data-msg-group-end") || "").trim();
        if (groupStartRaw && groupEndRaw && conv) {
          const start = Number.isFinite(Number(groupStartRaw)) ? Math.trunc(Number(groupStartRaw)) : -1;
          const end = Number.isFinite(Number(groupEndRaw)) ? Math.trunc(Number(groupEndRaw)) : -1;
          if (start >= 0 && end >= 0) {
            const selection = st.chatSelection;
            const idSet = new Set(selection && selection.key === key ? selection.ids || [] : []);
            let selectedCount = 0;
            let selectableCount = 0;
            const boundedEnd = Math.min(Math.max(start, end), conv.length - 1);
            for (let i = Math.min(start, end); i <= boundedEnd; i += 1) {
              const m = conv[i];
              if (!isChatMessageSelectable(m)) continue;
              const selId = messageSelectionKey(m);
              if (!selId) continue;
              selectableCount += 1;
              if (idSet.has(selId)) selectedCount += 1;
            }
            const shouldSelectAll = selectedCount < selectableCount;
            setChatSelectionRangeValue(key, start, end, shouldSelectAll);
            chatSelectionAnchor.set(idx);
            return;
          }
        }
        const shift = "shiftKey" in e ? Boolean((e as MouseEvent).shiftKey) : false;
        const anchor = chatSelectionAnchor.get();
        if (shift && anchor !== null) addChatSelectionRange(key, anchor, idx);
        else toggleChatSelection(key, msg);
        chatSelectionAnchor.set(idx);
        return;
      }

      const stForSelection = store.get();
      const selectionKey = stForSelection.selected ? conversationKey(stForSelection.selected) : "";
      const selectionActive =
        Boolean(selectionKey) &&
        Boolean(stForSelection.chatSelection && stForSelection.chatSelection.key === selectionKey) &&
        Boolean(stForSelection.chatSelection?.ids?.length);
      if (selectionActive) {
        if (target?.closest("button, a, input, textarea, select, audio, video, [contenteditable='true']")) return;
        const row = target?.closest("[data-msg-idx]") as HTMLElement | null;
        if (row) {
          const idx = Math.trunc(Number(row.getAttribute("data-msg-idx") || ""));
          const conv = selectionKey ? stForSelection.conversations[selectionKey] : null;
          const groupStartRaw = String(row.getAttribute("data-msg-group-start") || "").trim();
          const groupEndRaw = String(row.getAttribute("data-msg-group-end") || "").trim();
          if (groupStartRaw && groupEndRaw && conv) {
            const start = Number.isFinite(Number(groupStartRaw)) ? Math.trunc(Number(groupStartRaw)) : -1;
            const end = Number.isFinite(Number(groupEndRaw)) ? Math.trunc(Number(groupEndRaw)) : -1;
            if (start >= 0 && end >= 0) {
              e.preventDefault();
              e.stopPropagation();
              const selection = stForSelection.chatSelection;
              const idSet = new Set(selection && selection.key === selectionKey ? selection.ids || [] : []);
              let selectedCount = 0;
              let selectableCount = 0;
              const boundedEnd = Math.min(Math.max(start, end), conv.length - 1);
              for (let i = Math.min(start, end); i <= boundedEnd; i += 1) {
                const m = conv[i];
                if (!isChatMessageSelectable(m)) continue;
                const selId = messageSelectionKey(m);
                if (!selId) continue;
                selectableCount += 1;
                if (idSet.has(selId)) selectedCount += 1;
              }
              const shouldSelectAll = selectedCount < selectableCount;
              setChatSelectionRangeValue(selectionKey, start, end, shouldSelectAll);
              chatSelectionAnchor.set(idx);
              return;
            }
          }
          const msg = conv && idx >= 0 && idx < conv.length ? conv[idx] : null;
          if (msg) {
            e.preventDefault();
            e.stopPropagation();
            const shift = "shiftKey" in e ? Boolean((e as MouseEvent).shiftKey) : false;
            const anchor = chatSelectionAnchor.get();
            if (shift && anchor !== null) addChatSelectionRange(selectionKey, anchor, idx);
            else toggleChatSelection(selectionKey, msg);
            chatSelectionAnchor.set(idx);
            return;
          }
        }
      }

      const modalReactSetBtn = (e.target as HTMLElement | null)?.closest(
        "button[data-action='modal-react-set'][data-emoji]"
      ) as HTMLButtonElement | null;
      if (modalReactSetBtn) {
        const st = store.get();
        const modal = st.modal;
        if (!modal || modal.kind !== "reactions") return;
        if (!requireConnectedAndAuthed(st)) return;
        const chatKey = String(modal.chatKey || "").trim();
        const msgId = typeof modal.msgId === "number" && Number.isFinite(modal.msgId) ? Math.trunc(modal.msgId) : 0;
        const emoji = String(modalReactSetBtn.getAttribute("data-emoji") || "").trim();
        if (!chatKey || !msgId || !emoji) return;
        const conv = st.conversations?.[chatKey] || [];
        const msg = conv.find((m) => typeof m?.id === "number" && Number.isFinite(m.id) && m.id === msgId) || null;
        const mine = typeof msg?.reactions?.mine === "string" ? msg.reactions.mine : null;
        const nextEmoji = mine === emoji ? null : emoji;
        e.preventDefault();
        send({ type: "reaction_set", id: msgId, emoji: nextEmoji });
        return;
      }

      const modalReactPickerBtn = (e.target as HTMLElement | null)?.closest(
        "button[data-action='modal-react-picker']"
      ) as HTMLButtonElement | null;
      if (modalReactPickerBtn) {
        const st = store.get();
        const modal = st.modal;
        if (!modal || modal.kind !== "reactions") return;
        if (!requireConnectedAndAuthed(st)) return;
        const chatKey = String(modal.chatKey || "").trim();
        const msgId = typeof modal.msgId === "number" && Number.isFinite(modal.msgId) ? Math.trunc(modal.msgId) : 0;
        if (!chatKey || !msgId) return;
        e.preventDefault();
        closeModal();
        openEmojiPopoverForReaction({ key: chatKey, msgId });
        return;
      }

      const reactAddBtn = (e.target as HTMLElement | null)?.closest("button[data-action='msg-react-add']") as HTMLButtonElement | null;
      if (reactAddBtn) {
        const st = store.get();
        if (!requireConnectedAndAuthed(st)) return;
        const row = target?.closest("[data-msg-idx]") as HTMLElement | null;
        const idx = row ? Math.trunc(Number(row.getAttribute("data-msg-idx") || "")) : -1;
        const key = st.selected ? conversationKey(st.selected) : "";
        const conv = key ? st.conversations[key] : null;
        const msg = conv && idx >= 0 && idx < conv.length ? conv[idx] : null;
        const msgId = msg && typeof msg.id === "number" && Number.isFinite(msg.id) ? msg.id : null;
        if (!key || !msg || msgId === null || msgId <= 0) return;
        e.preventDefault();
        openEmojiPopoverForReaction({ key, msgId });
        return;
      }

      const reactMoreBtn = (e.target as HTMLElement | null)?.closest("button[data-action='msg-react-more']") as HTMLButtonElement | null;
      if (reactMoreBtn) {
        const st = store.get();
        const row = target?.closest("[data-msg-idx]") as HTMLElement | null;
        const idx = row ? Math.trunc(Number(row.getAttribute("data-msg-idx") || "")) : -1;
        const key = st.selected ? conversationKey(st.selected) : "";
        const conv = key ? st.conversations[key] : null;
        const msg = conv && idx >= 0 && idx < conv.length ? conv[idx] : null;
        const msgId = msg && typeof msg.id === "number" && Number.isFinite(msg.id) ? msg.id : null;
        if (!key || !msg || msgId === null || msgId <= 0) return;
        e.preventDefault();
        store.set({ modal: { kind: "reactions", chatKey: key, msgId } });
        return;
      }

      const reactBtn = target?.closest("button[data-action='msg-react'][data-emoji]") as HTMLButtonElement | null;
      if (reactBtn) {
        const st = store.get();
        if (!requireConnectedAndAuthed(st)) return;
        const emoji = String(reactBtn.getAttribute("data-emoji") || "").trim();
        if (!emoji) return;
        const row = target?.closest("[data-msg-idx]") as HTMLElement | null;
        const idx = row ? Math.trunc(Number(row.getAttribute("data-msg-idx") || "")) : -1;
        const key = st.selected ? conversationKey(st.selected) : "";
        const conv = key ? st.conversations[key] : null;
        const msg = conv && idx >= 0 && idx < conv.length ? conv[idx] : null;
        const msgId = msg && typeof msg.id === "number" && Number.isFinite(msg.id) ? msg.id : null;
        if (!msg || msgId === null || msgId <= 0) return;
        const mine = typeof msg.reactions?.mine === "string" ? msg.reactions.mine : null;
        const nextEmoji = mine === emoji ? null : emoji;
        e.preventDefault();
        send({ type: "reaction_set", id: msgId, emoji: nextEmoji });
        return;
      }

      const userBtn = target?.closest("[data-action='user-open']") as HTMLElement | null;
      if (userBtn) {
        const uid = String(userBtn.getAttribute("data-user-id") || "").trim();
        if (uid) {
          e.preventDefault();
          openUserPage(uid);
        }
        return;
      }

      const chatProfileBtn = target?.closest("button[data-action='chat-profile-open']") as HTMLButtonElement | null;
      if (chatProfileBtn) {
        const st = store.get();
        if (!st.selected) return;
        e.preventDefault();
        const mobileUi = isMobileLikeUi();
        if (!mobileUi && st.page === "main") {
          const active = Boolean(st.rightPanel && st.rightPanel.kind === st.selected.kind && st.rightPanel.id === st.selected.id);
          if (active) closeRightPanel();
          else openRightPanel(st.selected);
        } else if (st.selected.kind === "dm") {
          openUserPage(st.selected.id);
        } else if (st.selected.kind === "group") {
          openGroupPage(st.selected.id);
        } else if (st.selected.kind === "board") {
          openBoardPage(st.selected.id);
        }
        return;
      }

      const historyMoreBtn = target?.closest("button[data-action='chat-history-more']") as HTMLButtonElement | null;
      if (historyMoreBtn) {
        e.preventDefault();
        requestMoreHistory();
        return;
      }

      const historyRetryBtn = target?.closest("button[data-action='chat-history-retry']") as HTMLButtonElement | null;
      if (historyRetryBtn) {
        e.preventDefault();
        retryHistoryForSelected();
        return;
      }

      const selectionCancelBtn = target?.closest("button[data-action='chat-selection-cancel']") as HTMLButtonElement | null;
      if (selectionCancelBtn) {
        e.preventDefault();
        clearChatSelection();
        return;
      }

      const pinnedCloseBtn = target?.closest("button[data-action='chat-pinned-unpin']") as HTMLButtonElement | null;
      if (pinnedCloseBtn) {
        if (pinnedMessagesUiActions.unpinActiveForSelected()) e.preventDefault();
        return;
      }

      const pinnedJumpBtn = target?.closest("button[data-action='chat-pinned-jump']") as HTMLButtonElement | null;
      if (pinnedJumpBtn) {
        if (pinnedMessagesUiActions.jumpToActiveForSelected()) e.preventDefault();
        return;
      }

      const pinnedPrevBtn = target?.closest("button[data-action='chat-pinned-prev']") as HTMLButtonElement | null;
      if (pinnedPrevBtn) {
        if (pinnedMessagesUiActions.activatePrevForSelected()) e.preventDefault();
        return;
      }

      const pinnedNextBtn = target?.closest("button[data-action='chat-pinned-next']") as HTMLButtonElement | null;
      if (pinnedNextBtn) {
        if (pinnedMessagesUiActions.activateNextForSelected()) e.preventDefault();
        return;
      }

      const searchOpenBtn = target?.closest("button[data-action='chat-search-open']") as HTMLButtonElement | null;
      if (searchOpenBtn) {
        e.preventDefault();
        openChatSearch();
        return;
      }
      const searchCloseBtn = target?.closest("button[data-action='chat-search-close']") as HTMLButtonElement | null;
      if (searchCloseBtn) {
        e.preventDefault();
        closeChatSearch();
        return;
      }
      const searchPrevBtn = target?.closest("button[data-action='chat-search-prev']") as HTMLButtonElement | null;
      if (searchPrevBtn) {
        e.preventDefault();
        stepChatSearch(-1);
        return;
      }
      const searchNextBtn = target?.closest("button[data-action='chat-search-next']") as HTMLButtonElement | null;
      if (searchNextBtn) {
        e.preventDefault();
        stepChatSearch(1);
        return;
      }
      const searchDateClearBtn = target?.closest("button[data-action='chat-search-date-clear']") as HTMLButtonElement | null;
      if (searchDateClearBtn) {
        e.preventDefault();
        setChatSearchDate("");
        return;
      }
      const searchFilterBtn = target?.closest("button[data-action='chat-search-filter']") as HTMLButtonElement | null;
      if (searchFilterBtn) {
        const filter = String(searchFilterBtn.getAttribute("data-filter") || "all") as ChatSearchFilter;
        e.preventDefault();
        setChatSearchFilter(filter);
        return;
      }
      const searchResultsToggle = target?.closest("[data-action='chat-search-results-toggle']") as HTMLElement | null;
      if (searchResultsToggle) {
        e.preventDefault();
        toggleChatSearchResults();
        return;
      }
      const searchResultBtn = target?.closest("[data-action='chat-search-result']") as HTMLButtonElement | null;
      if (searchResultBtn) {
        if (handleSearchResultClick(searchResultBtn)) e.preventDefault();
        return;
      }

      const jumpBtn = target?.closest("button[data-action='chat-jump-bottom']") as HTMLButtonElement | null;
      if (jumpBtn) {
        e.preventDefault();
        jumpToBottom();
        return;
      }

      const authAcceptBtn = target?.closest("button[data-action='auth-accept']") as HTMLButtonElement | null;
      if (authAcceptBtn) {
        const peer = String(authAcceptBtn.getAttribute("data-peer") || "").trim();
        if (!peer) return;
        e.preventDefault();
        closeMobileSidebar();
        authRequestsActions.acceptAuth(peer);
        return;
      }

      const authDeclineBtn = target?.closest("button[data-action='auth-decline']") as HTMLButtonElement | null;
      if (authDeclineBtn) {
        const peer = String(authDeclineBtn.getAttribute("data-peer") || "").trim();
        if (!peer) return;
        e.preventDefault();
        closeMobileSidebar();
        authRequestsActions.declineAuth(peer);
        return;
      }

      const authCancelBtn = target?.closest("button[data-action='auth-cancel']") as HTMLButtonElement | null;
      if (authCancelBtn) {
        const peer = String(authCancelBtn.getAttribute("data-peer") || "").trim();
        if (!peer) return;
        e.preventDefault();
        closeMobileSidebar();
        authRequestsActions.cancelAuth(peer);
        return;
      }

      const groupInviteAcceptBtn = target?.closest("button[data-action='group-invite-accept']") as HTMLButtonElement | null;
      if (groupInviteAcceptBtn) {
        const groupId = String(groupInviteAcceptBtn.getAttribute("data-group-id") || "").trim();
        if (!groupId) return;
        e.preventDefault();
        closeMobileSidebar();
        groupBoardJoinActions.acceptGroupInvite(groupId);
        return;
      }

      const groupInviteDeclineBtn = target?.closest("button[data-action='group-invite-decline']") as HTMLButtonElement | null;
      if (groupInviteDeclineBtn) {
        const groupId = String(groupInviteDeclineBtn.getAttribute("data-group-id") || "").trim();
        if (!groupId) return;
        e.preventDefault();
        closeMobileSidebar();
        groupBoardJoinActions.declineGroupInvite(groupId);
        return;
      }

      const groupInviteBlockBtn = target?.closest("button[data-action='group-invite-block']") as HTMLButtonElement | null;
      if (groupInviteBlockBtn) {
        const groupId = String(groupInviteBlockBtn.getAttribute("data-group-id") || "").trim();
        if (!groupId) return;
        const fromAttr = String(groupInviteBlockBtn.getAttribute("data-from") || "").trim();
        const from = fromAttr || String(store.get().pendingGroupInvites.find((x) => x.groupId === groupId)?.from || "").trim();
        e.preventDefault();
        closeMobileSidebar();
        if (from) {
          const st = store.get();
          if (st.conn === "connected" && st.authed) {
            send({ type: "block_set", peer: from, value: true });
            showToast(`Заблокировано: ${from}`, { kind: "warn" });
          } else {
            store.set({ status: "Нет соединения" });
          }
        }
        groupBoardJoinActions.declineGroupInvite(groupId);
        return;
      }

      const groupJoinAcceptBtn = target?.closest("button[data-action='group-join-accept']") as HTMLButtonElement | null;
      if (groupJoinAcceptBtn) {
        const groupId = String(groupJoinAcceptBtn.getAttribute("data-group-id") || "").trim();
        const peer = String(groupJoinAcceptBtn.getAttribute("data-peer") || "").trim();
        if (!groupId || !peer) return;
        e.preventDefault();
        closeMobileSidebar();
        roomInviteResponsesActions.acceptGroupJoin(groupId, peer);
        return;
      }

      const groupJoinDeclineBtn = target?.closest("button[data-action='group-join-decline']") as HTMLButtonElement | null;
      if (groupJoinDeclineBtn) {
        const groupId = String(groupJoinDeclineBtn.getAttribute("data-group-id") || "").trim();
        const peer = String(groupJoinDeclineBtn.getAttribute("data-peer") || "").trim();
        if (!groupId || !peer) return;
        e.preventDefault();
        closeMobileSidebar();
        roomInviteResponsesActions.declineGroupJoin(groupId, peer);
        return;
      }

      const boardInviteAcceptBtn = target?.closest("button[data-action='board-invite-accept']") as HTMLButtonElement | null;
      if (boardInviteAcceptBtn) {
        const boardId = String(boardInviteAcceptBtn.getAttribute("data-board-id") || "").trim();
        if (!boardId) return;
        e.preventDefault();
        closeMobileSidebar();
        roomInviteResponsesActions.joinBoardFromInvite(boardId);
        return;
      }

      const boardInviteDeclineBtn = target?.closest("button[data-action='board-invite-decline']") as HTMLButtonElement | null;
      if (boardInviteDeclineBtn) {
        const boardId = String(boardInviteDeclineBtn.getAttribute("data-board-id") || "").trim();
        if (!boardId) return;
        e.preventDefault();
        closeMobileSidebar();
        roomInviteResponsesActions.declineBoardInvite(boardId);
        return;
      }

      const boardInviteBlockBtn = target?.closest("button[data-action='board-invite-block']") as HTMLButtonElement | null;
      if (boardInviteBlockBtn) {
        const boardId = String(boardInviteBlockBtn.getAttribute("data-board-id") || "").trim();
        if (!boardId) return;
        const fromAttr = String(boardInviteBlockBtn.getAttribute("data-from") || "").trim();
        const from = fromAttr || String(store.get().pendingBoardInvites.find((x) => x.boardId === boardId)?.from || "").trim();
        e.preventDefault();
        closeMobileSidebar();
        if (from) {
          const st = store.get();
          if (st.conn === "connected" && st.authed) {
            send({ type: "block_set", peer: from, value: true });
            showToast(`Заблокировано: ${from}`, { kind: "warn" });
          } else {
            store.set({ status: "Нет соединения" });
          }
        }
        roomInviteResponsesActions.declineBoardInvite(boardId);
        return;
      }

      const fileAcceptBtn = target?.closest("button[data-action='file-accept']") as HTMLButtonElement | null;
      if (fileAcceptBtn) {
        const fileId = String(fileAcceptBtn.getAttribute("data-file-id") || "").trim();
        if (!fileId) return;
        e.preventDefault();
        closeMobileSidebar();
        fileOffersAccept(fileId);
        return;
      }

      const fileDownloadBtn = target?.closest("button[data-action='file-download']") as HTMLButtonElement | null;
      if (fileDownloadBtn) {
        const fileId = String(fileDownloadBtn.getAttribute("data-file-id") || "").trim();
        if (!fileId) return;
        e.preventDefault();
        closeMobileSidebar();
        beginFileDownload(fileId);
        return;
      }

      const viewBtn = target?.closest("button[data-action='open-file-viewer']") as HTMLButtonElement | null;
      if (viewBtn) {
        const url = String(viewBtn.getAttribute("data-url") || "").trim();
        const fileId = String(viewBtn.getAttribute("data-file-id") || "").trim();
        if (!url && !fileId) return;
        const name = String(viewBtn.getAttribute("data-name") || "файл");
        const size = Number(viewBtn.getAttribute("data-size") || 0) || 0;
        const mimeRaw = viewBtn.getAttribute("data-mime");
        const mime = mimeRaw ? String(mimeRaw) : null;
        const autoplay = isVideoLikeFile(name, mime);
        const captionRaw = viewBtn.getAttribute("data-caption");
        const caption = captionRaw ? String(captionRaw).trim() : "";
        const captionText = caption || null;
        const msgIdxRaw = viewBtn.getAttribute("data-msg-idx");
        const msgIdx = msgIdxRaw !== null && msgIdxRaw.trim() ? Number(msgIdxRaw) : null;
        const st = store.get();
        const chatKey = st.selected ? conversationKey(st.selected) : null;
        e.preventDefault();
        closeMobileSidebar();
        if (chatKey && msgIdx !== null && Number.isFinite(msgIdx)) {
          void fileViewer.openFromMessageIndex(chatKey, Math.trunc(msgIdx), {
            url,
            name,
            size,
            mime,
            caption: captionText,
            fileId: fileId || null,
          });
          return;
        }
        if (url) {
          store.set({
            modal: buildFileViewerState({
              url,
              name,
              size,
              mime,
              caption: captionText,
              autoplay,
              chatKey: null,
              msgIdx: null,
            }),
          });
          return;
        }
        void (async () => {
          const existing = st.fileTransfers.find((t) => String(t.id || "").trim() === fileId && Boolean(t.url));
          if (existing?.url) {
            store.set({
              modal: buildFileViewerState({
                url: existing.url,
                name,
                size: size || existing.size || 0,
                mime: mime || existing.mime || null,
                caption: captionText,
                autoplay,
                chatKey: null,
                msgIdx: null,
              }),
            });
            return;
          }
          const opened = await tryOpenFileViewerFromCache(fileId, {
            name,
            size,
            mime,
            caption: captionText,
            chatKey: null,
            msgIdx: null,
          });
          if (opened) return;

          const latest = store.get();
          if (latest.conn !== "connected") {
            store.set({ status: "Нет соединения" });
            return;
          }
          if (!latest.authed) {
            store.set({ status: "Сначала войдите или зарегистрируйтесь" });
            return;
          }
          setPendingFileViewer({ fileId, name, size, mime, caption: captionText, chatKey: null, msgIdx: null });
          enqueueFileGet(fileId, { priority: "high" });
          store.set({ status: `Скачивание: ${name}` });
        })();
        return;
      }
    });

    layout.chatSelectionBar.addEventListener("click", (e) => {
      const target = e.target as HTMLElement | null;
      const btn = target?.closest("button[data-action^='chat-selection-']") as HTMLButtonElement | null;
      if (!btn || btn.hasAttribute("disabled")) return;
      const action = String(btn.getAttribute("data-action") || "");
      if (!action) return;
      e.preventDefault();
      if (action === "chat-selection-cancel") {
        clearChatSelection();
        return;
      }
      if (action === "chat-selection-forward") {
        forwardViewerSelectionActions.handleChatSelectionForward();
        return;
      }
      if (action === "chat-selection-copy") {
        void forwardViewerSelectionActions.handleChatSelectionCopy();
        return;
      }
      if (action === "chat-selection-download") {
        void forwardViewerSelectionActions.handleChatSelectionDownload();
        return;
      }
      if (action === "chat-selection-send-now") {
        forwardViewerSelectionActions.handleChatSelectionSendNow();
        return;
      }
      if (action === "chat-selection-delete") {
        forwardViewerSelectionActions.handleChatSelectionDelete();
        return;
      }
      if (action === "chat-selection-pin") {
        forwardViewerSelectionActions.handleChatSelectionPin();
        return;
      }
    });

    layout.chat.addEventListener("dblclick", (e) => {
      const st = store.get();
      if (coarsePointerMq.matches && !anyFinePointerMq.matches) return;
      if (st.editing) return;
      if (Date.now() < getSuppressChatClickUntil()) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("button, a, input, textarea, [contenteditable='true']")) return;
      const row = target.closest("[data-msg-idx]") as HTMLElement | null;
      if (!row) return;
      const idx = Math.trunc(Number(row.getAttribute("data-msg-idx") || ""));
      const key = st.selected ? conversationKey(st.selected) : "";
      if (!key || !Number.isFinite(idx) || idx < 0) return;
      const conv = st.conversations[key] || null;
      const msg = conv && idx >= 0 && idx < conv.length ? conv[idx] : null;
      const draft = msg ? buildHelperDraft(st, key, msg) : null;
      if (!draft) return;
      e.preventDefault();
      store.set({ replyDraft: draft, forwardDraft: null });
      scheduleFocusComposer();
    });

    layout.chat.addEventListener("input", (e) => {
      const t = e.target as HTMLElement | null;
      if (!t || !(t instanceof HTMLInputElement)) return;
      if (t.id === "chat-search-input") {
        markUserInput();
        setChatSearchQuery(t.value);
        return;
      }
      if (t.id === "chat-search-date") {
        markUserInput();
        setChatSearchDate(t.value);
      }
    });

    layout.chat.addEventListener("change", (e) => {
      const t = e.target as HTMLElement | null;
      if (!t || !(t instanceof HTMLInputElement)) return;
      if (t.id !== "chat-search-date") return;
      markUserInput();
      setChatSearchDate(t.value);
    });

    layout.chat.addEventListener("keydown", (e) => {
      const t = e.target as HTMLElement | null;
      if (!t || !(t instanceof HTMLInputElement)) return;
      if (t.id !== "chat-search-input") return;
      if (e.key === "Enter") {
        e.preventDefault();
        stepChatSearch(e.shiftKey ? -1 : 1);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeChatSearch();
      }
    });
  };

  return { install };
}
