import { el } from "../../helpers/dom/el";
import { formatTime } from "../../helpers/time";
import { conversationKey } from "../../helpers/chat/conversationKey";
import { messageSelectionKey } from "../../helpers/chat/chatSelection";
import { isPinnedMessage } from "../../helpers/chat/pinnedMessages";
import { isMessageContinuation } from "../../helpers/chat/messageGrouping";
import type { AppState, ChatMessage, ChatMessageRef, FileOfferIn, FileTransferEntry } from "../../stores/types";
import { avatarHue, avatarMonogram, getStoredAvatar } from "../../helpers/avatar/avatarStore";
import { fileBadge } from "../../helpers/files/fileBadge";
import { safeUrl } from "../../helpers/security/safeUrl";
import { renderRichText } from "../../helpers/chat/richText";
import { renderBoardPost } from "../../helpers/boards/boardPost";
import type { Layout } from "../layout/types";
import { isMobileLikeUi } from "../../helpers/ui/mobileLike";
import { getCachedMediaAspectRatio } from "../../helpers/chat/mediaAspectCache";
import {
  HISTORY_VIRTUAL_THRESHOLD,
  HISTORY_VIRTUAL_WINDOW,
  clampVirtualAvg,
  getVirtualEnd,
  getVirtualMaxStart,
  getVirtualStart,
  shouldVirtualize,
} from "../../helpers/chat/virtualHistory";
import { CHAT_SEARCH_FILTERS } from "../../helpers/chat/chatSearch";

import {
  AlbumItem,
  ChatShiftAnchor,
  EMPTY_CHAT,
  EMPTY_HITS,
  UnreadDividerAnchor,
  captureChatShiftAnchor,
  chatTitleNodes,
  dayKey,
  findChatShiftAnchorElement,
  findUnreadAnchorIndex,
  formatDayLabel,
  formatSelectionCount,
  formatUserLabel,
  getFileAttachmentInfo,
  isAlbumCandidate,
  messageLine,
  renderAlbumLine,
  resolveUserLabel,
  searchResultPreview,
  skeletonMsg,
  trimSearchPreview,
  unreadAnchorForMessage,
} from "./renderChatHelpers";

function transferProgressTickOnly(prev: AppState["fileTransfers"], next: AppState["fileTransfers"]): boolean {
  if (!Array.isArray(prev) || !Array.isArray(next)) return false;
  if (prev.length !== next.length) return false;
  const prevByLocalId = new Map<string, FileTransferEntry>();
  for (const entry of prev) {
    const lid = String(entry?.localId || "").trim();
    if (!lid) return false;
    if (prevByLocalId.has(lid)) return false;
    prevByLocalId.set(lid, entry);
  }
  const norm = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const arrEq = (a?: string[] | null, b?: string[] | null): boolean => {
    if (a === b) return true;
    const aa = Array.isArray(a) ? a : [];
    const bb = Array.isArray(b) ? b : [];
    if (aa.length !== bb.length) return false;
    for (let i = 0; i < aa.length; i += 1) {
      if (String(aa[i]) !== String(bb[i])) return false;
    }
    return true;
  };
  for (const entry of next) {
    const lid = String(entry?.localId || "").trim();
    if (!lid) return false;
    const prevEntry = prevByLocalId.get(lid);
    if (!prevEntry) return false;
    if (norm(prevEntry.id) !== norm(entry.id)) return false;
    if (String(prevEntry.name) !== String(entry.name)) return false;
    if (Number(prevEntry.size || 0) !== Number(entry.size || 0)) return false;
    if (String(prevEntry.direction) !== String(entry.direction)) return false;
    if (String(prevEntry.peer) !== String(entry.peer)) return false;
    if (norm(prevEntry.room) !== norm(entry.room)) return false;
    if (String(prevEntry.status) !== String(entry.status)) return false;
    if (norm(prevEntry.error) !== norm(entry.error)) return false;
    if (norm(prevEntry.url) !== norm(entry.url)) return false;
    if (norm(prevEntry.mime) !== norm(entry.mime)) return false;
    if (!arrEq(prevEntry.acceptedBy, entry.acceptedBy)) return false;
    if (!arrEq(prevEntry.receivedBy, entry.receivedBy)) return false;
    const prevProgress = Math.round(Number(prevEntry.progress || 0));
    const nextProgress = Math.round(Number(entry.progress || 0));
    if (prevProgress !== nextProgress && entry.status !== "uploading" && entry.status !== "downloading") return false;
  }
  return true;
}

function patchChatTransferProgress(scrollHost: HTMLElement, transfers: AppState["fileTransfers"]): void {
  if (!Array.isArray(transfers) || transfers.length === 0) return;
  const byLocalId = new Map<string, FileTransferEntry>();
  const byFileId = new Map<string, FileTransferEntry>();
  for (const t of transfers) {
    const lid = String(t?.localId || "").trim();
    if (lid) byLocalId.set(lid, t);
    const fid = String(t?.id || "").trim();
    if (fid) byFileId.set(fid, t);
  }
  const updateProgressbar = (node: HTMLElement, transfer: FileTransferEntry) => {
    const pct = Math.max(0, Math.min(100, Math.round(transfer.progress || 0)));
    const label = transfer.status === "uploading" ? `Загрузка ${pct}%` : transfer.status === "downloading" ? `Скачивание ${pct}%` : `${pct}%`;
    try {
      node.setAttribute("aria-valuenow", String(pct));
      node.setAttribute("title", label);
      node.setAttribute("aria-label", label);
    } catch {
      // ignore
    }
    const candy = node.querySelector(".file-progress-candy") as HTMLElement | null;
    if (candy) {
      try {
        candy.style.setProperty("--file-progress", `${pct}%`);
      } catch {
        // ignore
      }
    }
  };
  const nodes = scrollHost.querySelectorAll("button.chat-file-preview[data-local-id], button.chat-file-preview[data-file-id]");
  for (const node of Array.from(nodes)) {
    if (!(node instanceof HTMLButtonElement)) continue;
    const localId = String(node.getAttribute("data-local-id") || "").trim();
    const fileId = String(node.getAttribute("data-file-id") || "").trim();
    const transfer = localId ? byLocalId.get(localId) : fileId ? byFileId.get(fileId) : null;
    if (!transfer) continue;
    if (transfer.status !== "uploading" && transfer.status !== "downloading") continue;
    const media = node.querySelector(".chat-media-progress") as HTMLElement | null;
    if (media) updateProgressbar(media, transfer);
    const row = node.closest(".file-row") as HTMLElement | null;
    if (row) {
      const bar = row.querySelector(".file-progress") as HTMLElement | null;
      if (bar) updateProgressbar(bar, transfer);
    }
  }
}

export function renderChat(layout: Layout, state: AppState) {
  const mobileUi = isMobileLikeUi();
  const boardUi = Boolean(state.selected && state.selected.kind === "board");
  const scrollHost = layout.chatHost;
  const hostState = scrollHost as any;
  const albumLayout = (() => {
    const fallbackMaxWidth = mobileUi ? 340 : 420;
    const fallbackSpacing = 1;
    const parseCssPx = (raw: string, fallback: number): number => {
      const v = String(raw || "").trim().toLowerCase();
      if (!v) return fallback;
      const n = Number(v.endsWith("px") ? v.slice(0, -2) : v);
      if (!Number.isFinite(n) || n <= 0) return fallback;
      return Math.round(n);
    };
    try {
      const st = getComputedStyle(layout.chat);
      const maxWidth = parseCssPx(st.getPropertyValue("--chat-album-frame-max"), fallbackMaxWidth);
      const spacing = parseCssPx(st.getPropertyValue("--chat-album-gap"), fallbackSpacing);
      return { maxWidth, minWidth: 100, spacing };
    } catch {
      return { maxWidth: fallbackMaxWidth, minWidth: 100, spacing: fallbackSpacing };
    }
  })();
  const key = state.selected ? conversationKey(state.selected) : "";
  const selectionState = state.chatSelection && state.chatSelection.key === key ? state.chatSelection : null;
  const selectionSet =
    selectionState && Array.isArray(selectionState.ids) && selectionState.ids.length ? new Set(selectionState.ids) : null;
  const selectionCount = selectionSet ? selectionSet.size : 0;
  const maxScrollTop = () => Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
  const selectedKindClass = state.selected ? state.selected.kind : null;
  layout.chat.classList.toggle("chat-board", selectedKindClass === "board");
  layout.chat.classList.toggle("chat-dm", selectedKindClass === "dm");
  layout.chat.classList.toggle("chat-group", selectedKindClass === "group");
  const prevKey = String(scrollHost.getAttribute("data-chat-key") || "");
  const keyChanged = key !== prevKey;
  const prevScrollTop = scrollHost.scrollTop;
  const atBottomBefore = scrollHost.scrollTop >= maxScrollTop() - 24;
  const sticky = hostState.__stickBottom;
  const stickyActive = Boolean(sticky && sticky.active && sticky.key === key);
  const cachedMessages = key ? (state.conversations?.[key] ?? EMPTY_CHAT) : EMPTY_CHAT;
  const allowSticky = Boolean(key && (state.historyLoaded?.[key] || cachedMessages.length));
  // NOTE: autoscroll-on-open/sent is handled in app/mountApp.ts (pendingChatAutoScroll).
  // Here we only keep pinned-bottom stable during re-renders/content growth for the *current* chat.
  const shouldStick = Boolean(key && !keyChanged && allowSticky && (stickyActive || atBottomBefore));
  const preShiftAnchor = key && !keyChanged && !shouldStick ? captureChatShiftAnchor(scrollHost, key) : null;
  if (keyChanged && hostState.__stickBottom) hostState.__stickBottom = null;
  if (keyChanged && hostState.__chatShiftAnchor) hostState.__chatShiftAnchor = null;
  else if (key) {
    if (shouldStick) hostState.__stickBottom = { key, active: true, at: Date.now() };
    else if (hostState.__stickBottom && hostState.__stickBottom.key === key) hostState.__stickBottom.active = false;
  }
  scrollHost.setAttribute("data-chat-key", key);
  if (!key && hostState.__chatLinesObserver && typeof hostState.__chatLinesObserver.disconnect === "function") {
    try {
      hostState.__chatLinesObserver.disconnect();
      hostState.__chatLinesObserved = null;
    } catch {
      // ignore
    }
  }

  // No selected chat: keep the main area empty (mobile starts from the sidebar tabs).
  if (!key) {
    layout.chatTop.replaceChildren();
    scrollHost.replaceChildren();
    layout.chatJump.classList.add("hidden");
    layout.chatSearchResults.classList.add("hidden");
    layout.chatSearchResults.replaceChildren();
    layout.chatSearchFooter.classList.add("hidden");
    layout.chatSearchFooter.replaceChildren();
    layout.chatSelectionBar.classList.add("hidden");
    layout.chatSelectionBar.replaceChildren();
    return;
  }

  const friendLabels = new Map<string, string>();
  for (const f of state.friends || []) {
    friendLabels.set(String(f.id), formatUserLabel(f.display_name || "", f.handle || "", String(f.id || "")));
  }

  const msgs = cachedMessages;
  const historyLoaded = Boolean(key && state.historyLoaded && state.historyLoaded[key]);
  const historyLoading = Boolean(key && state.historyLoading && state.historyLoading[key]);
  const historyCursor = key && state.historyCursor ? Number(state.historyCursor[key]) : NaN;
  const rawHasMore = key && state.historyHasMore ? state.historyHasMore[key] : undefined;
  const hasMore = Boolean(key && (rawHasMore ?? (historyLoaded && Number.isFinite(historyCursor) && historyCursor > 0)));
  const loadingMore = Boolean(historyLoading && historyLoaded);
  const loadingInitial = Boolean(historyLoading && !historyLoaded);
  const searchActive = Boolean(state.chatSearchOpen && state.chatSearchQuery.trim());
  const hits = searchActive ? state.chatSearchHits || EMPTY_HITS : EMPTY_HITS;
  const hitSet = searchActive && hits.length ? new Set(hits) : null;
  const activePos = searchActive ? Math.max(0, Math.min(hits.length ? hits.length - 1 : 0, state.chatSearchPos | 0)) : 0;
  const activeMsgIdx = searchActive && hits.length ? hits[activePos] : null;
  const searchResultsOpen = Boolean(searchActive && state.chatSearchResultsOpen);
  const prevRender = hostState.__chatRenderState as
    | {
        key: string;
        selectedKind: string;
        selectedId: string;
        page: string;
        msgsRef: ChatMessage[];
        historyLoaded: boolean;
        historyLoading: boolean;
        historyHasMore: boolean;
        historyVirtualStart: number | null;
        searchOpen: boolean;
        searchQuery: string;
        searchResultsOpen: boolean;
        searchPos: number;
        searchHitsRef: number[] | null;
        selectionRef: AppState["chatSelection"] | null;
        pinnedIdsRef: number[] | null;
        pinnedActive: number | null;
        lastRead: { id?: number; ts?: number } | null;
        avatarsRev: number;
        profilesRef: AppState["profiles"];
        groupsRef: AppState["groups"];
        boardsRef: AppState["boards"];
        rightPanelRef: AppState["rightPanel"];
        fileTransfersRef: AppState["fileTransfers"];
        fileThumbsRef: AppState["fileThumbs"];
        messageView: AppState["messageView"];
        searchFilter: AppState["chatSearchFilter"];
        searchDate: AppState["chatSearchDate"];
      }
    | null;
  const pinnedIds = key && state.pinnedMessages ? state.pinnedMessages[key] : null;
  const activeRaw = key && state.pinnedMessageActive ? state.pinnedMessageActive[key] : null;
  const selectedKind = state.selected?.kind ? String(state.selected.kind) : "";
  const selectedId = state.selected?.id ? String(state.selected.id) : "";
  const historyVirtualStart = key && state.historyVirtualStart ? state.historyVirtualStart[key] ?? null : null;
  const lastRead = key && state.lastRead ? state.lastRead[key] ?? null : null;
  const selectionRef = selectionState;
  const renderState = {
    key,
    selectedKind,
    selectedId,
    page: state.page,
    msgsRef: msgs,
    historyLoaded,
    historyLoading,
    historyHasMore: hasMore,
    historyVirtualStart,
    searchOpen: Boolean(state.chatSearchOpen),
    searchQuery: String(state.chatSearchQuery || ""),
    searchResultsOpen,
    searchPos: state.chatSearchPos | 0,
    searchHitsRef: hits,
    selectionRef,
    pinnedIdsRef: pinnedIds,
    pinnedActive: typeof activeRaw === "number" ? activeRaw : null,
    lastRead,
    avatarsRev: Math.max(0, Math.trunc(Number((state as any).avatarsRev || 0) || 0)),
    profilesRef: state.profiles,
    groupsRef: state.groups,
    boardsRef: state.boards,
    rightPanelRef: state.rightPanel,
    fileTransfersRef: state.fileTransfers,
    fileThumbsRef: state.fileThumbs,
    messageView: state.messageView,
    searchFilter: state.chatSearchFilter,
    searchDate: state.chatSearchDate,
  };
  const canSkipRenderExceptTransfers =
    prevRender &&
    prevRender.key === renderState.key &&
    prevRender.selectedKind === renderState.selectedKind &&
    prevRender.selectedId === renderState.selectedId &&
    prevRender.page === renderState.page &&
    prevRender.msgsRef === renderState.msgsRef &&
    prevRender.historyLoaded === renderState.historyLoaded &&
    prevRender.historyLoading === renderState.historyLoading &&
    prevRender.historyHasMore === renderState.historyHasMore &&
    prevRender.historyVirtualStart === renderState.historyVirtualStart &&
    prevRender.searchOpen === renderState.searchOpen &&
    prevRender.searchQuery === renderState.searchQuery &&
    prevRender.searchResultsOpen === renderState.searchResultsOpen &&
    prevRender.searchPos === renderState.searchPos &&
    prevRender.searchHitsRef === renderState.searchHitsRef &&
    prevRender.selectionRef === renderState.selectionRef &&
    prevRender.pinnedIdsRef === renderState.pinnedIdsRef &&
    prevRender.pinnedActive === renderState.pinnedActive &&
    prevRender.lastRead === renderState.lastRead &&
    prevRender.avatarsRev === renderState.avatarsRev &&
    prevRender.profilesRef === renderState.profilesRef &&
    prevRender.groupsRef === renderState.groupsRef &&
    prevRender.boardsRef === renderState.boardsRef &&
    prevRender.rightPanelRef === renderState.rightPanelRef &&
    prevRender.fileThumbsRef === renderState.fileThumbsRef &&
    prevRender.messageView === renderState.messageView &&
    prevRender.searchFilter === renderState.searchFilter &&
    prevRender.searchDate === renderState.searchDate;
  const canSkipRender =
    prevRender &&
    prevRender.key === renderState.key &&
    prevRender.selectedKind === renderState.selectedKind &&
    prevRender.selectedId === renderState.selectedId &&
    prevRender.page === renderState.page &&
    prevRender.msgsRef === renderState.msgsRef &&
    prevRender.historyLoaded === renderState.historyLoaded &&
    prevRender.historyLoading === renderState.historyLoading &&
    prevRender.historyHasMore === renderState.historyHasMore &&
    prevRender.historyVirtualStart === renderState.historyVirtualStart &&
    prevRender.searchOpen === renderState.searchOpen &&
    prevRender.searchQuery === renderState.searchQuery &&
    prevRender.searchResultsOpen === renderState.searchResultsOpen &&
    prevRender.searchPos === renderState.searchPos &&
    prevRender.searchHitsRef === renderState.searchHitsRef &&
    prevRender.selectionRef === renderState.selectionRef &&
    prevRender.pinnedIdsRef === renderState.pinnedIdsRef &&
    prevRender.pinnedActive === renderState.pinnedActive &&
    prevRender.lastRead === renderState.lastRead &&
    prevRender.avatarsRev === renderState.avatarsRev &&
    prevRender.profilesRef === renderState.profilesRef &&
    prevRender.groupsRef === renderState.groupsRef &&
    prevRender.boardsRef === renderState.boardsRef &&
    prevRender.rightPanelRef === renderState.rightPanelRef &&
    prevRender.fileTransfersRef === renderState.fileTransfersRef &&
    prevRender.fileThumbsRef === renderState.fileThumbsRef &&
    prevRender.messageView === renderState.messageView &&
    prevRender.searchFilter === renderState.searchFilter &&
    prevRender.searchDate === renderState.searchDate;
  if (
    canSkipRenderExceptTransfers &&
    prevRender.fileTransfersRef !== renderState.fileTransfersRef &&
    transferProgressTickOnly(prevRender.fileTransfersRef, renderState.fileTransfersRef)
  ) {
    hostState.__chatRenderState = renderState;
    patchChatTransferProgress(scrollHost, renderState.fileTransfersRef);
    return;
  }
  if (canSkipRender) return;
  hostState.__chatRenderState = renderState;
  const mobileLikeUi = isMobileLikeUi();
  const memoryGb = (() => {
    try {
      const raw = Number((navigator as any)?.deviceMemory ?? 0);
      return Number.isFinite(raw) && raw > 0 ? raw : 4;
    } catch {
      return 4;
    }
  })();
  const connection = (() => {
    try {
      return (navigator as any)?.connection ?? null;
    } catch {
      return null;
    }
  })();
  const saveData = Boolean(connection && (connection as any).saveData);
  const effectiveType = String((connection as any)?.effectiveType || "").toLowerCase();
  const slowNetwork = saveData || effectiveType.includes("2g") || effectiveType.includes("3g");
  const constrained = mobileLikeUi || memoryGb <= 4 || slowNetwork;
  const virtualThreshold = slowNetwork ? 200 : constrained ? 240 : HISTORY_VIRTUAL_THRESHOLD;
  const virtualWindow = slowNetwork ? 160 : constrained ? 200 : HISTORY_VIRTUAL_WINDOW;
  const virtualEnabled = Boolean(key && shouldVirtualize(msgs.length, searchActive, virtualThreshold));
  const virtualAvgMap: Map<string, number> = hostState.__chatVirtualAvgHeights || new Map();
  hostState.__chatVirtualAvgHeights = virtualAvgMap;
  const avgHeight = clampVirtualAvg(key ? virtualAvgMap.get(key) : null);
  const maxVirtualStart = getVirtualMaxStart(msgs.length, virtualWindow);
  const preferredStart = virtualEnabled && shouldStick ? maxVirtualStart : state.historyVirtualStart?.[key];
  const virtualStart = virtualEnabled ? getVirtualStart(msgs.length, preferredStart, virtualWindow) : 0;
  const virtualEnd = virtualEnabled ? getVirtualEnd(msgs.length, virtualStart, virtualWindow) : msgs.length;
  const topSpacerHeight = virtualEnabled ? Math.max(0, virtualStart) * avgHeight : 0;
  const bottomSpacerHeight = virtualEnabled ? Math.max(0, msgs.length - virtualEnd) * avgHeight : 0;
  const lineItems: HTMLElement[] = [];
  const lines: HTMLElement[] = [];
  let prevDay = "";
  let prevMsg: ChatMessage | null = null;
  const unreadMap: Map<string, UnreadDividerAnchor> = hostState.__chatUnreadAnchors || new Map();
  hostState.__chatUnreadAnchors = unreadMap;
  if (keyChanged && key) {
    unreadMap.delete(key);
    const armed: Set<string> | undefined = hostState.__chatUnreadClearArmed;
    if (armed && typeof armed.delete === "function") armed.delete(key);
  }

  let unreadIdx = -1;
  let unreadCount = 0;

  if (!searchActive && key) {
    const saved = unreadMap.get(key);
    if (saved) {
      const idx = findUnreadAnchorIndex(msgs, saved);
      if (idx >= 0) {
        unreadIdx = idx;
      }
    }
  }

  if (unreadIdx < 0 && state.selected?.kind === "dm" && !searchActive) {
    const peerId = String(state.selected?.id || "").trim();
    const unread = (state.friends || []).find((f) => f.id === peerId)?.unread ?? 0;
    if (unread > 0 && msgs.length > 0) {
      let idx = Math.max(0, Math.min(msgs.length - 1, msgs.length - unread));
      while (idx < msgs.length && msgs[idx]?.kind === "sys") idx += 1;
      if (idx < msgs.length) unreadIdx = idx;
    }
  } else if (unreadIdx < 0 && !searchActive && key) {
    const marker = state.lastRead?.[key];
    const lastReadId = Number(marker?.id ?? 0);
    const lastReadAt = Number(marker?.ts ?? 0);
    if (lastReadId > 0 && msgs.length > 0) {
      const idx = msgs.findIndex((m) => Number(m?.id ?? 0) > lastReadId);
      if (idx >= 0) unreadIdx = idx;
    } else if (lastReadAt > 0 && msgs.length > 0) {
      const idx = msgs.findIndex((m) => Number(m?.ts ?? 0) > lastReadAt);
      if (idx >= 0) unreadIdx = idx;
    }
  }

  if (!searchActive && key && unreadIdx >= 0 && unreadIdx < msgs.length) {
    unreadCount = Math.max(0, msgs.length - unreadIdx);
    const anchor = unreadAnchorForMessage(msgs[unreadIdx]);
    if (anchor.msgKey || anchor.msgId !== undefined) unreadMap.set(key, anchor);
  }

  const unreadInsertIdx = unreadIdx >= 0 && virtualEnabled && unreadIdx < virtualStart ? virtualStart : unreadIdx;
  if (virtualEnabled && virtualStart > 0) {
    const prev = msgs[virtualStart - 1];
    if (prev) {
      prevDay = dayKey(prev.ts);
      prevMsg = prev.kind === "sys" ? null : prev;
    }
  }
  const isGroupTail = (idx: number, msg: ChatMessage) => {
    const nextIdx = idx + 1;
    if (nextIdx >= msgs.length) return true;
    if (nextIdx === unreadInsertIdx) return true;
    const nextMsg = msgs[nextIdx];
    if (!nextMsg || nextMsg.kind === "sys") return true;
    const curDay = dayKey(msg.ts);
    const nextDay = dayKey(nextMsg.ts);
    if (curDay && nextDay && curDay !== nextDay) return true;
    return !isMessageContinuation(msg, nextMsg);
  };
  const albumMin = 2;
  const albumMax = 12;
  const albumGapSeconds = 121;
  for (let msgIdx = virtualStart; msgIdx < virtualEnd; msgIdx += 1) {
    const m = msgs[msgIdx];
    const dk = dayKey(m.ts);
    if (dk && dk !== prevDay) {
      prevDay = dk;
      lineItems.push(
        el("div", { class: "msg-sep msg-date", "aria-hidden": "true" }, [el("span", { class: "msg-sep-text" }, [formatDayLabel(m.ts)])])
      );
      prevMsg = null;
    }
    if (msgIdx === unreadInsertIdx) {
      const unreadLabel = unreadCount > 0 ? `Непрочитанные (${unreadCount})` : "Непрочитанные";
      lineItems.push(
        el("div", { class: "msg-sep msg-unread", role: "separator", "aria-label": unreadLabel }, [
          el("span", { class: "msg-sep-text" }, [unreadLabel]),
        ])
      );
      prevMsg = null;
    }

    const info = getFileAttachmentInfo(state, m, { mobileUi });
    if (isAlbumCandidate(m, info)) {
      const group: AlbumItem[] = [{ idx: msgIdx, msg: m, info }];
      let scan = msgIdx + 1;
      while (scan < virtualEnd) {
        const next = msgs[scan];
        if (dk && dayKey(next.ts) !== dk) break;
        const nextInfo = getFileAttachmentInfo(state, next, { mobileUi });
        if (!isAlbumCandidate(next, nextInfo)) break;
        if (!isMessageContinuation(group[group.length - 1].msg, next, { maxGapSeconds: albumGapSeconds })) break;
        group.push({ idx: scan, msg: next, info: nextInfo });
        scan += 1;
        if (group.length >= albumMax) break;
      }
		      if (group.length >= albumMin) {
		        const groupCounts = (() => {
		          let selectedCount = 0;
		          let selectableCount = 0;
		          for (const item of group) {
		            const selKey = messageSelectionKey(item.msg);
		            if (!selKey) continue;
		            selectableCount += 1;
		            if (selectionSet && selectionSet.has(selKey)) selectedCount += 1;
		          }
		          const anySelected = selectedCount > 0;
		          const allSelected = selectableCount > 0 && selectedCount === selectableCount;
		          const partial = anySelected && !allSelected;
		          return { anySelected, allSelected, partial };
		        })();
		        const lastIdx = group[group.length - 1].idx;
		        const line = renderAlbumLine(state, group, friendLabels, {
		          selectionMode: selectionCount > 0,
		          selected: groupCounts.allSelected,
		          partial: groupCounts.partial,
		          groupStartIdx: group[0].idx,
		          groupEndIdx: lastIdx,
              albumLayout,
		        });
		        if (m.kind !== "sys" && isMessageContinuation(prevMsg, m)) line.classList.add("msg-cont");
		        const lastItem = group[group.length - 1];
		        if (!boardUi && lastItem?.msg?.kind !== "sys" && isGroupTail(lastItem.idx, lastItem.msg)) line.classList.add("msg-tail");
		        const hit = hitSet ? group.some((item) => hitSet.has(item.idx)) : false;
		        const active = activeMsgIdx !== null && group.some((item) => item.idx === activeMsgIdx);
		        if (groupCounts.anySelected) line.classList.add("msg-selected");
		        line.setAttribute("data-msg-idx", String(lastIdx));
		        line.setAttribute("data-msg-group-start", String(group[0].idx));
		        line.setAttribute("data-msg-group-end", String(lastIdx));
		        const groupMsgId = Number(group[group.length - 1].msg.id ?? NaN);
		        if (Number.isFinite(groupMsgId)) line.setAttribute("data-msg-id", String(groupMsgId));
		        const groupMsgKey = messageSelectionKey(group[group.length - 1].msg);
		        if (groupMsgKey) line.setAttribute("data-msg-key", groupMsgKey);
        if (hit) line.classList.add("msg-hit");
        if (active) line.classList.add("msg-hit-active");
        lineItems.push(line);
        prevMsg = group[group.length - 1].msg.kind === "sys" ? null : group[group.length - 1].msg;
        msgIdx = group[group.length - 1].idx;
        continue;
      }
    }

	    const msgKey = messageSelectionKey(m);
	    const selected = Boolean(selectionSet && msgKey && selectionSet.has(msgKey));
	    const line = messageLine(state, m, friendLabels, { mobileUi, boardUi, msgIdx, selectionMode: selectionCount > 0, selected });
	    if (m.kind !== "sys" && isMessageContinuation(prevMsg, m)) line.classList.add("msg-cont");
	    if (!boardUi && m.kind !== "sys" && isGroupTail(msgIdx, m)) line.classList.add("msg-tail");
	    line.setAttribute("data-msg-idx", String(msgIdx));
	    const msgId = Number(m.id ?? NaN);
	    if (Number.isFinite(msgId)) line.setAttribute("data-msg-id", String(msgId));
	    if (msgKey) line.setAttribute("data-msg-key", msgKey);
	    if (selected) line.classList.add("msg-selected");
	    if (hitSet?.has(msgIdx)) line.classList.add("msg-hit");
	    if (activeMsgIdx === msgIdx) line.classList.add("msg-hit-active");
	    lineItems.push(line);
	    prevMsg = m.kind === "sys" ? null : m;
	  }

  // Infinite scroll вверх: загрузка более ранних сообщений запускается автологикой (mountApp.ts).
  // Здесь показываем только индикатор, когда уже идёт подгрузка.
  if (key && hasMore && loadingMore) {
    const loader = el("div", { class: "chat-history-loader", role: "status", "aria-live": "polite" }, ["Загрузка…"]);
    lineItems.unshift(el("div", { class: "chat-history-more-wrap" }, [loader]));
  }

  if (key && !historyLoaded && !loadingInitial && lineItems.length) {
    const retry = el(
      "button",
      {
        class: "btn chat-history-more",
        type: "button",
        "data-action": "chat-history-retry",
        "aria-label": "Повторить загрузку истории",
      },
      ["Повторить загрузку"]
    );
    lineItems.unshift(el("div", { class: "chat-history-more-wrap" }, [retry]));
  }

  let isEmptyState = false;
  if (!lineItems.length) {
    if (!historyLoaded) {
      if (loadingInitial) {
        for (let i = 0; i < 7; i += 1) {
          lines.push(skeletonMsg(i % 2 === 0 ? "in" : "out", i));
        }
      } else {
        lines.push(
          el("div", { class: "chat-empty chat-empty-retry" }, [
            el("div", { class: "chat-empty-title" }, ["История не загружена"]),
            el("div", { class: "chat-empty-sub" }, ["Проверьте соединение и попробуйте снова"]),
            el(
              "button",
              { class: "btn chat-history-more", type: "button", "data-action": "chat-history-retry", "aria-label": "Повторить загрузку истории" },
              ["Повторить загрузку"]
            ),
          ])
        );
        isEmptyState = true;
      }
    } else {
      lines.push(el("div", { class: "chat-empty" }, [el("div", { class: "chat-empty-title" }, ["Пока нет сообщений"])]));
      isEmptyState = true;
    }
  } else {
    if (virtualEnabled && topSpacerHeight > 0) {
      const spacer = el("div", { class: "chat-virtual-spacer", "data-virtual-spacer": "top", "aria-hidden": "true" });
      spacer.style.height = `${topSpacerHeight}px`;
      lines.push(spacer);
    }
    lines.push(...lineItems);
    if (virtualEnabled && bottomSpacerHeight > 0) {
      const spacer = el("div", { class: "chat-virtual-spacer", "data-virtual-spacer": "bottom", "aria-hidden": "true" });
      spacer.style.height = `${bottomSpacerHeight}px`;
      lines.push(spacer);
    }
  }
  const titleChildren: Array<string | HTMLElement> = [...chatTitleNodes(state)];
  const chatSearchEnabled = !mobileUi;
  const showChatSearchToggle = false;
  if (state.selected) {
    const infoActive = Boolean(
      state.page === "main" &&
        state.rightPanel &&
        state.rightPanel.kind === state.selected.kind &&
        state.rightPanel.id === state.selected.id
    );
    titleChildren.push(el("span", { class: "chat-title-spacer", "aria-hidden": "true" }, [""]));
    titleChildren.push(
      el(
        "button",
        {
          class: infoActive ? "btn chat-info-btn btn-active" : "btn chat-info-btn",
          type: "button",
          "data-action": "chat-profile-open",
          title: infoActive ? "Закрыть профиль чата" : "Профиль чата",
          "aria-label": infoActive ? "Закрыть профиль чата" : "Профиль чата",
          "aria-pressed": infoActive ? "true" : "false",
        },
        ["ℹ︎"]
      )
    );
    if (chatSearchEnabled && showChatSearchToggle) {
      titleChildren.push(
        el(
          "button",
          {
            class: state.chatSearchOpen ? "btn chat-search-toggle btn-active" : "btn chat-search-toggle",
            type: "button",
            "data-action": state.chatSearchOpen ? "chat-search-close" : "chat-search-open",
            title: "Поиск в чате (Ctrl+F)",
            "aria-label": "Поиск в чате",
          },
          [state.chatSearchOpen ? "Закрыть поиск" : "Поиск"]
        )
      );
    }
  }

  let searchBar: HTMLElement | null = null;
  if (state.selected && state.chatSearchOpen && chatSearchEnabled) {
    const input = el("input", {
      class: "modal-input chat-search-input",
      id: "chat-search-input",
      type: "search",
      placeholder: "Найти в чате…",
      "data-ios-assistant": "off",
      autocomplete: "off",
      autocorrect: "off",
      autocapitalize: "off",
      spellcheck: "false",
      inputmode: "text",
      enterkeyhint: "search",
    }) as HTMLInputElement;
    input.value = state.chatSearchQuery || "";
    const row = el("div", { class: "chat-search-row" }, [input]);
    const filters: HTMLElement[] = [];
    const counts = state.chatSearchCounts || { all: 0, media: 0, files: 0, links: 0, audio: 0 };
    const hasQuery = Boolean((state.chatSearchQuery || "").trim());
    if (hasQuery) {
      for (const item of CHAT_SEARCH_FILTERS) {
        const count = item.id === "all" ? counts.all : counts[item.id] || 0;
        const active = item.id === state.chatSearchFilter;
        const disabled = item.id !== "all" && count === 0;
        const btn = el(
          "button",
          {
            class: `chat-search-filter${active ? " is-active" : ""}`,
            type: "button",
            role: "tab",
            "aria-selected": active ? "true" : "false",
            "data-action": "chat-search-filter",
            "data-filter": item.id,
            ...(disabled ? { disabled: "true" } : {}),
          },
          [item.label, el("span", { class: "chat-search-filter-count" }, [String(count)])]
        );
        filters.push(btn);
      }
    }
    const filterRow = filters.length ? el("div", { class: "chat-search-filters", role: "tablist" }, filters) : null;
    searchBar = el("div", { class: "chat-search" }, [row, ...(filterRow ? [filterRow] : [])]);
  }

  let searchFooter: HTMLElement | null = null;
  if (state.selected && state.chatSearchOpen) {
    const total = hits.length;
    const hasQuery = Boolean((state.chatSearchQuery || "").trim());
    const countLabel = total ? `${Math.min(activePos + 1, total)}/${total}` : hasQuery ? "0/0" : "";
    const count = el(
      "span",
      { class: `chat-search-count${hasQuery ? "" : " is-empty"}`, "aria-live": "polite" },
      [countLabel || ""]
    );
    const dateInput = el("input", {
      class: "modal-input chat-search-date",
      id: "chat-search-date",
      type: "date",
      "aria-label": "Перейти к дате",
    }) as HTMLInputElement;
    dateInput.value = state.chatSearchDate || "";
    const dateClear = el(
      "button",
      {
        class: "btn chat-search-date-clear",
        type: "button",
        title: "Сбросить дату",
        "data-action": "chat-search-date-clear",
        ...(dateInput.value ? {} : { disabled: "true" }),
      },
      ["×"]
    );
    const btnPrev = el(
      "button",
      {
        class: "btn chat-search-nav",
        type: "button",
        "data-action": "chat-search-prev",
        "aria-label": "Предыдущий результат",
        ...(total ? {} : { disabled: "true" }),
      },
      ["↑"]
    );
    const btnNext = el(
      "button",
      {
        class: "btn chat-search-nav",
        type: "button",
        "data-action": "chat-search-next",
        "aria-label": "Следующий результат",
        ...(total ? {} : { disabled: "true" }),
      },
      ["↓"]
    );
    const controls = el("div", { class: "chat-search-controls" }, [btnPrev, btnNext]);
    const footerClass = `chat-search-footer-row${searchResultsOpen ? " is-open" : ""}`;
    searchFooter = el(
      "div",
      { class: footerClass, "data-action": "chat-search-results-toggle", "aria-expanded": searchResultsOpen ? "true" : "false" },
      [count, dateInput, dateClear, controls]
    );
  }

  if (searchResultsOpen) {
    const maxResults = 200;
    const totalHits = hits.length;
    let windowStart = 0;
    let windowHits = hits;
    if (totalHits > maxResults) {
      const half = Math.floor(maxResults / 2);
      const clampStart = Math.max(0, Math.min(totalHits - maxResults, activePos - half));
      windowStart = clampStart;
      windowHits = hits.slice(windowStart, windowStart + maxResults);
    }
    const rows: HTMLElement[] = [];
    const showFrom = Boolean(state.selected && state.selected.kind !== "dm");
    for (let i = 0; i < windowHits.length; i += 1) {
      const msgIdx = windowHits[i];
      const m = msgs[msgIdx];
      if (!m) continue;
      const hitPos = windowStart + i;
      const preview = trimSearchPreview(searchResultPreview(m));
      const textEl = el("div", { class: "chat-search-result-text" }, [preview]);
      const metaItems: HTMLElement[] = [];
      if (showFrom && m.kind !== "sys") {
        metaItems.push(el("span", { class: "chat-search-result-from" }, [resolveUserLabel(state, m.from, friendLabels)]));
      }
      const time = typeof m.ts === "number" && Number.isFinite(m.ts) ? formatTime(m.ts) : "";
      if (time) {
        metaItems.push(el("span", { class: "chat-search-result-time" }, [time]));
      }
      const body = el("div", { class: "chat-search-result-body" }, [textEl, ...(metaItems.length ? [el("div", { class: "chat-search-result-meta" }, metaItems)] : [])]);
      const active = hitPos === activePos;
      rows.push(
        el(
          "button",
          {
            class: `chat-search-result${active ? " is-active" : ""}`,
            type: "button",
            "data-action": "chat-search-result",
            "data-msg-idx": String(msgIdx),
            "data-hit-pos": String(hitPos),
            ...(active ? { "aria-current": "true" } : {}),
          },
          [body]
        )
      );
    }
    if (!rows.length) {
      rows.push(el("div", { class: "chat-search-results-empty" }, ["Ничего не найдено"]));
    }
    const list = el("div", { class: "chat-search-results-list", role: "list" }, rows);
    const header =
      totalHits > maxResults
        ? el("div", { class: "chat-search-results-hint" }, [
            `Показаны ${windowStart + 1}–${windowStart + windowHits.length} из ${totalHits}`,
          ])
        : null;
    layout.chatSearchResults.classList.remove("hidden");
    layout.chatSearchResults.replaceChildren(...(header ? [header, list] : [list]));
  } else {
    layout.chatSearchResults.classList.add("hidden");
    layout.chatSearchResults.replaceChildren();
  }

  let pinnedBar: HTMLElement | null = null;
  if (Array.isArray(pinnedIds) && pinnedIds.length) {
    const activeId = typeof activeRaw === "number" && pinnedIds.includes(activeRaw) ? activeRaw : pinnedIds[0];
    const activeIdx = Math.max(0, pinnedIds.indexOf(activeId));
    const pinnedMsg = msgs.find((m) => typeof m.id === "number" && m.id === activeId) || null;
    const previewRaw =
      pinnedMsg?.attachment?.kind === "file"
        ? `Файл: ${String(pinnedMsg.attachment.name || "файл")}`
        : String(pinnedMsg?.text || "").trim() || `Сообщение #${activeId}`;
    const preview = previewRaw.length > 140 ? `${previewRaw.slice(0, 137)}…` : previewRaw;
    const titleNodes: Array<string | HTMLElement> = ["Закреплено"];
    if (pinnedIds.length > 1) {
      titleNodes.push(
        el("span", { class: "chat-pinned-count", "aria-label": `Закреп ${activeIdx + 1} из ${pinnedIds.length}` }, [
          `${activeIdx + 1}/${pinnedIds.length}`,
        ])
      );
    }

    const jumpBtn = el(
      "button",
      { class: "chat-pinned-body", type: "button", "data-action": "chat-pinned-jump", "aria-label": "Показать закреплённое сообщение" },
      [
        el("div", { class: "chat-pinned-main" }, [
          el("span", { class: "chat-pinned-title" }, titleNodes),
          el("span", { class: "chat-pinned-text" }, [preview]),
        ]),
        el("span", { class: "chat-pinned-jump", "aria-hidden": "true" }, ["→"]),
      ]
    );
    const closeBtn = el("button", { class: "btn chat-pinned-close", type: "button", "data-action": "chat-pinned-unpin", "aria-label": "Открепить" }, [
      "×",
    ]);
    const actions: HTMLElement[] = [];
    if (pinnedIds.length > 1) {
      actions.push(el("button", { class: "btn chat-pinned-nav", type: "button", "data-action": "chat-pinned-prev", "aria-label": "Предыдущий закреп" }, ["↑"]));
      actions.push(el("button", { class: "btn chat-pinned-nav", type: "button", "data-action": "chat-pinned-next", "aria-label": "Следующий закреп" }, ["↓"]));
    }
    actions.push(closeBtn);
    pinnedBar = el("div", { class: "chat-pinned", role: "note" }, [
      jumpBtn,
      el("div", { class: "chat-pinned-actions" }, actions),
    ]);
  }

  const topChildren: HTMLElement[] = [el("div", { class: "chat-title" }, titleChildren)];
  if (pinnedBar) topChildren.push(pinnedBar);
  if (searchBar) topChildren.push(searchBar);
  layout.chatTop.replaceChildren(...topChildren);
  if (searchFooter) {
    layout.chatSearchFooter.classList.remove("hidden");
    layout.chatSearchFooter.replaceChildren(searchFooter);
  } else {
    layout.chatSearchFooter.classList.add("hidden");
    layout.chatSearchFooter.replaceChildren();
  }
  if (selectionCount > 0) {
    const selectedMsgs =
      selectionSet && selectionSet.size
        ? msgs.filter((msg) => {
            const selKey = messageSelectionKey(msg);
            return Boolean(selKey && selectionSet.has(selKey));
          })
        : [];
    const canCopy = selectedMsgs.some((msg) => {
      if (!msg) return false;
      const raw = String(msg.text || "").trim();
      if (raw && !raw.startsWith("[file]")) return true;
      const att = msg.attachment;
      if (att?.kind === "file") return Boolean(String(att.name || "").trim());
      return false;
    });
    const fileIds = (() => {
      const out = new Set<string>();
      for (const msg of selectedMsgs) {
        const fid = msg?.attachment?.kind === "file" ? String(msg.attachment.fileId || "").trim() : "";
        if (fid) out.add(fid);
      }
      return out;
    })();
    const scheduledCount = selectedMsgs.filter((msg) => {
      const at = typeof msg?.scheduleAt === "number" && Number.isFinite(msg.scheduleAt) ? Math.trunc(msg.scheduleAt) : 0;
      return at > Date.now() + 1200;
    }).length;
    const pinCandidates = selectedMsgs
      .map((msg) => (typeof msg.id === "number" && Number.isFinite(msg.id) ? Math.trunc(msg.id) : 0))
      .filter((id) => id > 0);
    const canPin = pinCandidates.length > 0;
    const allPinned = canPin && pinCandidates.every((id) => isPinnedMessage(state.pinnedMessages, key, id));
    const pinLabel = allPinned ? "📍" : "📌";
    const pinTitle = allPinned ? "Открепить" : "Закрепить";
    const cancelBtn = el(
      "button",
      {
        class: "btn chat-selection-cancel",
        type: "button",
        "data-action": "chat-selection-cancel",
        "aria-label": "Отменить выбор",
      },
      ["×"]
    );
    const countNode = el("div", { class: "chat-selection-count" }, [formatSelectionCount(selectionCount)]);
    const forwardBtn = el(
      "button",
      {
        class: "btn chat-selection-action",
        type: "button",
        "data-action": "chat-selection-forward",
        "aria-label": "Переслать выбранные сообщения",
        title: "Переслать",
      },
      ["↪"]
    );
    const copyBtn = el(
      "button",
      {
        class: "btn chat-selection-action",
        type: "button",
        "data-action": "chat-selection-copy",
        "aria-label": "Скопировать выбранные сообщения",
        title: "Скопировать",
        ...(canCopy ? {} : { disabled: "true" }),
      },
      ["📋"]
    );
    const downloadBtn =
      fileIds.size > 0
        ? el(
            "button",
            {
              class: "btn chat-selection-action",
              type: "button",
              "data-action": "chat-selection-download",
              "aria-label": "Скачать выбранные файлы",
              title: "Скачать",
            },
            ["⬇️"]
          )
        : null;
    const sendNowBtn =
      scheduledCount > 0
        ? el(
            "button",
            {
              class: "btn chat-selection-action",
              type: "button",
              "data-action": "chat-selection-send-now",
              "aria-label": "Отправить сейчас выбранные сообщения из очереди",
              title: "Отправить сейчас",
            },
            ["⚡"]
          )
        : null;
    const deleteBtn = el(
      "button",
      {
        class: "btn chat-selection-action chat-selection-danger",
        type: "button",
        "data-action": "chat-selection-delete",
        "aria-label": "Удалить выбранные сообщения",
        title: "Удалить",
      },
      ["🗑️"]
    );
    const pinBtn = el(
      "button",
      {
        class: "btn chat-selection-action",
        type: "button",
        "data-action": "chat-selection-pin",
        "aria-label": pinTitle,
        title: pinTitle,
        ...(canPin ? {} : { disabled: "true" }),
      },
      [pinLabel]
    );
    const actions = el("div", { class: "chat-selection-actions" }, [
      forwardBtn,
      copyBtn,
      ...(downloadBtn ? [downloadBtn] : []),
      ...(sendNowBtn ? [sendNowBtn] : []),
      deleteBtn,
      pinBtn,
    ]);
    const left = el("div", { class: "chat-selection-container-left" }, [cancelBtn, countNode]);
    const right = el("div", { class: "chat-selection-container-right" }, [actions]);
    const inner = el("div", { class: "chat-selection-inner" }, [left, right]);
    layout.chatSelectionBar.classList.remove("hidden");
    layout.chatSelectionBar.replaceChildren(inner);
  } else {
    layout.chatSelectionBar.classList.add("hidden");
    layout.chatSelectionBar.replaceChildren();
  }
  const linesClass = isEmptyState ? "chat-lines chat-lines-empty" : "chat-lines";
  scrollHost.replaceChildren(el("div", { class: linesClass }, lines));
  try {
    scrollHost.dispatchEvent(new Event("yagodka:chat-rendered"));
  } catch {
    // ignore
  }

  if (virtualEnabled && key) {
    const w = typeof window !== "undefined" ? window : null;
    if (hostState.__chatVirtualAvgRaf) {
      // already scheduled
    } else {
      const schedule = () => {
        hostState.__chatVirtualAvgRaf = null;
        const linesEl = scrollHost.firstElementChild as HTMLElement | null;
        if (!linesEl) return;
        const children = Array.from(linesEl.children) as HTMLElement[];
        let spacerHeight = 0;
        let spacerCount = 0;
        for (const child of children) {
          if (child.getAttribute("data-virtual-spacer")) {
            spacerHeight += child.offsetHeight;
            spacerCount += 1;
          }
        }
        const totalHeight = Math.max(0, linesEl.scrollHeight - spacerHeight);
        const lineCount = Math.max(1, children.length - spacerCount);
        const avg = clampVirtualAvg(totalHeight / lineCount);
        virtualAvgMap.set(key, avg);
      };
      if (w && typeof w.requestAnimationFrame === "function") {
        hostState.__chatVirtualAvgRaf = w.requestAnimationFrame(schedule);
      } else {
        hostState.__chatVirtualAvgRaf = 1;
        schedule();
      }
    }
  }

  // iOS/WebKit: images and media previews may change the history height after render.
  // Keep the chat pinned to bottom on content height changes, or preserve a visible anchor when not pinned.
  if (key && typeof ResizeObserver === "function") {
    try {
      if (!hostState.__chatLinesObserver) {
        hostState.__chatLinesObserverRaf = null;
        hostState.__chatLinesObserver = new ResizeObserver(() => {
          const w = typeof window !== "undefined" ? window : null;
          if (hostState.__chatLinesObserverRaf !== null) return;
          const run = () => {
            hostState.__chatLinesObserverRaf = null;
            const curKey = String(scrollHost.getAttribute("data-chat-key") || "");
            if (!curKey) return;
            const st = hostState.__stickBottom;
            if (st && st.active && st.key === curKey) {
              scrollHost.scrollTop = Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
              return;
            }
            const anchor = hostState.__chatShiftAnchor as ChatShiftAnchor | null;
            if (!anchor || anchor.key !== curKey) return;
            if (Math.abs(scrollHost.scrollTop - anchor.scrollTop) > 2) {
              hostState.__chatShiftAnchor = captureChatShiftAnchor(scrollHost, curKey);
              return;
            }
            const anchorEl = findChatShiftAnchorElement(scrollHost, anchor);
            if (!anchorEl) return;
            const rect = anchorEl.getBoundingClientRect();
            const delta = rect.bottom - anchor.rectBottom;
            if (Math.abs(delta) >= 1) {
              scrollHost.scrollTop += delta;
            }
            anchor.rectBottom = rect.bottom;
            anchor.scrollTop = scrollHost.scrollTop;
          };
          if (w && typeof w.requestAnimationFrame === "function") {
            hostState.__chatLinesObserverRaf = w.requestAnimationFrame(run);
          } else {
            hostState.__chatLinesObserverRaf = 1;
            run();
          }
        });
      }
      const linesEl = scrollHost.firstElementChild as HTMLElement | null;
      if (linesEl && hostState.__chatLinesObserved !== linesEl) {
        hostState.__chatLinesObserver.disconnect();
        hostState.__chatLinesObserver.observe(linesEl);
        hostState.__chatLinesObserved = linesEl;
      }
    } catch {
      // ignore
    }
  }

  if (!shouldStick && !keyChanged) {
    // Preserve the user's position in history unless we explicitly want to stick to bottom.
    // Some browsers may reset scrollTop when we replace the chat DOM; also keep the visible anchor stable on prepends.
    try {
      const maxTop = Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
      const nextTop = Math.max(0, Math.min(maxTop, prevScrollTop));
      if (Math.abs(scrollHost.scrollTop - nextTop) >= 1) scrollHost.scrollTop = nextTop;
      if (preShiftAnchor && (preShiftAnchor.msgKey || preShiftAnchor.msgId !== undefined)) {
        const anchorEl = findChatShiftAnchorElement(scrollHost, preShiftAnchor);
        if (anchorEl) {
          const rect = anchorEl.getBoundingClientRect();
          const delta = rect.bottom - preShiftAnchor.rectBottom;
          if (Math.abs(delta) >= 1) {
            const corrected = Math.max(0, Math.min(maxTop, scrollHost.scrollTop + delta));
            if (Math.abs(scrollHost.scrollTop - corrected) >= 1) scrollHost.scrollTop = corrected;
          }
        }
      }
    } catch {
      // ignore
    }
  }
  const atBottomNow = scrollHost.scrollTop >= maxScrollTop() - 24;
  layout.chatJump.classList.toggle("hidden", !key || shouldStick || atBottomNow);
  if (shouldStick) {
    const stickNow = () => {
      const curKey = String(scrollHost.getAttribute("data-chat-key") || "");
      const st = hostState.__stickBottom;
      if (!curKey || curKey !== key) return;
      if (!st || !st.active || st.key !== key) return;
      scrollHost.scrollTop = Math.max(0, scrollHost.scrollHeight - scrollHost.clientHeight);
    };
    queueMicrotask(stickNow);
  }
  if (key && !shouldStick) {
    hostState.__chatShiftAnchor = captureChatShiftAnchor(scrollHost, key);
  } else if (hostState.__chatShiftAnchor) {
    hostState.__chatShiftAnchor = null;
  }
}
