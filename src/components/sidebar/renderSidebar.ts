import { el } from "../../helpers/dom/el";
import { dmKey, roomKey } from "../../helpers/chat/conversationKey";
import { isIOS, isStandaloneDisplayMode } from "../../helpers/ui/iosInputAssistant";
import { isMobileLikeUi } from "../../helpers/ui/mobileLike";
import type { ActionModalPayload, AppState, FriendEntry, MobileSidebarTab, PageKind, TargetRef } from "../../stores/types";
import {
  attentionHintForPeer,
  collectAttentionPeers,
  collectSelfMentionHandles,
  compactOneLine,
  displayNameForFriend,
  friendRow,
  hasSelfMention,
  isRowMenuOpen,
  previewForConversation,
  roomRow,
} from "./renderSidebarHelpers";
import { clearDeferredSidebarMenu, renderSidebarMenuDeferred } from "./renderSidebarMenuRuntime";
import { clearDeferredSidebarDesktopTabs, renderSidebarDesktopTabsDeferred } from "./renderSidebarDesktopTabsRuntime";
import { clearDeferredSidebarMobile, renderSidebarMobileDeferred } from "./renderSidebarMobileRuntime";
import { clearDeferredSidebarStandalone, renderSidebarStandaloneDeferred } from "./renderSidebarStandaloneRuntime";
import { createSidebarRenderTools } from "./renderSidebarUiTools";

export function renderSidebar(
  target: HTMLElement,
  state: AppState,
  onSelect: (t: TargetRef) => void,
  onOpenUser: (id: string) => void,
  onOpenAction: (payload: ActionModalPayload) => void,
  onSetPage: (page: PageKind) => void,
  onCreateGroup: () => void,
  onCreateBoard: () => void,
  onSetMobileSidebarTab: (tab: MobileSidebarTab) => void,
  onSetSidebarFolderId: (folderId: string) => void,
  onSetSidebarQuery: (query: string) => void,
  onAuthOpen: () => void,
  onAuthLogout: () => void,
  onOpenSidebarToolsMenu: (x: number, y: number) => void,
  onToggleSidebarArchive: () => void = () => {},
  sidebarDock?: HTMLElement | null
) {
  const isMobile =
    typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(max-width: 600px)").matches : false;
  const mobileUi = isMobileLikeUi();
  const disableSearchWhileTyping = (() => {
    try {
      if (!isIOS()) return false;
      const ae = document.activeElement as any;
      const mode = typeof ae?.getAttribute === "function" ? String(ae.getAttribute("data-ios-assistant") || "") : "";
      return mode === "composer";
    } catch {
      return false;
    }
  })();
  const hostState = target as any;
  const prevRender = hostState.__sidebarRenderState as
    | {
        page: string;
        selectedKind: string;
        selectedId: string;
        mobileTab: string;
        sidebarQuery: string;
        sidebarArchiveOpen: boolean;
        conn: string;
        authed: boolean;
        selfId: string;
        isMobile: boolean;
        mobileUi: boolean;
        disableSearchWhileTyping: boolean;
        presenceTick: number;
        avatarsRev: number;
        friendsRef: AppState["friends"];
        groupsRef: AppState["groups"];
        boardsRef: AppState["boards"];
        profilesRef: AppState["profiles"];
	        conversationsRef: AppState["conversations"];
	        pinnedRef: AppState["pinned"];
	        archivedRef: AppState["archived"];
	        mutedRef: AppState["muted"];
	        pendingInRef: AppState["pendingIn"];
        pendingOutRef: AppState["pendingOut"];
        pendingGroupInvitesRef: AppState["pendingGroupInvites"];
        pendingGroupJoinRequestsRef: AppState["pendingGroupJoinRequests"];
        pendingBoardInvitesRef: AppState["pendingBoardInvites"];
        fileOffersInRef: AppState["fileOffersIn"];
      }
    | null;
  const selectedKind = state.selected?.kind ? String(state.selected.kind) : "";
  const selectedId = state.selected?.id ? String(state.selected.id) : "";
  const sidebarQueryRaw = compactOneLine(String((state as any).sidebarQuery || ""));
  const renderState = {
    page: state.page,
    selectedKind,
    selectedId,
    mobileTab: String(state.mobileSidebarTab || ""),
    sidebarQuery: sidebarQueryRaw,
    sidebarArchiveOpen: state.sidebarArchiveOpen !== false,
    conn: String(state.conn || ""),
    authed: Boolean(state.authed),
    selfId: String(state.selfId || ""),
    isMobile,
    mobileUi,
    disableSearchWhileTyping,
    presenceTick: Math.max(0, Math.trunc(Number((state as any).presenceTick || 0) || 0)),
    avatarsRev: Math.max(0, Math.trunc(Number((state as any).avatarsRev || 0) || 0)),
    friendsRef: state.friends,
    groupsRef: state.groups,
    boardsRef: state.boards,
	    profilesRef: state.profiles,
	    conversationsRef: state.conversations,
	    pinnedRef: state.pinned,
	    archivedRef: state.archived,
	    mutedRef: state.muted,
	    pendingInRef: state.pendingIn,
    pendingOutRef: state.pendingOut,
    pendingGroupInvitesRef: state.pendingGroupInvites,
    pendingGroupJoinRequestsRef: state.pendingGroupJoinRequests,
    pendingBoardInvitesRef: state.pendingBoardInvites,
    fileOffersInRef: state.fileOffersIn,
  };
  const canSkipRender =
    prevRender &&
    prevRender.page === renderState.page &&
    prevRender.selectedKind === renderState.selectedKind &&
    prevRender.selectedId === renderState.selectedId &&
    prevRender.mobileTab === renderState.mobileTab &&
    prevRender.sidebarQuery === renderState.sidebarQuery &&
    prevRender.sidebarArchiveOpen === renderState.sidebarArchiveOpen &&
    prevRender.conn === renderState.conn &&
    prevRender.authed === renderState.authed &&
    prevRender.selfId === renderState.selfId &&
    prevRender.isMobile === renderState.isMobile &&
    prevRender.mobileUi === renderState.mobileUi &&
    prevRender.disableSearchWhileTyping === renderState.disableSearchWhileTyping &&
    prevRender.presenceTick === renderState.presenceTick &&
    prevRender.avatarsRev === renderState.avatarsRev &&
    prevRender.friendsRef === renderState.friendsRef &&
    prevRender.groupsRef === renderState.groupsRef &&
    prevRender.boardsRef === renderState.boardsRef &&
    prevRender.profilesRef === renderState.profilesRef &&
	    prevRender.conversationsRef === renderState.conversationsRef &&
	    prevRender.pinnedRef === renderState.pinnedRef &&
	    prevRender.archivedRef === renderState.archivedRef &&
	    prevRender.mutedRef === renderState.mutedRef &&
    prevRender.pendingInRef === renderState.pendingInRef &&
    prevRender.pendingOutRef === renderState.pendingOutRef &&
    prevRender.pendingGroupInvitesRef === renderState.pendingGroupInvitesRef &&
    prevRender.pendingGroupJoinRequestsRef === renderState.pendingGroupJoinRequestsRef &&
    prevRender.pendingBoardInvitesRef === renderState.pendingBoardInvitesRef &&
    prevRender.fileOffersInRef === renderState.fileOffersInRef;
  if (canSkipRender) return;
  hostState.__sidebarRenderState = renderState;

  const roomUnreadCache = new Map<string, number>();
  const computeRoomUnread = (key: string): number => {
    if (!key.startsWith("room:")) return 0;
    if (roomUnreadCache.has(key)) return roomUnreadCache.get(key) || 0;
    const conv = state.conversations?.[key] || [];
    if (!Array.isArray(conv) || conv.length === 0) {
      roomUnreadCache.set(key, 0);
      return 0;
    }
    const marker = state.lastRead?.[key];
    const lastReadId = Number((marker as any)?.id ?? 0);
    const lastReadTs = Number((marker as any)?.ts ?? 0);
    if (lastReadId <= 0 && lastReadTs <= 0) {
      roomUnreadCache.set(key, 0);
      return 0;
    }
    let count = 0;
    for (let i = conv.length - 1; i >= 0; i -= 1) {
      const msg = conv[i] as any;
      if (!msg || msg.kind !== "in") continue;
      const msgId = Number(msg.id ?? 0);
      const msgTs = Number(msg.ts ?? 0);
      if (lastReadId > 0) {
        if (Number.isFinite(msgId) && msgId > lastReadId) {
          count += 1;
          continue;
        }
        if (Number.isFinite(msgId) && msgId <= lastReadId) break;
        if (lastReadTs > 0 && msgTs > lastReadTs) {
          count += 1;
          continue;
        }
        if (lastReadTs > 0 && msgTs <= lastReadTs) break;
        continue;
      }
      if (lastReadTs > 0) {
        if (msgTs > lastReadTs) {
          count += 1;
          continue;
        }
        if (msgTs > 0 && msgTs <= lastReadTs) break;
      }
    }
    roomUnreadCache.set(key, count);
    return count;
  };
  const lastTsForKey = (key: string): number => {
    const conv = state.conversations[key] || [];
    const last = conv.length ? conv[conv.length - 1] : null;
    const ts = last && typeof last.ts === "number" && Number.isFinite(last.ts) ? last.ts : 0;
    return Math.max(0, ts);
  };
  const drafts = state.drafts || {};
  const pinnedKeys = state.pinned || [];
  const pinnedSet = new Set(pinnedKeys);
  const attnSet = collectAttentionPeers(state);
  const mutedSet = new Set((state.muted || []).map((x) => String(x || "").trim()).filter(Boolean));
  const isMuted = (id: string): boolean => mutedSet.has(String(id || "").trim());
  const selfMentionHandles = collectSelfMentionHandles(state);
  const mentionForKey = (key: string): boolean => {
    if (!selfMentionHandles.size) return false;
    const conv = state.conversations[key] || [];
    const last = conv.length ? conv[conv.length - 1] : null;
    if (!last) return false;
    if (last.kind !== "in") return false;
    const from = String(last.from || "").trim();
    if (from && state.selfId && from === state.selfId) return false;
    const mentioned = hasSelfMention(String(last.text || ""), selfMentionHandles);
    if (!mentioned) return false;
    if (!key.startsWith("room:")) return true;
    const marker = state.lastRead?.[key];
    const lastReadId = Number(marker?.id ?? 0);
    const lastReadTs = Number(marker?.ts ?? 0);
    const msgId = Number(last.id ?? 0);
    const msgTs = Number(last.ts ?? 0);
    if (lastReadId > 0 && Number.isFinite(msgId) && msgId > 0 && msgId <= lastReadId) return false;
    if (lastReadId <= 0 && lastReadTs > 0 && msgTs > 0 && msgTs <= lastReadTs) return false;
    return true;
  };
  const friendMap = new Map<string, FriendEntry>();
  for (const f of state.friends || []) {
    const id = String(f.id || "").trim();
    if (!id) continue;
    friendMap.set(id, f);
  }
  const friendIdSet = new Set(friendMap.keys());
  const unknownAttnPeers = Array.from(attnSet).filter((id) => !friendIdSet.has(id)).sort();
  const boards = state.boards || [];
  const groups = state.groups || [];
  const sel = state.selected;
  const sidebarQuery = sidebarQueryRaw.toLowerCase();
  const hasSidebarQuery = Boolean(sidebarQuery);
  const body = (() => {
    const existing =
      typeof (target as HTMLElement | null)?.querySelector === "function"
        ? ((target as HTMLElement).querySelector(".sidebar-body") as HTMLElement | null)
        : null;
    if (existing) return existing;
    const cached = (target as any)._sidebarBody as HTMLElement | null | undefined;
    if (cached) return cached;
    return el("div", { class: "sidebar-body" });
  })();
  if (!(target as any)._sidebarBody) (target as any)._sidebarBody = body;
  const {
    toggleClass,
    markCompactAvatarRows,
    dialogPriority,
    buildSidebarHeaderToolbar,
    buildSidebarTabButton,
    buildContactRows,
    buildTopPeerContactRows,
    bindHeaderScroll,
    buildFolderTabs,
    buildSidebarSearchBar,
    buildSidebarArchiveToggle,
    buildSidebarArchiveHint,
    buildSidebarArchiveEmpty,
    buildChatlist,
    clearVirtualChatlist,
  } = createSidebarRenderTools({
    body,
    state,
    selected: sel,
    drafts,
    attnSet,
    sidebarQueryRaw,
    disableSearchWhileTyping,
    onSetMobileSidebarTab,
    onSetSidebarFolderId,
    onSetSidebarQuery,
    onOpenUser,
    onSelect,
    onOpenSidebarToolsMenu,
    onCreateGroup,
    onCreateBoard,
    onToggleSidebarArchive,
  });
  toggleClass(body, "sidebar-mobile-body", isMobile);
  const setBodyChatlistClass = (children: HTMLElement[]) => {
    const hasChatlist = children.some((child) => Boolean(child?.classList?.contains("chatlist")));
    toggleClass(body, "sidebar-body-chatlist", hasChatlist);
  };
  if (sidebarDock) {
    toggleClass(sidebarDock, "hidden", true);
    toggleClass(sidebarDock, "sidebar-desktop-bottom", false);
    toggleClass(sidebarDock, "sidebar-mobile-bottom", false);
    sidebarDock.replaceChildren();
  }
  const prevPage = String((target as any)._sidebarPrevPage || "").trim();
  const pageChanged = Boolean(prevPage && prevPage !== state.page);
  if (pageChanged && state.page === "main") {
    try {
      (target as HTMLElement).dataset.sidebarResetScroll = "1";
      body.dataset.sidebarResetScroll = "1";
    } catch {
      // ignore
    }
  }
  const currentSelectedKey = (() => {
    if (state.page !== "main") return "";
    const sel = state.selected;
    if (!sel) return "";
    const id = String((sel as any).id || "").trim();
    if (!id) return "";
    if (sel.kind === "dm") return dmKey(id);
    if (sel.kind === "group" || sel.kind === "board") return roomKey(id);
    return "";
  })();
  const prevSelectedKey = String((target as any)._sidebarPrevSelectedKey || "").trim();
  const shouldResetOnReturn = Boolean(
    (isMobile || isStandaloneDisplayMode()) && prevSelectedKey && !currentSelectedKey && state.page === "main"
  );
  if (shouldResetOnReturn) {
    try {
      (target as HTMLElement).dataset.sidebarResetScroll = "1";
      body.dataset.sidebarResetScroll = "1";
    } catch {
      // ignore
    }
  }
  (target as any)._sidebarPrevPage = state.page;
  (target as any)._sidebarPrevSelectedKey = currentSelectedKey;
  const forceResetScroll = (() => {
    try {
      return (
        (target as HTMLElement).dataset.sidebarResetScroll === "1" ||
        body.dataset.sidebarResetScroll === "1"
      );
    } catch {
      return false;
    }
  })();
  const matchesQuery = (raw: string): boolean => {
    if (!hasSidebarQuery) return true;
    return String(raw || "").toLowerCase().includes(sidebarQuery);
  };

  const matchesFriend = (f: FriendEntry): boolean => {
    if (!hasSidebarQuery) return true;
    const id = String(f.id || "").trim();
    const p = id ? state.profiles?.[id] : null;
    const dn = displayNameForFriend(state, f);
    const handle = p?.handle ? String(p.handle).trim() : "";
    const h = handle ? (handle.startsWith("@") ? handle : `@${handle}`) : "";
    return matchesQuery([dn, h, id].filter(Boolean).join(" "));
  };

  const matchesRoom = (entry: { id: string; name?: string | null; handle?: string | null }): boolean => {
    if (!hasSidebarQuery) return true;
    const id = String(entry.id || "").trim();
    const name = entry.name ? String(entry.name).trim() : "";
    const handle = entry.handle ? String(entry.handle).trim() : "";
    const h = handle ? (handle.startsWith("@") ? handle : `@${handle}`) : "";
    return matchesQuery([name, h, id].filter(Boolean).join(" "));
  };
  const hasActiveDialogForFriend = (f: FriendEntry): boolean => {
    const id = String(f.id || "").trim();
    if (!id) return false;
    const k = dmKey(id);
    const conv = state.conversations[k] || [];
    const hasConv = conv.length > 0;
    const hasDraft = Boolean(String(drafts[k] || "").trim());
    const unread = Math.max(0, Number(f.unread || 0) || 0);
    const attention = attnSet.has(id);
    return hasConv || hasDraft || unread > 0 || attention;
  };

  const archivedKeys = Array.isArray(state.archived) ? state.archived : [];
  const archivedSet = new Set(archivedKeys);

  const chatArchiveCount = hasSidebarQuery
    ? 0
    : (() => {
        let count = 0;
        for (const key of archivedKeys) {
          if (pinnedSet.has(key)) continue;
          if (key.startsWith("dm:")) {
            const id = key.slice(3);
            const f = friendMap.get(id);
            if (f && matchesFriend(f) && hasActiveDialogForFriend(f)) count += 1;
            continue;
          }
          if (key.startsWith("room:")) {
            const roomId = key.slice(5);
            const g = groups.find((x) => String(x?.id || "") === roomId);
            if (g && matchesRoom(g)) count += 1;
          }
        }
        return count;
      })();
  const chatArchiveVisible = chatArchiveCount > 0;
  const chatArchiveOpen = chatArchiveVisible && state.sidebarArchiveOpen !== false;
  const chatArchiveToggle = chatArchiveVisible ? buildSidebarArchiveToggle(chatArchiveCount, chatArchiveOpen) : null;

  const boardArchiveCount = hasSidebarQuery
    ? 0
    : (() => {
        let count = 0;
        for (const key of archivedKeys) {
          if (pinnedSet.has(key)) continue;
          if (!key.startsWith("room:")) continue;
          const roomId = key.slice(5);
          const b = boards.find((x) => String(x?.id || "") === roomId);
          if (b && matchesRoom(b)) count += 1;
        }
        return count;
      })();
  const boardArchiveVisible = boardArchiveCount > 0;
  const boardArchiveOpen = boardArchiveVisible && state.sidebarArchiveOpen !== false;
  const boardArchiveToggle = boardArchiveVisible ? buildSidebarArchiveToggle(boardArchiveCount, boardArchiveOpen) : null;

  const contactCandidates = (state.friends || []).filter((f) => matchesFriend(f) && !pinnedSet.has(dmKey(f.id)));
  const activeContacts = contactCandidates.filter((f) => hasActiveDialogForFriend(f));
  const archivedContacts = contactCandidates.filter((f) => !hasActiveDialogForFriend(f));
  const archiveCount = hasSidebarQuery ? 0 : archivedContacts.length;
  const archiveVisible = archiveCount > 0;
  const archiveOpen = archiveVisible && state.sidebarArchiveOpen !== false;
  const archiveToggle = archiveVisible ? buildSidebarArchiveToggle(archiveCount, archiveOpen) : null;
  clearVirtualChatlist();


  if (isMobile) {
    clearDeferredSidebarDesktopTabs(target);
    clearDeferredSidebarMenu(target);
    clearDeferredSidebarStandalone(target);
    renderSidebarMobileDeferred({
      target, state, body, isMobile, mobileUi,
      forceResetScroll, hasSidebarQuery,
      archiveToggle, chatArchiveToggle, boardArchiveToggle, chatArchiveOpen, boardArchiveOpen, archiveOpen,
      chatArchiveCount, boardArchiveCount, buildSidebarArchiveHint, buildSidebarArchiveEmpty,
      pinnedKeys, pinnedSet, archivedSet, groups, boards, sel, drafts,
      matchesQuery, matchesFriend, matchesRoom, isMuted, lastTsForKey, attnSet, mentionForKey, computeRoomUnread,
      buildSidebarTabButton, buildSidebarSearchBar, buildFolderTabs, buildChatlist,
      setBodyChatlistClass, bindHeaderScroll, toggleClass, markCompactAvatarRows, dialogPriority, hasActiveDialogForFriend,
      unknownAttnPeers, contactCandidates, activeContacts, archivedContacts, buildContactRows, buildTopPeerContactRows,
      onSelect, onOpenUser, onSetPage, onCreateGroup, onCreateBoard, onAuthOpen, onAuthLogout,
    });
    return;
  }
  clearDeferredSidebarMobile(target);

  if ("dataset" in target) delete (target as HTMLElement).dataset.sidebarTab;

  // PWA (standalone/fullscreen): tabs should behave like mobile (separate views),
  // not just as "scroll-to" shortcuts.
  if (isStandaloneDisplayMode()) {
    clearDeferredSidebarDesktopTabs(target);
    clearDeferredSidebarMenu(target);
    renderSidebarStandaloneDeferred({
      target,
      state,
      body,
      isMobile,
      mobileUi,
      forceResetScroll,
      hasSidebarQuery,
      archiveToggle,
      chatArchiveToggle,
      boardArchiveToggle,
      chatArchiveOpen,
      boardArchiveOpen,
      archiveOpen,
      chatArchiveCount,
      boardArchiveCount,
      pinnedKeys,
      pinnedSet,
      archivedSet,
      groups,
      boards,
      sel,
      drafts,
      matchesQuery,
      matchesFriend,
      matchesRoom,
      isMuted,
      lastTsForKey,
      attnSet,
      mentionForKey,
      computeRoomUnread,
      buildSidebarArchiveHint,
      buildSidebarArchiveEmpty,
      buildSidebarHeaderToolbar,
      buildSidebarTabButton,
      buildSidebarSearchBar,
      buildFolderTabs,
      buildChatlist,
      setBodyChatlistClass,
      bindHeaderScroll,
      toggleClass,
      markCompactAvatarRows,
      dialogPriority,
      hasActiveDialogForFriend,
      unknownAttnPeers,
      contactCandidates,
      activeContacts,
      archivedContacts,
      buildContactRows,
      buildTopPeerContactRows,
      onSelect,
      onOpenUser,
      onSetPage,
      onCreateGroup,
      onCreateBoard,
      onAuthOpen,
      onAuthLogout,
    });
    return;
  }
  clearDeferredSidebarStandalone(target);

  // Desktop (browser): compact tabs (Контакты/Доски/Чаты), меню через кнопку в шапке.
  type DesktopTab = "contacts" | "boards" | "chats" | "menu";
  const allowMenuTab = false;
  const showMenuTab = false;
  const defaultDesktopTab: DesktopTab = unknownAttnPeers.length ? "contacts" : "chats";
  const rawDesktopTab = state.mobileSidebarTab;
  let activeDesktopTab: DesktopTab =
    rawDesktopTab === "contacts" || rawDesktopTab === "boards" || rawDesktopTab === "chats" || rawDesktopTab === "menu"
      ? rawDesktopTab
      : defaultDesktopTab;
  if (!allowMenuTab && activeDesktopTab === "menu") activeDesktopTab = defaultDesktopTab;
  if ("dataset" in target) (target as HTMLElement).dataset.sidebarTab = activeDesktopTab;
  const desktopMenuDockRow = showMenuTab
    ? (() => {
        const row = roomRow("☰", "Меню", activeDesktopTab === "menu", () => onSetMobileSidebarTab("menu"));
        row.setAttribute("title", "Меню");
        return row;
      })()
    : null;
  const shouldShowDesktopDock = Boolean(sidebarDock && desktopMenuDockRow);
  if (sidebarDock) {
    toggleClass(sidebarDock, "hidden", !desktopMenuDockRow);
    toggleClass(sidebarDock, "sidebar-desktop-bottom", Boolean(desktopMenuDockRow));
    if (desktopMenuDockRow) sidebarDock.replaceChildren(desktopMenuDockRow);
  }

  const desktopTabContacts = buildSidebarTabButton("contacts", activeDesktopTab, "Контакты");
  const desktopTabBoards = buildSidebarTabButton("boards", activeDesktopTab, "Доски");
  const desktopTabChats = buildSidebarTabButton("chats", activeDesktopTab, "Чаты");
  const desktopTabMenu = showMenuTab ? buildSidebarTabButton("menu", activeDesktopTab, "Меню") : null;

  const desktopTabs = el("div", { class: "sidebar-tabs sidebar-tabs-desktop", role: "tablist", "aria-label": "Раздел" }, [
    desktopTabContacts,
    desktopTabBoards,
    desktopTabChats,
    ...(desktopTabMenu ? [desktopTabMenu] : []),
  ]);
  const desktopTabsList = [desktopTabContacts, desktopTabBoards, desktopTabChats, ...(desktopTabMenu ? [desktopTabMenu] : [])];
  desktopTabs.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const idx = desktopTabsList.findIndex((b) => b === document.activeElement);
    const next = idx < 0 ? 0 : (idx + dir + desktopTabsList.length) % desktopTabsList.length;
    e.preventDefault();
    desktopTabsList[next]?.focus();
  });

  const searchBarAction =
    activeDesktopTab === "contacts"
      ? archiveToggle
      : activeDesktopTab === "chats"
        ? chatArchiveToggle
        : activeDesktopTab === "boards"
          ? boardArchiveToggle
          : null;
  const searchBar = buildSidebarSearchBar(
    activeDesktopTab === "contacts" ? "Поиск контакта" : activeDesktopTab === "boards" ? "Поиск доски" : "Поиск",
    searchBarAction ? { action: searchBarAction } : undefined
  );
  const headerToolbar = buildSidebarHeaderToolbar(activeDesktopTab);
  const headerStack = el("div", { class: "sidebar-header-stack" }, [
    headerToolbar,
    desktopTabs,
    ...(activeDesktopTab === "menu"
      ? [el("div", { class: "sidebar-header-title" }, ["Меню"])]
      : [searchBar]),
  ]);
  const header = el("div", { class: "sidebar-header" }, [headerStack]);
  const chatFiltersRow: HTMLElement | null = null;
  const passesChatFilter = (_opts: { kind: "dm" | "group"; unread: number; mention?: boolean; attention?: boolean }): boolean => true;

  const chatFolders = Array.isArray((state as any).chatFolders) ? (state as any).chatFolders : [];
  const rawFolderId =
    activeDesktopTab === "chats" ? String((state as any).sidebarFolderId || "all").trim().toLowerCase() : "all";
  const matchedFolder =
    rawFolderId !== "all"
      ? chatFolders.find((f: any) => String(f?.id || "").trim().toLowerCase() === rawFolderId)
      : null;
  const activeFolderId = matchedFolder ? rawFolderId : "all";
  const includeSet = matchedFolder
    ? new Set<string>((Array.isArray(matchedFolder.include) ? matchedFolder.include : []).map((x: any) => String(x || "").trim()).filter(Boolean))
    : null;
  const excludeSet = matchedFolder
    ? new Set<string>((Array.isArray(matchedFolder.exclude) ? matchedFolder.exclude : []).map((x: any) => String(x || "").trim()).filter(Boolean))
    : null;
  const folderAllowsKey = (key: string): boolean => {
    if (!matchedFolder) return true;
    const k = String(key || "").trim();
    if (!k) return false;
    if (excludeSet && excludeSet.has(k)) return false;
    if (!includeSet || !includeSet.size) return false;
    return includeSet.has(k);
  };
  const folderTabsRow = activeDesktopTab === "chats" ? buildFolderTabs(activeFolderId, chatFolders) : null;

  const pinnedBoardRows: HTMLElement[] = [];
  const pinnedContactEntries: FriendEntry[] = [];
  const pinnedDialogRowByKey = new Map<string, HTMLElement>();
  for (const key of pinnedKeys) {
    if (key.startsWith("dm:")) {
      const id = key.slice(3);
      const f = state.friends.find((x) => x.id === id);
      if (!f) continue;
      if (!matchesFriend(f)) continue;
      const k = dmKey(f.id);
      const unread = Math.max(0, Number(f.unread || 0) || 0);
      const attention = attnSet.has(f.id);
      if (activeDesktopTab === "chats" && !folderAllowsKey(k)) continue;
      if (!passesChatFilter({ kind: "dm", unread, attention })) continue;
      const meta = previewForConversation(state, k, "dm", drafts[k]);
      const row = friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === f.id), meta, onSelect, onOpenUser, attention);
      pinnedDialogRowByKey.set(key, row);
      pinnedContactEntries.push(f);
      continue;
    }
    if (!key.startsWith("room:")) continue;
    const id = key.slice(5);
    const g = groups.find((x) => x.id === id);
    if (g) {
      if (!matchesRoom(g)) continue;
      const k = roomKey(g.id);
      const meta = previewForConversation(state, k, "room", drafts[k]);
      const unread = computeRoomUnread(k);
      const mention = mentionForKey(k);
      if (activeDesktopTab === "chats" && !folderAllowsKey(k)) continue;
      if (!passesChatFilter({ kind: "group", unread, mention })) continue;
      const row = roomRow(
        null,
        String(g.name || g.id),
        Boolean(sel && sel.kind === "group" && sel.id === g.id),
        () => onSelect({ kind: "group", id: g.id }),
        { kind: "group", id: g.id },
        meta,
        { mention, muted: isMuted(g.id), unread, pinned: true, menuOpen: isRowMenuOpen(state, "group", g.id) }
      );
      pinnedDialogRowByKey.set(key, row);
      continue;
    }
    const b = boards.find((x) => x.id === id);
    if (!b) continue;
    if (!matchesRoom(b)) continue;
    const k = roomKey(b.id);
    const meta = previewForConversation(state, k, "room", drafts[k]);
    const unread = computeRoomUnread(k);
    pinnedBoardRows.push(
      roomRow(
        null,
        String(b.name || b.id),
        Boolean(sel && sel.kind === "board" && sel.id === b.id),
        () => onSelect({ kind: "board", id: b.id }),
        { kind: "board", id: b.id },
        meta,
        { muted: isMuted(b.id), unread, pinned: true, menuOpen: isRowMenuOpen(state, "board", b.id) }
      )
    );
  }

  const unknownAttnRows = unknownAttnPeers
    .filter((id) => (hasSidebarQuery ? matchesQuery(id) : true))
    .map((id) => {
      const k = dmKey(id);
      const meta = previewForConversation(state, k, "dm", drafts[k]);
      const hint = attentionHintForPeer(state, id);
      const meta2 = meta.sub ? meta : { ...meta, sub: hint };
      const pseudo: FriendEntry = { id, online: false, unread: 0 };
      return friendRow(state, pseudo, Boolean(sel && sel.kind === "dm" && sel.id === id), meta2, onSelect, onOpenUser, true);
    });

  // Keep per-tab scroll positions to avoid "random" scroll jumps on tab switch.
  const prevTab = String((target as any)._desktopSidebarPrevTab || "").trim();
  const didSwitchTab = Boolean(prevTab && prevTab !== activeDesktopTab);
  const forceTopTab = Boolean(forceResetScroll || !prevTab || didSwitchTab);
  if (forceTopTab && !forceResetScroll) {
    try {
      (target as HTMLElement).dataset.sidebarResetScroll = "1";
      body.dataset.sidebarResetScroll = "1";
    } catch {
      // ignore
    }
  }

  const mountDesktop = (children: HTMLElement[]) => {
    setBodyChatlistClass(children);
    body.replaceChildren(...children);
    const nodes: HTMLElement[] = [header, body];
    if (shouldShowDesktopDock && sidebarDock) nodes.push(sidebarDock);
    target.replaceChildren(...nodes);
    bindHeaderScroll(header);
    (target as any)._desktopSidebarPrevTab = activeDesktopTab;
    if (!forceTopTab) return;
    try {
      body.scrollTop = 0;
      body.scrollLeft = 0;
    } catch {
      // ignore
    }
    try {
      window.requestAnimationFrame(() => {
        try {
          body.scrollTop = 0;
          body.scrollLeft = 0;
        } catch {
          // ignore
        }
      });
    } catch {
      // ignore
    }
  };

  if (activeDesktopTab === "menu") {
    clearDeferredSidebarDesktopTabs(target);
    renderSidebarMenuDeferred({
      target,
      state,
      mobileUi,
      onSetPage,
      onCreateGroup,
      onCreateBoard,
      onAuthOpen,
      onAuthLogout,
      mountDesktop,
    });
    return;
  }
  clearDeferredSidebarMenu(target);

  if (activeDesktopTab === "chats") {
    clearDeferredSidebarDesktopTabs(target);
    const restGroups = groups.filter((g) => !pinnedSet.has(roomKey(g.id)));
    const dialogItems: Array<{ sortTs: number; priority: number; label: string; row: HTMLElement }> = [];
    const archivedItems: Array<{ sortTs: number; priority: number; label: string; row: HTMLElement }> = [];

    for (const f of state.friends || []) {
      const id = String(f?.id || "").trim();
      if (!id) continue;
      const k = dmKey(id);
      if (pinnedSet.has(k)) continue;
      if (!folderAllowsKey(k)) continue;
      if (!hasActiveDialogForFriend(f)) continue;
      if (!matchesFriend(f)) continue;
      const meta = previewForConversation(state, k, "dm", drafts[k]);
      const label = displayNameForFriend(state, f);
      const unread = Math.max(0, Number(f.unread || 0) || 0);
      const attention = attnSet.has(id);
      if (!passesChatFilter({ kind: "dm", unread, attention })) continue;
      const item = {
        sortTs: lastTsForKey(k),
        priority: dialogPriority({ hasDraft: meta.hasDraft, unread, attention }),
        label,
        row: friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === id), meta, onSelect, onOpenUser, attention),
      };
      if (!hasSidebarQuery && archivedSet.has(k)) archivedItems.push(item);
      else dialogItems.push(item);
    }

    for (const g of restGroups) {
      if (!matchesRoom(g)) continue;
      const k = roomKey(g.id);
      if (!folderAllowsKey(k)) continue;
      const meta = previewForConversation(state, k, "room", drafts[k]);
      const unread = computeRoomUnread(k);
      const mention = mentionForKey(k);
      const label = String(g.name || g.id);
      if (!passesChatFilter({ kind: "group", unread, mention })) continue;
      const item = {
        sortTs: lastTsForKey(k),
        priority: dialogPriority({ hasDraft: meta.hasDraft, mention, unread }),
        label,
        row: roomRow(
          null,
          label,
          Boolean(sel && sel.kind === "group" && sel.id === g.id),
          () => onSelect({ kind: "group", id: g.id }),
          { kind: "group", id: g.id },
          meta,
          { mention, muted: isMuted(g.id), unread, menuOpen: isRowMenuOpen(state, "group", g.id) }
        ),
      };
      if (!hasSidebarQuery && archivedSet.has(k)) archivedItems.push(item);
      else dialogItems.push(item);
    }

    dialogItems.sort(
      (a, b) =>
        b.sortTs - a.sortTs ||
        b.priority - a.priority ||
        a.label.localeCompare(b.label, "ru", { sensitivity: "base" })
    );
    archivedItems.sort(
      (a, b) =>
        b.sortTs - a.sortTs ||
        b.priority - a.priority ||
        a.label.localeCompare(b.label, "ru", { sensitivity: "base" })
    );
    const dialogRows = dialogItems.map((x) => x.row);
    const archivedRows = archivedItems.map((x) => x.row);
    const pinnedDialogRows = pinnedKeys
      .map((key) => pinnedDialogRowByKey.get(key))
      .filter(Boolean) as HTMLElement[];

    const chatFixedRows: HTMLElement[] = [];
    if (pinnedDialogRows.length) {
      chatFixedRows.push(...pinnedDialogRows);
    }
    chatFixedRows.push(el("div", { class: "pane-section" }, [hasSidebarQuery ? "Результаты" : "Чаты"]));
    const archiveBlock = chatArchiveOpen
      ? [
          el("div", { class: "pane-section pane-section-archive" }, [`Архив (${chatArchiveCount})`]),
          buildSidebarArchiveHint(),
          ...(archivedRows.length ? archivedRows : [buildSidebarArchiveEmpty("По текущему фильтру в архиве нет чатов.")]),
        ]
      : [];
    const chatRows = archiveBlock.length ? [...archiveBlock, ...dialogRows] : dialogRows;
    const chatList = buildChatlist(
      chatFixedRows,
      chatRows,
      hasSidebarQuery ? "(ничего не найдено)" : "(пока нет чатов)",
      { virtual: !chatArchiveOpen }
    );
    mountDesktop([...(folderTabsRow ? [folderTabsRow] : []), ...(chatFiltersRow ? [chatFiltersRow] : []), chatList]);
    return;
  }

  renderSidebarDesktopTabsDeferred({
    target,
    kind: activeDesktopTab === "boards" ? "boards" : "contacts",
    state,
    boards,
    sel,
    drafts,
    archivedSet,
    hasSidebarQuery,
    boardArchiveOpen,
    boardArchiveCount,
    archiveOpen,
    pinnedBoardRows,
    pinnedContactEntries,
    unknownAttnRows,
    activeContacts,
    archivedContacts,
    matchesRoom,
    computeRoomUnread,
    lastTsForKey,
    isMuted,
    buildSidebarArchiveHint,
    buildChatlist,
    markCompactAvatarRows,
    buildContactRows,
    buildTopPeerContactRows,
    onSelect,
    mountDesktop,
  });
}
