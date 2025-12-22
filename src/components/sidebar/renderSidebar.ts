import { el } from "../../helpers/dom/el";
import { avatarHue, avatarMonogram, getStoredAvatar } from "../../helpers/avatar/avatarStore";
import { dmKey, roomKey } from "../../helpers/chat/conversationKey";
import { formatTime } from "../../helpers/time";
import type { ActionModalPayload, AppState, FriendEntry, MobileSidebarTab, PageKind, TargetRef } from "../../stores/types";

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
  onOpenUser: (id: string) => void
): HTMLElement {
  const cls = selected ? "row row-sel" : "row";
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
  btn.addEventListener("click", (e) => {
    const ev = e as MouseEvent;
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
  const mainChildren: Array<string | HTMLElement> = [
    hasConversationMeta ? el("span", { class: "row-title row-label" }, [label]) : el("span", { class: "row-label" }, [label]),
  ];
  if (hasConversationMeta && meta?.sub) {
    mainChildren.push(el("span", { class: meta.hasDraft ? "row-sub row-sub-draft" : "row-sub" }, [meta.sub]));
  }
  const btn = el("button", { class: cls, type: "button" }, [
    ...(prefix ? [el("span", { class: "row-prefix", "aria-hidden": "true" }, [prefix])] : []),
    ...(ctx ? [avatar(ctx.kind, ctx.id)] : []),
    ...(hasConversationMeta ? [el("span", { class: "row-main" }, mainChildren)] : mainChildren),
    ...(tail ? [tail] : []),
  ]);
  if (ctx) {
    btn.setAttribute("data-ctx-kind", ctx.kind);
    btn.setAttribute("data-ctx-id", ctx.id);
  }
  btn.addEventListener("click", (e) => {
    const ev = e as MouseEvent;
    if (ev.ctrlKey) return;
    if (typeof ev.button === "number" && ev.button !== 0) return;
    onClick();
  });
  return btn;
}

function pendingRow(prefix: string, label: string, onClick: () => void, ctx?: { kind: "auth_in" | "auth_out"; id: string }): HTMLElement {
  const cls = ctx?.kind === "auth_in" ? "row row-attn" : "row";
  const btn = el("button", { class: cls, type: "button" }, [
    el("span", { class: "row-prefix", "aria-hidden": "true" }, [prefix]),
    el("span", { class: "row-label" }, [label]),
  ]);
  if (ctx) {
    btn.setAttribute("data-ctx-kind", ctx.kind);
    btn.setAttribute("data-ctx-id", ctx.id);
  }
  btn.addEventListener("click", (e) => {
    const ev = e as MouseEvent;
    if (ev.ctrlKey) return;
    if (typeof ev.button === "number" && ev.button !== 0) return;
    onClick();
  });
  return btn;
}

function roomLabel(name: string | null | undefined, id: string, handle?: string | null): string {
  const base = name ? `${name} (${id})` : id;
  if (handle) return `${base} ${handle}`;
  return base;
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
  onSetMobileSidebarTab: (tab: MobileSidebarTab) => void
) {
  const isMobile =
    typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(max-width: 820px)").matches : false;

  const drafts = state.drafts || {};
  const pinnedKeys = state.pinned || [];
  const pinnedSet = new Set(pinnedKeys);
  const online = state.friends.filter((f) => f.online);
  const offline = state.friends.filter((f) => !f.online);
  const pendingCount =
    state.pendingIn.length +
    state.pendingOut.length +
    state.pendingGroupInvites.length +
    state.pendingGroupJoinRequests.length +
    state.pendingBoardInvites.length +
    state.fileOffersIn.length;
  const boards = state.boards || [];
  const groups = state.groups || [];
  const sel = state.selected;

  if (isMobile) {
    const activeTab: MobileSidebarTab = state.mobileSidebarTab === "contacts" ? "contacts" : "chats";
    const topTitle = activeTab === "contacts" ? "Контакты" : "Чаты";

    const top = el("div", { class: "sidebar-mobile-top" }, [
      el(
        "button",
        { class: "btn sidebar-close", type: "button", "data-action": "sidebar-close", title: "Назад", "aria-label": "Назад" },
        ["←"]
      ),
      el("div", { class: "sidebar-mobile-title" }, [topTitle]),
    ]);

    const tabChats = el(
      "button",
      {
        class: activeTab === "chats" ? "sidebar-tab sidebar-tab-active" : "sidebar-tab",
        type: "button",
        role: "tab",
        "aria-selected": String(activeTab === "chats"),
      },
      ["Чаты"]
    ) as HTMLButtonElement;
    const tabContacts = el(
      "button",
      {
        class: activeTab === "contacts" ? "sidebar-tab sidebar-tab-active" : "sidebar-tab",
        type: "button",
        role: "tab",
        "aria-selected": String(activeTab === "contacts"),
      },
      ["Контакты"]
    ) as HTMLButtonElement;
    tabChats.addEventListener("click", () => onSetMobileSidebarTab("chats"));
    tabContacts.addEventListener("click", () => onSetMobileSidebarTab("contacts"));
    const tabs = el("div", { class: "sidebar-tabs", role: "tablist", "aria-label": "Раздел" }, [tabChats, tabContacts]);

    const pinnedRows: HTMLElement[] = [];
    for (const key of pinnedKeys) {
      if (key.startsWith("dm:")) {
        const id = key.slice(3);
        const f = state.friends.find((x) => x.id === id);
        if (!f) continue;
        const k = dmKey(f.id);
        const meta = previewForConversation(state, k, "dm", drafts[k]);
        pinnedRows.push(friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === f.id), meta, onSelect, onOpenUser));
        continue;
      }
      if (key.startsWith("room:")) {
        const id = key.slice(5);
        const g = groups.find((x) => x.id === id);
        if (g) {
          const k = roomKey(g.id);
          const meta = previewForConversation(state, k, "room", drafts[k]);
          pinnedRows.push(
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
          const k = roomKey(b.id);
          const meta = previewForConversation(state, k, "room", drafts[k]);
          pinnedRows.push(
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

    const pendingCount =
      state.pendingIn.length +
      state.pendingOut.length +
      state.pendingGroupInvites.length +
      state.pendingGroupJoinRequests.length +
      state.pendingBoardInvites.length +
      state.fileOffersIn.length;

    const restBoards = boards.filter((b) => !pinnedSet.has(roomKey(b.id)));
    const restGroups = groups.filter((g) => !pinnedSet.has(roomKey(g.id)));

    const lastTsForKey = (key: string): number => {
      const conv = state.conversations[key] || [];
      const last = conv.length ? conv[conv.length - 1] : null;
      const ts = last && typeof last.ts === "number" && Number.isFinite(last.ts) ? last.ts : 0;
      return Math.max(0, ts);
    };

    if (activeTab === "chats") {
      const dialogItems: Array<{ sortTs: number; row: HTMLElement }> = [];
      for (const g of restGroups) {
        const k = roomKey(g.id);
        const meta = previewForConversation(state, k, "room", drafts[k]);
        dialogItems.push({
          sortTs: lastTsForKey(k),
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
      for (const b of restBoards) {
        const k = roomKey(b.id);
        const meta = previewForConversation(state, k, "room", drafts[k]);
        dialogItems.push({
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

      for (const f of state.friends) {
        const k = dmKey(f.id);
        if (pinnedSet.has(k)) continue;
        const hasConv = Boolean((state.conversations[k] || []).length);
        const hasDraft = Boolean(String(drafts[k] || "").trim());
        const unread = Math.max(0, Number(f.unread || 0) || 0);
        if (!hasConv && !hasDraft && unread <= 0) continue; // "Чаты" — только начатые диалоги
        const meta = previewForConversation(state, k, "dm", drafts[k]);
        dialogItems.push({
          sortTs: lastTsForKey(k),
          row: friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === f.id), meta, onSelect, onOpenUser),
        });
      }

      dialogItems.sort((a, b) => b.sortTs - a.sortTs);
      const dialogRows = dialogItems.map((x) => x.row);

      target.replaceChildren(
        top,
        tabs,
        ...(pinnedRows.length ? [el("div", { class: "pane-section" }, ["Закреплённые"]), ...pinnedRows] : []),
        el("div", { class: "pane-section" }, ["Диалоги"]),
        ...(dialogRows.length ? dialogRows : [el("div", { class: "pane-section" }, ["(пока нет чатов)"])])
      );
      return;
    }

    // Contacts tab (Telegram-like): адресная книга + навигация.
    const actionRows: HTMLElement[] = [
      roomRow("⌕", "Поиск", state.page === "search", () => onSetPage("search")),
      roomRow("☺", "Профиль", state.page === "profile", () => onSetPage("profile")),
      roomRow("▦", "Файлы", state.page === "files", () => onSetPage("files")),
      roomRow("?", "Info", state.page === "help", () => onSetPage("help")),
      roomRow("+", "Создать чат", state.page === "group_create", () => onCreateGroup()),
      roomRow("+", "Создать доску", state.page === "board_create", () => onCreateBoard()),
    ];

    const onlineRows = online.map((f) => {
      const k = dmKey(f.id);
      const meta = previewForConversation(state, k, "dm", drafts[k]);
      return friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === f.id), meta, onSelect, onOpenUser);
    });
    const offlineRows = offline.map((f) => {
      const k = dmKey(f.id);
      const meta = previewForConversation(state, k, "dm", drafts[k]);
      return friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === f.id), meta, onSelect, onOpenUser);
    });

    target.replaceChildren(
      top,
      tabs,
      el("div", { class: "pane-section" }, ["Меню"]),
      ...actionRows,
      el("div", { class: "pane-section" }, [`Онлайн (${onlineRows.length})`]),
      ...(onlineRows.length ? onlineRows : [el("div", { class: "pane-section" }, ["(нет)"])]),
      el("div", { class: "pane-section" }, [`Оффлайн (${offlineRows.length})`]),
      ...(offlineRows.length ? offlineRows : [el("div", { class: "pane-section" }, ["(нет)"])]),
      el("div", { class: "pane-section" }, [`Ожидают (${pendingCount})`]),
      ...(pendingCount
        ? [
            ...state.pendingIn.map((id) =>
              pendingRow("IN", `Запрос: ${id}`, () => onOpenAction({ kind: "auth_in", peer: id }), { kind: "auth_in", id })
            ),
            ...state.pendingOut.map((id) =>
              pendingRow("OUT", `Ожидает: ${id}`, () => onOpenAction({ kind: "auth_out", peer: id }), { kind: "auth_out", id })
            ),
            ...state.pendingGroupInvites.map((inv) =>
              pendingRow("G+", `Инвайт: ${roomLabel(inv.name, inv.groupId, inv.handle)}`, () => onOpenAction(inv))
            ),
            ...state.pendingGroupJoinRequests.map((req) =>
              pendingRow("G?", `Запрос: ${req.from} → ${roomLabel(req.name, req.groupId, req.handle)}`, () => onOpenAction(req))
            ),
            ...state.pendingBoardInvites.map((inv) =>
              pendingRow("B+", `Инвайт: ${roomLabel(inv.name, inv.boardId, inv.handle)}`, () => onOpenAction(inv))
            ),
            ...state.fileOffersIn.map((offer) =>
              pendingRow(
                "F+",
                `Файл: ${offer.name || "файл"} ← ${offer.from}${offer.room ? ` → ${offer.room}` : ""}`,
                () =>
                  onOpenAction({
                    kind: "file_offer",
                    fileId: offer.id,
                    from: offer.from,
                    name: offer.name,
                    size: offer.size,
                    room: offer.room,
                  })
              )
            ),
          ]
        : [el("div", { class: "pane-section" }, ["(нет)"])])
    );
    return;
  }

  const pinnedRows: HTMLElement[] = [];
  for (const key of pinnedKeys) {
    if (key.startsWith("dm:")) {
      const id = key.slice(3);
      const f = state.friends.find((x) => x.id === id);
      if (!f) continue;
      const k = dmKey(f.id);
      const meta = previewForConversation(state, k, "dm", drafts[k]);
      pinnedRows.push(friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === f.id), meta, onSelect, onOpenUser));
      continue;
    }
    if (key.startsWith("room:")) {
      const id = key.slice(5);
      const g = groups.find((x) => x.id === id);
      if (g) {
        const k = roomKey(g.id);
        const meta = previewForConversation(state, k, "room", drafts[k]);
        pinnedRows.push(
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
        const k = roomKey(b.id);
        const meta = previewForConversation(state, k, "room", drafts[k]);
        pinnedRows.push(
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

  const boardsRest = boards.filter((b) => !pinnedSet.has(roomKey(b.id)));
  const groupsRest = groups.filter((g) => !pinnedSet.has(roomKey(g.id)));
  const onlineRest = online.filter((f) => !pinnedSet.has(dmKey(f.id)));
  const offlineRest = offline.filter((f) => !pinnedSet.has(dmKey(f.id)));

  target.replaceChildren(
    el("div", { class: "sidebar-mobile-top" }, [
      el(
        "button",
        { class: "btn sidebar-close", type: "button", "data-action": "sidebar-close", title: "Назад", "aria-label": "Назад" },
        ["←"]
      ),
      el("div", { class: "sidebar-mobile-title" }, ["Меню"]),
    ]),
    el("div", { class: "pane-title" }, ["Контакты"]),
    roomRow("?", "Info", state.page === "help", () => onSetPage("help")),
    roomRow("+", "Создать чат", state.page === "group_create", () => onCreateGroup()),
    roomRow("+", "Создать доску", state.page === "board_create", () => onCreateBoard()),
    ...(pinnedRows.length ? [el("div", { class: "pane-section" }, ["Закреплённые"]), ...pinnedRows] : []),
    el("div", { class: "pane-section" }, [`Доски (${boardsRest.length})`]),
    ...(boardsRest.length
      ? boardsRest.map((b) =>
          (() => {
            const k = roomKey(b.id);
            const meta = previewForConversation(state, k, "room", drafts[k]);
            return roomRow(
              null,
              String(b.name || b.id),
              Boolean(sel && sel.kind === "board" && sel.id === b.id),
              () => onSelect({ kind: "board", id: b.id }),
              { kind: "board", id: b.id },
              meta
            );
          })()
        )
      : [el("div", { class: "pane-section" }, ["(нет)"])]),
    el("div", { class: "pane-section" }, [`Чаты (${groupsRest.length})`]),
    ...(groupsRest.length
      ? groupsRest.map((g) =>
          (() => {
            const k = roomKey(g.id);
            const meta = previewForConversation(state, k, "room", drafts[k]);
            return roomRow(
              null,
              String(g.name || g.id),
              Boolean(sel && sel.kind === "group" && sel.id === g.id),
              () => onSelect({ kind: "group", id: g.id }),
              { kind: "group", id: g.id },
              meta
            );
          })()
        )
      : [el("div", { class: "pane-section" }, ["(нет)"])]),
    el("div", { class: "pane-section" }, [`Онлайн (${onlineRest.length})`]),
    ...onlineRest.map((f) => {
      const k = dmKey(f.id);
      const meta = previewForConversation(state, k, "dm", drafts[k]);
      return friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === f.id), meta, onSelect, onOpenUser);
    }),
    el("div", { class: "pane-section" }, [`Оффлайн (${offlineRest.length})`]),
    ...offlineRest.map((f) => {
      const k = dmKey(f.id);
      const meta = previewForConversation(state, k, "dm", drafts[k]);
      return friendRow(state, f, Boolean(sel && sel.kind === "dm" && sel.id === f.id), meta, onSelect, onOpenUser);
    }),
    el("div", { class: "pane-section" }, [`Ожидают (${pendingCount})`]),
    ...(pendingCount
      ? [
          ...state.pendingIn.map((id) =>
            pendingRow("IN", `Запрос: ${id}`, () => onOpenAction({ kind: "auth_in", peer: id }), { kind: "auth_in", id })
          ),
          ...state.pendingOut.map((id) =>
            pendingRow("OUT", `Ожидает: ${id}`, () => onOpenAction({ kind: "auth_out", peer: id }), { kind: "auth_out", id })
          ),
          ...state.pendingGroupInvites.map((inv) =>
            pendingRow("G+", `Инвайт: ${roomLabel(inv.name, inv.groupId, inv.handle)}`, () => onOpenAction(inv))
          ),
          ...state.pendingGroupJoinRequests.map((req) =>
            pendingRow("G?", `Запрос: ${req.from} → ${roomLabel(req.name, req.groupId, req.handle)}`, () => onOpenAction(req))
          ),
          ...state.pendingBoardInvites.map((inv) =>
            pendingRow("B+", `Инвайт: ${roomLabel(inv.name, inv.boardId, inv.handle)}`, () => onOpenAction(inv))
          ),
          ...state.fileOffersIn.map((offer) =>
            pendingRow(
              "F+",
              `Файл: ${offer.name || "файл"} ← ${offer.from}${offer.room ? ` → ${offer.room}` : ""}`,
              () =>
                onOpenAction({
                  kind: "file_offer",
                  fileId: offer.id,
                  from: offer.from,
                  name: offer.name,
                  size: offer.size,
                  room: offer.room,
                })
            )
          ),
        ]
      : [el("div", { class: "pane-section" }, ["(нет)"])])
  );
}
