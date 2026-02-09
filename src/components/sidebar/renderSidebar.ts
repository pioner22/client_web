import { el } from "../../helpers/dom/el";
import { avatarHue, avatarMonogram, getStoredAvatar } from "../../helpers/avatar/avatarStore";
import { dmKey, roomKey } from "../../helpers/chat/conversationKey";
import { formatTime } from "../../helpers/time";
import { focusElement } from "../../helpers/ui/focus";
import { isIOS, isStandaloneDisplayMode } from "../../helpers/ui/iosInputAssistant";
import { isMobileLikeUi } from "../../helpers/ui/mobileLike";
import type { ActionModalPayload, AppState, ChatMessage, ContextMenuTargetKind, FriendEntry, MobileSidebarTab, PageKind, SidebarChatFilter, TargetRef } from "../../stores/types";
import {
  attentionHintForPeer,
  avatar,
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
import type { SidebarRowMeta } from "./renderSidebarHelpers";
import { renderSidebarMobile } from "./renderSidebarMobile";

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
  onSetSidebarChatFilter: (filter: SidebarChatFilter) => void,
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
        sidebarChatFilter: string;
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
    sidebarChatFilter: String(state.sidebarChatFilter || ""),
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
    prevRender.sidebarChatFilter === renderState.sidebarChatFilter &&
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

  const toggleClass = (node: HTMLElement | null | undefined, cls: string, enabled: boolean) => {
    if (!node) return;
    const list = (node as HTMLElement).classList;
    if (list && typeof list.toggle === "function") {
      list.toggle(cls, enabled);
      return;
    }
    const raw = String((node as any).className || "");
    const parts = raw.split(/\s+/).filter(Boolean);
    const has = parts.includes(cls);
    if (enabled && !has) parts.push(cls);
    if (!enabled && has) parts.splice(parts.indexOf(cls), 1);
    (node as any).className = parts.join(" ");
  };
  const markCompactAvatarRows = (rows: Array<HTMLElement | null | undefined>): HTMLElement[] => {
    const out: HTMLElement[] = [];
    for (const row of rows) {
      if (!row) continue;
      toggleClass(row, "row-avatar-compact", true);
      out.push(row);
    }
    return out;
  };
  const dialogPriority = (opts: { hasDraft: boolean; unread?: number; attention?: boolean; mention?: boolean }): number => {
    let score = 0;
    if (opts.mention) score += 4;
    if (opts.hasDraft) score += 3;
    if ((opts.unread || 0) > 0) score += 2;
    if (opts.attention) score += 1;
    return score;
  };
  const buildSidebarHeaderToolbar = (activeTab: "contacts" | "boards" | "chats" | "menu"): HTMLElement => {
    const menuBtn = el(
      "button",
      {
        class: activeTab === "menu" ? "btn sidebar-header-btn sidebar-header-btn-active" : "btn sidebar-header-btn",
        type: "button",
        title: "Меню",
        "aria-label": "Меню",
      },
      ["☰"]
    ) as HTMLButtonElement;
    menuBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof onOpenSidebarToolsMenu === "function") {
        const rect = menuBtn.getBoundingClientRect();
        onOpenSidebarToolsMenu(rect.right, rect.bottom);
        return;
      }
      onSetMobileSidebarTab("menu");
    });

    const isBoardTab = activeTab === "boards";
    const createLabel = isBoardTab ? "Создать доску" : "Создать чат";
    const createBtn = el(
      "button",
      {
        class: "btn sidebar-header-btn sidebar-header-btn-primary",
        type: "button",
        title: createLabel,
        "aria-label": createLabel,
      },
      ["+"]
    ) as HTMLButtonElement;
    createBtn.addEventListener("click", () => {
      if (isBoardTab) {
        onCreateBoard();
        return;
      }
      onCreateGroup();
    });

    return el("div", { class: "sidebar-header-toolbar" }, [menuBtn, createBtn]);
  };

  const buildSidebarTabButton = (tab: MobileSidebarTab, activeTab: MobileSidebarTab, label: string): HTMLButtonElement => {
    const btn = el(
      "button",
      {
        class: activeTab === tab ? "sidebar-tab sidebar-tab-active" : "sidebar-tab",
        type: "button",
        role: "tab",
        "aria-selected": String(activeTab === tab),
        title: label,
      },
      [label]
    ) as HTMLButtonElement;
    btn.addEventListener("click", () => onSetMobileSidebarTab(tab));
    return btn;
  };

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
  const lastSeenTs = (f: FriendEntry): number => {
    const raw = (f as any).last_seen_at;
    if (!raw) return 0;
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
    if (raw instanceof Date) {
      const ts = raw.getTime();
      return Number.isFinite(ts) ? ts : 0;
    }
    const ts = Date.parse(String(raw));
    return Number.isFinite(ts) ? ts : 0;
  };
  const formatLastSeenLabel = (ts: number): string | null => {
    if (!Number.isFinite(ts) || ts <= 0) return null;
    const now = Date.now();
    const diff = Math.max(0, now - ts);
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (diff < minute) return "был(а) только что";
    if (diff < hour) {
      const mins = Math.max(1, Math.floor(diff / minute));
      return `был(а) ${mins} мин назад`;
    }
    if (diff < day) {
      const hours = Math.max(1, Math.floor(diff / hour));
      return `был(а) ${hours} ч назад`;
    }
    const date = new Date(ts);
    if (!Number.isFinite(date.getTime())) return null;
    const label = date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
    return `был(а) ${label}`;
  };
  const lastTsForKey = (key: string): number => {
    const conv = state.conversations[key] || [];
    const last = conv.length ? conv[conv.length - 1] : null;
    const ts = last && typeof last.ts === "number" && Number.isFinite(last.ts) ? last.ts : 0;
    return Math.max(0, ts);
  };
  const contactStatusLabel = (f: FriendEntry): string | null => {
    const parts: string[] = [];
    if (f.online) {
      parts.push("в сети");
    } else {
      const seenLabel = formatLastSeenLabel(lastSeenTs(f));
      if (seenLabel) parts.push(seenLabel);
    }
    const id = String(f.id || "").trim();
    const rawHandle = String(f.handle || state.profiles?.[id]?.handle || "").trim();
    const handle = rawHandle.replace(/^@/, "");
    if (handle) parts.push(`@${handle}`);
    return parts.length ? parts.join(" · ") : null;
  };
  const compareContactsByPresence = (a: FriendEntry, b: FriendEntry): number => {
    const aOnline = Boolean(a.online);
    const bOnline = Boolean(b.online);
    if (aOnline !== bOnline) return aOnline ? -1 : 1;
    const aSeen = lastSeenTs(a);
    const bSeen = lastSeenTs(b);
    if (aSeen !== bSeen) return bSeen - aSeen;
    return displayNameForFriend(state, a).localeCompare(displayNameForFriend(state, b), "ru", { sensitivity: "base" });
  };
  const buildContactRows = (items: FriendEntry[], opts?: { sort?: boolean }): HTMLElement[] => {
    const ordered = items.slice();
    if (opts?.sort !== false) ordered.sort(compareContactsByPresence);
    return markCompactAvatarRows(
      ordered.map((f) => {
        const meta: SidebarRowMeta = {
          sub: contactStatusLabel(f),
          time: null,
          hasDraft: false,
          reactionEmoji: null,
        };
        const rowFriend = f.unread ? { ...f, unread: 0 } : f;
        return friendRow(
          state,
          rowFriend,
          Boolean(sel && sel.kind === "dm" && sel.id === f.id),
          meta,
          onSelect,
          onOpenUser,
          attnSet.has(f.id)
        );
      })
    );
  };
  const buildTopPeerContactRows = (items: FriendEntry[]): { ids: Set<string>; rows: HTMLElement[] } => {
    const topPeers = Array.isArray(state.topPeers) ? state.topPeers : [];
    if (!topPeers.length || !items.length) return { ids: new Set(), rows: [] };
    const byId = new Map<string, FriendEntry>();
    for (const f of items) {
      const id = String(f?.id || "").trim();
      if (!id || byId.has(id)) continue;
      byId.set(id, f);
    }
    const ids = new Set<string>();
    const entries: FriendEntry[] = [];
    for (const entry of topPeers) {
      const id = String((entry as any)?.id || "").trim();
      if (!id || ids.has(id)) continue;
      const f = byId.get(id);
      if (!f) continue;
      ids.add(id);
      entries.push(f);
      if (entries.length >= 12) break;
    }
    return { ids, rows: entries.length ? buildContactRows(entries, { sort: false }) : [] };
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
  const sidebarChatFilter: SidebarChatFilter =
    state.sidebarChatFilter === "unread" ||
    state.sidebarChatFilter === "mentions" ||
    state.sidebarChatFilter === "dms" ||
    state.sidebarChatFilter === "groups"
      ? state.sidebarChatFilter
      : "all";
  const effectiveChatFilter: SidebarChatFilter = hasSidebarQuery ? "all" : sidebarChatFilter;
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
  const bindHeaderScroll = (header: HTMLElement | null) => {
    const prev = (body as any)._sidebarHeaderScrollHandler as (() => void) | undefined;
    if (prev) body.removeEventListener("scroll", prev);
    if (!header) {
      delete (body as any)._sidebarHeaderScrollHandler;
      return;
    }
    const handler = () => toggleClass(header, "sidebar-header-scrolled", (body as any).scrollTop > 0);
    (body as any)._sidebarHeaderScrollHandler = handler;
    body.addEventListener("scroll", handler, { passive: true });
    handler();
  };

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


  const isUnreadDialog = (opts: { unread: number; mention?: boolean; attention?: boolean }): boolean =>
    opts.unread > 0 || Boolean(opts.mention) || Boolean(opts.attention);
  const isMentionDialog = (opts: { mention?: boolean; attention?: boolean }): boolean =>
    Boolean(opts.mention) || Boolean(opts.attention);
  const passesSidebarChatFilter = (
    mode: SidebarChatFilter,
    opts: { kind: "dm" | "group"; unread: number; mention?: boolean; attention?: boolean }
  ): boolean => {
    if (mode === "unread") return isUnreadDialog(opts);
    if (mode === "mentions") return isMentionDialog(opts);
    if (mode === "dms") return opts.kind === "dm";
    if (mode === "groups") return opts.kind === "group";
    return true;
  };

  const unreadDialogsCount = (() => {
    let count = 0;
    for (const f of friendMap.values()) {
      const unread = Math.max(0, Number(f.unread || 0) || 0);
      const attention = attnSet.has(String(f.id || "").trim());
      if (isUnreadDialog({ unread, attention })) count += 1;
    }
    for (const g of groups) {
      const k = roomKey(g.id);
      const unread = computeRoomUnread(k);
      const mention = mentionForKey(k);
      if (isUnreadDialog({ unread, mention })) count += 1;
    }
    return count;
  })();
  const mentionDialogsCount = (() => {
    let count = 0;
    for (const f of friendMap.values()) {
      const id = String(f.id || "").trim();
      if (!id) continue;
      const attention = attnSet.has(id);
      if (isMentionDialog({ attention })) count += 1;
    }
    for (const g of groups) {
      const k = roomKey(g.id);
      const mention = mentionForKey(k);
      if (isMentionDialog({ mention })) count += 1;
    }
    return count;
  })();

  const buildChatFilters = (active: SidebarChatFilter, unreadCount: number, mentionCount: number): HTMLElement => {
    const makeBtn = (value: SidebarChatFilter, label: string, badge?: string) => {
      const btn = el(
        "button",
        {
          class: active === value ? "sidebar-filter sidebar-filter-active" : "sidebar-filter",
          type: "button",
          role: "tab",
          "aria-selected": String(active === value),
          "aria-label": label,
          title: label,
        },
        [label]
      ) as HTMLButtonElement;
      if (badge) {
        btn.append(el("span", { class: "sidebar-filter-badge", "aria-hidden": "true" }, [badge]));
      }
      btn.addEventListener("click", () => onSetSidebarChatFilter(value));
      return btn;
    };
    const badgeText = unreadCount > 99 ? "99+" : unreadCount > 0 ? String(unreadCount) : "";
    const mentionText = mentionCount > 99 ? "99+" : mentionCount > 0 ? String(mentionCount) : "";
    return el("div", { class: "sidebar-filters", role: "tablist", "aria-label": "Фильтр чатов" }, [
      makeBtn("all", "Все"),
      makeBtn("unread", "Непрочитанные", badgeText || undefined),
      makeBtn("mentions", "Упоминания", mentionText || undefined),
      makeBtn("dms", "Личные"),
      makeBtn("groups", "Группы"),
    ]);
  };

  const buildFolderTabs = (activeId: string, folders: any[]): HTMLElement | null => {
    const list = Array.isArray(folders) ? folders : [];
    if (!list.length) return null;
    const normActive = String(activeId || "all").trim().toLowerCase() || "all";
    const makeBtn = (id: string, label: string) => {
      const active = normActive === id;
      const btn = el(
        "button",
        {
          class: active ? "sidebar-filter sidebar-filter-active" : "sidebar-filter",
          type: "button",
          role: "tab",
          "aria-selected": String(active),
          "aria-label": label,
          title: label,
        },
        [label]
      ) as HTMLButtonElement;
      btn.addEventListener("click", () => onSetSidebarFolderId(id));
      return btn;
    };

    const items: HTMLElement[] = [makeBtn("all", "Все")];
    for (const f of list) {
      const id = String((f as any)?.id || "").trim().toLowerCase();
      if (!id || id === "all" || id === "archive") continue;
      const title = String((f as any)?.title || "").trim();
      if (!title) continue;
      const emoji = typeof (f as any)?.emoji === "string" ? String((f as any).emoji).trim() : "";
      const label = emoji ? `${emoji} ${title}` : title;
      items.push(makeBtn(id, label));
    }
    return el("div", { class: "sidebar-filters sidebar-folders", role: "tablist", "aria-label": "Папки" }, items);
  };

  const buildSidebarSearchBar = (placeholder: string, opts?: { action?: HTMLElement }): HTMLElement => {
    const input = el("input", {
      class: "sidebar-search-input",
      type: "search",
      placeholder,
      "aria-label": "Поиск",
      "data-ios-assistant": "off",
      autocomplete: "off",
      autocorrect: "off",
      autocapitalize: "off",
      spellcheck: "false",
      enterkeyhint: "search",
    }) as HTMLInputElement;
    const searchIcon = el("span", { class: "sidebar-search-icon", "aria-hidden": "true" }, ["🔍"]);
    input.value = sidebarQueryRaw;
    input.disabled = disableSearchWhileTyping;
    const clearBtn = el(
      "button",
      {
        class: "btn sidebar-search-clear",
        type: "button",
        title: "Очистить",
        "aria-label": "Очистить",
      },
      ["×"]
    ) as HTMLButtonElement;
    const updateClearState = () => toggleClass(clearBtn, "hidden", !input.value.trim());
    updateClearState();
    input.addEventListener("input", () => {
      onSetSidebarQuery(input.value);
      updateClearState();
    });
    input.addEventListener("search", () => {
      onSetSidebarQuery(input.value);
      updateClearState();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        input.value = "";
        onSetSidebarQuery("");
        updateClearState();
      }
    });
    clearBtn.addEventListener("click", (e) => {
      e.preventDefault();
      input.value = "";
      onSetSidebarQuery("");
      updateClearState();
      focusElement(input);
    });
    const children: HTMLElement[] = [searchIcon, input, clearBtn];
    if (opts?.action) children.push(opts.action);
    return el("div", { class: "sidebar-searchbar" }, children);
  };
  const buildSidebarArchiveToggle = (count: number, active: boolean): HTMLElement => {
    const label = count > 0 ? `Архив (${count})` : "Архив";
    const btn = el(
      "button",
      {
        class: active ? "btn sidebar-archive-toggle sidebar-archive-toggle-active" : "btn sidebar-archive-toggle",
        type: "button",
        "aria-pressed": String(active),
        title: label,
      },
      [label]
    ) as HTMLButtonElement;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      onToggleSidebarArchive();
    });
    return btn;
  };
  const buildSidebarArchiveHint = (): HTMLElement =>
    el("div", { class: "sidebar-archive-hint" }, [
      "Чтобы вернуть из архива: ПКМ/долгое нажатие по чату → «Убрать из архива».",
    ]);
  const buildSidebarArchiveEmpty = (label: string): HTMLElement => el("div", { class: "sidebar-archive-empty" }, [label]);

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
  const wrapChatlist = (children: HTMLElement[]): HTMLElement => el("div", { class: "chatlist virtual-chatlist" }, children);
  const VIRTUAL_CHATLIST_MIN_ROWS = 80;
  const VIRTUAL_CHATLIST_OVERSCAN = 6;
  const clearVirtualChatlist = () => {
    const prev = (body as any)._virtualChatlistCleanup as (() => void) | undefined;
    if (prev) prev();
    delete (body as any)._virtualChatlistCleanup;
  };
  const buildVirtualChatlistBlock = (rows: HTMLElement[]): HTMLElement => {
    const topSpacer = el("div", { class: "chatlist-virtual-spacer", "aria-hidden": "true" });
    const bottomSpacer = el("div", { class: "chatlist-virtual-spacer", "aria-hidden": "true" });
    const items = el("div", { class: "chatlist-virtual-items" });
    const block = el("div", { class: "chatlist-virtual-block" }, [topSpacer, items, bottomSpacer]);
    const state = {
      active: true,
      start: -1,
      end: -1,
      raf: 0 as number | 0,
      rowHeight: 0,
    };
    const measureRenderedRowHeight = (): number => {
      const el = items.firstElementChild as HTMLElement | null;
      if (!el) return 0;
      try {
        const rect = el.getBoundingClientRect();
        const h = Math.round(rect.height || 0);
        return h > 0 ? h : 0;
      } catch {
        return 0;
      }
    };
    const readRowHeight = (): number => {
      if (state.rowHeight > 0) return state.rowHeight;
      const measured = measureRenderedRowHeight();
      if (measured > 0) return measured;
      try {
        const raw = getComputedStyle(body).getPropertyValue("--row-min-h").trim();
        const parsed = parseFloat(raw);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
      } catch {
        // ignore
      }
      return 56;
    };
    const readBlockOffset = (): number => {
      try {
        const bodyRect = body.getBoundingClientRect();
        const blockRect = block.getBoundingClientRect();
        const offset = blockRect.top - bodyRect.top + body.scrollTop;
        if (Number.isFinite(offset)) return offset;
      } catch {
        // ignore
      }
      return block.offsetTop || 0;
    };
    const update = () => {
      if (!state.active) return;
      const rowHeight = readRowHeight();
      const viewportHeight = body.clientHeight || 0;
      const offset = readBlockOffset();
      const virtualScrollTop = Math.max(0, body.scrollTop - offset);
      let start = Math.max(0, Math.floor(virtualScrollTop / rowHeight) - VIRTUAL_CHATLIST_OVERSCAN);
      let end = Math.min(rows.length, Math.ceil((virtualScrollTop + viewportHeight) / rowHeight) + VIRTUAL_CHATLIST_OVERSCAN);
      if (start === state.start && end === state.end && state.rowHeight > 0) return;
      state.start = start;
      state.end = end;
      items.replaceChildren(...rows.slice(start, end));
      let effectiveHeight = rowHeight;
      const measured = measureRenderedRowHeight();
      if (measured > 0 && Math.abs(measured - rowHeight) > 1) {
        state.rowHeight = measured;
        effectiveHeight = measured;
        const nextStart = Math.max(0, Math.floor(virtualScrollTop / measured) - VIRTUAL_CHATLIST_OVERSCAN);
        const nextEnd = Math.min(
          rows.length,
          Math.ceil((virtualScrollTop + viewportHeight) / measured) + VIRTUAL_CHATLIST_OVERSCAN
        );
        if (nextStart !== start || nextEnd !== end) {
          start = nextStart;
          end = nextEnd;
          state.start = start;
          state.end = end;
          items.replaceChildren(...rows.slice(start, end));
        }
      } else if (measured > 0 && state.rowHeight === 0) {
        state.rowHeight = measured;
        effectiveHeight = measured;
      }
      topSpacer.style.height = `${start * effectiveHeight}px`;
      bottomSpacer.style.height = `${(rows.length - end) * effectiveHeight}px`;
    };
    const onScroll = () => {
      if (state.raf) return;
      try {
        state.raf = window.requestAnimationFrame(() => {
          state.raf = 0;
          update();
        });
      } catch {
        state.raf = 0;
        update();
      }
    };
    const onResize = () => {
      state.rowHeight = 0;
      onScroll();
    };
    body.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    try {
      window.requestAnimationFrame(update);
    } catch {
      update();
    }
    (body as any)._virtualChatlistCleanup = () => {
      state.active = false;
      body.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      if (state.raf) {
        try {
          window.cancelAnimationFrame(state.raf);
        } catch {
          // ignore
        }
      }
    };
    return block;
  };
  const buildChatlist = (
    fixedRows: HTMLElement[],
    rows: HTMLElement[],
    emptyLabel?: string,
    opts?: { virtual?: boolean }
  ): HTMLElement => {
    const children: HTMLElement[] = [...fixedRows];
    if (!rows.length) {
      if (emptyLabel) children.push(el("div", { class: "pane-section" }, [emptyLabel]));
      return wrapChatlist(children);
    }
    const allowVirtual = opts?.virtual !== false;
    if (!allowVirtual || rows.length < VIRTUAL_CHATLIST_MIN_ROWS) return wrapChatlist([...children, ...rows]);
    const block = buildVirtualChatlistBlock(rows);
    children.push(block);
    return wrapChatlist(children);
  };
  clearVirtualChatlist();


  if (isMobile) {
    renderSidebarMobile({
      target, state, body, isMobile, mobileUi,
      forceResetScroll, hasSidebarQuery, effectiveChatFilter, unreadDialogsCount, mentionDialogsCount,
      archiveToggle, chatArchiveToggle, boardArchiveToggle, chatArchiveOpen, boardArchiveOpen, archiveOpen,
      chatArchiveCount, boardArchiveCount, buildSidebarArchiveHint, buildSidebarArchiveEmpty,
      pinnedKeys, pinnedSet, archivedSet, groups, boards, sel, drafts,
      matchesQuery, matchesFriend, matchesRoom, isMuted, lastTsForKey, attnSet, mentionForKey, computeRoomUnread,
      buildSidebarTabButton, buildSidebarSearchBar, buildChatFilters, passesSidebarChatFilter, buildFolderTabs, buildChatlist,
      setBodyChatlistClass, bindHeaderScroll, toggleClass, markCompactAvatarRows, dialogPriority, hasActiveDialogForFriend,
      unknownAttnPeers, contactCandidates, activeContacts, archivedContacts, buildContactRows, buildTopPeerContactRows,
      onSelect, onOpenUser, onSetPage, onCreateGroup, onCreateBoard, onAuthOpen, onAuthLogout,
    });
    return;
  }

  if ("dataset" in target) delete (target as HTMLElement).dataset.sidebarTab;

  // PWA (standalone/fullscreen): tabs should behave like mobile (separate views),
  // not just as "scroll-to" shortcuts.
  if (isStandaloneDisplayMode()) {
    const rawTab = state.mobileSidebarTab;
    const showMenuTab = isMobile;
    const defaultTab: MobileSidebarTab = unknownAttnPeers.length ? "contacts" : "chats";
    let activeTab: MobileSidebarTab =
      rawTab === "contacts" || rawTab === "boards" || (showMenuTab && rawTab === "menu") ? rawTab : defaultTab;
    if (!showMenuTab && activeTab === "menu") activeTab = defaultTab;
    if ("dataset" in target) (target as HTMLElement).dataset.sidebarTab = activeTab;
    const prevTab = String((target as any)._pwaSidebarPrevTab || "").trim();
    const didSwitchTab = Boolean(prevTab && prevTab !== activeTab);
    const forceTopTab = Boolean(forceResetScroll || !prevTab || didSwitchTab);
    if (forceTopTab && !forceResetScroll) {
      try {
        (target as HTMLElement).dataset.sidebarResetScroll = "1";
        body.dataset.sidebarResetScroll = "1";
      } catch {
        // ignore
      }
    }

    const tabContacts = buildSidebarTabButton("contacts", activeTab, "Контакты");
    const tabBoards = buildSidebarTabButton("boards", activeTab, "Доски");
    const tabChats = buildSidebarTabButton("chats", activeTab, "Чаты");
    const tabMenu = showMenuTab ? buildSidebarTabButton("menu", activeTab, "Меню") : null;

    const tabs = el(
      "div",
      {
        class: showMenuTab
          ? "sidebar-tabs sidebar-tabs-desktop sidebar-tabs-pwa sidebar-tabs-standalone"
          : "sidebar-tabs sidebar-tabs-desktop sidebar-tabs-standalone",
        role: "tablist",
        "aria-label": "Раздел",
      },
      [tabContacts, tabBoards, tabChats, ...(tabMenu ? [tabMenu] : [])]
    );
    const tabsList = [tabContacts, tabBoards, tabChats, ...(tabMenu ? [tabMenu] : [])];
    tabs.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const dir = e.key === "ArrowRight" ? 1 : -1;
      const idx = tabsList.findIndex((b) => b === document.activeElement);
      const next = idx < 0 ? 0 : (idx + dir + tabsList.length) % tabsList.length;
      e.preventDefault();
      tabsList[next]?.focus();
    });

    const searchBarAction =
      activeTab === "contacts"
        ? archiveToggle
        : activeTab === "chats"
          ? chatArchiveToggle
          : activeTab === "boards"
            ? boardArchiveToggle
            : null;
    const searchBar =
      showMenuTab && activeTab === "menu"
        ? null
        : buildSidebarSearchBar(
            activeTab === "contacts" ? "Поиск контакта" : activeTab === "boards" ? "Поиск доски" : "Поиск",
            searchBarAction ? { action: searchBarAction } : undefined
          );
    const headerToolbar = buildSidebarHeaderToolbar(activeTab);
    const headerStack = el("div", { class: "sidebar-header-stack" }, [
      headerToolbar,
      ...(activeTab === "menu"
        ? [el("div", { class: "sidebar-header-title" }, ["Меню"])]
        : [...(searchBar ? [searchBar] : [])]),
    ]);
    const header = el("div", { class: "sidebar-header" }, [headerStack]);
    const showChatFilters = activeTab === "chats" && !hasSidebarQuery;
    const chatFiltersRow = showChatFilters
      ? buildChatFilters(effectiveChatFilter, unreadDialogsCount, mentionDialogsCount)
      : null;
    const chatFilterMode: SidebarChatFilter = showChatFilters ? effectiveChatFilter : "all";
    const passesChatFilter = (opts: { kind: "dm" | "group"; unread: number; mention?: boolean; attention?: boolean }): boolean =>
      passesSidebarChatFilter(chatFilterMode, opts);

    const chatFolders = Array.isArray((state as any).chatFolders) ? (state as any).chatFolders : [];
    const rawFolderId =
      activeTab === "chats" ? String((state as any).sidebarFolderId || "all").trim().toLowerCase() : "all";
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
    const folderTabsRow = activeTab === "chats" ? buildFolderTabs(activeFolderId, chatFolders) : null;

    const pinnedBoardRows: HTMLElement[] = [];
    const pinnedDialogRowByKey = new Map<string, HTMLElement>();
    const pinnedContactEntries: FriendEntry[] = [];
    for (const key of pinnedKeys) {
      if (key.startsWith("dm:")) {
        const id = key.slice(3);
        const f = state.friends.find((x) => x.id === id);
        if (!f) continue;
        if (!matchesFriend(f)) continue;
        const k = dmKey(f.id);
        const unread = Math.max(0, Number(f.unread || 0) || 0);
        const attention = attnSet.has(f.id);
        if (activeTab === "chats" && !folderAllowsKey(k)) continue;
        if (!passesChatFilter({ kind: "dm", unread, attention })) continue;
        const meta = previewForConversation(state, k, "dm", drafts[k]);
        const row = friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === f.id), meta, onSelect, onOpenUser, attention);
        pinnedDialogRowByKey.set(key, row);
        pinnedContactEntries.push(f);
        continue;
      }
      if (key.startsWith("room:")) {
        const id = key.slice(5);
        const g = groups.find((x) => x.id === id);
        if (g) {
          if (!matchesRoom(g)) continue;
          const k = roomKey(g.id);
          const meta = previewForConversation(state, k, "room", drafts[k]);
          const unread = computeRoomUnread(k);
          const mention = mentionForKey(k);
          if (activeTab === "chats" && !folderAllowsKey(k)) continue;
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
        if (b) {
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
      }
    }

    const mountPwa = (children: HTMLElement[]) => {
      setBodyChatlistClass(children);
      body.replaceChildren(...children);
      const nodes: HTMLElement[] = [];
      if (header) nodes.push(header);
      nodes.push(tabs);
      nodes.push(body);
      target.replaceChildren(...nodes);
      bindHeaderScroll(header);
      (target as any)._pwaSidebarPrevTab = activeTab;
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

	    if (activeTab === "chats") {
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
	      mountPwa([...(folderTabsRow ? [folderTabsRow] : []), ...(chatFiltersRow ? [chatFiltersRow] : []), chatList]);
	      return;
	    }

	    if (activeTab === "boards") {
	      const restBoards = boards.filter((b) => !pinnedSet.has(roomKey(b.id)));
	      const boardItems: Array<{ sortTs: number; row: HTMLElement }> = [];
	      const archivedItems: Array<{ sortTs: number; row: HTMLElement }> = [];
	      for (const b of restBoards) {
	        if (!matchesRoom(b)) continue;
	        const k = roomKey(b.id);
	        const meta = previewForConversation(state, k, "room", drafts[k]);
	        const unread = computeRoomUnread(k);
	        const item = {
	          sortTs: lastTsForKey(k),
	          row: roomRow(
	            null,
	            String(b.name || b.id),
	            Boolean(sel && sel.kind === "board" && sel.id === b.id),
	            () => onSelect({ kind: "board", id: b.id }),
	            { kind: "board", id: b.id },
	            meta,
	            { muted: isMuted(b.id), unread, menuOpen: isRowMenuOpen(state, "board", b.id) }
	          ),
	        };
	        if (!hasSidebarQuery && archivedSet.has(k)) archivedItems.push(item);
	        else boardItems.push(item);
	      }
	      boardItems.sort((a, b) => b.sortTs - a.sortTs);
	      archivedItems.sort((a, b) => b.sortTs - a.sortTs);
	      const boardRows = boardItems.map((x) => x.row);
	      const archivedRows = archivedItems.map((x) => x.row);

	      const boardFixedRows: HTMLElement[] = [];
	      if (pinnedBoardRows.length) {
	        boardFixedRows.push(...pinnedBoardRows);
	      }
	      boardFixedRows.push(el("div", { class: "pane-section" }, [hasSidebarQuery ? "Результаты" : "Доски"]));
	      const archiveBlock = boardArchiveOpen
	        ? [
	            el("div", { class: "pane-section pane-section-archive" }, [`Архив (${boardArchiveCount})`]),
	            buildSidebarArchiveHint(),
	            ...archivedRows,
	          ]
	        : [];
	      const rows = archiveBlock.length ? [...archiveBlock, ...boardRows] : boardRows;
	      const boardList = buildChatlist(
	        boardFixedRows,
	        rows,
	        hasSidebarQuery ? "(ничего не найдено)" : "(пока нет досок)",
	        { virtual: !boardArchiveOpen }
	      );
	      mountPwa([boardList]);
	      return;
	    }

    if (activeTab === "contacts") {
      const pinnedContactRowsCompact = buildContactRows(pinnedContactEntries, { sort: false });
      const contactRowsAll = buildContactRows(contactCandidates);
      const { ids: topPeerIds, rows: topPeerRows } = buildTopPeerContactRows(activeContacts);
      const activeContactRows = buildContactRows(activeContacts.filter((f) => !topPeerIds.has(f.id)));
      const archivedContactRows = buildContactRows(archivedContacts);
      const archiveBlock =
        archiveOpen && archivedContactRows.length
          ? [el("div", { class: "pane-section pane-section-archive" }, [`Архив (${archivedContactRows.length})`]), ...archivedContactRows]
          : [];

      if (hasSidebarQuery) {
        const unknownAttnRows = unknownAttnPeers
          .filter((id) => matchesQuery(id))
          .map((id) => {
            const k = dmKey(id);
            const meta = previewForConversation(state, k, "dm", drafts[k]);
            const hint = attentionHintForPeer(state, id);
            const meta2 = meta.sub ? meta : { ...meta, sub: hint };
            const pseudo: FriendEntry = { id, online: false, unread: 0 };
            return friendRow(state, pseudo, Boolean(sel && sel.kind === "dm" && sel.id === id), meta2, onSelect, onOpenUser, true);
          });
        const allRows = markCompactAvatarRows([...unknownAttnRows, ...contactRowsAll]);
        const contactFixedRows: HTMLElement[] = [];
        if (pinnedContactRowsCompact.length) {
          contactFixedRows.push(...pinnedContactRowsCompact);
        }
        if (allRows.length) {
          contactFixedRows.push(el("div", { class: "pane-section" }, [`Результаты (${allRows.length})`]));
        }
        const contactList = buildChatlist(contactFixedRows, allRows, "(ничего не найдено)");
        mountPwa([contactList]);
        return;
      }

      const unknownAttnRows = markCompactAvatarRows(
        unknownAttnPeers
        .map((id) => {
          const k = dmKey(id);
          const meta = previewForConversation(state, k, "dm", drafts[k]);
          const hint = attentionHintForPeer(state, id);
          const meta2 = meta.sub ? meta : { ...meta, sub: hint };
          const pseudo: FriendEntry = { id, online: false, unread: 0 };
          return friendRow(state, pseudo, Boolean(sel && sel.kind === "dm" && sel.id === id), meta2, onSelect, onOpenUser, true);
        })
      );

      const contactFixedRows: HTMLElement[] = [];
      if (pinnedContactRowsCompact.length) {
        contactFixedRows.push(...pinnedContactRowsCompact);
      }
      if (unknownAttnRows.length) {
        contactFixedRows.push(el("div", { class: "pane-section" }, ["Внимание"]), ...unknownAttnRows);
      }
      if (topPeerRows.length) {
        contactFixedRows.push(el("div", { class: "pane-section" }, ["Топ"]), ...topPeerRows);
      }
      if (activeContactRows.length && !archiveBlock.length) {
        contactFixedRows.push(el("div", { class: "pane-section" }, ["Контакты"]));
      }
      const contactRows = (() => {
        if (!archiveBlock.length) return activeContactRows;
        const rows: HTMLElement[] = [...archiveBlock];
        if (activeContactRows.length) rows.push(el("div", { class: "pane-section" }, ["Контакты"]), ...activeContactRows);
        return rows;
      })();
      const contactList = buildChatlist(contactFixedRows, contactRows, undefined, { virtual: !archiveOpen });
      mountPwa([contactList]);
      return;
    }

    // Menu tab (PWA): actions/navigation.
    const profileRow = roomRow("☺", "Профиль", state.page === "profile", () => onSetPage("profile"), undefined, {
      sub: "Имя, @handle, аватар",
      time: null,
      hasDraft: false,
    });
    toggleClass(profileRow, "row-settings", true);
    profileRow.setAttribute("title", "Настройки профиля и интерфейса");
    const searchRow = roomRow("🔍", "Поиск", state.page === "search", () => onSetPage("search"), undefined, {
      sub: "Глобальный поиск",
      time: null,
      hasDraft: false,
    });
    searchRow.setAttribute("title", "Глобальный поиск");
    const filesRow = roomRow("▦", "Файлы", state.page === "files", () => onSetPage("files"), undefined, {
      sub: "История и загрузки",
      time: null,
      hasDraft: false,
    });
    filesRow.setAttribute("title", "Передача файлов и история");
    const navRows: HTMLElement[] = [profileRow, searchRow, filesRow];

    const createGroupRow = roomRow("+", "Создать чат", state.page === "group_create", () => onCreateGroup(), undefined, {
      sub: "Групповой чат и приглашения",
      time: null,
      hasDraft: false,
    });
    createGroupRow.setAttribute("title", "Создать новый чат");
    const createBoardRow = roomRow("+", "Создать доску", state.page === "board_create", () => onCreateBoard(), undefined, {
      sub: "Лента объявлений и новости",
      time: null,
      hasDraft: false,
    });
    createBoardRow.setAttribute("title", "Создать новую доску");
    const infoRow = roomRow("?", "Info", state.page === "help", () => onSetPage("help"), undefined, {
      sub: mobileUi ? "Версии и изменения" : "Хоткеи, версии и изменения",
      time: null,
      hasDraft: false,
    });
    infoRow.setAttribute("title", mobileUi ? "Справка и журнал обновлений" : "Подсказки по клавишам и журнал обновлений");

    const accountRows: HTMLElement[] = [];
    if (state.conn === "connected" && !state.authed) {
      const loginRow = roomRow("→", "Войти", false, () => onAuthOpen(), undefined, {
        sub: "Вход или регистрация",
        time: null,
        hasDraft: false,
      });
      loginRow.setAttribute("title", "Войти или зарегистрироваться");
      accountRows.push(loginRow);
    } else if (state.authed) {
      const logoutRow = roomRow("⏻", "Выход", false, () => onAuthLogout(), undefined, {
        sub: "Завершить сессию",
        time: null,
        hasDraft: false,
      });
      logoutRow.setAttribute("title", "Выйти из аккаунта");
      accountRows.push(logoutRow);
    }

    mountPwa([
      el("div", { class: "pane-section" }, ["Навигация"]),
      ...navRows,
      ...(accountRows.length ? [el("div", { class: "pane-section" }, ["Аккаунт"]), ...accountRows] : []),
      el("div", { class: "pane-section" }, ["Создание"]),
      createGroupRow,
      createBoardRow,
      el("div", { class: "pane-section" }, ["Справка"]),
      infoRow,
    ]);
    return;
  }

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
  const showChatFilters = activeDesktopTab === "chats" && !hasSidebarQuery;
  const chatFiltersRow = showChatFilters ? buildChatFilters(effectiveChatFilter, unreadDialogsCount, mentionDialogsCount) : null;
  const chatFilterMode: SidebarChatFilter = showChatFilters ? effectiveChatFilter : "all";
  const passesChatFilter = (opts: { kind: "dm" | "group"; unread: number; mention?: boolean; attention?: boolean }): boolean =>
    passesSidebarChatFilter(chatFilterMode, opts);

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
    const profileRow = roomRow("☺", "Профиль", state.page === "profile", () => onSetPage("profile"), undefined, {
      sub: "Имя, @handle, аватар",
      time: null,
      hasDraft: false,
    });
    toggleClass(profileRow, "row-settings", true);
    profileRow.setAttribute("title", "Настройки профиля и интерфейса");
    const searchRow = roomRow("🔍", "Поиск", state.page === "search", () => onSetPage("search"), undefined, {
      sub: "Глобальный поиск",
      time: null,
      hasDraft: false,
    });
    searchRow.setAttribute("title", "Глобальный поиск");
    const filesRow = roomRow("▦", "Файлы", state.page === "files", () => onSetPage("files"), undefined, {
      sub: "История и загрузки",
      time: null,
      hasDraft: false,
    });
    filesRow.setAttribute("title", "Передача файлов и история");
    const navRows: HTMLElement[] = [profileRow, searchRow, filesRow];

    const createGroupRow = roomRow("+", "Создать чат", state.page === "group_create", () => onCreateGroup(), undefined, {
      sub: "Групповой чат и приглашения",
      time: null,
      hasDraft: false,
    });
    createGroupRow.setAttribute("title", "Создать новый групповой чат");
    const createBoardRow = roomRow("+", "Создать доску", state.page === "board_create", () => onCreateBoard(), undefined, {
      sub: "Доска (чтение всем, запись владельцу)",
      time: null,
      hasDraft: false,
    });
    createBoardRow.setAttribute("title", "Создать новую доску");
    const createRows: HTMLElement[] = [createGroupRow, createBoardRow];

    const infoRow = roomRow("?", "Info", state.page === "help", () => onSetPage("help"), undefined, {
      sub: mobileUi ? "Версии и изменения" : "Хоткеи, версии и изменения",
      time: null,
      hasDraft: false,
    });
    infoRow.setAttribute("title", mobileUi ? "Справка и журнал обновлений" : "Подсказки по клавишам и журнал обновлений");

    const accountRows: HTMLElement[] = [];
    if (state.conn === "connected" && !state.authed) {
      const loginRow = roomRow("→", "Войти", false, () => onAuthOpen(), undefined, {
        sub: "Вход или регистрация",
        time: null,
        hasDraft: false,
      });
      loginRow.setAttribute("title", "Войти или зарегистрироваться");
      accountRows.push(loginRow);
    } else if (state.authed) {
      const logoutIcon = mobileUi ? "⏻" : "⎋";
      const logoutRow = roomRow(logoutIcon, mobileUi ? "Выход" : "Выход (F10)", false, () => onAuthLogout(), undefined, {
        sub: "Завершить сессию",
        time: null,
        hasDraft: false,
      });
      logoutRow.setAttribute("title", mobileUi ? "Выйти из аккаунта" : "Выйти из аккаунта (F10)");
      accountRows.push(logoutRow);
    }

    mountDesktop([
      el("div", { class: "pane-section" }, ["Навигация"]),
      ...navRows,
      ...(accountRows.length ? [el("div", { class: "pane-section" }, ["Аккаунт"]), ...accountRows] : []),
      el("div", { class: "pane-section" }, ["Создание"]),
      ...createRows,
      el("div", { class: "pane-section" }, ["Справка"]),
      infoRow,
    ]);
    return;
  }

  if (activeDesktopTab === "chats") {
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

  if (activeDesktopTab === "boards") {
    const restBoards = boards.filter((b) => !pinnedSet.has(roomKey(b.id)));
    const boardItems: Array<{ sortTs: number; row: HTMLElement }> = [];
    const archivedItems: Array<{ sortTs: number; row: HTMLElement }> = [];
    for (const b of restBoards) {
      if (!matchesRoom(b)) continue;
      const k = roomKey(b.id);
      const meta = previewForConversation(state, k, "room", drafts[k]);
      const unread = computeRoomUnread(k);
      const item = {
        sortTs: lastTsForKey(k),
        row: roomRow(
          null,
          String(b.name || b.id),
          Boolean(sel && sel.kind === "board" && sel.id === b.id),
          () => onSelect({ kind: "board", id: b.id }),
          { kind: "board", id: b.id },
          meta,
          { muted: isMuted(b.id), unread, menuOpen: isRowMenuOpen(state, "board", b.id) }
        ),
      };
      if (!hasSidebarQuery && archivedSet.has(k)) archivedItems.push(item);
      else boardItems.push(item);
    }
    boardItems.sort((a, b) => b.sortTs - a.sortTs);
    archivedItems.sort((a, b) => b.sortTs - a.sortTs);
    const boardRows = boardItems.map((x) => x.row);
    const archivedRows = archivedItems.map((x) => x.row);

    const boardFixedRows: HTMLElement[] = [];
    if (pinnedBoardRows.length) {
      boardFixedRows.push(...pinnedBoardRows);
    }
    boardFixedRows.push(el("div", { class: "pane-section" }, [hasSidebarQuery ? "Результаты" : "Доски"]));
    const archiveBlock = boardArchiveOpen
      ? [
          el("div", { class: "pane-section pane-section-archive" }, [`Архив (${boardArchiveCount})`]),
          buildSidebarArchiveHint(),
          ...archivedRows,
        ]
      : [];
    const rows = archiveBlock.length ? [...archiveBlock, ...boardRows] : boardRows;
    const boardList = buildChatlist(
      boardFixedRows,
      rows,
      hasSidebarQuery ? "(ничего не найдено)" : "(пока нет досок)",
      { virtual: !boardArchiveOpen }
    );
    mountDesktop([boardList]);
    return;
  }

  // Contacts tab.
  const pinnedContactEntries: FriendEntry[] = [];
  for (const key of pinnedKeys) {
    if (!key.startsWith("dm:")) continue;
    const id = key.slice(3);
    const f = state.friends.find((x) => x.id === id);
    if (!f) continue;
    if (!matchesFriend(f)) continue;
    pinnedContactEntries.push(f);
  }
  const pinnedContactRowsCompact = buildContactRows(pinnedContactEntries, { sort: false });
  const contactRowsAll = buildContactRows(contactCandidates);
  const { ids: topPeerIds, rows: topPeerRows } = buildTopPeerContactRows(activeContacts);
  const activeContactRows = buildContactRows(activeContacts.filter((f) => !topPeerIds.has(f.id)));
  const archivedContactRows = buildContactRows(archivedContacts);
  const archiveBlock =
    archiveOpen && archivedContactRows.length
      ? [el("div", { class: "pane-section pane-section-archive" }, [`Архив (${archivedContactRows.length})`]), ...archivedContactRows]
      : [];

  if (hasSidebarQuery) {
    const allRows = markCompactAvatarRows([...unknownAttnRows, ...contactRowsAll]);
    const contactFixedRows: HTMLElement[] = [];
    if (pinnedContactRowsCompact.length) {
      contactFixedRows.push(...pinnedContactRowsCompact);
    }
    if (allRows.length) {
      contactFixedRows.push(el("div", { class: "pane-section" }, [`Результаты (${allRows.length})`]));
    }
    const contactList = buildChatlist(contactFixedRows, allRows, "(ничего не найдено)");
    mountDesktop([contactList]);
    return;
  }

  const compactUnknownAttnRows = markCompactAvatarRows(unknownAttnRows);
  const contactFixedRows: HTMLElement[] = [];
  if (pinnedContactRowsCompact.length) {
    contactFixedRows.push(...pinnedContactRowsCompact);
  }
  if (compactUnknownAttnRows.length) {
    contactFixedRows.push(el("div", { class: "pane-section" }, ["Внимание"]), ...compactUnknownAttnRows);
  }
  if (topPeerRows.length) {
    contactFixedRows.push(el("div", { class: "pane-section" }, ["Топ"]), ...topPeerRows);
  }
  if (activeContactRows.length && !archiveBlock.length) {
    contactFixedRows.push(el("div", { class: "pane-section" }, ["Контакты"]));
  }
  const contactRows = (() => {
    if (!archiveBlock.length) return activeContactRows;
    const rows: HTMLElement[] = [...archiveBlock];
    if (activeContactRows.length) rows.push(el("div", { class: "pane-section" }, ["Контакты"]), ...activeContactRows);
    return rows;
  })();
  const contactList = buildChatlist(contactFixedRows, contactRows, undefined, { virtual: !archiveOpen });
  mountDesktop([contactList]);
}
