import { el } from "../../helpers/dom/el";
import { avatarHue, avatarMonogram, getStoredAvatar } from "../../helpers/avatar/avatarStore";
import { applyLegacyIdMask } from "../../helpers/id/legacyIdMask";
import { focusElement } from "../../helpers/ui/focus";
import { isMobileLikeUi } from "../../helpers/ui/mobileLike";
import { mapKeyboardLayout } from "../../helpers/search/keyboardLayout";
import { deriveServerSearchQuery } from "../../helpers/search/serverSearchQuery";
import { fileBadge } from "../../helpers/files/fileBadge";
import type { AppState, ChatMessage, SearchResultEntry, TargetRef } from "../../stores/types";

export interface SearchPageActions {
  onQueryChange: (query: string) => void;
  onSubmit: (query: string) => void;
  onSelectTarget: (t: TargetRef) => void;
  onOpenHistoryHit: (t: TargetRef, query: string, msgIdx?: number) => void;
  onAuthRequest: (peer: string) => void;
  onAuthAccept: (peer: string) => void;
  onAuthDecline: (peer: string) => void;
  onAuthCancel: (peer: string) => void;
  onGroupJoin: (groupId: string) => void;
  onBoardJoin: (boardId: string) => void;
}

export interface SearchPage {
  root: HTMLElement;
  update: (state: AppState) => void;
  focus: () => void;
}

function inferTarget(entry: SearchResultEntry): TargetRef {
  if (entry.board) return { kind: "board", id: entry.id };
  if (entry.group) return { kind: "group", id: entry.id };
  return { kind: "dm", id: entry.id };
}

function resultLabel(r: SearchResultEntry): string {
  if (r.board) return `# ${r.id}`;
  if (r.group) return `# ${r.id}`;
  const dot = r.online ? "●" : "○";
  const star = r.friend ? "★" : " ";
  return `${star} ${dot} ${r.id}`;
}

function avatar(kind: "dm" | "group" | "board", id: string): HTMLElement {
  const url = getStoredAvatar(kind, id);
  const a = el("span", { class: url ? "avatar avatar-img" : "avatar", "aria-hidden": "true" }, [url ? "" : avatarMonogram(kind, id)]);
  a.style.setProperty("--avatar-h", String(avatarHue(`${kind}:${id}`)));
  if (url) a.style.backgroundImage = `url(${url})`;
  return a;
}

const SEARCH_NORMALIZE_RE = /[^a-z0-9а-яё_@]+/gi;
const CONTACTS_LIMIT = 60;
const ROOMS_LIMIT = 40;
const HISTORY_SCAN_LIMIT = 400;
const HISTORY_PER_CHAT_LIMIT = 4;
const HISTORY_MAX_RESULTS = 40;
const SNIPPET_MAX = 140;
const HISTORY_LINK_RE = /(https?:\/\/|www\.)\S+/i;

type HistoryFilter = "all" | "media" | "files" | "links" | "audio";

const HISTORY_FILTERS: Array<{ id: HistoryFilter; label: string }> = [
  { id: "all", label: "Все" },
  { id: "media", label: "Медиа" },
  { id: "files", label: "Файлы" },
  { id: "links", label: "Ссылки" },
  { id: "audio", label: "Аудио" },
];

function normalizeSearchText(raw: string): string {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(SEARCH_NORMALIZE_RE, " ")
    .trim();
}

function tokenizeSearchQuery(raw: string): string[] {
  const normalized = normalizeSearchText(raw);
  if (!normalized) return [];
  return normalized.split(/\s+/).filter(Boolean);
}

function scoreStringMatch(haystack: string, query: string): number {
  if (!query || !haystack) return 0;
  if (haystack === query) return 140;
  if (haystack.startsWith(query)) return 90;
  if (haystack.includes(query)) return 40;
  return 0;
}

function buildHaystack(parts: Array<string | null | undefined>): string {
  const text = parts
    .map((p) => String(p || "").trim())
    .filter(Boolean)
    .join(" ");
  return normalizeSearchText(text);
}

function matchesTokens(haystack: string, tokens: string[]): boolean {
  if (!tokens.length) return false;
  return tokens.every((t) => haystack.includes(t));
}

function truncateText(raw: string, max: number): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function formatHandle(handle: string): string {
  const h = String(handle || "").trim();
  if (!h) return "";
  return h.startsWith("@") ? h : `@${h}`;
}

function classifyHistoryMessage(msg: ChatMessage) {
  const attachment = msg?.attachment;
  const text = String(msg?.text || "");
  const hasLink = HISTORY_LINK_RE.test(text);
  let hasMedia = false;
  let hasAudio = false;
  let hasFiles = false;
  if (attachment?.kind === "file") {
    const badge = fileBadge(attachment.name, attachment.mime);
    if (badge.kind === "image" || badge.kind === "video") {
      hasMedia = true;
    } else if (badge.kind === "audio") {
      hasAudio = true;
    } else {
      hasFiles = true;
    }
  }
  return { media: hasMedia, files: hasFiles, links: hasLink, audio: hasAudio };
}

function matchesHistoryFilter(match: { flags: { media: boolean; files: boolean; links: boolean; audio: boolean } }, filter: HistoryFilter): boolean {
  if (filter === "all") return true;
  return Boolean(match.flags?.[filter]);
}

function resolveContactLabel(state: AppState, id: string): { title: string; handle: string; sub: string; online: boolean } {
  const friend = state.friends.find((f) => f.id === id);
  const profile = state.profiles?.[id];
  const displayName = String(friend?.display_name || profile?.display_name || "").trim();
  const handle = formatHandle(String(friend?.handle || profile?.handle || "").trim());
  const title = displayName || handle || id;
  const subParts: string[] = [];
  if (handle && handle !== title) subParts.push(handle);
  if (id && id !== title) subParts.push(`ID: ${id}`);
  const sub = subParts.join(" · ");
  return { title, handle, sub, online: Boolean(friend?.online) };
}

function resolveRoomLabel(state: AppState, kind: "group" | "board", id: string): { title: string; sub: string } {
  const entry = kind === "group" ? state.groups.find((g) => g.id === id) : state.boards.find((b) => b.id === id);
  const name = String(entry?.name || "").trim();
  const handle = formatHandle(String(entry?.handle || "").trim());
  const title = name || id;
  const subParts: string[] = [];
  if (handle && handle !== title) subParts.push(handle);
  if (id && id !== title) subParts.push(`ID: ${id}`);
  const sub = subParts.join(" · ");
  return { title, sub };
}

export function createSearchPage(actions: SearchPageActions): SearchPage {
  const mobileUi = isMobileLikeUi();
  const title = el("div", { class: "chat-title" }, ["Поиск"]);

  const input = el("input", {
    class: "modal-input",
    type: "text",
    placeholder: "Имя, @логин, ID или текст сообщения",
    "data-ios-assistant": "off",
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    spellcheck: "false",
    inputmode: "text",
    enterkeyhint: "search",
  }) as HTMLInputElement;

  const btn = el("button", { class: "btn", type: "button" }, ["Искать"]);

  const form = el("div", { class: "page-form" }, [input, btn]);
  const filterBar = el("div", { class: "search-filters hidden", role: "tablist" });
  const results = el("div", { class: "page-results" });
  const hint = mobileUi ? null : el("div", { class: "msg msg-sys page-hint" }, ["Enter — искать | Esc — назад"]);

  const root = el("div", { class: "page page-search" }, [title, form, filterBar, results, ...(hint ? [hint] : [])]);

  type ContactMatch = {
    id: string;
    title: string;
    sub: string;
    online: boolean;
    score: number;
  };

  type RoomMatch = {
    id: string;
    kind: "group" | "board";
    title: string;
    sub: string;
    score: number;
  };

  type HistoryMatch = {
    target: TargetRef;
    idx: number;
    title: string;
    sub: string;
    ts: number;
    flags: { media: boolean; files: boolean; links: boolean; audio: boolean };
  };

  let cachedQuery = "";
  let cachedFriendsRef: AppState["friends"] | null = null;
  let cachedGroupsRef: AppState["groups"] | null = null;
  let cachedBoardsRef: AppState["boards"] | null = null;
  let cachedProfilesRef: AppState["profiles"] | null = null;
  let cachedConversationsRef: AppState["conversations"] | null = null;
  let cachedContacts: ContactMatch[] = [];
  let cachedRooms: RoomMatch[] = [];
  let cachedHistory: HistoryMatch[] = [];
  let cachedTotals = { contacts: 0, rooms: 0, history: 0 };
  let cachedHistoryCounts = { all: 0, media: 0, files: 0, links: 0, audio: 0 };
  let activeFilter: HistoryFilter = "all";
  let lastState: AppState | null = null;

  const setActiveFilter = (next: HistoryFilter) => {
    if (activeFilter === next) return;
    activeFilter = next;
    if (lastState) update(lastState);
  };

  function computeLocalMatches(state: AppState, rawQuery: string) {
    const q = rawQuery.trim();
    const qAltEn = mapKeyboardLayout(q, "ruToEn");
    const qAltRu = mapKeyboardLayout(q, "enToRu");
    const tokens = tokenizeSearchQuery(q);
    const tokensAltEn = qAltEn !== q ? tokenizeSearchQuery(qAltEn) : [];
    const tokensAltRu = qAltRu !== q ? tokenizeSearchQuery(qAltRu) : [];
    const tokenSets = [tokens, tokensAltEn, tokensAltRu].filter((set) => set.length > 0);
    const qNorm = normalizeSearchText(q);
    const qNormAltEn = qAltEn !== q ? normalizeSearchText(qAltEn) : "";
    const qNormAltRu = qAltRu !== q ? normalizeSearchText(qAltRu) : "";
    const qDigits = q.replace(/\D/g, "");
    if (!q) {
      cachedQuery = q;
      cachedContacts = [];
      cachedRooms = [];
      cachedHistory = [];
      cachedTotals = { contacts: 0, rooms: 0, history: 0 };
      cachedHistoryCounts = { all: 0, media: 0, files: 0, links: 0, audio: 0 };
      return { contacts: cachedContacts, rooms: cachedRooms, history: cachedHistory, totals: cachedTotals, historyCounts: cachedHistoryCounts };
    }

    const canReuse =
      q === cachedQuery &&
      cachedFriendsRef === state.friends &&
      cachedGroupsRef === state.groups &&
      cachedBoardsRef === state.boards &&
      cachedProfilesRef === state.profiles &&
      cachedConversationsRef === state.conversations;
    if (canReuse) {
      return { contacts: cachedContacts, rooms: cachedRooms, history: cachedHistory, totals: cachedTotals, historyCounts: cachedHistoryCounts };
    }

    const contactMatches: ContactMatch[] = [];
    for (const friend of state.friends) {
      const id = String(friend.id || "").trim();
      if (!id) continue;
      const profile = state.profiles?.[id];
      const displayName = String(friend.display_name || profile?.display_name || "").trim();
      const handleRaw = String(friend.handle || profile?.handle || "").trim();
      const idDigits = id.replace(/\D/g, "");
      const haystack = buildHaystack([displayName, handleRaw, formatHandle(handleRaw), id, idDigits]);
      const tokenHit = tokenSets.some((set) => matchesTokens(haystack, set));
      if (!tokenHit && !(qDigits && idDigits.includes(qDigits))) continue;
      const { title, sub, online } = resolveContactLabel(state, id);
      const bestDisplay = Math.max(
        scoreStringMatch(normalizeSearchText(displayName), qNorm),
        qNormAltEn ? scoreStringMatch(normalizeSearchText(displayName), qNormAltEn) : 0,
        qNormAltRu ? scoreStringMatch(normalizeSearchText(displayName), qNormAltRu) : 0
      );
      const bestHandle = Math.max(
        scoreStringMatch(normalizeSearchText(handleRaw), qNorm),
        qNormAltEn ? scoreStringMatch(normalizeSearchText(handleRaw), qNormAltEn) : 0,
        qNormAltRu ? scoreStringMatch(normalizeSearchText(handleRaw), qNormAltRu) : 0
      );
      const score =
        bestDisplay +
        bestHandle +
        (qDigits && idDigits.startsWith(qDigits) ? 70 : qDigits && idDigits.includes(qDigits) ? 30 : 0) +
        (tokens.length > 1 ? 10 : 0);
      contactMatches.push({ id, title, sub, online, score });
    }
    contactMatches.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

    const roomMatches: RoomMatch[] = [];
    for (const g of state.groups) {
      const id = String(g.id || "").trim();
      if (!id) continue;
      const name = String(g.name || "").trim();
      const handleRaw = String(g.handle || "").trim();
      const idDigits = id.replace(/\D/g, "");
      const haystack = buildHaystack([name, handleRaw, formatHandle(handleRaw), id, idDigits]);
      const tokenHit = tokenSets.some((set) => matchesTokens(haystack, set));
      if (!tokenHit && !(qDigits && idDigits.includes(qDigits))) continue;
      const { title, sub } = resolveRoomLabel(state, "group", id);
      const bestName = Math.max(
        scoreStringMatch(normalizeSearchText(name), qNorm),
        qNormAltEn ? scoreStringMatch(normalizeSearchText(name), qNormAltEn) : 0,
        qNormAltRu ? scoreStringMatch(normalizeSearchText(name), qNormAltRu) : 0
      );
      const bestHandle = Math.max(
        scoreStringMatch(normalizeSearchText(handleRaw), qNorm),
        qNormAltEn ? scoreStringMatch(normalizeSearchText(handleRaw), qNormAltEn) : 0,
        qNormAltRu ? scoreStringMatch(normalizeSearchText(handleRaw), qNormAltRu) : 0
      );
      const score =
        bestName +
        bestHandle +
        (qDigits && idDigits.startsWith(qDigits) ? 70 : qDigits && idDigits.includes(qDigits) ? 30 : 0) +
        (tokens.length > 1 ? 10 : 0);
      roomMatches.push({ id, kind: "group", title, sub, score });
    }
    for (const b of state.boards) {
      const id = String(b.id || "").trim();
      if (!id) continue;
      const name = String(b.name || "").trim();
      const handleRaw = String(b.handle || "").trim();
      const idDigits = id.replace(/\D/g, "");
      const haystack = buildHaystack([name, handleRaw, formatHandle(handleRaw), id, idDigits]);
      const tokenHit = tokenSets.some((set) => matchesTokens(haystack, set));
      if (!tokenHit && !(qDigits && idDigits.includes(qDigits))) continue;
      const { title, sub } = resolveRoomLabel(state, "board", id);
      const bestName = Math.max(
        scoreStringMatch(normalizeSearchText(name), qNorm),
        qNormAltEn ? scoreStringMatch(normalizeSearchText(name), qNormAltEn) : 0,
        qNormAltRu ? scoreStringMatch(normalizeSearchText(name), qNormAltRu) : 0
      );
      const bestHandle = Math.max(
        scoreStringMatch(normalizeSearchText(handleRaw), qNorm),
        qNormAltEn ? scoreStringMatch(normalizeSearchText(handleRaw), qNormAltEn) : 0,
        qNormAltRu ? scoreStringMatch(normalizeSearchText(handleRaw), qNormAltRu) : 0
      );
      const score =
        bestName +
        bestHandle +
        (qDigits && idDigits.startsWith(qDigits) ? 70 : qDigits && idDigits.includes(qDigits) ? 30 : 0) +
        (tokens.length > 1 ? 10 : 0);
      roomMatches.push({ id, kind: "board", title, sub, score });
    }
    roomMatches.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

    const historyMatches: HistoryMatch[] = [];
    const historyCounts = { all: 0, media: 0, files: 0, links: 0, audio: 0 };
    if (tokens.length) {
      for (const [key, msgs] of Object.entries(state.conversations || {})) {
        if (!Array.isArray(msgs) || !msgs.length) continue;
        let target: TargetRef | null = null;
        if (key.startsWith("dm:")) {
          target = { kind: "dm", id: key.slice(3) };
        } else if (key.startsWith("room:")) {
          const id = key.slice(5);
          if (state.boards.some((b) => b.id === id)) target = { kind: "board", id };
          else target = { kind: "group", id };
        }
        if (!target) continue;
        const title =
          target.kind === "dm"
            ? resolveContactLabel(state, target.id).title
            : resolveRoomLabel(state, target.kind, target.id).title;
        let picked = 0;
        const start = Math.max(0, msgs.length - HISTORY_SCAN_LIMIT);
        for (let idx = msgs.length - 1; idx >= start; idx -= 1) {
          const msg = msgs[idx];
          const text = String(msg?.text || "");
          const attachmentName = msg?.attachment?.kind === "file" ? String(msg.attachment.name || "") : "";
          const haystack = buildHaystack([text, attachmentName]);
          const tokenHit = tokenSets.some((set) => matchesTokens(haystack, set));
          if (!tokenHit) continue;
          const fromLabel = msg?.from ? resolveContactLabel(state, String(msg.from)).title : "";
          const snippet = truncateText(text || attachmentName, SNIPPET_MAX);
          const subParts: string[] = [];
          if (fromLabel && target.kind !== "dm") subParts.push(`От: ${fromLabel}`);
          if (snippet) subParts.push(snippet);
          const sub = subParts.join(" · ");
          const flags = classifyHistoryMessage(msg);
          historyMatches.push({ target, idx, title, sub, ts: Number(msg?.ts || 0), flags });
          historyCounts.all += 1;
          if (flags.media) historyCounts.media += 1;
          if (flags.files) historyCounts.files += 1;
          if (flags.links) historyCounts.links += 1;
          if (flags.audio) historyCounts.audio += 1;
          picked += 1;
          if (picked >= HISTORY_PER_CHAT_LIMIT) break;
        }
      }
      historyMatches.sort((a, b) => b.ts - a.ts);
    }

    cachedQuery = q;
    cachedFriendsRef = state.friends;
    cachedGroupsRef = state.groups;
    cachedBoardsRef = state.boards;
    cachedProfilesRef = state.profiles;
    cachedConversationsRef = state.conversations;
    cachedTotals = { contacts: contactMatches.length, rooms: roomMatches.length, history: historyMatches.length };
    cachedContacts = contactMatches.slice(0, CONTACTS_LIMIT);
    cachedRooms = roomMatches.slice(0, ROOMS_LIMIT);
    cachedHistory = historyMatches.slice(0, HISTORY_MAX_RESULTS);
    cachedHistoryCounts = historyCounts;
    return { contacts: cachedContacts, rooms: cachedRooms, history: cachedHistory, totals: cachedTotals, historyCounts: cachedHistoryCounts };
  }

  function submit() {
    const q = input.value.trim();
    actions.onSubmit(q);
  }

  btn.addEventListener("click", () => submit());

  input.addEventListener("input", () => {
    applyLegacyIdMask(input);
    actions.onQueryChange(input.value);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  });

  function update(state: AppState) {
    lastState = state;
    if (document.activeElement !== input && input.value !== state.searchQuery) {
      input.value = state.searchQuery;
    }

    const qRaw = String(state.searchQuery || "");
    const q = qRaw.trim();
    const canSearchNow = Boolean(deriveServerSearchQuery(qRaw));

    if (!q) {
      activeFilter = "all";
      filterBar.classList.add("hidden");
      results.replaceChildren(
        el("div", { class: "page-empty" }, [
          el("div", { class: "page-empty-title" }, ["Введите имя, @логин или ID"]),
          el("div", { class: "page-empty-sub" }, ["По контактам и истории поиск работает сразу, по серверу — от 3 цифр ID или 3+ символов логина (@ необязателен)"]),
        ])
      );
      return;
    }

    const local = computeLocalMatches(state, qRaw);
    if (activeFilter !== "all" && local.historyCounts[activeFilter] === 0) {
      activeFilter = "all";
    }
    const list = state.searchResults || [];
    const blocks: HTMLElement[] = [];

    const pushSection = (label: string) => {
      blocks.push(el("div", { class: "pane-section" }, [label]));
    };

    if (local.historyCounts.all > 0) {
      filterBar.classList.remove("hidden");
      filterBar.replaceChildren(
        ...HISTORY_FILTERS.map((item) => {
          const count = item.id === "all" ? local.historyCounts.all : local.historyCounts[item.id];
          const active = item.id === activeFilter;
          const disabled = item.id !== "all" && count === 0;
          const btn = el(
            "button",
            {
              class: `search-filter${active ? " is-active" : ""}`,
              type: "button",
              role: "tab",
              "aria-selected": active ? "true" : "false",
              ...(disabled ? { disabled: "true" } : {}),
            },
            [item.label, el("span", { class: "search-filter-count" }, [String(count)])]
          );
          if (!disabled) btn.addEventListener("click", () => setActiveFilter(item.id));
          return btn;
        })
      );
    } else {
      filterBar.classList.add("hidden");
      filterBar.replaceChildren();
    }

    if (local.contacts.length) {
      pushSection(`Контакты (${local.totals.contacts})`);
      for (const item of local.contacts) {
        const dot = item.online ? "●" : "○";
        const rowMain = el("span", { class: "row-main" }, [
          el("span", { class: "row-title" }, [item.title]),
          ...(item.sub ? [el("span", { class: "row-sub" }, [item.sub])] : []),
        ]);
        const row = el("button", { class: "row", type: "button" }, [
          avatar("dm", item.id),
          rowMain,
          el("span", { class: "row-tail" }, [el("span", { class: `row-dot ${item.online ? "row-dot-online" : "row-dot-offline"}` }, [dot])]),
        ]);
        row.addEventListener("click", () => actions.onSelectTarget({ kind: "dm", id: item.id }));
        blocks.push(el("div", { class: "result-item" }, [row]));
      }
      if (local.totals.contacts > local.contacts.length) {
        blocks.push(el("div", { class: "result-meta" }, [`Показаны первые ${local.contacts.length} контактов`]));
      }
    }

    if (local.rooms.length) {
      pushSection(`Чаты и доски (${local.totals.rooms})`);
      for (const item of local.rooms) {
        const rowMain = el("span", { class: "row-main" }, [
          el("span", { class: "row-title" }, [item.title]),
          ...(item.sub ? [el("span", { class: "row-sub" }, [item.sub])] : []),
        ]);
        const row = el("button", { class: "row", type: "button" }, [avatar(item.kind, item.id), rowMain]);
        row.addEventListener("click", () => actions.onSelectTarget({ kind: item.kind, id: item.id }));
        blocks.push(el("div", { class: "result-item" }, [row]));
      }
      if (local.totals.rooms > local.rooms.length) {
        blocks.push(el("div", { class: "result-meta" }, [`Показаны первые ${local.rooms.length} чатов/досок`]));
      }
    }

    if (local.history.length) {
      pushSection(`История чатов (${local.totals.history})`);
      const historyItems = local.history.filter((item) => matchesHistoryFilter(item, activeFilter));
      if (!historyItems.length) {
        blocks.push(el("div", { class: "result-meta" }, ["По выбранному фильтру совпадений нет"]));
      } else {
        for (const item of historyItems) {
          const rowMain = el("span", { class: "row-main" }, [
            el("span", { class: "row-title" }, [item.title]),
            ...(item.sub ? [el("span", { class: "row-sub" }, [item.sub])] : []),
          ]);
          const row = el("button", { class: "row", type: "button" }, [avatar(item.target.kind, item.target.id), rowMain]);
          row.addEventListener("click", () => actions.onOpenHistoryHit(item.target, q, item.idx));
          blocks.push(el("div", { class: "result-item" }, [row]));
        }
      }
      blocks.push(el("div", { class: "result-meta" }, ["Поиск по загруженной истории сообщений"]));
    }

    if (list.length) {
      pushSection("Поиск по ID/@логину");
      blocks.push(
        ...list.map((r) => {
          const isGroup = Boolean(r.group);
          const isBoard = Boolean(r.board);
          const isFriend = r.friend ?? state.friends.some((f) => f.id === r.id);
          const pendingIn = state.pendingIn.includes(r.id);
          const pendingOut = state.pendingOut.includes(r.id);
          const inGroup = state.groups.some((g) => g.id === r.id);
          const inBoard = state.boards.some((b) => b.id === r.id);
          const canOpen = isGroup ? inGroup : isBoard ? inBoard : isFriend;

          const rowChildren: Array<string | HTMLElement> = [];
          if (isGroup) {
            rowChildren.push(el("span", { class: "row-prefix", "aria-hidden": "true" }, ["#"]), avatar("group", r.id), el("span", { class: "row-label" }, [r.id]));
          } else if (isBoard) {
            rowChildren.push(el("span", { class: "row-prefix", "aria-hidden": "true" }, ["#"]), avatar("board", r.id), el("span", { class: "row-label" }, [r.id]));
          } else {
            const dot = r.online ? "●" : "○";
            const star = isFriend ? "★" : " ";
            rowChildren.push(
              el("span", { class: "row-star", "aria-hidden": "true" }, [star]),
              avatar("dm", r.id),
              el("span", { class: `row-dot ${r.online ? "row-dot-online" : "row-dot-offline"}`, "aria-hidden": "true" }, [dot]),
              el("span", { class: "row-id" }, [r.id])
            );
          }

          const rowBtn = el(
            "button",
            { class: "row", type: "button", ...(canOpen ? {} : { disabled: "true" }) },
            rowChildren.length ? rowChildren : [resultLabel(r)]
          );
          if (canOpen) rowBtn.addEventListener("click", () => actions.onSelectTarget(inferTarget(r)));

          const actionButtons: HTMLElement[] = [];
          if (isGroup) {
            if (!inGroup) {
              const joinBtn = el("button", { class: "btn", type: "button" }, ["Запросить вступление"]);
              joinBtn.addEventListener("click", () => actions.onGroupJoin(r.id));
              actionButtons.push(joinBtn);
            }
          } else if (isBoard) {
            if (!inBoard) {
              const joinBtn = el("button", { class: "btn", type: "button" }, ["Вступить"]);
              joinBtn.addEventListener("click", () => actions.onBoardJoin(r.id));
              actionButtons.push(joinBtn);
            }
          } else if (pendingIn) {
            const acceptBtn = el("button", { class: "btn", type: "button" }, ["Принять"]);
            const declineBtn = el("button", { class: "btn", type: "button" }, ["Отклонить"]);
            acceptBtn.addEventListener("click", () => actions.onAuthAccept(r.id));
            declineBtn.addEventListener("click", () => actions.onAuthDecline(r.id));
            actionButtons.push(acceptBtn, declineBtn);
          } else if (pendingOut) {
            const cancelBtn = el("button", { class: "btn", type: "button" }, ["Отменить запрос"]);
            cancelBtn.addEventListener("click", () => actions.onAuthCancel(r.id));
            actionButtons.push(cancelBtn);
          } else if (!isFriend && !isGroup && !isBoard) {
            const reqBtn = el("button", { class: "btn", type: "button" }, ["Запросить контакт"]);
            reqBtn.addEventListener("click", () => actions.onAuthRequest(r.id));
            actionButtons.push(reqBtn);
          }

          const meta: string[] = [];
          if (pendingIn) meta.push("Входящий запрос");
          if (pendingOut) meta.push("Ожидает подтверждения");
          if (isGroup && !inGroup) meta.push("Доступ по запросу");
          if (isBoard && !inBoard) meta.push("Открытая доска");

          const itemChildren: HTMLElement[] = [rowBtn];
          if (meta.length) {
            itemChildren.push(el("div", { class: "result-meta" }, [meta.join(" · ")]));
          }
          if (actionButtons.length) {
            itemChildren.push(el("div", { class: "page-actions" }, actionButtons));
          }

          return el("div", { class: "result-item" }, itemChildren);
        })
      );
    }

    if (!blocks.length) {
      const message = canSearchNow
        ? "Проверьте запрос или попробуйте другие первые цифры/буквы"
        : "Локально ничего не найдено. Для поиска по серверу нужно минимум 3 цифры ID или 3+ символа логина (@ необязателен)";
      results.replaceChildren(
        el("div", { class: "page-empty" }, [el("div", { class: "page-empty-title" }, ["Ничего не найдено"]), el("div", { class: "page-empty-sub" }, [message])])
      );
      return;
    }

    if (!list.length && !canSearchNow) {
      blocks.push(el("div", { class: "result-meta" }, ["Поиск по серверу доступен от 3 цифр ID или 3+ символов логина (@ необязателен)"]));
    }

    results.replaceChildren(...blocks);
  }

  return {
    root,
    update,
    focus: () => {
      focusElement(input, { select: true });
    },
  };
}
