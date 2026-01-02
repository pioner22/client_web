import { el } from "../../helpers/dom/el";
import { avatarHue, avatarMonogram, getStoredAvatar } from "../../helpers/avatar/avatarStore";
import { dmKey, roomKey } from "../../helpers/chat/conversationKey";
import { formatTime } from "../../helpers/time";
import { focusElement } from "../../helpers/ui/focus";
import { isIOS, isStandaloneDisplayMode } from "../../helpers/ui/iosInputAssistant";
import { isMobileLikeUi } from "../../helpers/ui/mobileLike";
import type {
  ActionModalPayload,
  AppState,
  ChatMessage,
  ContextMenuTargetKind,
  FriendEntry,
  MobileSidebarTab,
  PageKind,
  SidebarChatFilter,
  TargetRef,
} from "../../stores/types";

function collectAttentionPeers(state: AppState): Set<string> {
  const ids = new Set<string>();
  const add = (raw: unknown) => {
    const id = String(raw || "").trim();
    if (!id) return;
    if (state.selfId && id === String(state.selfId)) return;
    ids.add(id);
  };
  for (const id of state.pendingIn || []) add(id);
  for (const id of state.pendingOut || []) add(id);
  for (const inv of state.pendingGroupInvites || []) add(inv?.from);
  for (const req of state.pendingGroupJoinRequests || []) add(req?.from);
  for (const inv of state.pendingBoardInvites || []) add(inv?.from);
  for (const offer of state.fileOffersIn || []) add(offer?.from);
  return ids;
}

const HANDLE_RE = /^[a-z0-9_]{3,16}$/;

function collectSelfMentionHandles(state: AppState): Set<string> {
  const out = new Set<string>();
  const normalize = (raw: unknown): string | null => {
    const base = String(raw || "").trim().toLowerCase();
    if (!base) return null;
    const stripped = base.startsWith("@") ? base.slice(1) : base;
    if (!HANDLE_RE.test(stripped)) return null;
    return stripped;
  };
  const add = (raw: unknown) => {
    const handle = normalize(raw);
    if (handle) out.add(handle);
  };
  add(state.selfId);
  const profile = state.selfId ? state.profiles?.[state.selfId] : null;
  add(profile?.handle);
  return out;
}

function hasSelfMention(text: string, handles: Set<string>): boolean {
  if (!handles.size) return false;
  const s = String(text || "");
  if (!s.includes("@")) return false;
  const re = /@([a-z0-9_]{3,16})/gi;
  for (;;) {
    const m = re.exec(s);
    if (!m) break;
    const handle = String(m[1] || "").toLowerCase();
    if (handles.has(handle)) return true;
  }
  return false;
}

function attentionHintForPeer(state: AppState, id: string): string | null {
  const peer = String(id || "").trim();
  if (!peer) return null;
  if ((state.pendingIn || []).includes(peer)) return "Запрос авторизации";
  if ((state.pendingOut || []).includes(peer)) return "Ожидаем авторизацию";
  if ((state.fileOffersIn || []).some((x) => String(x?.from || "").trim() === peer)) return "Входящий файл";
  if ((state.pendingGroupInvites || []).some((x) => String(x?.from || "").trim() === peer)) return "Инвайт в чат";
  if ((state.pendingBoardInvites || []).some((x) => String(x?.from || "").trim() === peer)) return "Инвайт в доску";
  if ((state.pendingGroupJoinRequests || []).some((x) => String(x?.from || "").trim() === peer)) return "Запрос вступления";
  return null;
}

function isRowMenuOpen(state: AppState, kind: ContextMenuTargetKind, id: string): boolean {
  if (kind !== "dm" && kind !== "group" && kind !== "board") return false;
  const rowId = String(id || "").trim();
  if (!rowId) return false;
  const modal = state.modal;
  if (!modal || modal.kind !== "context_menu") return false;
  const target = modal.payload.target;
  return target.kind === kind && String(target.id || "").trim() === rowId;
}

function avatar(kind: "dm" | "group" | "board", id: string): HTMLElement {
  const url = getStoredAvatar(kind, id);
  const a = el("span", { class: url ? "avatar avatar-img" : "avatar", "aria-hidden": "true" }, [url ? "" : avatarMonogram(kind, id)]);
  a.style.setProperty("--avatar-h", String(avatarHue(`${kind}:${id}`)));
  if (url) a.style.backgroundImage = `url(${url})`;
  return a;
}

type SidebarRowMeta = {
  sub: string | null;
  time: string | null;
  hasDraft: boolean;
  reactionEmoji?: string | null;
};

function displayNameForFriend(state: AppState, f: FriendEntry): string {
  const id = String(f.id || "").trim();
  if (!id) return "—";
  const p = state.profiles?.[id];
  const dn = p?.display_name ? String(p.display_name).trim() : "";
  if (dn) return dn;
  const fdn = (f as any).display_name ? String((f as any).display_name).trim() : "";
  return fdn || id;
}

function compactOneLine(raw: string): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function pickPreviewReactionEmoji(state: AppState, msg: ChatMessage | null): string | null {
  if (!msg || msg.kind === "sys") return null;
  const selfId = String(state.selfId || "").trim();
  const from = String(msg.from || "").trim();
  const isSelf = msg.kind === "out" || (selfId && from === selfId);
  if (!isSelf) return null;
  const counts = msg.reactions?.counts;
  if (!counts || typeof counts !== "object") return null;
  const entries = Object.entries(counts)
    .map(([emoji, count]) => [String(emoji || "").trim(), Number(count)] as const)
    .filter(([emoji, count]) => emoji && Number.isFinite(count) && count > 0);
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

function shouldSuppressRowClick(btn: HTMLElement): boolean {
  const now = Date.now();
  const localUntil = Number(btn.getAttribute("data-ctx-suppress-until") || 0);
  if (Number.isFinite(localUntil) && localUntil > now) return true;
  if (typeof document === "undefined" || !document.documentElement) return false;
  const rootUntil = Number(document.documentElement.dataset.sidebarClickSuppressUntil || 0);
  if (Number.isFinite(rootUntil) && rootUntil > now) return true;
  const longPressUntil = Number(document.documentElement.dataset.sidebarLongPressUntil || 0);
  return Number.isFinite(longPressUntil) && longPressUntil > now;
}

function isImageName(name: string, mime?: string | null): boolean {
  const mt = String(mime || "").toLowerCase();
  if (mt.startsWith("image/")) return true;
  const n = String(name || "").toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|ico|svg)$/.test(n);
}

function previewForConversation(state: AppState, key: string, kind: "dm" | "room", draftText?: string | null): SidebarRowMeta {
  const draft = compactOneLine(draftText || "");
  const conv = state.conversations[key] || [];
  const last = conv.length ? conv[conv.length - 1] : null;
  const time = last && typeof last.ts === "number" && Number.isFinite(last.ts) ? formatTime(last.ts) : null;
  const reactionEmoji = pickPreviewReactionEmoji(state, last);

  let sub: string | null = null;
  if (draft) {
    sub = `Черновик: ${draft}`;
  } else if (last) {
    if (last.attachment?.kind === "file") {
      const nm = String(last.attachment.name || "файл");
      sub = isImageName(nm, last.attachment.mime) ? "Фото" : `Файл: ${nm}`;
    } else {
      const t = compactOneLine(String(last.text || ""));
      sub = t || null;
    }
    if (kind === "dm" && sub) {
      const from = String(last.from || "").trim();
      if (from && from === state.selfId) sub = `Вы: ${sub}`;
    }
    if (kind === "room" && sub) {
      const from = String(last.from || "").trim();
      if (from) {
        const who = from === state.selfId ? "Вы" : from;
        sub = `${who}: ${sub}`;
      }
    }
  }

  if (sub && sub.length > 84) sub = `${sub.slice(0, 81)}…`;
  return { sub, time, hasDraft: Boolean(draft), reactionEmoji };
}

function friendRow(
  state: AppState,
  f: FriendEntry,
  selected: boolean,
  meta: SidebarRowMeta,
  onSelect: (t: TargetRef) => void,
  onOpenUser: (id: string) => void,
  attn?: boolean
): HTMLElement {
  const peerId = String(f.id || "").trim();
  const muted = peerId ? (state.muted || []).includes(peerId) : false;
  const pinKey = peerId ? dmKey(peerId) : "";
  const pinned = Boolean(pinKey && (state.pinned || []).includes(pinKey));
  let cls = selected ? "row row-sel" : "row";
  if (muted) cls += " row-muted-chat";
  if (attn) cls += " row-attn";
  if (isRowMenuOpen(state, "dm", peerId)) cls += " row-menu-open";
  const unread = Math.max(0, Number(f.unread || 0) || 0);
  const unreadLabel = unread > 99 ? "99+" : String(unread);
  const tailTopChildren: HTMLElement[] = [];
  if (meta.time) {
    tailTopChildren.push(el("span", { class: "row-time", "aria-label": `Время: ${meta.time}` }, [meta.time]));
  }
  const tailBottomChildren: HTMLElement[] = [];
  if (meta.reactionEmoji) {
    tailBottomChildren.push(
      el("span", { class: "row-reaction", "aria-label": `Реакция: ${meta.reactionEmoji}` }, [meta.reactionEmoji])
    );
  }
  if (unread > 0) {
    tailBottomChildren.push(el("span", { class: "row-unread", "aria-label": `Непрочитано: ${unread}` }, [unreadLabel]));
  }
  if (pinned) tailBottomChildren.push(el("span", { class: "row-pin", "aria-label": "Закреплено" }, ["📌"]));
  if (meta.hasDraft) tailBottomChildren.push(el("span", { class: "row-draft", "aria-label": "Есть черновик" }, ["черновик"]));
  if (muted) tailBottomChildren.push(el("span", { class: "row-muted", "aria-label": "Звук отключён" }, ["M"]));
  const tailChildren: HTMLElement[] = [];
  if (tailTopChildren.length) tailChildren.push(el("span", { class: "row-tail-top" }, tailTopChildren));
  if (tailBottomChildren.length) tailChildren.push(el("span", { class: "row-tail-bottom" }, tailBottomChildren));
  const tail = tailChildren.length
    ? el("span", { class: "row-tail", "aria-hidden": tailChildren.length ? "false" : "true" }, tailChildren)
    : null;
  const titleText = displayNameForFriend(state, f);
  const isIdTitle = titleText === String(f.id || "").trim();
  const mainChildren: Array<string | HTMLElement> = [el("span", { class: isIdTitle ? "row-title row-id" : "row-title row-name" }, [titleText])];
  if (meta.sub) {
    mainChildren.push(el("span", { class: meta.hasDraft ? "row-sub row-sub-draft" : "row-sub" }, [meta.sub]));
  }
  const main = el("span", { class: "row-main" }, mainChildren);
  const av = avatar("dm", f.id);
  av.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onOpenUser(f.id);
  });
  const btn = el("button", { class: cls, type: "button" }, [
    av,
    main,
    ...(tail ? [tail] : []),
  ]);
  btn.setAttribute("data-ctx-kind", "dm");
  btn.setAttribute("data-ctx-id", f.id);
  btn.setAttribute("data-online", f.online ? "1" : "0");
  btn.addEventListener("click", (e) => {
    const ev = e as MouseEvent;
    if (shouldSuppressRowClick(btn)) {
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    // Prevent Ctrl+Click / RMB quirks (macOS) from triggering navigation when opening context menu.
    if (ev.ctrlKey) return;
    if (typeof ev.button === "number" && ev.button !== 0) return;
    onSelect({ kind: "dm", id: f.id });
  });
  return btn;
}

function roomRow(
  prefix: string | null,
  label: string,
  selected: boolean,
  onClick: () => void,
  ctx?: { kind: "group" | "board"; id: string },
  meta?: SidebarRowMeta,
  opts?: { mention?: boolean; muted?: boolean; unread?: number; pinned?: boolean; menuOpen?: boolean }
): HTMLElement {
  let cls = selected ? "row row-sel" : "row";
  if (opts?.muted) cls += " row-muted-chat";
  if (opts?.menuOpen) cls += " row-menu-open";
  const unread = Math.max(0, Number(opts?.unread || 0) || 0);
  const unreadLabel = unread > 99 ? "99+" : String(unread);
  const tailTopChildren: HTMLElement[] = [];
  if (meta?.time) tailTopChildren.push(el("span", { class: "row-time", "aria-label": `Время: ${meta.time}` }, [meta.time]));
  const tailBottomChildren: HTMLElement[] = [];
  if (meta?.reactionEmoji) {
    tailBottomChildren.push(
      el("span", { class: "row-reaction", "aria-label": `Реакция: ${meta.reactionEmoji}` }, [meta.reactionEmoji])
    );
  }
  if (opts?.mention) tailBottomChildren.push(el("span", { class: "row-mention", "aria-label": "Упоминание" }, ["@"]));
  if (unread > 0) {
    tailBottomChildren.push(el("span", { class: "row-unread", "aria-label": `Непрочитано: ${unread}` }, [unreadLabel]));
  }
  if (opts?.pinned) tailBottomChildren.push(el("span", { class: "row-pin", "aria-label": "Закреплено" }, ["📌"]));
  if (meta?.hasDraft) tailBottomChildren.push(el("span", { class: "row-draft", "aria-label": "Есть черновик" }, ["черновик"]));
  if (opts?.muted) tailBottomChildren.push(el("span", { class: "row-muted", "aria-label": "Звук отключён" }, ["M"]));
  const tailChildren: HTMLElement[] = [];
  if (tailTopChildren.length) tailChildren.push(el("span", { class: "row-tail-top" }, tailTopChildren));
  if (tailBottomChildren.length) tailChildren.push(el("span", { class: "row-tail-bottom" }, tailBottomChildren));
  const tail = tailChildren.length ? el("span", { class: "row-tail" }, tailChildren) : null;
  const hasConversationMeta = Boolean(ctx);
  const hasSub = Boolean(meta?.sub);
  const mainChildren: Array<string | HTMLElement> = [
    el("span", { class: hasConversationMeta || hasSub ? "row-title row-label" : "row-label" }, [label]),
    ...(hasSub ? [el("span", { class: meta?.hasDraft ? "row-sub row-sub-draft" : "row-sub" }, [String(meta?.sub || "")])] : []),
  ];
  const btn = el("button", { class: cls, type: "button" }, [
    ...(prefix ? [el("span", { class: "row-prefix", "aria-hidden": "true" }, [prefix])] : []),
    ...(ctx ? [avatar(ctx.kind, ctx.id)] : []),
    ...(hasConversationMeta || hasSub ? [el("span", { class: "row-main" }, mainChildren)] : mainChildren),
    ...(tail ? [tail] : []),
  ]);
  if (ctx) {
    btn.setAttribute("data-ctx-kind", ctx.kind);
    btn.setAttribute("data-ctx-id", ctx.id);
  }
  btn.addEventListener("click", (e) => {
    const ev = e as MouseEvent;
    if (shouldSuppressRowClick(btn)) {
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    if (ev.ctrlKey) return;
    if (typeof ev.button === "number" && ev.button !== 0) return;
    onClick();
  });
  return btn;
}

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
  onSetSidebarQuery: (query: string) => void,
  onAuthOpen: () => void,
  onAuthLogout: () => void,
  onOpenSidebarToolsMenu: (x: number, y: number) => void,
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
  const lastTsForKey = (key: string): number => {
    const conv = state.conversations[key] || [];
    const last = conv.length ? conv[conv.length - 1] : null;
    const ts = last && typeof last.ts === "number" && Number.isFinite(last.ts) ? last.ts : 0;
    return Math.max(0, ts);
  };
  const lastActivityTs = (f: FriendEntry): number => {
    const id = String(f.id || "").trim();
    if (!id) return 0;
    const ts = lastTsForKey(dmKey(id));
    if (ts) return ts;
    return lastSeenTs(f);
  };
  const compareFriendsByActivity = (a: FriendEntry, b: FriendEntry): number => {
    const aTs = lastActivityTs(a);
    const bTs = lastActivityTs(b);
    if (aTs !== bTs) return bTs - aTs;
    return displayNameForFriend(state, a).localeCompare(displayNameForFriend(state, b), "ru", { sensitivity: "base" });
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
    const from = String(last.from || "").trim();
    if (from && state.selfId && from === state.selfId) return false;
    return hasSelfMention(String(last.text || ""), selfMentionHandles);
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
  const sidebarQueryRaw = compactOneLine(String((state as any).sidebarQuery || ""));
  const sidebarQuery = sidebarQueryRaw.toLowerCase();
  const hasSidebarQuery = Boolean(sidebarQuery);
  const sidebarChatFilter: SidebarChatFilter = state.sidebarChatFilter === "unread" ? "unread" : "all";
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

  const buildChatFilters = (active: SidebarChatFilter, unreadCount: number): HTMLElement => {
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
    return el("div", { class: "sidebar-filters", role: "tablist", "aria-label": "Фильтр чатов" }, [
      makeBtn("all", "Все"),
      makeBtn("unread", "Непрочитанные", badgeText || undefined),
    ]);
  };


  if (isMobile) {
    const rawTab = state.mobileSidebarTab;
    const activeTab: MobileSidebarTab =
      rawTab === "contacts" || rawTab === "menu" || rawTab === "boards" ? rawTab : "chats";
    const prevTab = String((target as any)._mobileSidebarPrevTab || "").trim();
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
    if ("dataset" in target) (target as HTMLElement).dataset.sidebarTab = activeTab;
    const tabContacts = el(
      "button",
      {
        class: activeTab === "contacts" ? "sidebar-tab sidebar-tab-active" : "sidebar-tab",
        type: "button",
        role: "tab",
        "aria-selected": String(activeTab === "contacts"),
        title: "Контакты",
      },
      ["Контакты"]
    ) as HTMLButtonElement;
    const tabBoards = el(
      "button",
      {
        class: activeTab === "boards" ? "sidebar-tab sidebar-tab-active" : "sidebar-tab",
        type: "button",
        role: "tab",
        "aria-selected": String(activeTab === "boards"),
        title: "Доски",
      },
      ["Доски"]
    ) as HTMLButtonElement;
    const tabChats = el(
      "button",
      {
        class: activeTab === "chats" ? "sidebar-tab sidebar-tab-active" : "sidebar-tab",
        type: "button",
        role: "tab",
        "aria-selected": String(activeTab === "chats"),
        title: "Чаты",
      },
      ["Чаты"]
    ) as HTMLButtonElement;
    const tabMenu = el(
      "button",
      {
        class: activeTab === "menu" ? "sidebar-tab sidebar-tab-active" : "sidebar-tab",
        type: "button",
        role: "tab",
        "aria-selected": String(activeTab === "menu"),
        title: "Меню",
      },
      ["Меню"]
    ) as HTMLButtonElement;
    tabChats.addEventListener("click", () => onSetMobileSidebarTab("chats"));
    tabContacts.addEventListener("click", () => onSetMobileSidebarTab("contacts"));
    tabBoards.addEventListener("click", () => onSetMobileSidebarTab("boards"));
    tabMenu.addEventListener("click", () => onSetMobileSidebarTab("menu"));
    const tabs = el("div", { class: "sidebar-tabs sidebar-tabs-mobile", role: "tablist", "aria-label": "Раздел" }, [
      tabContacts,
      tabBoards,
      tabChats,
      tabMenu,
    ]);

    const searchBar =
      activeTab === "menu"
        ? null
        : (() => {
            const input = el("input", {
              class: "sidebar-search-input",
              type: "search",
              placeholder: activeTab === "contacts" ? "Поиск контакта" : activeTab === "boards" ? "Поиск доски" : "Поиск",
              "aria-label": "Поиск",
              "data-ios-assistant": "off",
              autocomplete: "off",
              autocorrect: "off",
              autocapitalize: "off",
              spellcheck: "false",
              enterkeyhint: "search",
            }) as HTMLInputElement;
            input.value = sidebarQueryRaw;
            input.disabled = disableSearchWhileTyping;
            input.addEventListener("input", () => onSetSidebarQuery(input.value));
            input.addEventListener("keydown", (e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onSetSidebarQuery("");
              }
            });
            const clearBtn = el(
              "button",
              {
                class: sidebarQueryRaw ? "btn sidebar-search-clear" : "btn sidebar-search-clear hidden",
                type: "button",
                title: "Очистить",
                "aria-label": "Очистить",
              },
              ["×"]
            ) as HTMLButtonElement;
            clearBtn.addEventListener("click", (e) => {
              e.preventDefault();
              onSetSidebarQuery("");
              focusElement(input);
            });
            return el("div", { class: "sidebar-searchbar" }, [input, clearBtn]);
          })();
    const sticky = el("div", { class: "sidebar-mobile-sticky" }, [
      tabs,
      ...(searchBar ? [searchBar] : []),
    ]);
    const showChatFilters = activeTab === "chats" && !hasSidebarQuery;
    const chatFiltersRow = showChatFilters ? buildChatFilters(effectiveChatFilter, unreadDialogsCount) : null;
    const filterChats = activeTab === "chats" && effectiveChatFilter === "unread";
    const mountMobile = (children: HTMLElement[]) => {
      body.replaceChildren(...children);
      target.replaceChildren(sticky, body);
      bindHeaderScroll(sticky);
      (target as any)._mobileSidebarPrevTab = activeTab;
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

    const pinnedChatRows: HTMLElement[] = [];
    const pinnedBoardRows: HTMLElement[] = [];
    const pinnedContactRows: HTMLElement[] = [];
    for (const key of pinnedKeys) {
      if (key.startsWith("dm:")) {
        const id = key.slice(3);
        const f = state.friends.find((x) => x.id === id);
        if (!f) continue;
        if (!matchesFriend(f)) continue;
        const k = dmKey(f.id);
        const unread = Math.max(0, Number(f.unread || 0) || 0);
        const attention = attnSet.has(f.id);
        if (filterChats && !isUnreadDialog({ unread, attention })) continue;
        const meta = previewForConversation(state, k, "dm", drafts[k]);
        const row = friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === f.id), meta, onSelect, onOpenUser, attention);
        pinnedContactRows.push(row);
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
          if (filterChats && !isUnreadDialog({ unread, mention })) continue;
          pinnedChatRows.push(
            roomRow(
              null,
              String(g.name || g.id),
              Boolean(sel && sel.kind === "group" && sel.id === g.id),
              () => onSelect({ kind: "group", id: g.id }),
              { kind: "group", id: g.id },
              meta,
              { mention, muted: isMuted(g.id), unread, pinned: true, menuOpen: isRowMenuOpen(state, "group", g.id) }
            )
          );
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

    const restBoards = boards.filter((b) => !pinnedSet.has(roomKey(b.id)));
    const restGroups = groups.filter((g) => !pinnedSet.has(roomKey(g.id)));

    if (activeTab === "chats") {
      const dialogItems: Array<{ sortTs: number; priority: number; label: string; row: HTMLElement }> = [];

      // Активные диалоги (ЛС): показываем только тех, у кого есть история/черновик/unread/attention.
      for (const f of state.friends || []) {
        const id = String(f?.id || "").trim();
        if (!id) continue;
        const k = dmKey(id);
        if (pinnedSet.has(k)) continue;
        if (!hasActiveDialogForFriend(f)) continue;
        if (!matchesFriend(f)) continue;
        const meta = previewForConversation(state, k, "dm", drafts[k]);
        const label = displayNameForFriend(state, f);
        const unread = Math.max(0, Number(f.unread || 0) || 0);
        const attention = attnSet.has(id);
        if (filterChats && !isUnreadDialog({ unread, attention })) continue;
        dialogItems.push({
          sortTs: lastTsForKey(k),
          priority: dialogPriority({ hasDraft: meta.hasDraft, unread, attention }),
          label,
          row: friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === id), meta, onSelect, onOpenUser, attention),
        });
      }

      for (const g of restGroups) {
        if (!matchesRoom(g)) continue;
        const k = roomKey(g.id);
        const meta = previewForConversation(state, k, "room", drafts[k]);
        const unread = computeRoomUnread(k);
        const mention = mentionForKey(k);
        const label = String(g.name || g.id);
        if (filterChats && !isUnreadDialog({ unread, mention })) continue;
        dialogItems.push({
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
        });
      }

      dialogItems.sort(
        (a, b) =>
          b.priority - a.priority ||
          b.sortTs - a.sortTs ||
          a.label.localeCompare(b.label, "ru", { sensitivity: "base" })
      );
      const dialogRows = dialogItems.map((x) => x.row);
      const pinnedDialogRows = [...pinnedContactRows, ...pinnedChatRows];

      mountMobile([
        ...(chatFiltersRow ? [chatFiltersRow] : []),
        ...(pinnedDialogRows.length ? [el("div", { class: "pane-section" }, ["Закреплённые"]), ...pinnedDialogRows] : []),
        el("div", { class: "pane-section" }, [hasSidebarQuery ? "Результаты" : "Чаты"]),
        ...(dialogRows.length ? dialogRows : [el("div", { class: "pane-section" }, [hasSidebarQuery ? "(ничего не найдено)" : "(пока нет чатов)"])])
      ]);
      return;
    }

    if (activeTab === "boards") {
      const boardItems: Array<{ sortTs: number; row: HTMLElement }> = [];
      for (const b of restBoards) {
        if (!matchesRoom(b)) continue;
        const k = roomKey(b.id);
        const meta = previewForConversation(state, k, "room", drafts[k]);
        const unread = computeRoomUnread(k);
        boardItems.push({
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
        });
      }
      boardItems.sort((a, b) => b.sortTs - a.sortTs);
      const boardRows = boardItems.map((x) => x.row);

      mountMobile([
        ...(pinnedBoardRows.length ? [el("div", { class: "pane-section" }, ["Закреплённые"]), ...pinnedBoardRows] : []),
        el("div", { class: "pane-section" }, [hasSidebarQuery ? "Результаты" : "Доски"]),
        ...(boardRows.length ? boardRows : [el("div", { class: "pane-section" }, [hasSidebarQuery ? "(ничего не найдено)" : "(пока нет досок)"])])
      ]);
      return;
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

    if (activeTab === "contacts") {
      const pinnedContactRowsCompact = markCompactAvatarRows(pinnedContactRows);
      const contactRowsSorted = markCompactAvatarRows(
        (state.friends || [])
          .filter((f) => matchesFriend(f) && !pinnedSet.has(dmKey(f.id)))
          .sort(compareFriendsByActivity)
          .map((f) => {
            const k = dmKey(f.id);
            const meta = previewForConversation(state, k, "dm", drafts[k]);
            return friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === f.id), meta, onSelect, onOpenUser, attnSet.has(f.id));
          })
      );
      if (hasSidebarQuery) {
        const allRows = markCompactAvatarRows([...unknownAttnRows, ...contactRowsSorted]);
        mountMobile([
          ...(pinnedContactRowsCompact.length ? [el("div", { class: "pane-section" }, ["Закреплённые"]), ...pinnedContactRowsCompact] : []),
          ...(allRows.length
            ? [el("div", { class: "pane-section" }, [`Результаты (${allRows.length})`]), ...allRows]
            : [el("div", { class: "pane-section" }, ["(ничего не найдено)"])])
        ]);
        return;
      }
      const compactUnknownAttnRows = markCompactAvatarRows(unknownAttnRows);
      const contactRows: HTMLElement[] = [];
      if (pinnedContactRowsCompact.length) {
        contactRows.push(el("div", { class: "pane-section" }, ["Закреплённые"]), ...pinnedContactRowsCompact);
      }
      if (compactUnknownAttnRows.length) {
        contactRows.push(el("div", { class: "pane-section" }, ["Внимание"]), ...compactUnknownAttnRows);
      }
      if (contactRowsSorted.length) contactRows.push(...contactRowsSorted);
      mountMobile(contactRows);
      return;
    }

    // Menu tab: действия и навигация.
    const profileRow = roomRow("☺", "Профиль", state.page === "profile", () => onSetPage("profile"), undefined, {
      sub: "Имя, @handle, аватар",
      time: null,
      hasDraft: false,
    });
    profileRow.setAttribute("title", "Настройки профиля и интерфейса");
    const filesRow = roomRow("▦", "Файлы", state.page === "files", () => onSetPage("files"), undefined, {
      sub: "История и загрузки",
      time: null,
      hasDraft: false,
    });
    filesRow.setAttribute("title", "Передача файлов и история");
    const navRows: HTMLElement[] = [profileRow, filesRow];

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

    const tips = el("details", { class: "sidebar-tips" }, [
      el("summary", { class: "sidebar-tips-summary", title: "Короткие подсказки", "aria-label": "Подсказки" }, ["Подсказки"]),
      el("div", { class: "sidebar-tips-body" }, [
        el("div", { class: "sidebar-tip" }, ["ПКМ/долгий тап по контакту — меню действий."]),
        el("div", { class: "sidebar-tip" }, ["«Чаты» — активные диалоги и группы, «Контакты» — список пользователей."]),
      ]),
    ]);

    mountMobile([
      tips,
      el("div", { class: "pane-section" }, ["Навигация"]),
      ...navRows,
      ...(accountRows.length ? [el("div", { class: "pane-section" }, ["Аккаунт"]), ...accountRows] : []),
      el("div", { class: "pane-section" }, ["Создание"]),
      ...createRows,
      el("div", { class: "pane-section" }, ["Справка"]),
      infoRow
    ]);
    return;
  }

  if ("dataset" in target) delete (target as HTMLElement).dataset.sidebarTab;

  // PWA (standalone/fullscreen): tabs should behave like mobile (separate views),
  // not just as "scroll-to" shortcuts.
  if (isStandaloneDisplayMode()) {
    const rawTab = state.mobileSidebarTab;
    const showMenuTab = true;
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

    const tabContacts = el(
      "button",
      {
        class: activeTab === "contacts" ? "sidebar-tab sidebar-tab-active" : "sidebar-tab",
        type: "button",
        role: "tab",
        "aria-selected": String(activeTab === "contacts"),
        title: "Контакты",
      },
      ["Контакты"]
    ) as HTMLButtonElement;
    const tabBoards = el(
      "button",
      {
        class: activeTab === "boards" ? "sidebar-tab sidebar-tab-active" : "sidebar-tab",
        type: "button",
        role: "tab",
        "aria-selected": String(activeTab === "boards"),
        title: "Доски",
      },
      ["Доски"]
    ) as HTMLButtonElement;
    const tabChats = el(
      "button",
      {
        class: activeTab === "chats" ? "sidebar-tab sidebar-tab-active" : "sidebar-tab",
        type: "button",
        role: "tab",
        "aria-selected": String(activeTab === "chats"),
        title: "Чаты",
      },
      ["Чаты"]
    ) as HTMLButtonElement;

    tabChats.addEventListener("click", () => onSetMobileSidebarTab("chats"));
    tabContacts.addEventListener("click", () => onSetMobileSidebarTab("contacts"));
    tabBoards.addEventListener("click", () => onSetMobileSidebarTab("boards"));
    const tabMenu = showMenuTab
      ? (el(
          "button",
          {
            class: activeTab === "menu" ? "sidebar-tab sidebar-tab-active" : "sidebar-tab",
            type: "button",
            role: "tab",
            "aria-selected": String(activeTab === "menu"),
            title: "Меню",
          },
          ["Меню"]
        ) as HTMLButtonElement)
      : null;
    if (tabMenu) tabMenu.addEventListener("click", () => onSetMobileSidebarTab("menu"));

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

    const searchBar =
      showMenuTab && activeTab === "menu"
        ? null
        : (() => {
            const input = el("input", {
              class: "sidebar-search-input",
              type: "search",
              placeholder: activeTab === "contacts" ? "Поиск контакта" : activeTab === "boards" ? "Поиск доски" : "Поиск",
              "aria-label": "Поиск",
              "data-ios-assistant": "off",
              autocomplete: "off",
              autocorrect: "off",
              autocapitalize: "off",
              spellcheck: "false",
              enterkeyhint: "search",
            }) as HTMLInputElement;
            input.value = sidebarQueryRaw;
            input.disabled = disableSearchWhileTyping;
            input.addEventListener("input", () => onSetSidebarQuery(input.value));
            input.addEventListener("keydown", (e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onSetSidebarQuery("");
              }
            });
            const clearBtn = el(
              "button",
              {
                class: sidebarQueryRaw ? "btn sidebar-search-clear" : "btn sidebar-search-clear hidden",
                type: "button",
                title: "Очистить",
                "aria-label": "Очистить",
              },
              ["×"]
            ) as HTMLButtonElement;
            clearBtn.addEventListener("click", (e) => {
              e.preventDefault();
              onSetSidebarQuery("");
              focusElement(input);
            });
            return el("div", { class: "sidebar-searchbar" }, [input, clearBtn]);
          })();
    const headerToolbar = buildSidebarHeaderToolbar(activeTab);
    const headerStack = el("div", { class: "sidebar-header-stack" }, [
      headerToolbar,
      ...(activeTab === "menu"
        ? [el("div", { class: "sidebar-header-title" }, ["Меню"])]
        : [...(searchBar ? [searchBar] : [])]),
    ]);
    const header = el("div", { class: "sidebar-header" }, [headerStack]);
    const showChatFilters = activeTab === "chats" && !hasSidebarQuery;
    const chatFiltersRow = showChatFilters ? buildChatFilters(effectiveChatFilter, unreadDialogsCount) : null;
    const filterChats = activeTab === "chats" && effectiveChatFilter === "unread";

    const pinnedChatRows: HTMLElement[] = [];
    const pinnedBoardRows: HTMLElement[] = [];
    const pinnedContactRows: HTMLElement[] = [];
    for (const key of pinnedKeys) {
      if (key.startsWith("dm:")) {
        const id = key.slice(3);
        const f = state.friends.find((x) => x.id === id);
        if (!f) continue;
        if (!matchesFriend(f)) continue;
        const k = dmKey(f.id);
        const unread = Math.max(0, Number(f.unread || 0) || 0);
        const attention = attnSet.has(f.id);
        if (filterChats && !isUnreadDialog({ unread, attention })) continue;
        const meta = previewForConversation(state, k, "dm", drafts[k]);
        pinnedContactRows.push(friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === f.id), meta, onSelect, onOpenUser, attention));
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
          if (filterChats && !isUnreadDialog({ unread, mention })) continue;
          pinnedChatRows.push(
            roomRow(
              null,
              String(g.name || g.id),
              Boolean(sel && sel.kind === "group" && sel.id === g.id),
              () => onSelect({ kind: "group", id: g.id }),
              { kind: "group", id: g.id },
              meta,
              { mention, muted: isMuted(g.id), unread, pinned: true, menuOpen: isRowMenuOpen(state, "group", g.id) }
            )
          );
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

      for (const f of state.friends || []) {
        const id = String(f?.id || "").trim();
        if (!id) continue;
        const k = dmKey(id);
        if (pinnedSet.has(k)) continue;
        if (!hasActiveDialogForFriend(f)) continue;
        if (!matchesFriend(f)) continue;
        const meta = previewForConversation(state, k, "dm", drafts[k]);
        const label = displayNameForFriend(state, f);
        const unread = Math.max(0, Number(f.unread || 0) || 0);
        const attention = attnSet.has(id);
        if (filterChats && !isUnreadDialog({ unread, attention })) continue;
        dialogItems.push({
          sortTs: lastTsForKey(k),
          priority: dialogPriority({ hasDraft: meta.hasDraft, unread, attention }),
          label,
          row: friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === id), meta, onSelect, onOpenUser, attention),
        });
      }

      for (const g of restGroups) {
        if (!matchesRoom(g)) continue;
        const k = roomKey(g.id);
        const meta = previewForConversation(state, k, "room", drafts[k]);
        const unread = computeRoomUnread(k);
        const mention = mentionForKey(k);
        const label = String(g.name || g.id);
        if (filterChats && !isUnreadDialog({ unread, mention })) continue;
        dialogItems.push({
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
        });
      }

      dialogItems.sort(
        (a, b) =>
          b.priority - a.priority ||
          b.sortTs - a.sortTs ||
          a.label.localeCompare(b.label, "ru", { sensitivity: "base" })
      );
      const dialogRows = dialogItems.map((x) => x.row);
      const pinnedDialogRows = [...pinnedContactRows, ...pinnedChatRows];

      mountPwa([
        ...(chatFiltersRow ? [chatFiltersRow] : []),
        ...(pinnedDialogRows.length ? [el("div", { class: "pane-section" }, ["Закреплённые"]), ...pinnedDialogRows] : []),
        el("div", { class: "pane-section" }, [hasSidebarQuery ? "Результаты" : "Чаты"]),
        ...(dialogRows.length ? dialogRows : [el("div", { class: "pane-section" }, [hasSidebarQuery ? "(ничего не найдено)" : "(пока нет чатов)"])]),
      ]);
      return;
    }

    if (activeTab === "boards") {
      const restBoards = boards.filter((b) => !pinnedSet.has(roomKey(b.id)));
      const boardItems: Array<{ sortTs: number; row: HTMLElement }> = [];
      for (const b of restBoards) {
        if (!matchesRoom(b)) continue;
        const k = roomKey(b.id);
        const meta = previewForConversation(state, k, "room", drafts[k]);
        const unread = computeRoomUnread(k);
        boardItems.push({
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
        });
      }
      boardItems.sort((a, b) => b.sortTs - a.sortTs);
      const boardRows = boardItems.map((x) => x.row);

      mountPwa([
        ...(pinnedBoardRows.length ? [el("div", { class: "pane-section" }, ["Закреплённые"]), ...pinnedBoardRows] : []),
        el("div", { class: "pane-section" }, [hasSidebarQuery ? "Результаты" : "Доски"]),
        ...(boardRows.length ? boardRows : [el("div", { class: "pane-section" }, [hasSidebarQuery ? "(ничего не найдено)" : "(пока нет досок)"])]),
      ]);
      return;
    }

    if (activeTab === "contacts") {
      const pinnedContactRowsCompact = markCompactAvatarRows(pinnedContactRows);
      const contactRowsSorted = markCompactAvatarRows(
        (state.friends || [])
          .filter((f) => matchesFriend(f) && !pinnedSet.has(dmKey(f.id)))
          .sort(compareFriendsByActivity)
          .map((f) => {
            const k = dmKey(f.id);
            const meta = previewForConversation(state, k, "dm", drafts[k]);
            return friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === f.id), meta, onSelect, onOpenUser, attnSet.has(f.id));
          })
      );

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
        const allRows = markCompactAvatarRows([...unknownAttnRows, ...contactRowsSorted]);
        mountPwa([
          ...(pinnedContactRowsCompact.length ? [el("div", { class: "pane-section" }, ["Закреплённые"]), ...pinnedContactRowsCompact] : []),
          ...(allRows.length
            ? [el("div", { class: "pane-section" }, [`Результаты (${allRows.length})`]), ...allRows]
            : [el("div", { class: "pane-section" }, ["(ничего не найдено)"])]),
        ]);
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

      const contactRows: HTMLElement[] = [];
      if (pinnedContactRowsCompact.length) {
        contactRows.push(el("div", { class: "pane-section" }, ["Закреплённые"]), ...pinnedContactRowsCompact);
      }
      if (unknownAttnRows.length) {
        contactRows.push(el("div", { class: "pane-section" }, ["Внимание"]), ...unknownAttnRows);
      }
      if (contactRowsSorted.length) {
        contactRows.push(...contactRowsSorted);
      }
      mountPwa(contactRows);
      return;
    }

    // Menu tab (PWA): actions/navigation.
    const profileRow = roomRow("☺", "Профиль", state.page === "profile", () => onSetPage("profile"), undefined, {
      sub: "Имя, @handle, аватар",
      time: null,
      hasDraft: false,
    });
    profileRow.setAttribute("title", "Настройки профиля и интерфейса");
    const filesRow = roomRow("▦", "Файлы", state.page === "files", () => onSetPage("files"), undefined, {
      sub: "История и загрузки",
      time: null,
      hasDraft: false,
    });
    filesRow.setAttribute("title", "Передача файлов и история");
    const navRows: HTMLElement[] = [profileRow, filesRow];

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

  // Desktop (browser): tabs like on mobile/PWA (Контакты/Доски/Чаты/Меню).
  type DesktopTab = "contacts" | "boards" | "chats" | "menu";
  const showMenuTab = true;
  const defaultDesktopTab: DesktopTab = unknownAttnPeers.length ? "contacts" : "chats";
  const rawDesktopTab = state.mobileSidebarTab;
  let activeDesktopTab: DesktopTab =
    rawDesktopTab === "contacts" || rawDesktopTab === "boards" || rawDesktopTab === "menu" ? rawDesktopTab : defaultDesktopTab;
  if (!showMenuTab && activeDesktopTab === "menu") activeDesktopTab = defaultDesktopTab;
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

  const desktopTabContacts = el(
    "button",
    {
      class: activeDesktopTab === "contacts" ? "sidebar-tab sidebar-tab-active" : "sidebar-tab",
      type: "button",
      role: "tab",
      "aria-selected": String(activeDesktopTab === "contacts"),
      title: "Контакты",
    },
    ["Контакты"]
  ) as HTMLButtonElement;
  const desktopTabBoards = el(
    "button",
    {
      class: activeDesktopTab === "boards" ? "sidebar-tab sidebar-tab-active" : "sidebar-tab",
      type: "button",
      role: "tab",
      "aria-selected": String(activeDesktopTab === "boards"),
      title: "Доски",
    },
    ["Доски"]
  ) as HTMLButtonElement;
  const desktopTabChats = el(
    "button",
    {
      class: activeDesktopTab === "chats" ? "sidebar-tab sidebar-tab-active" : "sidebar-tab",
      type: "button",
      role: "tab",
      "aria-selected": String(activeDesktopTab === "chats"),
      title: "Чаты",
    },
    ["Чаты"]
  ) as HTMLButtonElement;
  const desktopTabMenu = showMenuTab
    ? (el(
        "button",
        {
          class: activeDesktopTab === "menu" ? "sidebar-tab sidebar-tab-active" : "sidebar-tab",
          type: "button",
          role: "tab",
          "aria-selected": String(activeDesktopTab === "menu"),
          title: "Меню",
        },
        ["Меню"]
      ) as HTMLButtonElement)
    : null;

  desktopTabChats.addEventListener("click", () => onSetMobileSidebarTab("chats"));
  desktopTabContacts.addEventListener("click", () => onSetMobileSidebarTab("contacts"));
  desktopTabBoards.addEventListener("click", () => onSetMobileSidebarTab("boards"));
  if (desktopTabMenu) desktopTabMenu.addEventListener("click", () => onSetMobileSidebarTab("menu"));

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

  const searchBar = (() => {
    const input = el("input", {
      class: "sidebar-search-input",
      type: "search",
      placeholder:
        activeDesktopTab === "contacts" ? "Поиск контакта" : activeDesktopTab === "boards" ? "Поиск доски" : "Поиск",
      "aria-label": "Поиск",
      "data-ios-assistant": "off",
      autocomplete: "off",
      autocorrect: "off",
      autocapitalize: "off",
      spellcheck: "false",
      enterkeyhint: "search",
    }) as HTMLInputElement;
    input.value = sidebarQueryRaw;
    input.disabled = disableSearchWhileTyping;
    input.addEventListener("input", () => onSetSidebarQuery(input.value));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onSetSidebarQuery("");
      }
    });
    const clearBtn = el(
      "button",
      {
        class: sidebarQueryRaw ? "btn sidebar-search-clear" : "btn sidebar-search-clear hidden",
        type: "button",
        title: "Очистить",
        "aria-label": "Очистить",
      },
      ["×"]
    ) as HTMLButtonElement;
    clearBtn.addEventListener("click", (e) => {
      e.preventDefault();
      onSetSidebarQuery("");
      focusElement(input);
    });
    return el("div", { class: "sidebar-searchbar" }, [input, clearBtn]);
  })();
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
  const chatFiltersRow = showChatFilters ? buildChatFilters(effectiveChatFilter, unreadDialogsCount) : null;
  const filterChats = activeDesktopTab === "chats" && effectiveChatFilter === "unread";

  const pinnedDmRows: HTMLElement[] = [];
  const pinnedChatRows: HTMLElement[] = [];
  const pinnedBoardRows: HTMLElement[] = [];
  for (const key of pinnedKeys) {
    if (key.startsWith("dm:")) {
      const id = key.slice(3);
      const f = state.friends.find((x) => x.id === id);
      if (!f) continue;
      if (!matchesFriend(f)) continue;
      const k = dmKey(f.id);
      const unread = Math.max(0, Number(f.unread || 0) || 0);
      const attention = attnSet.has(f.id);
      if (filterChats && !isUnreadDialog({ unread, attention })) continue;
      const meta = previewForConversation(state, k, "dm", drafts[k]);
      pinnedDmRows.push(friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === f.id), meta, onSelect, onOpenUser, attention));
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
      if (filterChats && !isUnreadDialog({ unread, mention })) continue;
      pinnedChatRows.push(
        roomRow(
          null,
          String(g.name || g.id),
          Boolean(sel && sel.kind === "group" && sel.id === g.id),
          () => onSelect({ kind: "group", id: g.id }),
          { kind: "group", id: g.id },
          meta,
          { mention, muted: isMuted(g.id), unread, pinned: true, menuOpen: isRowMenuOpen(state, "group", g.id) }
        )
      );
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
    profileRow.setAttribute("title", "Настройки профиля и интерфейса");
    const filesRow = roomRow("▦", "Файлы", state.page === "files", () => onSetPage("files"), undefined, {
      sub: "История и загрузки",
      time: null,
      hasDraft: false,
    });
    filesRow.setAttribute("title", "Передача файлов и история");
    const navRows: HTMLElement[] = [profileRow, filesRow];

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

    for (const f of state.friends || []) {
      const id = String(f?.id || "").trim();
      if (!id) continue;
      const k = dmKey(id);
      if (pinnedSet.has(k)) continue;
      if (!hasActiveDialogForFriend(f)) continue;
      if (!matchesFriend(f)) continue;
      const meta = previewForConversation(state, k, "dm", drafts[k]);
      const label = displayNameForFriend(state, f);
      const unread = Math.max(0, Number(f.unread || 0) || 0);
      const attention = attnSet.has(id);
      if (filterChats && !isUnreadDialog({ unread, attention })) continue;
      dialogItems.push({
        sortTs: lastTsForKey(k),
        priority: dialogPriority({ hasDraft: meta.hasDraft, unread, attention }),
        label,
        row: friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === id), meta, onSelect, onOpenUser, attention),
      });
    }

    for (const g of restGroups) {
      if (!matchesRoom(g)) continue;
      const k = roomKey(g.id);
      const meta = previewForConversation(state, k, "room", drafts[k]);
      const unread = computeRoomUnread(k);
      const mention = mentionForKey(k);
      const label = String(g.name || g.id);
      if (filterChats && !isUnreadDialog({ unread, mention })) continue;
      dialogItems.push({
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
      });
    }

    dialogItems.sort(
      (a, b) =>
        b.priority - a.priority ||
        b.sortTs - a.sortTs ||
        a.label.localeCompare(b.label, "ru", { sensitivity: "base" })
    );
    const dialogRows = dialogItems.map((x) => x.row);
    const pinnedDialogRows = [...pinnedDmRows, ...pinnedChatRows];

    mountDesktop([
      ...(chatFiltersRow ? [chatFiltersRow] : []),
      ...(pinnedDialogRows.length ? [el("div", { class: "pane-section" }, ["Закреплённые"]), ...pinnedDialogRows] : []),
      el("div", { class: "pane-section" }, [hasSidebarQuery ? "Результаты" : "Чаты"]),
      ...(dialogRows.length ? dialogRows : [el("div", { class: "pane-section" }, [hasSidebarQuery ? "(ничего не найдено)" : "(пока нет чатов)"])]),
    ]);
    return;
  }

  if (activeDesktopTab === "boards") {
    const restBoards = boards.filter((b) => !pinnedSet.has(roomKey(b.id)));
    const boardItems: Array<{ sortTs: number; row: HTMLElement }> = [];
    for (const b of restBoards) {
      if (!matchesRoom(b)) continue;
      const k = roomKey(b.id);
      const meta = previewForConversation(state, k, "room", drafts[k]);
      const unread = computeRoomUnread(k);
      boardItems.push({
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
      });
    }
    boardItems.sort((a, b) => b.sortTs - a.sortTs);
    const boardRows = boardItems.map((x) => x.row);

    mountDesktop([
      ...(pinnedBoardRows.length ? [el("div", { class: "pane-section" }, ["Закреплённые"]), ...pinnedBoardRows] : []),
      el("div", { class: "pane-section" }, [hasSidebarQuery ? "Результаты" : "Доски"]),
      ...(boardRows.length ? boardRows : [el("div", { class: "pane-section" }, [hasSidebarQuery ? "(ничего не найдено)" : "(пока нет досок)"])]),
    ]);
    return;
  }

  // Contacts tab.
  const contactRowsSorted = markCompactAvatarRows(
    (state.friends || [])
      .filter((f) => matchesFriend(f))
      .sort(compareFriendsByActivity)
      .map((f) => {
        const k = dmKey(f.id);
        const meta = previewForConversation(state, k, "dm", drafts[k]);
        return friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === f.id), meta, onSelect, onOpenUser, attnSet.has(f.id));
      })
  );

  if (hasSidebarQuery) {
    const allRows = markCompactAvatarRows([...unknownAttnRows, ...contactRowsSorted]);
    mountDesktop([
      ...(allRows.length
        ? [el("div", { class: "pane-section" }, [`Результаты (${allRows.length})`]), ...allRows]
        : [el("div", { class: "pane-section" }, ["(ничего не найдено)"])]),
    ]);
    return;
  }

  const compactUnknownAttnRows = markCompactAvatarRows(unknownAttnRows);
  const contactRows: HTMLElement[] = [];
  if (compactUnknownAttnRows.length) {
    contactRows.push(el("div", { class: "pane-section" }, ["Внимание"]), ...compactUnknownAttnRows);
  }
  if (contactRowsSorted.length) {
    contactRows.push(...contactRowsSorted);
  }
  mountDesktop(contactRows);
}
