import { el } from "../../helpers/dom/el";
import { avatarHue, avatarMonogram, getStoredAvatar } from "../../helpers/avatar/avatarStore";
import { dmKey, roomKey } from "../../helpers/chat/conversationKey";
import { formatTime } from "../../helpers/time";
import { focusElement } from "../../helpers/ui/focus";
import { isIOS, isStandaloneDisplayMode } from "../../helpers/ui/iosInputAssistant";
import { isMobileLikeUi } from "../../helpers/ui/mobileLike";
import type { ActionModalPayload, AppState, FriendEntry, MobileSidebarTab, PageKind, TargetRef } from "../../stores/types";

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
  return { sub, time, hasDraft: Boolean(draft) };
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
  const clsBase = selected ? "row row-sel" : "row";
  const cls = attn ? `${clsBase} row-attn` : clsBase;
  const unread = Math.max(0, Number(f.unread || 0) || 0);
  const unreadLabel = unread > 99 ? "99+" : String(unread);
  const tailChildren: HTMLElement[] = [];
  if (meta.time) tailChildren.push(el("span", { class: "row-time", "aria-label": `Время: ${meta.time}` }, [meta.time]));
  if (meta.hasDraft) tailChildren.push(el("span", { class: "row-draft", "aria-label": "Есть черновик" }, ["черновик"]));
  if (unread > 0) {
    tailChildren.push(el("span", { class: "row-unread", "aria-label": `Непрочитано: ${unread}` }, [unreadLabel]));
  }
  const tail = tailChildren.length ? el("span", { class: "row-tail", "aria-hidden": tailChildren.length ? "false" : "true" }, tailChildren) : null;
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
  meta?: SidebarRowMeta
): HTMLElement {
  const cls = selected ? "row row-sel" : "row";
  const tailChildren: HTMLElement[] = [];
  if (meta?.time) tailChildren.push(el("span", { class: "row-time", "aria-label": `Время: ${meta.time}` }, [meta.time]));
  if (meta?.hasDraft) tailChildren.push(el("span", { class: "row-draft", "aria-label": "Есть черновик" }, ["черновик"]));
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
  onSetSidebarQuery: (query: string) => void,
  onAuthOpen: () => void,
  onAuthLogout: () => void,
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

  const drafts = state.drafts || {};
  const pinnedKeys = state.pinned || [];
  const pinnedSet = new Set(pinnedKeys);
  const attnSet = collectAttentionPeers(state);
  const friendIdSet = new Set((state.friends || []).map((f) => String(f.id || "").trim()).filter(Boolean));
  const unknownAttnPeers = Array.from(attnSet).filter((id) => !friendIdSet.has(id)).sort();
  const online = state.friends.filter((f) => f.online);
  const offline = state.friends.filter((f) => !f.online);
  const boards = state.boards || [];
  const groups = state.groups || [];
  const sel = state.selected;
  const sidebarQueryRaw = compactOneLine(String((state as any).sidebarQuery || ""));
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
  toggleClass(body, "sidebar-mobile-body", isMobile);
  if (sidebarDock) {
    toggleClass(sidebarDock, "hidden", isMobile);
    if (isMobile) sidebarDock.replaceChildren();
  }
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

  if (isMobile) {
    const rawTab = state.mobileSidebarTab;
    const activeTab: MobileSidebarTab =
      rawTab === "contacts" || rawTab === "menu" || rawTab === "boards" ? rawTab : "chats";
    type SidebarScrollAnchor = { kind: string; id: string; offset: number };
    type SidebarScrollSnapshot = { scrollTop: number; anchor: SidebarScrollAnchor | null };
    const scrollMemory: Record<string, SidebarScrollSnapshot | undefined> = ((target as any)._mobileSidebarScrollMemory ||= {});
    const prevTab = String((target as any)._mobileSidebarPrevTab || "").trim();
    const isSameTab = Boolean(prevTab && prevTab === activeTab);
    if (prevTab && prevTab !== activeTab) {
      try {
        const hostRect = body.getBoundingClientRect();
        const rows = Array.from(body.querySelectorAll<HTMLElement>('.row[data-ctx-kind][data-ctx-id]'));
        const anchorRow = rows.find((row) => {
          const r = row.getBoundingClientRect();
          return r.bottom > hostRect.top + 1;
        });
        const anchorKind = anchorRow?.getAttribute("data-ctx-kind") || "";
        const anchorId = anchorRow?.getAttribute("data-ctx-id") || "";
        const anchor =
          anchorRow && anchorKind && anchorId
            ? ({ kind: anchorKind, id: anchorId, offset: anchorRow.getBoundingClientRect().top - hostRect.top } satisfies SidebarScrollAnchor)
            : null;
        scrollMemory[prevTab] = { scrollTop: body.scrollTop || 0, anchor };
      } catch {
        scrollMemory[prevTab] = { scrollTop: body.scrollTop || 0, anchor: null };
      }
    }
    if ("dataset" in target) (target as HTMLElement).dataset.sidebarTab = activeTab;
    const topTitle =
      activeTab === "contacts" ? "Контакты" : activeTab === "boards" ? "Доски" : activeTab === "menu" ? "Меню" : "Чаты";

    const canCloseSidebar = Boolean(state.page === "main" && state.selected);
    const top = el("div", { class: "sidebar-mobile-top" }, [
      canCloseSidebar
        ? el(
            "button",
            { class: "btn sidebar-close", type: "button", "data-action": "sidebar-close", title: "Назад", "aria-label": "Назад" },
            ["←"]
          )
        : el("div", { class: "sidebar-close sidebar-close-spacer", "aria-hidden": "true" }, [""]),
      el("div", { class: "sidebar-mobile-title" }, [topTitle]),
    ]);

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
    const tabs = el("div", { class: "sidebar-tabs sidebar-tabs-bottom", role: "tablist", "aria-label": "Раздел" }, [
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

    const sticky = el("div", { class: "sidebar-mobile-sticky" }, [top, ...(searchBar ? [searchBar] : [])]);
    const bottom = el("div", { class: "sidebar-mobile-bottom" }, [tabs]);
    const takeScrollSnapshot = (): SidebarScrollSnapshot => {
      const scrollTop = body.scrollTop || 0;
      try {
        const hostRect = body.getBoundingClientRect();
        const rows = Array.from(body.querySelectorAll<HTMLElement>('.row[data-ctx-kind][data-ctx-id]'));
        const anchorRow = rows.find((row) => {
          const r = row.getBoundingClientRect();
          return r.bottom > hostRect.top + 1;
        });
        const anchorKind = anchorRow?.getAttribute("data-ctx-kind") || "";
        const anchorId = anchorRow?.getAttribute("data-ctx-id") || "";
        const anchor =
          anchorRow && anchorKind && anchorId
            ? ({ kind: anchorKind, id: anchorId, offset: anchorRow.getBoundingClientRect().top - hostRect.top } satisfies SidebarScrollAnchor)
            : null;
        return { scrollTop, anchor };
      } catch {
        return { scrollTop, anchor: null };
      }
    };
    const restoreScrollSnapshot = (snap: SidebarScrollSnapshot): void => {
      try {
        if (!snap.anchor) {
          body.scrollTop = snap.scrollTop || 0;
          return;
        }
        const selector = `.row[data-ctx-kind="${snap.anchor.kind}"][data-ctx-id="${snap.anchor.id}"]`;
        const row = body.querySelector(selector) as HTMLElement | null;
        if (!row) {
          body.scrollTop = snap.scrollTop || 0;
          return;
        }
        const next = Math.max(0, Math.round(row.offsetTop - snap.anchor.offset));
        body.scrollTop = next;
      } catch {
        body.scrollTop = snap.scrollTop || 0;
      }
    };
    const initialSnap = isSameTab ? takeScrollSnapshot() : scrollMemory[activeTab] || { scrollTop: 0, anchor: null };
    const mountMobile = (children: HTMLElement[]) => {
      const snap = isSameTab ? takeScrollSnapshot() : initialSnap;
      body.replaceChildren(...children);
      target.replaceChildren(sticky, body, bottom);
      bindHeaderScroll(sticky);
      restoreScrollSnapshot(snap);
      try {
        window.requestAnimationFrame(() => restoreScrollSnapshot(snap));
      } catch {
        // ignore
      }
      (target as any)._mobileSidebarPrevTab = activeTab;
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
        const meta = previewForConversation(state, k, "dm", drafts[k]);
        const row = friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === f.id), meta, onSelect, onOpenUser, attnSet.has(f.id));
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
          pinnedChatRows.push(
            roomRow(
              null,
              String(g.name || g.id),
              Boolean(sel && sel.kind === "group" && sel.id === g.id),
              () => onSelect({ kind: "group", id: g.id }),
              { kind: "group", id: g.id },
              meta
            )
          );
          continue;
        }
        const b = boards.find((x) => x.id === id);
        if (b) {
          if (!matchesRoom(b)) continue;
          const k = roomKey(b.id);
          const meta = previewForConversation(state, k, "room", drafts[k]);
          pinnedBoardRows.push(
            roomRow(
              null,
              String(b.name || b.id),
              Boolean(sel && sel.kind === "board" && sel.id === b.id),
              () => onSelect({ kind: "board", id: b.id }),
              { kind: "board", id: b.id },
              meta
            )
          );
        }
      }
    }

    const restBoards = boards.filter((b) => !pinnedSet.has(roomKey(b.id)));
    const restGroups = groups.filter((g) => !pinnedSet.has(roomKey(g.id)));

    const lastTsForKey = (key: string): number => {
      const conv = state.conversations[key] || [];
      const last = conv.length ? conv[conv.length - 1] : null;
      const ts = last && typeof last.ts === "number" && Number.isFinite(last.ts) ? last.ts : 0;
      return Math.max(0, ts);
    };

    if (activeTab === "chats") {
      const dialogItems: Array<{ sortTs: number; label: string; row: HTMLElement }> = [];

      // Активные диалоги (ЛС): показываем только тех, у кого есть история/черновик/unread/attention.
      for (const f of state.friends || []) {
        const id = String(f?.id || "").trim();
        if (!id) continue;
        const k = dmKey(id);
        if (pinnedSet.has(k)) continue;
        if (!hasActiveDialogForFriend(f)) continue;
        if (!matchesFriend(f)) continue;
        const meta = previewForConversation(state, k, "dm", drafts[k]);
        dialogItems.push({
          sortTs: lastTsForKey(k),
          label: displayNameForFriend(state, f),
          row: friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === id), meta, onSelect, onOpenUser, attnSet.has(id)),
        });
      }

      for (const g of restGroups) {
        if (!matchesRoom(g)) continue;
        const k = roomKey(g.id);
        const meta = previewForConversation(state, k, "room", drafts[k]);
        dialogItems.push({
          sortTs: lastTsForKey(k),
          label: String(g.name || g.id),
          row: roomRow(
            null,
            String(g.name || g.id),
            Boolean(sel && sel.kind === "group" && sel.id === g.id),
            () => onSelect({ kind: "group", id: g.id }),
            { kind: "group", id: g.id },
            meta
          ),
        });
      }

      dialogItems.sort((a, b) => b.sortTs - a.sortTs || a.label.localeCompare(b.label, "ru", { sensitivity: "base" }));
      const dialogRows = dialogItems.map((x) => x.row);
      const pinnedDialogRows = [...pinnedContactRows, ...pinnedChatRows];

      mountMobile([
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
        boardItems.push({
          sortTs: lastTsForKey(k),
          row: roomRow(
            null,
            String(b.name || b.id),
            Boolean(sel && sel.kind === "board" && sel.id === b.id),
            () => onSelect({ kind: "board", id: b.id }),
            { kind: "board", id: b.id },
            meta
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

    const onlineRows = markCompactAvatarRows(
      online.map((f) => {
        const k = dmKey(f.id);
        if (pinnedSet.has(k)) return null;
        const meta = previewForConversation(state, k, "dm", drafts[k]);
        return friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === f.id), meta, onSelect, onOpenUser, attnSet.has(f.id));
      })
    );
    const offlineRows = markCompactAvatarRows(
      offline.map((f) => {
        const k = dmKey(f.id);
        if (pinnedSet.has(k)) return null;
        const meta = previewForConversation(state, k, "dm", drafts[k]);
        return friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === f.id), meta, onSelect, onOpenUser, attnSet.has(f.id));
      })
    );

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
      if (hasSidebarQuery) {
        const allFriends = (state.friends || []).filter((f) => matchesFriend(f) && !pinnedSet.has(dmKey(f.id)));
        allFriends.sort((a, b) => {
          if (Boolean(a.online) !== Boolean(b.online)) return a.online ? -1 : 1;
          const an = displayNameForFriend(state, a);
          const bn = displayNameForFriend(state, b);
          return an.localeCompare(bn, "ru", { sensitivity: "base" });
        });
        const rows = allFriends.map((f) => {
          const k = dmKey(f.id);
          const meta = previewForConversation(state, k, "dm", drafts[k]);
          return friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === f.id), meta, onSelect, onOpenUser, attnSet.has(f.id));
        });
        const allRows = markCompactAvatarRows([...unknownAttnRows, ...rows]);
        mountMobile([
          ...(pinnedContactRowsCompact.length ? [el("div", { class: "pane-section" }, ["Закреплённые"]), ...pinnedContactRowsCompact] : []),
          ...(allRows.length
            ? [el("div", { class: "pane-section" }, [`Результаты (${allRows.length})`]), ...allRows]
            : [el("div", { class: "pane-section" }, ["(ничего не найдено)"])])
        ]);
        return;
      }
      const compactUnknownAttnRows = markCompactAvatarRows(unknownAttnRows);
      mountMobile([
        ...(pinnedContactRowsCompact.length ? [el("div", { class: "pane-section" }, ["Закреплённые"]), ...pinnedContactRowsCompact] : []),
        ...(compactUnknownAttnRows.length ? [el("div", { class: "pane-section" }, ["Внимание"]), ...compactUnknownAttnRows] : []),
        el("div", { class: "pane-section" }, [`Онлайн (${onlineRows.length})`]),
        ...(onlineRows.length ? onlineRows : [el("div", { class: "pane-section" }, ["(нет)"])]),
        el("div", { class: "pane-section" }, [`Оффлайн (${offlineRows.length})`]),
        ...(offlineRows.length ? offlineRows : [el("div", { class: "pane-section" }, ["(нет)"])])
      ]);
      return;
    }

    // Menu tab: действия и навигация.
    const searchRow = roomRow("⌕", "Поиск", state.page === "search", () => onSetPage("search"), undefined, {
      sub: "Найти по ID или @handle",
      time: null,
      hasDraft: false,
    });
    searchRow.setAttribute("title", "Поиск пользователей по ID или @handle");
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
    const navRows: HTMLElement[] = [searchRow, profileRow, filesRow];

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
        el("div", { class: "sidebar-tip" }, ["Новые контакты удобнее добавлять через «Поиск»."]),
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
    const showMenuTab = mobileUi;
    const defaultTab: MobileSidebarTab = unknownAttnPeers.length ? "contacts" : "chats";
    let activeTab: MobileSidebarTab =
      rawTab === "contacts" || rawTab === "boards" || (showMenuTab && rawTab === "menu") ? rawTab : defaultTab;
    if (!showMenuTab && activeTab === "menu") activeTab = defaultTab;

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
        class: showMenuTab ? "sidebar-tabs sidebar-tabs-desktop sidebar-tabs-pwa" : "sidebar-tabs sidebar-tabs-desktop",
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

    const useDock = Boolean(sidebarDock);
    if (useDock && sidebarDock) sidebarDock.replaceChildren(tabs);
    const desktopBottom = useDock ? null : el("div", { class: "sidebar-desktop-bottom" }, [tabs]);

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
    const header = searchBar ? el("div", { class: "sidebar-header" }, [searchBar]) : null;

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
        const meta = previewForConversation(state, k, "dm", drafts[k]);
        pinnedContactRows.push(friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === f.id), meta, onSelect, onOpenUser, attnSet.has(f.id)));
        continue;
      }
      if (key.startsWith("room:")) {
        const id = key.slice(5);
        const g = groups.find((x) => x.id === id);
        if (g) {
          if (!matchesRoom(g)) continue;
          const k = roomKey(g.id);
          const meta = previewForConversation(state, k, "room", drafts[k]);
          pinnedChatRows.push(
            roomRow(
              null,
              String(g.name || g.id),
              Boolean(sel && sel.kind === "group" && sel.id === g.id),
              () => onSelect({ kind: "group", id: g.id }),
              { kind: "group", id: g.id },
              meta
            )
          );
          continue;
        }
        const b = boards.find((x) => x.id === id);
        if (b) {
          if (!matchesRoom(b)) continue;
          const k = roomKey(b.id);
          const meta = previewForConversation(state, k, "room", drafts[k]);
          pinnedBoardRows.push(
            roomRow(
              null,
              String(b.name || b.id),
              Boolean(sel && sel.kind === "board" && sel.id === b.id),
              () => onSelect({ kind: "board", id: b.id }),
              { kind: "board", id: b.id },
              meta
            )
          );
        }
      }
    }

    const lastTsForKey = (key: string): number => {
      const conv = state.conversations[key] || [];
      const last = conv.length ? conv[conv.length - 1] : null;
      const ts = last && typeof last.ts === "number" && Number.isFinite(last.ts) ? last.ts : 0;
      return Math.max(0, ts);
    };

    const mountPwa = (children: HTMLElement[]) => {
      body.replaceChildren(...children);
      const nodes: HTMLElement[] = [];
      if (header) nodes.push(header);
      nodes.push(body);
      if (useDock && sidebarDock) nodes.push(sidebarDock);
      else if (desktopBottom) nodes.push(desktopBottom);
      target.replaceChildren(...nodes);
      bindHeaderScroll(header);
    };

    if (activeTab === "chats") {
      const restGroups = groups.filter((g) => !pinnedSet.has(roomKey(g.id)));
      const dialogItems: Array<{ sortTs: number; label: string; row: HTMLElement }> = [];

      for (const f of state.friends || []) {
        const id = String(f?.id || "").trim();
        if (!id) continue;
        const k = dmKey(id);
        if (pinnedSet.has(k)) continue;
        if (!hasActiveDialogForFriend(f)) continue;
        if (!matchesFriend(f)) continue;
        const meta = previewForConversation(state, k, "dm", drafts[k]);
        dialogItems.push({
          sortTs: lastTsForKey(k),
          label: displayNameForFriend(state, f),
          row: friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === id), meta, onSelect, onOpenUser, attnSet.has(id)),
        });
      }

      for (const g of restGroups) {
        if (!matchesRoom(g)) continue;
        const k = roomKey(g.id);
        const meta = previewForConversation(state, k, "room", drafts[k]);
        dialogItems.push({
          sortTs: lastTsForKey(k),
          label: String(g.name || g.id),
          row: roomRow(
            null,
            String(g.name || g.id),
            Boolean(sel && sel.kind === "group" && sel.id === g.id),
            () => onSelect({ kind: "group", id: g.id }),
            { kind: "group", id: g.id },
            meta
          ),
        });
      }

      dialogItems.sort((a, b) => b.sortTs - a.sortTs || a.label.localeCompare(b.label, "ru", { sensitivity: "base" }));
      const dialogRows = dialogItems.map((x) => x.row);
      const pinnedDialogRows = [...pinnedContactRows, ...pinnedChatRows];

      mountPwa([
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
        boardItems.push({
          sortTs: lastTsForKey(k),
          row: roomRow(
            null,
            String(b.name || b.id),
            Boolean(sel && sel.kind === "board" && sel.id === b.id),
            () => onSelect({ kind: "board", id: b.id }),
            { kind: "board", id: b.id },
            meta
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
      const onlineAll = (state.friends || []).filter((f) => f.online).filter((f) => !pinnedSet.has(dmKey(f.id)));
      const offlineAll = (state.friends || []).filter((f) => !f.online).filter((f) => !pinnedSet.has(dmKey(f.id)));

      if (hasSidebarQuery) {
        const allFriends = (state.friends || []).filter((f) => matchesFriend(f) && !pinnedSet.has(dmKey(f.id)));
        allFriends.sort((a, b) => {
          if (Boolean(a.online) !== Boolean(b.online)) return a.online ? -1 : 1;
          const an = displayNameForFriend(state, a);
          const bn = displayNameForFriend(state, b);
          return an.localeCompare(bn, "ru", { sensitivity: "base" });
        });
        const rows = allFriends.map((f) => {
          const k = dmKey(f.id);
          const meta = previewForConversation(state, k, "dm", drafts[k]);
          return friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === f.id), meta, onSelect, onOpenUser, attnSet.has(f.id));
        });
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
        const allRows = markCompactAvatarRows([...unknownAttnRows, ...rows]);
        mountPwa([
          ...(pinnedContactRowsCompact.length ? [el("div", { class: "pane-section" }, ["Закреплённые"]), ...pinnedContactRowsCompact] : []),
          ...(allRows.length
            ? [el("div", { class: "pane-section" }, [`Результаты (${allRows.length})`]), ...allRows]
            : [el("div", { class: "pane-section" }, ["(ничего не найдено)"])]),
        ]);
        return;
      }

      const onlineRows = markCompactAvatarRows(
        onlineAll
        .filter((f) => matchesFriend(f))
        .map((f) => {
          const k = dmKey(f.id);
          const meta = previewForConversation(state, k, "dm", drafts[k]);
          return friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === f.id), meta, onSelect, onOpenUser, attnSet.has(f.id));
        })
      );
      const offlineRows = markCompactAvatarRows(
        offlineAll
        .filter((f) => matchesFriend(f))
        .map((f) => {
          const k = dmKey(f.id);
          const meta = previewForConversation(state, k, "dm", drafts[k]);
          return friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === f.id), meta, onSelect, onOpenUser, attnSet.has(f.id));
        })
      );
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

      mountPwa([
        ...(pinnedContactRowsCompact.length ? [el("div", { class: "pane-section" }, ["Закреплённые"]), ...pinnedContactRowsCompact] : []),
        ...(unknownAttnRows.length ? [el("div", { class: "pane-section" }, ["Внимание"]), ...unknownAttnRows] : []),
        el("div", { class: "pane-section" }, [`Онлайн (${onlineRows.length})`]),
        ...(onlineRows.length ? onlineRows : [el("div", { class: "pane-section" }, ["(нет)"])]),
        el("div", { class: "pane-section" }, [`Оффлайн (${offlineRows.length})`]),
        ...(offlineRows.length ? offlineRows : [el("div", { class: "pane-section" }, ["(нет)"])]),
      ]);
      return;
    }

    // Menu tab (PWA): actions/navigation.
    const searchRow = roomRow("⌕", "Поиск", state.page === "search", () => onSetPage("search"), undefined, {
      sub: "Найти по ID или @handle",
      time: null,
      hasDraft: false,
    });
    searchRow.setAttribute("title", "Поиск пользователей по ID или @handle");
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
    const navRows: HTMLElement[] = [searchRow, profileRow, filesRow];

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
    ]);
    return;
  }

  // Desktop (browser): separate tabs (Контакты/Доски/Чаты) like on mobile/PWA,
  // and remove the redundant sidebar "Меню" (desktop already has header/footer nav).
  type DesktopTab = "contacts" | "boards" | "chats";
  const defaultDesktopTab: DesktopTab = unknownAttnPeers.length ? "contacts" : "chats";
  const rawDesktopTab = state.mobileSidebarTab;
  const activeDesktopTab: DesktopTab =
    rawDesktopTab === "contacts" || rawDesktopTab === "boards" ? rawDesktopTab : defaultDesktopTab;

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

  desktopTabChats.addEventListener("click", () => onSetMobileSidebarTab("chats"));
  desktopTabContacts.addEventListener("click", () => onSetMobileSidebarTab("contacts"));
  desktopTabBoards.addEventListener("click", () => onSetMobileSidebarTab("boards"));

  const desktopTabs = el("div", { class: "sidebar-tabs sidebar-tabs-desktop", role: "tablist", "aria-label": "Раздел" }, [
    desktopTabContacts,
    desktopTabBoards,
    desktopTabChats,
  ]);
  const desktopTabsList = [desktopTabContacts, desktopTabBoards, desktopTabChats];
  desktopTabs.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const idx = desktopTabsList.findIndex((b) => b === document.activeElement);
    const next = idx < 0 ? 0 : (idx + dir + desktopTabsList.length) % desktopTabsList.length;
    e.preventDefault();
    desktopTabsList[next]?.focus();
  });

  const useDock = Boolean(sidebarDock && !isMobile);
  if (useDock && sidebarDock) sidebarDock.replaceChildren(desktopTabs);
  const desktopBottom = useDock ? null : el("div", { class: "sidebar-desktop-bottom" }, [desktopTabs]);

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
  const header = el("div", { class: "sidebar-header" }, [searchBar]);

  const lastTsForKey = (key: string): number => {
    const conv = state.conversations[key] || [];
    const last = conv.length ? conv[conv.length - 1] : null;
    const ts = last && typeof last.ts === "number" && Number.isFinite(last.ts) ? last.ts : 0;
    return Math.max(0, ts);
  };

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
      const meta = previewForConversation(state, k, "dm", drafts[k]);
      pinnedDmRows.push(friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === f.id), meta, onSelect, onOpenUser, attnSet.has(f.id)));
      continue;
    }
    if (!key.startsWith("room:")) continue;
    const id = key.slice(5);
    const g = groups.find((x) => x.id === id);
    if (g) {
      if (!matchesRoom(g)) continue;
      const k = roomKey(g.id);
      const meta = previewForConversation(state, k, "room", drafts[k]);
      pinnedChatRows.push(
        roomRow(
          null,
          String(g.name || g.id),
          Boolean(sel && sel.kind === "group" && sel.id === g.id),
          () => onSelect({ kind: "group", id: g.id }),
          { kind: "group", id: g.id },
          meta
        )
      );
      continue;
    }
    const b = boards.find((x) => x.id === id);
    if (!b) continue;
    if (!matchesRoom(b)) continue;
    const k = roomKey(b.id);
    const meta = previewForConversation(state, k, "room", drafts[k]);
    pinnedBoardRows.push(
      roomRow(
        null,
        String(b.name || b.id),
        Boolean(sel && sel.kind === "board" && sel.id === b.id),
        () => onSelect({ kind: "board", id: b.id }),
        { kind: "board", id: b.id },
        meta
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
  const scrollMemory: Record<string, number | undefined> = ((target as any)._desktopSidebarScrollMemory ||= {});
  if (didSwitchTab) scrollMemory[prevTab] = Number((body as any).scrollTop || 0) || 0;
  const desiredScrollTop = didSwitchTab ? Number(scrollMemory[activeDesktopTab] || 0) || 0 : Number((body as any).scrollTop || 0) || 0;

  const mountDesktop = (children: HTMLElement[]) => {
    body.replaceChildren(...children);
    const nodes: HTMLElement[] = [header, body];
    if (useDock && sidebarDock) nodes.push(sidebarDock);
    else if (desktopBottom) nodes.push(desktopBottom);
    target.replaceChildren(...nodes);
    bindHeaderScroll(header);
    (target as any)._desktopSidebarPrevTab = activeDesktopTab;

    if (!didSwitchTab) return;
    try {
      (body as any).scrollTop = desiredScrollTop;
    } catch {
      // ignore
    }
    try {
      window.requestAnimationFrame(() => {
        try {
          (body as any).scrollTop = desiredScrollTop;
        } catch {
          // ignore
        }
      });
    } catch {
      // ignore
    }
  };

  if (activeDesktopTab === "chats") {
    const restGroups = groups.filter((g) => !pinnedSet.has(roomKey(g.id)));
    const dialogItems: Array<{ sortTs: number; label: string; row: HTMLElement }> = [];

    for (const f of state.friends || []) {
      const id = String(f?.id || "").trim();
      if (!id) continue;
      const k = dmKey(id);
      if (pinnedSet.has(k)) continue;
      if (!hasActiveDialogForFriend(f)) continue;
      if (!matchesFriend(f)) continue;
      const meta = previewForConversation(state, k, "dm", drafts[k]);
      dialogItems.push({
        sortTs: lastTsForKey(k),
        label: displayNameForFriend(state, f),
        row: friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === id), meta, onSelect, onOpenUser, attnSet.has(id)),
      });
    }

    for (const g of restGroups) {
      if (!matchesRoom(g)) continue;
      const k = roomKey(g.id);
      const meta = previewForConversation(state, k, "room", drafts[k]);
      dialogItems.push({
        sortTs: lastTsForKey(k),
        label: String(g.name || g.id),
        row: roomRow(
          null,
          String(g.name || g.id),
          Boolean(sel && sel.kind === "group" && sel.id === g.id),
          () => onSelect({ kind: "group", id: g.id }),
          { kind: "group", id: g.id },
          meta
        ),
      });
    }

    dialogItems.sort((a, b) => b.sortTs - a.sortTs || a.label.localeCompare(b.label, "ru", { sensitivity: "base" }));
    const dialogRows = dialogItems.map((x) => x.row);
    const pinnedDialogRows = [...pinnedDmRows, ...pinnedChatRows];

    mountDesktop([
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
      boardItems.push({
        sortTs: lastTsForKey(k),
        row: roomRow(
          null,
          String(b.name || b.id),
          Boolean(sel && sel.kind === "board" && sel.id === b.id),
          () => onSelect({ kind: "board", id: b.id }),
          { kind: "board", id: b.id },
          meta
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
  const onlineSorted = [...online]
    .filter((f) => matchesFriend(f))
    .sort((a, b) => displayNameForFriend(state, a).localeCompare(displayNameForFriend(state, b), "ru", { sensitivity: "base" }));
  const offlineSorted = [...offline]
    .filter((f) => matchesFriend(f))
    .sort((a, b) => displayNameForFriend(state, a).localeCompare(displayNameForFriend(state, b), "ru", { sensitivity: "base" }));

  const onlineRows = markCompactAvatarRows(
    onlineSorted.map((f) => {
      const k = dmKey(f.id);
      if (pinnedSet.has(k)) return null;
      const meta = previewForConversation(state, k, "dm", drafts[k]);
      return friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === f.id), meta, onSelect, onOpenUser, attnSet.has(f.id));
    })
  );
  const offlineRows = markCompactAvatarRows(
    offlineSorted.map((f) => {
      const k = dmKey(f.id);
      if (pinnedSet.has(k)) return null;
      const meta = previewForConversation(state, k, "dm", drafts[k]);
      return friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === f.id), meta, onSelect, onOpenUser, attnSet.has(f.id));
    })
  );

  if (hasSidebarQuery) {
    const allFriends = (state.friends || []).filter((f) => matchesFriend(f) && !pinnedSet.has(dmKey(f.id)));
    allFriends.sort((a, b) => {
      if (Boolean(a.online) !== Boolean(b.online)) return a.online ? -1 : 1;
      return displayNameForFriend(state, a).localeCompare(displayNameForFriend(state, b), "ru", { sensitivity: "base" });
    });
    const rows = allFriends.map((f) => {
      const k = dmKey(f.id);
      const meta = previewForConversation(state, k, "dm", drafts[k]);
      return friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === f.id), meta, onSelect, onOpenUser, attnSet.has(f.id));
    });
    const allRows = markCompactAvatarRows([...unknownAttnRows, ...rows]);
    mountDesktop([
      ...(allRows.length
        ? [el("div", { class: "pane-section" }, [`Результаты (${allRows.length})`]), ...allRows]
        : [el("div", { class: "pane-section" }, ["(ничего не найдено)"])]),
    ]);
    return;
  }

  const compactUnknownAttnRows = markCompactAvatarRows(unknownAttnRows);
  mountDesktop([
    ...(compactUnknownAttnRows.length ? [el("div", { class: "pane-section" }, ["Внимание"]), ...compactUnknownAttnRows] : []),
    el("div", { class: "pane-section" }, [`Онлайн (${onlineRows.length})`]),
    ...(onlineRows.length ? onlineRows : [el("div", { class: "pane-section" }, ["(нет)"])]),
    el("div", { class: "pane-section" }, [`Оффлайн (${offlineRows.length})`]),
    ...(offlineRows.length ? offlineRows : [el("div", { class: "pane-section" }, ["(нет)"])]),
  ]);
}
