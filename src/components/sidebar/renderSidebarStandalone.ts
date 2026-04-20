import { el } from "../../helpers/dom/el";
import { dmKey, roomKey } from "../../helpers/chat/conversationKey";
import type { AppState, BoardEntry, FriendEntry, GroupEntry, MobileSidebarTab, PageKind, TargetRef } from "../../stores/types";
import {
  attentionHintForPeer,
  displayNameForFriend,
  friendRow,
  isRowMenuOpen,
  previewForConversation,
  roomRow,
} from "./renderSidebarHelpers";

export type RenderSidebarStandaloneCtx = {
  target: HTMLElement;
  body: HTMLElement;
  state: AppState;
  isMobile: boolean;
  mobileUi: boolean;
  forceResetScroll: boolean;
  hasSidebarQuery: boolean;
  archiveToggle: HTMLElement | null;
  chatArchiveToggle: HTMLElement | null;
  boardArchiveToggle: HTMLElement | null;
  chatArchiveOpen: boolean;
  boardArchiveOpen: boolean;
  archiveOpen: boolean;
  chatArchiveCount: number;
  boardArchiveCount: number;
  pinnedKeys: string[];
  pinnedSet: Set<string>;
  archivedSet: Set<string>;
  groups: GroupEntry[];
  boards: BoardEntry[];
  sel: AppState["selected"] | null;
  drafts: Record<string, string>;
  matchesQuery: (raw: string) => boolean;
  matchesFriend: (f: FriendEntry) => boolean;
  matchesRoom: (entry: { id: string; name?: string | null; handle?: string | null }) => boolean;
  isMuted: (id: string) => boolean;
  lastTsForKey: (key: string) => number;
  attnSet: Set<string>;
  mentionForKey: (key: string) => boolean;
  computeRoomUnread: (key: string) => number;
  buildSidebarArchiveHint: () => HTMLElement;
  buildSidebarArchiveEmpty: (label: string) => HTMLElement;
  buildSidebarHeaderToolbar: (activeTab: "contacts" | "boards" | "chats" | "menu") => HTMLElement;
  buildSidebarTabButton: (tab: MobileSidebarTab, activeTab: MobileSidebarTab, label: string) => HTMLButtonElement;
  buildSidebarSearchBar: (placeholder: string, opts?: { action?: HTMLElement }) => HTMLElement;
  buildFolderTabs: (activeId: string, folders: any[]) => HTMLElement | null;
  buildChatlist: (
    fixedRows: HTMLElement[],
    rows: HTMLElement[],
    emptyLabel?: string,
    opts?: { virtual?: boolean }
  ) => HTMLElement;
  setBodyChatlistClass: (children: HTMLElement[]) => void;
  bindHeaderScroll: (header: HTMLElement | null) => void;
  toggleClass: (node: HTMLElement | null | undefined, cls: string, enabled: boolean) => void;
  markCompactAvatarRows: (rows: Array<HTMLElement | null | undefined>) => HTMLElement[];
  dialogPriority: (opts: { hasDraft: boolean; unread?: number; attention?: boolean; mention?: boolean }) => number;
  hasActiveDialogForFriend: (f: FriendEntry) => boolean;
  unknownAttnPeers: string[];
  contactCandidates: FriendEntry[];
  activeContacts: FriendEntry[];
  archivedContacts: FriendEntry[];
  buildContactRows: (items: FriendEntry[], opts?: { sort?: boolean }) => HTMLElement[];
  buildTopPeerContactRows: (items: FriendEntry[]) => { ids: Set<string>; rows: HTMLElement[] };
  onSelect: (t: TargetRef) => void;
  onOpenUser: (id: string) => void;
  onSetPage: (page: PageKind) => void;
  onCreateGroup: () => void;
  onCreateBoard: () => void;
  onAuthOpen: () => void;
  onAuthLogout: () => void;
} & Record<string, unknown>;

export function renderSidebarStandalone(ctx: RenderSidebarStandaloneCtx) {
  const {
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
  } = ctx;

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
  const chatFiltersRow: HTMLElement | null = null;
  const passesChatFilter = (_opts: { kind: "dm" | "group"; unread: number; mention?: boolean; attention?: boolean }): boolean => true;

  const chatFolders = Array.isArray((state as any).chatFolders) ? (state as any).chatFolders : [];
  const rawFolderId = activeTab === "chats" ? String((state as any).sidebarFolderId || "all").trim().toLowerCase() : "all";
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
    if (!key.startsWith("room:")) continue;
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

  const mountPwa = (children: HTMLElement[]) => {
    setBodyChatlistClass(children);
    body.replaceChildren(...children);
    const nodes: HTMLElement[] = [header, tabs, body];
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
    const pinnedDialogRows = pinnedKeys.map((key) => pinnedDialogRowByKey.get(key)).filter(Boolean) as HTMLElement[];

    const chatFixedRows: HTMLElement[] = [];
    if (pinnedDialogRows.length) chatFixedRows.push(...pinnedDialogRows);
    chatFixedRows.push(el("div", { class: "pane-section" }, [hasSidebarQuery ? "Результаты" : "Чаты"]));
    const archiveBlock = chatArchiveOpen
      ? [
          el("div", { class: "pane-section pane-section-archive" }, [`Архив (${chatArchiveCount})`]),
          buildSidebarArchiveHint(),
          ...(archivedRows.length ? archivedRows : [buildSidebarArchiveEmpty("По текущему фильтру в архиве нет чатов.")]),
        ]
      : [];
    const chatRows = archiveBlock.length ? [...archiveBlock, ...dialogRows] : dialogRows;
    const chatList = buildChatlist(chatFixedRows, chatRows, hasSidebarQuery ? "(ничего не найдено)" : "(пока нет чатов)", {
      virtual: !chatArchiveOpen,
    });
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
    if (pinnedBoardRows.length) boardFixedRows.push(...pinnedBoardRows);
    boardFixedRows.push(el("div", { class: "pane-section" }, [hasSidebarQuery ? "Результаты" : "Доски"]));
    const archiveBlock = boardArchiveOpen
      ? [
          el("div", { class: "pane-section pane-section-archive" }, [`Архив (${boardArchiveCount})`]),
          buildSidebarArchiveHint(),
          ...archivedRows,
        ]
      : [];
    const rows = archiveBlock.length ? [...archiveBlock, ...boardRows] : boardRows;
    const boardList = buildChatlist(boardFixedRows, rows, hasSidebarQuery ? "(ничего не найдено)" : "(пока нет досок)", {
      virtual: !boardArchiveOpen,
    });
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
      if (pinnedContactRowsCompact.length) contactFixedRows.push(...pinnedContactRowsCompact);
      if (allRows.length) contactFixedRows.push(el("div", { class: "pane-section" }, [`Результаты (${allRows.length})`]));
      const contactList = buildChatlist(contactFixedRows, allRows, "(ничего не найдено)");
      mountPwa([contactList]);
      return;
    }

    const unknownAttnRows = markCompactAvatarRows(
      unknownAttnPeers.map((id) => {
        const k = dmKey(id);
        const meta = previewForConversation(state, k, "dm", drafts[k]);
        const hint = attentionHintForPeer(state, id);
        const meta2 = meta.sub ? meta : { ...meta, sub: hint };
        const pseudo: FriendEntry = { id, online: false, unread: 0 };
        return friendRow(state, pseudo, Boolean(sel && sel.kind === "dm" && sel.id === id), meta2, onSelect, onOpenUser, true);
      })
    );

    const contactFixedRows: HTMLElement[] = [];
    if (pinnedContactRowsCompact.length) contactFixedRows.push(...pinnedContactRowsCompact);
    if (unknownAttnRows.length) contactFixedRows.push(el("div", { class: "pane-section" }, ["Внимание"]), ...unknownAttnRows);
    if (topPeerRows.length) contactFixedRows.push(el("div", { class: "pane-section" }, ["Топ"]), ...topPeerRows);
    if (activeContactRows.length && !archiveBlock.length) contactFixedRows.push(el("div", { class: "pane-section" }, ["Контакты"]));
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

  const profileRow = roomRow("☺", "Профиль", state.page === "profile" || state.page === "sessions", () => onSetPage("profile"), undefined, {
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
}
