import { createLayout } from "../components/layout/createLayout";
import { getGatewayUrl } from "../config/env";
import { APP_MSG_MAX_LEN, APP_VERSION } from "../config/app";
import { GatewayClient } from "../lib/net/gatewayClient";
import { Store } from "../stores/store";
import { el } from "../helpers/dom/el";
import type {
  ActionModalPayload,
  AppState,
  ConnStatus,
  ConfirmAction,
  ContextMenuTargetKind,
  FileOfferIn,
  FileTransferEntry,
  MobileSidebarTab,
  PageKind,
  SearchResultEntry,
  TargetRef,
} from "../stores/types";
import { conversationKey, dmKey, roomKey } from "../helpers/chat/conversationKey";
import { newestServerMessageId } from "../helpers/chat/historySync";
import { loadDraftsForUser, sanitizeDraftMap, saveDraftsForUser, updateDraftMap } from "../helpers/chat/drafts";
import { clampChatSearchPos, computeChatSearchHits, stepChatSearchPos } from "../helpers/chat/chatSearch";
import { loadPinsForUser, sanitizePins, savePinsForUser, togglePin } from "../helpers/chat/pins";
import {
  loadPinnedMessagesForUser,
  mergePinnedMessagesMaps,
  isPinnedMessage,
  savePinnedMessagesForUser,
  togglePinnedMessage,
} from "../helpers/chat/pinnedMessages";
import { loadFileTransfersForUser, saveFileTransfersForUser } from "../helpers/files/fileTransferHistory";
import { upsertConversation } from "../helpers/chat/upsertConversation";
import { addOutboxEntry, loadOutboxForUser, makeOutboxLocalId, removeOutboxEntry, saveOutboxForUser, updateOutboxEntry } from "../helpers/chat/outbox";
import { activatePwaUpdate } from "../helpers/pwa/registerServiceWorker";
import { shouldReloadForBuild } from "../helpers/pwa/shouldReloadForBuild";
import {
  clearPwaInstallDismissed,
  isBeforeInstallPromptEvent,
  markPwaInstallDismissed,
  shouldOfferPwaInstall,
  type BeforeInstallPromptEvent,
} from "../helpers/pwa/installPrompt";
import { applySkin, fetchAvailableSkins, normalizeSkinId, storeSkinId } from "../helpers/skin/skin";
import { clearStoredSessionToken, getStoredSessionToken, isSessionAutoAuthBlocked, storeAuthId } from "../helpers/auth/session";
import { nowTs } from "../helpers/time";
import { applyLegacyIdMask } from "../helpers/id/legacyIdMask";
import { createInitialState } from "./createInitialState";
import { handleServerMessage } from "./handleServerMessage";
import { renderApp } from "./renderApp";
import { clearStoredAvatar, getStoredAvatar, imageFileToAvatarDataUrl, storeAvatar, type AvatarTargetKind } from "../helpers/avatar/avatarStore";
import { normalizeMemberToken, statusForSearchResult, type MemberTokenStatus } from "../helpers/members/memberTokens";
import { resolveMemberTokensForSubmit } from "../helpers/members/resolveMemberTokens";
import { defaultToastTimeoutMs } from "../helpers/ui/toast";
import { shouldAutofocusComposer } from "../helpers/ui/autofocusPolicy";
import { armCtxClickSuppression, consumeCtxClickSuppression, type CtxClickSuppressionState } from "../helpers/ui/ctxClickSuppression";
import { applyIosInputAssistantWorkaround, isIOS, isStandaloneDisplayMode } from "../helpers/ui/iosInputAssistant";
import { DEFAULT_EMOJI, insertTextAtSelection, mergeEmojiPalette, updateEmojiRecents } from "../helpers/ui/emoji";
import { createRafScrollLock } from "../helpers/ui/rafScrollLock";
import { readScrollSnapshot } from "../helpers/ui/scrollSnapshot";

function autosizeInput(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  const style = window.getComputedStyle(el);
  const max = Number.parseFloat(style.maxHeight || "");
  const next = el.scrollHeight;
  const height = Number.isFinite(max) && max > 0 ? Math.min(next, max) : next;
  el.style.height = `${Math.max(0, Math.ceil(height))}px`;

  const maxed = Number.isFinite(max) && max > 0 ? next > max + 1 : false;
  el.classList.toggle("input-maxed", maxed);
}

let draftsSaveTimer: number | null = null;
let draftsLoadedForUser: string | null = null;
let pinsLoadedForUser: string | null = null;
let pinnedMessagesLoadedForUser: string | null = null;
let pinnedMessagesSaveTimer: number | null = null;
let fileTransfersSaveTimer: number | null = null;
let fileTransfersLoadedForUser: string | null = null;
let outboxSaveTimer: number | null = null;
let outboxLoadedForUser: string | null = null;

function scheduleSaveDrafts(store: Store<AppState>) {
  if (draftsSaveTimer !== null) {
    window.clearTimeout(draftsSaveTimer);
    draftsSaveTimer = null;
  }
  draftsSaveTimer = window.setTimeout(() => {
    draftsSaveTimer = null;
    try {
      const st = store.get();
      if (!st.authed || !st.selfId) return;
      saveDraftsForUser(st.selfId, st.drafts);
    } catch {
      // ignore
    }
  }, 420);
}

function flushDrafts(store: Store<AppState>) {
  if (draftsSaveTimer !== null) {
    window.clearTimeout(draftsSaveTimer);
    draftsSaveTimer = null;
  }
  try {
    const st = store.get();
    if (!st.authed || !st.selfId) return;
    saveDraftsForUser(st.selfId, st.drafts);
  } catch {
    // ignore
  }
}

function scheduleSaveOutbox(store: Store<AppState>) {
  if (outboxSaveTimer !== null) {
    window.clearTimeout(outboxSaveTimer);
    outboxSaveTimer = null;
  }
  outboxSaveTimer = window.setTimeout(() => {
    outboxSaveTimer = null;
    try {
      const st = store.get();
      if (!st.selfId) return;
      saveOutboxForUser(st.selfId, st.outbox);
    } catch {
      // ignore
    }
  }, 420);
}

function flushOutbox(store: Store<AppState>) {
  if (outboxSaveTimer !== null) {
    window.clearTimeout(outboxSaveTimer);
    outboxSaveTimer = null;
  }
  try {
    const st = store.get();
    if (!st.selfId) return;
    saveOutboxForUser(st.selfId, st.outbox);
  } catch {
    // ignore
  }
}

function scheduleSavePinnedMessages(store: Store<AppState>) {
  if (pinnedMessagesSaveTimer !== null) {
    window.clearTimeout(pinnedMessagesSaveTimer);
    pinnedMessagesSaveTimer = null;
  }
  pinnedMessagesSaveTimer = window.setTimeout(() => {
    pinnedMessagesSaveTimer = null;
    try {
      const st = store.get();
      if (!st.authed || !st.selfId) return;
      savePinnedMessagesForUser(st.selfId, st.pinnedMessages);
    } catch {
      // ignore
    }
  }, 420);
}

function flushPinnedMessages(store: Store<AppState>) {
  if (pinnedMessagesSaveTimer !== null) {
    window.clearTimeout(pinnedMessagesSaveTimer);
    pinnedMessagesSaveTimer = null;
  }
  try {
    const st = store.get();
    if (!st.authed || !st.selfId) return;
    savePinnedMessagesForUser(st.selfId, st.pinnedMessages);
  } catch {
    // ignore
  }
}

function scheduleSaveFileTransfers(store: Store<AppState>) {
  if (fileTransfersSaveTimer !== null) {
    window.clearTimeout(fileTransfersSaveTimer);
    fileTransfersSaveTimer = null;
  }
  fileTransfersSaveTimer = window.setTimeout(() => {
    fileTransfersSaveTimer = null;
    try {
      const st = store.get();
      if (!st.authed || !st.selfId) return;
      saveFileTransfersForUser(st.selfId, st.fileTransfers);
    } catch {
      // ignore
    }
  }, 650);
}

function flushFileTransfers(store: Store<AppState>) {
  if (fileTransfersSaveTimer !== null) {
    window.clearTimeout(fileTransfersSaveTimer);
    fileTransfersSaveTimer = null;
  }
  try {
    const st = store.get();
    if (!st.authed || !st.selfId) return;
    saveFileTransfersForUser(st.selfId, st.fileTransfers);
  } catch {
    // ignore
  }
}

function parseMembersInput(raw: string): string[] {
  return (raw || "")
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

type MembersAddUiStatus = MemberTokenStatus;

function normalizeHandle(raw: string): string | null {
  const trimmed = (raw || "").trim().toLowerCase();
  if (!trimmed) return null;
  const base = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  const safe = base.replace(/[^a-z0-9_]/g, "");
  const handle = `@${safe}`;
  if (!/^@[a-z0-9_]{3,16}$/.test(handle)) return null;
  return handle;
}

interface UploadState {
  localId: string;
  file: File;
  target: TargetRef;
  caption?: string;
  fileId?: string | null;
  bytesSent: number;
  seq: number;
  lastProgress: number;
  aborted: boolean;
}

interface DownloadState {
  fileId: string;
  name: string;
  size: number;
  from: string;
  room?: string | null;
  chunks: ArrayBuffer[];
  received: number;
  lastProgress: number;
}

function membersAddDom(): {
  field: HTMLElement;
  chips: HTMLElement;
  entry: HTMLInputElement;
  hidden: HTMLInputElement;
} | null {
  const field = document.getElementById("members-add-field");
  const chips = document.getElementById("members-add-chips");
  const entry = document.getElementById("members-add-entry") as HTMLInputElement | null;
  const hidden = document.getElementById("members-add-input") as HTMLInputElement | null;
  if (!field || !chips || !entry || !hidden) return null;
  return { field, chips, entry, hidden };
}

type CreateMembersScope = "group_create" | "board_create";

function createMembersDom(scope: CreateMembersScope): {
  field: HTMLElement;
  chips: HTMLElement;
  entry: HTMLInputElement;
  hidden: HTMLInputElement;
} | null {
  const base = scope === "group_create" ? "group-members" : "board-members";
  const field = document.getElementById(`${base}-field`);
  const chips = document.getElementById(`${base}-chips`);
  const entry = document.getElementById(`${base}-entry`) as HTMLInputElement | null;
  const hidden = document.getElementById(base) as HTMLInputElement | null;
  if (!field || !chips || !entry || !hidden) return null;
  return { field, chips, entry, hidden };
}

function chipTitle(status: MembersAddUiStatus): string {
  if (status === "ok") return "Найден";
  if (status === "warn") return "Найден, но может не добавиться (нет доступа)";
  if (status === "pending") return "Проверка…";
  if (status === "invalid") return "Некорректный формат";
  return "Не найден";
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function base64ToBytes(data: string): Uint8Array | null {
  try {
    const binary = atob(data);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

function guessMimeTypeByName(name: string): string {
  const n = String(name || "").toLowerCase();
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".gif")) return "image/gif";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".svg")) return "image/svg+xml";
  if (n.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

export function mountApp(root: HTMLElement) {
  const store = new Store<AppState>(createInitialState());
  const iosStandalone = isIOS() && isStandaloneDisplayMode();
  const layout = createLayout(root, { iosStandalone });

  function maybeApplyIosInputAssistant(target: EventTarget | null) {
    if (!iosStandalone) return;
    const t = target instanceof HTMLElement ? target : null;
    if (!t) return;
    const node =
      t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement
        ? t
        : (t.closest("input,textarea") as HTMLInputElement | HTMLTextAreaElement | null);
    if (!node) return;
    if (node.getAttribute("data-ios-assistant") === "off") return;
    if (node instanceof HTMLInputElement) {
      const type = String(node.type || "text").toLowerCase();
      if (["password", "file", "checkbox", "radio", "button", "submit", "reset", "hidden", "range", "color"].includes(type)) return;
    }
    applyIosInputAssistantWorkaround(node);
  }

  maybeApplyIosInputAssistant(layout.input);

  // iOS standalone (PWA): стараемся применить workaround ДО focus, т.к. WebKit решает,
  // какую "панель" показывать над клавиатурой, в момент фокуса.
  if (iosStandalone) {
    document.addEventListener("pointerdown", (e) => maybeApplyIosInputAssistant(e.target), true);
    document.addEventListener("touchstart", (e) => maybeApplyIosInputAssistant(e.target), true);
    document.addEventListener("focusin", (e) => maybeApplyIosInputAssistant(e.target), true);
  }
  let prevPinnedMessagesRef = store.get().pinnedMessages;
  store.subscribe(() => {
    const st = store.get();
    if (!st.authed || !st.selfId) {
      prevPinnedMessagesRef = st.pinnedMessages;
      return;
    }
    if (st.pinnedMessages !== prevPinnedMessagesRef) {
      prevPinnedMessagesRef = st.pinnedMessages;
      scheduleSavePinnedMessages(store);
    }
  });
  const historyRequested = new Set<string>();
  const historyDeltaRequestedAt = new Map<string, number>();
  let autoAuthAttemptedForConn = false;
  let lastConn: ConnStatus = "connecting";
  const lastReadSentAt = new Map<string, number>();
  let pwaAutoApplyTimer: number | null = null;
  let lastUserInputAt = Date.now();
  const uploadQueue: UploadState[] = [];
  let activeUpload: UploadState | null = null;
  const uploadByFileId = new Map<string, UploadState>();
  const downloadByFileId = new Map<string, DownloadState>();
  let pendingFileViewer: { fileId: string; name: string; size: number; mime: string | null } | null = null;
  let transferSeq = 0;
  let localChatMsgSeq = 0;
  const mobileSidebarMq = window.matchMedia("(max-width: 820px)");
  const coarsePointerMq = window.matchMedia("(pointer: coarse)");
  const anyFinePointerMq = window.matchMedia("(any-pointer: fine)");
  const hoverMq = window.matchMedia("(hover: hover)");
  let mobileSidebarOpen = false;
  let mobileSidebarAutoOpened = false;
  let searchDebounceTimer: number | null = null;
  let lastSearchIssued = "";
  const membersAddStatus = new Map<string, MembersAddUiStatus>();
  const membersAddHandleToId = new Map<string, string>();
  const membersAddQueryToToken = new Map<string, string>();
  const membersAddQueue: string[] = [];
  const membersIgnoreQueries = new Map<string, number>();
  let membersAddInFlight: string | null = null;
  let membersAddTimeout: number | null = null;
  const groupCreateMembers = {
    status: new Map<string, MembersAddUiStatus>(),
    handleToId: new Map<string, string>(),
    queryToToken: new Map<string, string>(),
    queue: [] as string[],
    inFlight: null as string | null,
    timeout: null as number | null,
  };
  const boardCreateMembers = {
    status: new Map<string, MembersAddUiStatus>(),
    handleToId: new Map<string, string>(),
    queryToToken: new Map<string, string>(),
    queue: [] as string[],
    inFlight: null as string | null,
    timeout: null as number | null,
  };

  window.addEventListener("pagehide", () => {
    flushDrafts(store);
    flushFileTransfers(store);
  });
  window.addEventListener("beforeunload", () => {
    flushDrafts(store);
    flushFileTransfers(store);
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
  let lastChatScrollTop = 0;
  let historyAutoBlockUntil = 0;
  let lastHistoryAutoAt = 0;
  let lastHistoryAutoKey = "";
  let suppressChatClickUntil = 0;

  const updateChatJumpVisibility = () => {
    chatJumpRaf = null;
    const btn = layout.chatJump;
    if (!btn) return;
    const key = String(layout.chatHost.getAttribute("data-chat-key") || "");
    if (!key) {
      btn.classList.add("hidden");
      return;
    }
    const host = layout.chatHost;
    const atBottom = host.scrollTop + host.clientHeight >= host.scrollHeight - 24;
    btn.classList.toggle("hidden", atBottom);
  };
  const scheduleChatJumpVisibility = () => {
    if (chatJumpRaf !== null) return;
    chatJumpRaf = window.requestAnimationFrame(updateChatJumpVisibility);
  };

  function maybeAutoLoadMoreHistory(scrollTop: number, scrollingUp: boolean) {
    const now = Date.now();
    if (now < historyAutoBlockUntil) return;

    const st = store.get();
    if (!st.authed || st.conn !== "connected") return;
    if (st.page !== "main") return;
    if (st.modal && st.modal.kind !== "context_menu") return;
    if (!st.selected) return;

    const key = conversationKey(st.selected);
    if (!key) return;
    if (!st.historyLoaded[key]) return;
    if (!st.historyHasMore[key]) return;
    if (st.historyLoading[key]) return;
    if (historyRequested.has(key)) return;
    const cursor = st.historyCursor[key];
    if (!cursor || !Number.isFinite(cursor) || cursor <= 0) return;

    // Telegram-like: если пользователь доскроллил до верха — подтянуть более ранние сообщения.
    const nearTop = scrollTop <= 48;
    if (!nearTop) return;
    // Чтобы не "заливать" историю сама по себе при ререндере/программном скролле — требуем жест вверх
    // (кроме случая когда уже ровно на 0).
    if (!scrollingUp && scrollTop > 0) return;

    if (key === lastHistoryAutoKey && now - lastHistoryAutoAt < 900) return;
    lastHistoryAutoKey = key;
    lastHistoryAutoAt = now;
    historyAutoBlockUntil = now + 200;
    requestMoreHistory();
  }

  layout.chatHost.addEventListener(
    "scroll",
    () => {
      const scrollTop = layout.chatHost.scrollTop;
      const scrollingUp = scrollTop < lastChatScrollTop;
      lastChatScrollTop = scrollTop;
      scheduleChatJumpVisibility();
      maybeAutoLoadMoreHistory(scrollTop, scrollingUp);
    },
    { passive: true }
  );
  layout.chat.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;

    if (Date.now() < suppressChatClickUntil) {
      const row = target?.closest("[data-msg-idx]");
      if (row) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }

    const historyMoreBtn = target?.closest("button[data-action='chat-history-more']") as HTMLButtonElement | null;
    if (historyMoreBtn) {
      e.preventDefault();
      requestMoreHistory();
      return;
    }

    const pinnedCloseBtn = target?.closest("button[data-action='chat-pinned-unpin']") as HTMLButtonElement | null;
    if (pinnedCloseBtn) {
      const st = store.get();
      const key = st.selected ? conversationKey(st.selected) : "";
      const ids = key ? st.pinnedMessages[key] : null;
      if (!key || !Array.isArray(ids) || !ids.length) return;
      e.preventDefault();
      const activeRaw = st.pinnedMessageActive[key];
      const activeId = typeof activeRaw === "number" && ids.includes(activeRaw) ? activeRaw : ids[0];
      const nextList = ids.filter((x) => x !== activeId);
      const nextPinned = { ...st.pinnedMessages };
      const nextActive = { ...st.pinnedMessageActive };
      if (nextList.length) {
        nextPinned[key] = nextList;
        if (nextActive[key] === activeId || !nextList.includes(nextActive[key])) nextActive[key] = nextList[0];
      } else {
        delete nextPinned[key];
        delete nextActive[key];
      }
      store.set({ pinnedMessages: nextPinned, pinnedMessageActive: nextActive, status: "Откреплено" });
      if (st.selfId) savePinnedMessagesForUser(st.selfId, nextPinned);
      return;
    }

    const pinnedJumpBtn = target?.closest("button[data-action='chat-pinned-jump']") as HTMLButtonElement | null;
    if (pinnedJumpBtn) {
      const st = store.get();
      const key = st.selected ? conversationKey(st.selected) : "";
      const ids = key ? st.pinnedMessages[key] : null;
      if (!key || !Array.isArray(ids) || !ids.length) return;
      e.preventDefault();
      const activeRaw = st.pinnedMessageActive[key];
      const activeId = typeof activeRaw === "number" && ids.includes(activeRaw) ? activeRaw : ids[0];
      const conv = st.conversations[key] || [];
      const idx = conv.findIndex((m) => typeof m.id === "number" && m.id === activeId);
      if (idx < 0) {
        showToast("Сообщение пока не загружено", { kind: "info" });
        return;
      }
      const row = layout.chat.querySelector(`[data-msg-idx="${idx}"]`) as HTMLElement | null;
      if (!row) return;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      try {
        row.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
      } catch {
        row.scrollIntoView();
      }
      row.classList.add("msg-jump");
      window.setTimeout(() => row.classList.remove("msg-jump"), 900);
      return;
    }

    const pinnedPrevBtn = target?.closest("button[data-action='chat-pinned-prev']") as HTMLButtonElement | null;
    if (pinnedPrevBtn) {
      const st = store.get();
      const key = st.selected ? conversationKey(st.selected) : "";
      const ids = key ? st.pinnedMessages[key] : null;
      if (!key || !Array.isArray(ids) || ids.length < 2) return;
      e.preventDefault();
      const activeRaw = st.pinnedMessageActive[key];
      const curIdx = typeof activeRaw === "number" ? ids.indexOf(activeRaw) : -1;
      const base = curIdx >= 0 ? curIdx : 0;
      const nextIdx = (base - 1 + ids.length) % ids.length;
      const nextId = ids[nextIdx];
      store.set((prev) => ({ ...prev, pinnedMessageActive: { ...prev.pinnedMessageActive, [key]: nextId } }));
      return;
    }

    const pinnedNextBtn = target?.closest("button[data-action='chat-pinned-next']") as HTMLButtonElement | null;
    if (pinnedNextBtn) {
      const st = store.get();
      const key = st.selected ? conversationKey(st.selected) : "";
      const ids = key ? st.pinnedMessages[key] : null;
      if (!key || !Array.isArray(ids) || ids.length < 2) return;
      e.preventDefault();
      const activeRaw = st.pinnedMessageActive[key];
      const curIdx = typeof activeRaw === "number" ? ids.indexOf(activeRaw) : -1;
      const base = curIdx >= 0 ? curIdx : 0;
      const nextIdx = (base + 1) % ids.length;
      const nextId = ids[nextIdx];
      store.set((prev) => ({ ...prev, pinnedMessageActive: { ...prev.pinnedMessageActive, [key]: nextId } }));
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

    const jumpBtn = target?.closest("button[data-action='chat-jump-bottom']") as HTMLButtonElement | null;
    if (jumpBtn) {
      e.preventDefault();
      layout.chatHost.scrollTop = layout.chatHost.scrollHeight;
      scheduleChatJumpVisibility();
      return;
    }

    const authAcceptBtn = target?.closest("button[data-action='auth-accept']") as HTMLButtonElement | null;
    if (authAcceptBtn) {
      const peer = String(authAcceptBtn.getAttribute("data-peer") || "").trim();
      if (!peer) return;
      e.preventDefault();
      closeMobileSidebar();
      acceptAuth(peer);
      return;
    }

    const authDeclineBtn = target?.closest("button[data-action='auth-decline']") as HTMLButtonElement | null;
    if (authDeclineBtn) {
      const peer = String(authDeclineBtn.getAttribute("data-peer") || "").trim();
      if (!peer) return;
      e.preventDefault();
      closeMobileSidebar();
      declineAuth(peer);
      return;
    }

    const authCancelBtn = target?.closest("button[data-action='auth-cancel']") as HTMLButtonElement | null;
    if (authCancelBtn) {
      const peer = String(authCancelBtn.getAttribute("data-peer") || "").trim();
      if (!peer) return;
      e.preventDefault();
      closeMobileSidebar();
      cancelAuth(peer);
      return;
    }

    const groupInviteAcceptBtn = target?.closest("button[data-action='group-invite-accept']") as HTMLButtonElement | null;
    if (groupInviteAcceptBtn) {
      const groupId = String(groupInviteAcceptBtn.getAttribute("data-group-id") || "").trim();
      if (!groupId) return;
      e.preventDefault();
      closeMobileSidebar();
      acceptGroupInvite(groupId);
      return;
    }

    const groupInviteDeclineBtn = target?.closest("button[data-action='group-invite-decline']") as HTMLButtonElement | null;
    if (groupInviteDeclineBtn) {
      const groupId = String(groupInviteDeclineBtn.getAttribute("data-group-id") || "").trim();
      if (!groupId) return;
      e.preventDefault();
      closeMobileSidebar();
      declineGroupInvite(groupId);
      return;
    }

    const groupJoinAcceptBtn = target?.closest("button[data-action='group-join-accept']") as HTMLButtonElement | null;
    if (groupJoinAcceptBtn) {
      const groupId = String(groupJoinAcceptBtn.getAttribute("data-group-id") || "").trim();
      const peer = String(groupJoinAcceptBtn.getAttribute("data-peer") || "").trim();
      if (!groupId || !peer) return;
      e.preventDefault();
      closeMobileSidebar();
      acceptGroupJoin(groupId, peer);
      return;
    }

    const groupJoinDeclineBtn = target?.closest("button[data-action='group-join-decline']") as HTMLButtonElement | null;
    if (groupJoinDeclineBtn) {
      const groupId = String(groupJoinDeclineBtn.getAttribute("data-group-id") || "").trim();
      const peer = String(groupJoinDeclineBtn.getAttribute("data-peer") || "").trim();
      if (!groupId || !peer) return;
      e.preventDefault();
      closeMobileSidebar();
      declineGroupJoin(groupId, peer);
      return;
    }

    const boardInviteAcceptBtn = target?.closest("button[data-action='board-invite-accept']") as HTMLButtonElement | null;
    if (boardInviteAcceptBtn) {
      const boardId = String(boardInviteAcceptBtn.getAttribute("data-board-id") || "").trim();
      if (!boardId) return;
      e.preventDefault();
      closeMobileSidebar();
      joinBoardFromInvite(boardId);
      return;
    }

    const boardInviteDeclineBtn = target?.closest("button[data-action='board-invite-decline']") as HTMLButtonElement | null;
    if (boardInviteDeclineBtn) {
      const boardId = String(boardInviteDeclineBtn.getAttribute("data-board-id") || "").trim();
      if (!boardId) return;
      e.preventDefault();
      closeMobileSidebar();
      declineBoardInvite(boardId);
      return;
    }

    const fileAcceptBtn = target?.closest("button[data-action='file-accept']") as HTMLButtonElement | null;
    if (fileAcceptBtn) {
      const fileId = String(fileAcceptBtn.getAttribute("data-file-id") || "").trim();
      if (!fileId) return;
      e.preventDefault();
      closeMobileSidebar();
      acceptFileOffer(fileId);
      return;
    }

    const fileDownloadBtn = target?.closest("button[data-action='file-download']") as HTMLButtonElement | null;
    if (fileDownloadBtn) {
      const fileId = String(fileDownloadBtn.getAttribute("data-file-id") || "").trim();
      if (!fileId) return;
      e.preventDefault();
      closeMobileSidebar();
      gateway.send({ type: "file_get", file_id: fileId });
      store.set({ status: `Запрос файла: ${fileId}` });
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
      e.preventDefault();
      closeMobileSidebar();
      if (url) {
        store.set({ modal: { kind: "file_viewer", url, name, size, mime } });
        return;
      }
      pendingFileViewer = { fileId, name, size, mime };
      gateway.send({ type: "file_get", file_id: fileId });
      store.set({ status: `Скачивание: ${name}` });
      return;
    }
  });

  layout.chat.addEventListener("input", (e) => {
    const t = e.target as HTMLElement | null;
    if (!t || !(t instanceof HTMLInputElement)) return;
    if (t.id !== "chat-search-input") return;
    lastUserInputAt = Date.now();
    setChatSearchQuery(t.value);
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

  async function copyText(text: string): Promise<boolean> {
    const value = String(text ?? "");
    if (!value) return false;
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // ignore
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.readOnly = true;
      ta.setAttribute("autocomplete", "off");
      ta.setAttribute("autocorrect", "off");
      ta.setAttribute("autocapitalize", "off");
      ta.setAttribute("spellcheck", "false");
      ta.setAttribute("inputmode", "none");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }

  let toastTimer: number | null = null;
  const toastActionHandlers = new Map<string, () => void>();

  function clearToast() {
    if (toastTimer !== null) {
      window.clearTimeout(toastTimer);
      toastTimer = null;
    }
    toastActionHandlers.clear();
    store.set({ toast: null });
  }

  function showToast(
    message: string,
    opts?: {
      kind?: "info" | "success" | "warn" | "error";
      undo?: () => void;
      actions?: Array<{ id: string; label: string; primary?: boolean; onClick: () => void }>;
      timeoutMs?: number;
    }
  ) {
    const msg = String(message || "").trim();
    if (!msg) return;
    if (toastTimer !== null) {
      window.clearTimeout(toastTimer);
      toastTimer = null;
    }
    toastActionHandlers.clear();

    const actions: Array<{ id: string; label: string; primary?: boolean }> = [];
    if (opts?.actions) {
      for (const a of opts.actions) {
        const id = String(a?.id || "").trim();
        const label = String(a?.label || "").trim();
        if (!id || !label) continue;
        if (toastActionHandlers.has(id)) continue;
        actions.push({ id, label, primary: Boolean(a.primary) });
        toastActionHandlers.set(id, () => a.onClick());
      }
    }
    if (opts?.undo) {
      actions.push({ id: "undo", label: "Отмена" });
      toastActionHandlers.set("undo", opts.undo);
    }
    actions.push({ id: "dismiss", label: "×" });
    toastActionHandlers.set("dismiss", () => {});

    const toast = { message: msg, kind: opts?.kind || "info", actions };
    store.set({ toast });

    const ms = Number(opts?.timeoutMs) > 0 ? Number(opts?.timeoutMs) : defaultToastTimeoutMs(toast);
    toastTimer = window.setTimeout(() => {
      toastTimer = null;
      toastActionHandlers.clear();
      store.set({ toast: null });
    }, ms);
  }

  layout.toastHost.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement | null)?.closest("button[data-action='toast-action'][data-toast-id]") as HTMLButtonElement | null;
    if (!btn) return;
    e.preventDefault();
    const id = String(btn.getAttribute("data-toast-id") || "");
    const handler = toastActionHandlers.get(id);
    clearToast();
    try {
      handler?.();
    } catch {
      // ignore
    }
  });

  // Android/Chromium PWA install prompt (beforeinstallprompt).
  // We show a small, non-blocking toast (similar to modern web apps).
  let deferredPwaInstall: BeforeInstallPromptEvent | null = null;
  let pwaInstallOffered = false;

  async function runPwaInstallPrompt() {
    const ev = deferredPwaInstall;
    if (!ev) return;
    deferredPwaInstall = null;
    try {
      await ev.prompt();
    } catch {
      markPwaInstallDismissed(localStorage, Date.now());
      return;
    }
    try {
      const choice = await ev.userChoice;
      if (choice?.outcome === "dismissed") {
        markPwaInstallDismissed(localStorage, Date.now());
      } else {
        clearPwaInstallDismissed(localStorage);
      }
    } catch {
      // ignore
    }
  }

  function maybeOfferPwaInstallToast() {
    if (pwaInstallOffered) return;
    const isStandalone = isStandaloneDisplayMode();
    if (!shouldOfferPwaInstall({ storage: localStorage, now: Date.now(), isStandalone })) return;
    pwaInstallOffered = true;
    showToast("Установить «Ягодку» как приложение?", {
      kind: "info",
      timeoutMs: 12000,
      actions: [
        { id: "pwa-install", label: "Установить", primary: true, onClick: () => void runPwaInstallPrompt() },
        { id: "pwa-later", label: "Позже", onClick: () => markPwaInstallDismissed(localStorage, Date.now()) },
      ],
    });
  }

  try {
    window.addEventListener("beforeinstallprompt", (e) => {
      if (!isBeforeInstallPromptEvent(e)) return;
      e.preventDefault();
      deferredPwaInstall = e;
      maybeOfferPwaInstallToast();
    });
    window.addEventListener("appinstalled", () => {
      deferredPwaInstall = null;
      clearPwaInstallDismissed(localStorage);
      showToast("Приложение установлено", { kind: "success" });
    });
  } catch {
    // ignore
  }

  function bumpAvatars(status: string) {
    store.set((prev) => ({ ...prev, avatarsRev: (prev.avatarsRev || 0) + 1, status }));
  }

  function avatarKindForTarget(kind: ContextMenuTargetKind): AvatarTargetKind | null {
    if (kind === "dm" || kind === "auth_in" || kind === "auth_out") return "dm";
    if (kind === "group") return "group";
    if (kind === "board") return "board";
    return null;
  }

  function pickAvatarFor(kind: AvatarTargetKind, id: string) {
    const targetId = String(id ?? "").trim();
    if (!targetId) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.top = "-9999px";
    document.body.appendChild(input);
    input.addEventListener(
      "change",
      () => {
        const file = input.files && input.files.length ? input.files[0] : null;
        input.remove();
        if (!file) return;
        void (async () => {
          try {
            const dataUrl = await imageFileToAvatarDataUrl(file, 128);
            storeAvatar(kind, targetId, dataUrl);
            bumpAvatars(`Аватар обновлён: ${targetId}`);
          } catch (e) {
            bumpAvatars(`Не удалось загрузить аватар: ${String((e as any)?.message || "ошибка")}`);
          }
        })();
      },
      { once: true }
    );
    input.click();
  }

  function setAvatarFromFile(kind: AvatarTargetKind, id: string, file: File | null) {
    const targetId = String(id ?? "").trim();
    if (!targetId) return;
    if (!file) return;
    void (async () => {
      try {
        const dataUrl = await imageFileToAvatarDataUrl(file, 128);
        storeAvatar(kind, targetId, dataUrl);
        bumpAvatars(`Аватар обновлён: ${targetId}`);
      } catch (e) {
        bumpAvatars(`Не удалось загрузить аватар: ${String((e as any)?.message || "ошибка")}`);
      }
    })();
  }

  function removeAvatar(kind: AvatarTargetKind, id: string) {
    const targetId = String(id ?? "").trim();
    if (!targetId) return;
    clearStoredAvatar(kind, targetId);
    bumpAvatars(`Аватар удалён: ${targetId}`);
  }

  function setMobileSidebarOpen(open: boolean) {
    const shouldOpen = Boolean(open && mobileSidebarMq.matches);
    mobileSidebarOpen = shouldOpen;
    layout.sidebar.classList.toggle("sidebar-mobile-open", shouldOpen);
    layout.navOverlay.classList.toggle("hidden", !shouldOpen);
    layout.navOverlay.setAttribute("aria-hidden", shouldOpen ? "false" : "true");
    if (shouldOpen) {
      queueMicrotask(() => {
        const closeBtn = layout.sidebar.querySelector("button[data-action='sidebar-close']") as HTMLButtonElement | null;
        closeBtn?.focus();
      });
    }
  }

  function closeMobileSidebar() {
    if (!mobileSidebarOpen) return;
    setMobileSidebarOpen(false);
  }

  function setMobileSidebarTab(tab: MobileSidebarTab) {
    const next: MobileSidebarTab = tab === "contacts" ? "contacts" : "chats";
    if (store.get().mobileSidebarTab === next) return;
    store.set({ mobileSidebarTab: next });
  }

  layout.navOverlay.addEventListener("click", () => closeMobileSidebar());

  layout.sidebar.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement | null)?.closest("button[data-action='sidebar-close']") as HTMLButtonElement | null;
    if (!btn) return;
    e.preventDefault();
    closeMobileSidebar();
  });

  layout.overlay.addEventListener("click", (e) => {
    if (store.get().modal?.kind !== "context_menu") return;
    if (e.target !== layout.overlay) return;
    e.preventDefault();
    store.set({ modal: null });
  });

  // Chips inputs живут внутри layout.chat (inline page/modal), поэтому слушаем layout.chat, а не overlay.
  layout.chat.addEventListener("input", (e) => {
    const st = store.get();
    const target = e.target as HTMLElement | null;
    if (!target) return;

    if (target.id === "members-add-entry") {
      if (st.modal?.kind !== "members_add") return;
      const input = target as HTMLInputElement;
      applyLegacyIdMask(input);
      consumeMembersAddEntry(false);
      return;
    }
    if (target.id === "group-members-entry") {
      if (st.page !== "group_create") return;
      const input = target as HTMLInputElement;
      applyLegacyIdMask(input);
      consumeCreateMembersEntry("group_create", false);
      return;
    }
    if (target.id === "board-members-entry") {
      if (st.page !== "board_create") return;
      const input = target as HTMLInputElement;
      applyLegacyIdMask(input);
      consumeCreateMembersEntry("board_create", false);
      return;
    }
  });

  layout.chat.addEventListener("paste", (e) => {
    const st = store.get();
    const target = e.target as HTMLElement | null;
    if (!target) return;

    if (target.id === "members-add-entry") {
      if (st.modal?.kind !== "members_add") return;
      // Pasting a list should сразу превращаться в чипсы (без требования "пробел в конце").
      window.setTimeout(() => consumeMembersAddEntry(true), 0);
      return;
    }
    if (target.id === "group-members-entry") {
      if (st.page !== "group_create") return;
      window.setTimeout(() => consumeCreateMembersEntry("group_create", true), 0);
      return;
    }
    if (target.id === "board-members-entry") {
      if (st.page !== "board_create") return;
      window.setTimeout(() => consumeCreateMembersEntry("board_create", true), 0);
      return;
    }
  });

  layout.chat.addEventListener(
    "keydown",
    (e) => {
      const st = store.get();
      const target = e.target as HTMLElement | null;

      const entryScope: "members_add" | CreateMembersScope | null =
        target?.id === "members-add-entry" && st.modal?.kind === "members_add"
          ? "members_add"
          : target?.id === "group-members-entry" && st.page === "group_create"
            ? "group_create"
            : target?.id === "board-members-entry" && st.page === "board_create"
              ? "board_create"
              : null;

      if (entryScope && target) {
        const entry = target as HTMLInputElement;
        const hasText = Boolean(entry.value.trim());
        if (e.key === "Enter" && !e.shiftKey) {
          if (hasText) {
            e.preventDefault();
            e.stopPropagation();
            if (entryScope === "members_add") consumeMembersAddEntry(true);
            else consumeCreateMembersEntry(entryScope, true);
          }
          return;
        }
        if (e.key === "," || e.key === " ") {
          if (hasText) {
            e.preventDefault();
            e.stopPropagation();
            if (entryScope === "members_add") consumeMembersAddEntry(true);
            else consumeCreateMembersEntry(entryScope, true);
          }
          return;
        }
        if (e.key === "Backspace" && !entry.value) {
          const tokens = entryScope === "members_add" ? membersAddTokens() : createMembersTokens(entryScope);
          const last = tokens.length ? tokens[tokens.length - 1] : "";
          if (last) {
            e.preventDefault();
            e.stopPropagation();
            if (entryScope === "members_add") membersAddEditToken(last);
            else createMembersEditToken(entryScope, last);
          }
          return;
        }
      }

      const chip = target?.closest("[data-action='chip-edit'][data-token]") as HTMLElement | null;
      if (chip && (e.key === "Enter" || e.key === " ")) {
        const token = String(chip.getAttribute("data-token") || "").trim();
        if (!token) return;

        const scope: "members_add" | CreateMembersScope | null =
          chip.closest("#members-add-field") && st.modal?.kind === "members_add"
            ? "members_add"
            : chip.closest("#group-members-field") && st.page === "group_create"
              ? "group_create"
              : chip.closest("#board-members-field") && st.page === "board_create"
                ? "board_create"
                : null;
        if (!scope) return;

        e.preventDefault();
        e.stopPropagation();
        if (scope === "members_add") membersAddEditToken(token);
        else createMembersEditToken(scope, token);
      }
    },
    true
  );

  layout.chat.addEventListener("click", (e) => {
    const st = store.get();
    const target = e.target as HTMLElement | null;
    if (!target) return;

    const scope: "members_add" | CreateMembersScope | null =
      target.closest("#members-add-field") && st.modal?.kind === "members_add"
        ? "members_add"
        : target.closest("#group-members-field") && st.page === "group_create"
          ? "group_create"
          : target.closest("#board-members-field") && st.page === "board_create"
            ? "board_create"
            : null;
    if (!scope) return;

    const removeBtn = target.closest("button[data-action='chip-remove'][data-token]") as HTMLButtonElement | null;
    if (removeBtn) {
      const token = String(removeBtn.getAttribute("data-token") || "").trim();
      if (token) {
        e.preventDefault();
        if (scope === "members_add") membersAddRemoveToken(token);
        else createMembersRemoveToken(scope, token);
      }
      return;
    }

    const chip = target.closest("[data-action='chip-edit'][data-token]") as HTMLElement | null;
    if (chip) {
      const token = String(chip.getAttribute("data-token") || "").trim();
      if (token) {
        e.preventDefault();
        if (scope === "members_add") membersAddEditToken(token);
        else createMembersEditToken(scope, token);
      }
      return;
    }

    const field = target.closest(".chips-field");
    if (!field) return;
    const dom = scope === "members_add" ? membersAddDom() : createMembersDom(scope);
    dom?.entry.focus();
  });

  layout.headerLeft.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement | null)?.closest("button[data-action]") as HTMLButtonElement | null;
    if (!btn) return;
    const action = String(btn.dataset.action || "");
    if (action === "chat-search-open") {
      e.preventDefault();
      openChatSearch();
      return;
    }
    if (action === "chat-search-close") {
      e.preventDefault();
      closeChatSearch();
      return;
    }
    if (action === "auth-logout") {
      e.preventDefault();
      logout();
      return;
    }
    if (action === "auth-open") {
      e.preventDefault();
      store.set((prev) => ({
        ...prev,
        authMode: prev.authRememberedId ? "login" : "register",
        modal: { kind: "auth" },
      }));
      return;
    }
    if (action !== "sidebar-toggle") return;
    e.preventDefault();
    const st = store.get();
    if (!mobileSidebarMq.matches) return;
    if (st.modal) return;
    setMobileSidebarOpen(!mobileSidebarOpen);
  });

  const onMobileSidebarMqChange = () => {
    if (!mobileSidebarMq.matches) {
      closeMobileSidebar();
      mobileSidebarAutoOpened = false;
    }
  };
  if (typeof mobileSidebarMq.addEventListener === "function") {
    mobileSidebarMq.addEventListener("change", onMobileSidebarMqChange);
  } else {
    const legacy = mobileSidebarMq as MediaQueryList & { addListener?: (cb: (ev: MediaQueryListEvent) => void) => void };
    legacy.addListener?.(onMobileSidebarMqChange);
  }

  async function initSkins() {
    const skins = await fetchAvailableSkins();
    store.set({ skins });
    const current = normalizeSkinId(store.get().skin);
    if (!skins.some((s) => s.id === current)) {
      store.set({ skin: "default" });
      storeSkinId("default");
      applySkin("default");
    }
  }

  function setSkin(id: string) {
    const norm = normalizeSkinId(id);
    const skins = store.get().skins || [];
    const exists = skins.some((s) => s.id === norm);
    const finalId = exists ? norm : "default";
    const title = skins.find((s) => s.id === finalId)?.title ?? finalId;
    store.set({ skin: finalId, status: `Скин: ${title}` });
    storeSkinId(finalId);
    applySkin(finalId);
  }

  const gateway = new GatewayClient(
    getGatewayUrl(),
    (msg) => {
      const t = String(msg?.type ?? "");
      if (t === "search_result") {
        const q = String(msg?.query ?? "").trim();
        const exp = q ? membersIgnoreQueries.get(q) : null;
        if (q && exp && exp > Date.now()) {
          // Validation queries for chips inputs: keep it silent (no status updates).
          handleMembersAddSearchResult(msg);
          handleGroupCreateMembersSearchResult(msg);
          handleBoardCreateMembersSearchResult(msg);
          return;
        }
        if (q && exp) membersIgnoreQueries.delete(q);
        if (handleMembersAddSearchResult(msg)) return;
        if (handleGroupCreateMembersSearchResult(msg)) return;
        if (handleBoardCreateMembersSearchResult(msg)) return;
      }
      if (t === "history_result") {
        const key = msg?.room ? roomKey(String(msg.room)) : msg?.peer ? dmKey(String(msg.peer)) : "";
        if (key) historyRequested.delete(key);
      }
      if (handleFileMessage(msg)) return;
      handleServerMessage(msg, store.get(), gateway, (p) => store.set(p));
      if (t === "message_delivered" || t === "message_queued" || t === "message_blocked" || t === "error" || t === "history_result") {
        scheduleSaveOutbox(store);
      }

      if (t === "auth_ok" || t === "register_ok") {
        const st = store.get();
        if (st.selected) requestHistory(st.selected, { force: true, deltaLimit: 2000 });
        drainOutbox();
      }
    },
    (conn, detail) => {
      const base =
        conn === "connected"
          ? "Связь с сервером установлена"
          : conn === "connecting"
            ? "Подключение…"
            : "Нет соединения";
      store.set({ conn, status: detail ? `${base}: ${detail}` : base });

      const prevConn = lastConn;
      lastConn = conn;

	      if (conn !== "connected") {
	        autoAuthAttemptedForConn = false;
	        historyRequested.clear();
	        historyDeltaRequestedAt.clear();
	        store.set((prev) => {
	          if (!prev.selfId) return prev.authed ? { ...prev, authed: false } : prev;
	          let outboxChanged = false;
	          let outbox = prev.outbox;
	          for (const [k, list] of Object.entries(prev.outbox || {})) {
	            const arr = Array.isArray(list) ? list : [];
	            if (!arr.length) continue;
	            const hasSending = arr.some((e) => e && typeof e === "object" && (e as any).status === "sending");
	            if (!hasSending) continue;
	            outboxChanged = true;
	            outbox = {
	              ...outbox,
	              [k]: arr.map((e) => (e && typeof e === "object" ? { ...(e as any), status: "queued" as const } : e)),
	            };
	          }

	          let conversations = prev.conversations;
	          let convChanged = false;
	          for (const [k, list] of Object.entries(outbox)) {
	            const arr = Array.isArray(list) ? list : [];
	            if (!arr.length) continue;
	            const lids = new Set(arr.map((e) => String(e?.localId || "").trim()).filter(Boolean));
	            const conv = conversations[k];
	            if (!Array.isArray(conv) || !conv.length) continue;
	            const idxs: number[] = [];
	            for (let i = 0; i < conv.length; i += 1) {
	              const m = conv[i];
	              if (m.kind !== "out") continue;
	              if (m.id !== undefined && m.id !== null) continue;
	              if (typeof m.localId !== "string" || !lids.has(m.localId)) continue;
	              if (m.status === "queued") continue;
	              idxs.push(i);
	            }
	            if (!idxs.length) continue;
	            convChanged = true;
	            const nextConv = [...conv];
	            for (const i of idxs) nextConv[i] = { ...nextConv[i], status: "queued" as const };
	            conversations = { ...conversations, [k]: nextConv };
	          }

	          const next = prev.authed ? { ...prev, authed: false } : prev;
	          if (!outboxChanged && !convChanged) return next;
	          return { ...next, outbox, conversations };
	        });
	        scheduleSaveOutbox(store);
	        return;
	      }

      // New socket: even if UI thought we were authed, we must re-auth on reconnect.
      if (prevConn !== "connected") {
        store.set((prev) => (prev.authed ? { ...prev, authed: false } : prev));
      }

      const st = store.get();
      if (st.authed) return;
      const token = getStoredSessionToken();
      if (token && isSessionAutoAuthBlocked()) {
        store.set((prev) => ({
          ...prev,
          authMode: prev.authRememberedId ? "login" : "register",
          status: "Сессия активна в другом окне. Нажмите «Войти», чтобы продолжить здесь.",
        }));
        return;
      }
      if (token && !autoAuthAttemptedForConn) {
        autoAuthAttemptedForConn = true;
        store.set({ status: "Авторизация…" });
        gateway.send({ type: "auth", session: token });
        return;
      }

      if (token && autoAuthAttemptedForConn) {
        // Авто-вход уже отправлен; ждём ответ (или сработает таймер).
        return;
      }

      // No stored session: не открываем auth-модалку автоматически (без мигания).
      store.set((prev) => ({
        ...prev,
        authMode: prev.authRememberedId ? "login" : "register",
        status: prev.authRememberedId
          ? "Связь установлена. Нажмите «Войти», чтобы продолжить."
          : "Связь установлена. Нажмите «Войти», чтобы войти или зарегистрироваться.",
      }));
    }
  );

  function setPage(page: PageKind) {
    const prevPage = store.get().page;
    if (prevPage === "group_create" && page !== "group_create") resetCreateMembers("group_create");
    if (prevPage === "board_create" && page !== "board_create") resetCreateMembers("board_create");
    if (page !== "main") closeEmojiPopover();
    closeMobileSidebar();
    store.set((prev) => ({
      ...prev,
      page,
      ...(page !== "user" ? { userViewId: null } : {}),
      ...(page !== "main" ? { mobileSidebarTab: "contacts" as MobileSidebarTab } : {}),
      ...(page !== "main" ? { chatSearchOpen: false, chatSearchQuery: "", chatSearchHits: [], chatSearchPos: 0 } : {}),
    }));
  }

  function openUserPage(id: string) {
    const uid = String(id || "").trim();
    if (!uid) return;
    setPage("user");
    store.set({ userViewId: uid, status: `Профиль: ${uid}` });
    const st = store.get();
    if (st.authed && st.conn === "connected") {
      gateway.send({ type: "profile_get", id: uid });
    }
  }

  layout.footer.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement | null)?.closest("button[data-action]") as HTMLButtonElement | null;
    if (!btn) return;
    const action = String(btn.dataset.action || "");
    if (action === "nav-main") {
      setPage("main");
    } else if (action === "nav-search") {
      setPage("search");
    } else if (action === "nav-profile") {
      setPage("profile");
    } else if (action === "nav-files") {
      setPage("files");
    }
  });

  function requestHistory(t: TargetRef, opts?: { force?: boolean; deltaLimit?: number }) {
    const st = store.get();
    if (!st.authed) return;
    if (st.conn !== "connected") return;
    const key = conversationKey(t);
    if (!key) return;
    if (historyRequested.has(key)) return;

    // 1) Первый заход в чат: забираем "хвост" (последние сообщения), чтобы быстро заполнить экран.
    if (!st.historyLoaded[key]) {
      historyRequested.add(key);
      store.set((prev) => ({ ...prev, historyLoading: { ...prev.historyLoading, [key]: true } }));
      if (t.kind === "dm") {
        gateway.send({ type: "history", peer: t.id, before_id: 0, limit: 200 });
      } else {
        gateway.send({ type: "history", room: t.id, before_id: 0, limit: 200 });
      }
      return;
    }

    // 2) Уже загружено: тихо синхронизируем "дельту" после reconnect/долгой паузы.
    const since = newestServerMessageId(st.conversations[key] ?? []);
    const now = Date.now();
    const last = historyDeltaRequestedAt.get(key) ?? 0;
    if (!opts?.force && now - last < 1500) return;
    historyDeltaRequestedAt.set(key, now);
    historyRequested.add(key);

    // Если в локальном кэше нет ни одного серверного id (чат был пуст), "дельта" не применима —
    // забираем хвост ещё раз (это и поймает новые сообщения).
    if (!since) {
      if (t.kind === "dm") {
        gateway.send({ type: "history", peer: t.id, before_id: 0, limit: 200 });
      } else {
        gateway.send({ type: "history", room: t.id, before_id: 0, limit: 200 });
      }
      return;
    }

    const rawLimit = Number(opts?.deltaLimit ?? 200);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(2000, Math.floor(rawLimit))) : 200;
    if (t.kind === "dm") {
      gateway.send({ type: "history", peer: t.id, since_id: since, limit });
    } else {
      gateway.send({ type: "history", room: t.id, since_id: since, limit });
    }
  }

  let historyPrependAnchor: { key: string; scrollHeight: number; scrollTop: number } | null = null;

  function requestMoreHistory() {
    const st = store.get();
    if (!st.authed) return;
    if (st.conn !== "connected") {
      store.set({ status: "Нет соединения" });
      return;
    }
    if (!st.selected) return;
    const key = conversationKey(st.selected);
    if (!st.historyLoaded[key]) {
      requestHistory(st.selected);
      return;
    }
    if (historyRequested.has(key)) return;
    const hasMore = Boolean(st.historyHasMore[key]);
    if (!hasMore) return;
    const before = st.historyCursor[key];
    if (!before || !Number.isFinite(before) || before <= 0) return;

    historyPrependAnchor = { key, scrollHeight: layout.chatHost.scrollHeight, scrollTop: layout.chatHost.scrollTop };
    historyRequested.add(key);
    store.set((prev) => ({ ...prev, historyLoading: { ...prev.historyLoading, [key]: true } }));
    if (st.selected.kind === "dm") {
      gateway.send({ type: "history", peer: st.selected.id, before_id: before, limit: 200 });
    } else {
      gateway.send({ type: "history", room: st.selected.id, before_id: before, limit: 200 });
    }
  }

  function maybeSendMessageRead(peerId: string, upToId?: number | null) {
    const st = store.get();
    if (st.conn !== "connected") return;
    if (!st.authed) return;
    const peer = String(peerId || "").trim();
    if (!peer) return;
    const unread = st.friends.find((f) => f.id === peer)?.unread ?? 0;
    const hasUpTo = typeof upToId === "number" && Number.isFinite(upToId);
    if (unread <= 0 && !hasUpTo) return;

    const now = Date.now();
    const last = lastReadSentAt.get(peer) ?? 0;
    if (now - last < 300) return;
    lastReadSentAt.set(peer, now);

    gateway.send({ type: "message_read", peer, ...(hasUpTo ? { up_to_id: upToId } : {}) });
    if (unread > 0) {
      store.set((prev) => ({
        ...prev,
        friends: prev.friends.map((f) => (f.id === peer ? { ...f, unread: 0 } : f)),
      }));
    }
  }

  function selectTarget(t: TargetRef) {
    closeEmojiPopover();
    const composerHadFocus = document.activeElement === layout.input;
    closeMobileSidebar();
    const prev = store.get();
    if (prev.page === "main" && prev.selected && prev.selected.kind === t.kind && prev.selected.id === t.id) {
      if (
        shouldAutofocusComposer({
          coarsePointer: coarsePointerMq.matches,
          composerHadFocus,
          anyFinePointer: anyFinePointerMq.matches,
          hover: hoverMq.matches,
        })
      ) {
        scheduleFocusComposer();
      }
      return;
    }
    const prevKey = prev.selected ? conversationKey(prev.selected) : "";
    const nextKey = conversationKey(t);
    const leavingEdit = Boolean(prev.editing && prevKey && prev.editing.key === prevKey && prevKey !== nextKey);
    const prevText = leavingEdit ? prev.editing?.prevDraft || "" : layout.input.value || "";
    const nextDrafts = prevKey ? updateDraftMap(prev.drafts, prevKey, prevText) : prev.drafts;
    const nextText = nextDrafts[nextKey] ?? "";
    store.set((p) => ({
      ...p,
      selected: t,
      page: "main",
      drafts: nextDrafts,
      input: nextText,
      editing: leavingEdit ? null : p.editing,
      chatSearchOpen: false,
      chatSearchQuery: "",
      chatSearchHits: [],
      chatSearchPos: 0,
    }));
    try {
      if (layout.input.value !== nextText) layout.input.value = nextText;
      autosizeInput(layout.input);
    } catch {
      // ignore
    }
    scheduleSaveDrafts(store);
    requestHistory(t);
    if (t.kind === "dm") {
      maybeSendMessageRead(t.id);
    }
    // UX:
    // - Desktop (pointer: fine): после выбора контакта/чата сразу фокусируем ввод, чтобы можно было печатать без лишнего клика.
    // - Touch (pointer: coarse): тоже ставим фокус, но с небольшой задержкой, чтобы закрытие drawer/overlay не конфликтовало с клавиатурой.
    if (
      shouldAutofocusComposer({
        coarsePointer: coarsePointerMq.matches,
        composerHadFocus,
        anyFinePointer: anyFinePointerMq.matches,
        hover: hoverMq.matches,
      })
    ) {
      const pureTouch = coarsePointerMq.matches && !anyFinePointerMq.matches && !hoverMq.matches;
      if (pureTouch && !composerHadFocus) {
        window.setTimeout(() => scheduleFocusComposer(), 90);
      } else {
        scheduleFocusComposer();
      }
    }
  }

  function searchableMessagesForSelected(st: AppState) {
    if (!st.selected) return [];
    const key = conversationKey(st.selected);
    const msgs = st.conversations[key] || [];
    return msgs.map((m) => ({
      text: m.text,
      attachmentName: m.attachment?.kind === "file" ? m.attachment.name : null,
    }));
  }

  function scrollToChatMsgIdx(idx: number) {
    const msgIdx = Number(idx);
    if (!Number.isFinite(msgIdx) || msgIdx < 0) return;
    const el = layout.chat.querySelector(`[data-msg-idx='${msgIdx}']`) as HTMLElement | null;
    if (!el) return;
    try {
      el.scrollIntoView({ block: "center" });
    } catch {
      // ignore
    }
  }

  function focusChatSearch(selectAll = false) {
    const input = layout.chat.querySelector("#chat-search-input") as HTMLInputElement | null;
    if (!input) return;
    try {
      input.focus({ preventScroll: true });
    } catch {
      try {
        input.focus();
      } catch {
        // ignore
      }
    }
    if (selectAll) {
      try {
        input.select();
      } catch {
        // ignore
      }
    }
  }

  function closeChatSearch() {
    store.set((prev) => ({ ...prev, chatSearchOpen: false, chatSearchQuery: "", chatSearchHits: [], chatSearchPos: 0 }));
    queueMicrotask(() => scheduleFocusComposer());
  }

  function openChatSearch() {
    const st = store.get();
    if (st.page !== "main") return;
    if (st.modal) return;
    if (!st.selected) return;
    store.set((prev) => ({ ...prev, chatSearchOpen: true }));
    queueMicrotask(() => focusChatSearch(true));
  }

  function setChatSearchQuery(query: string) {
    const q = String(query ?? "");
    store.set((prev) => {
      if (!prev.selected) return { ...prev, chatSearchQuery: q, chatSearchHits: [], chatSearchPos: 0 };
      const hits = computeChatSearchHits(searchableMessagesForSelected(prev), q);
      const pos = hits.length ? 0 : 0;
      return { ...prev, chatSearchQuery: q, chatSearchHits: hits, chatSearchPos: pos };
    });
    const st = store.get();
    if (st.chatSearchHits.length) scrollToChatMsgIdx(st.chatSearchHits[st.chatSearchPos] ?? st.chatSearchHits[0]);
  }

  function stepChatSearch(dir: 1 | -1) {
    const st = store.get();
    if (!st.chatSearchOpen) return;
    if (!st.chatSearchHits.length) return;
    const nextPos = stepChatSearchPos(st.chatSearchHits, st.chatSearchPos, dir);
    store.set({ chatSearchPos: nextPos });
    const idx = store.get().chatSearchHits[nextPos];
    if (typeof idx === "number") scrollToChatMsgIdx(idx);
    focusChatSearch(false);
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
    closeMobileSidebar();

    const jumpToMessage = (findIdx: (msgs: any[]) => number) => {
      const attempt = () => {
        const st = store.get();
        if (!st.selected) return;
        const key = conversationKey(st.selected);
        const msgs = (st.conversations && (st.conversations as any)[key]) || [];
        const idx = findIdx(Array.isArray(msgs) ? msgs : []);
        if (idx < 0) return;
        scrollToChatMsgIdx(idx);
      };
      queueMicrotask(attempt);
      window.setTimeout(attempt, 0);
      window.setTimeout(attempt, 120);
    };

    const jumpToLocalId = (localId: string) =>
      jumpToMessage((msgs) => msgs.findIndex((m: any) => String(m?.localId ?? "") === localId));
    const jumpToFileId = (fileId: string) =>
      jumpToMessage((msgs) =>
        msgs.findIndex((m: any) => m?.attachment?.kind === "file" && String(m?.attachment?.fileId ?? "") === fileId)
      );

    // Вместо блокирующей action-модалки показываем действия прямо в переписке (как системное сообщение).
    if (payload.kind === "auth_in" || payload.kind === "auth_out") {
      setPage("main");
      selectTarget({ kind: "dm", id: payload.peer });
      jumpToLocalId(`action:${payload.kind}:${payload.peer}`);
      return;
    }
    if (payload.kind === "group_invite") {
      setPage("main");
      selectTarget({ kind: "dm", id: payload.from });
      jumpToLocalId(`action:group_invite:${payload.groupId}:${payload.from}`);
      return;
    }
    if (payload.kind === "group_join_request") {
      setPage("main");
      selectTarget({ kind: "dm", id: payload.from });
      jumpToLocalId(`action:group_join_request:${payload.groupId}:${payload.from}`);
      return;
    }
    if (payload.kind === "board_invite") {
      setPage("main");
      selectTarget({ kind: "dm", id: payload.from });
      jumpToLocalId(`action:board_invite:${payload.boardId}:${payload.from}`);
      return;
    }
    if (payload.kind === "file_offer") {
      setPage("main");
      const room = String(payload.room ?? "").trim();
      if (room) {
        const kind = room.startsWith("grp-") ? "group" : "board";
        selectTarget({ kind, id: room });
      } else {
        selectTarget({ kind: "dm", id: payload.from });
      }
      jumpToFileId(payload.fileId);
      return;
    }

    // Fallback (не должно происходить, но безопаснее оставить).
    store.set({ modal: { kind: "action", payload } });
  }

  function openGroupCreateModal() {
    closeMobileSidebar();
    const st = store.get();
    if (!st.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    resetCreateMembers("group_create");
    store.set({ page: "group_create", groupCreateMessage: "" });
  }

  function openBoardCreateModal() {
    closeMobileSidebar();
    const st = store.get();
    if (!st.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    resetCreateMembers("board_create");
    store.set({ page: "board_create", boardCreateMessage: "" });
  }

  function openMembersAddModal(targetKind: "group" | "board", targetId: string) {
    const st = store.get();
    if (!st.authed) return;
    closeMobileSidebar();
    const entry =
      targetKind === "group" ? st.groups.find((g) => g.id === targetId) : st.boards.find((b) => b.id === targetId);
    const name = String(entry?.name || targetId);
    const title = targetKind === "group" ? `Чат: ${name}` : `Доска: ${name}`;
    store.set({ modal: { kind: "members_add", targetKind, targetId, title } });
  }

  function openMembersRemoveModal(targetKind: "group" | "board", targetId: string) {
    const st = store.get();
    if (!st.authed) return;
    closeMobileSidebar();
    const entry =
      targetKind === "group" ? st.groups.find((g) => g.id === targetId) : st.boards.find((b) => b.id === targetId);
    const name = String(entry?.name || targetId);
    const title = targetKind === "group" ? `Чат: ${name}` : `Доска: ${name}`;
    store.set({ modal: { kind: "members_remove", targetKind, targetId, title } });
  }

  function openRenameModal(targetKind: "group" | "board", targetId: string) {
    const st = store.get();
    if (!st.authed) return;
    closeMobileSidebar();
    const entry =
      targetKind === "group" ? st.groups.find((g) => g.id === targetId) : st.boards.find((b) => b.id === targetId);
    const name = String(entry?.name || targetId);
    const title = targetKind === "group" ? `Чат: ${name}` : `Доска: ${name}`;
    const currentName = entry?.name ? String(entry.name) : null;
    store.set({ modal: { kind: "rename", targetKind, targetId, title, currentName } });
  }

  function openConfirmModal(payload: {
    title: string;
    message: string;
    action: ConfirmAction;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  }) {
    closeMobileSidebar();
    store.set({ modal: { kind: "confirm", ...payload } });
  }

  function clearMembersAddLookups() {
    membersAddQueryToToken.clear();
    membersAddQueue.length = 0;
    membersAddInFlight = null;
    if (membersAddTimeout !== null) {
      window.clearTimeout(membersAddTimeout);
      membersAddTimeout = null;
    }
  }

  function createMembersState(scope: CreateMembersScope) {
    return scope === "group_create" ? groupCreateMembers : boardCreateMembers;
  }

  function resetCreateMembers(scope: CreateMembersScope) {
    const st = createMembersState(scope);
    st.status.clear();
    st.handleToId.clear();
    st.queryToToken.clear();
    st.queue.length = 0;
    st.inFlight = null;
    if (st.timeout !== null) {
      window.clearTimeout(st.timeout);
      st.timeout = null;
    }
  }

  function createMembersTokens(scope: CreateMembersScope): string[] {
    const dom = createMembersDom(scope);
    if (!dom) return [];
    return Array.from(new Set(parseMembersInput(dom.hidden.value)));
  }

  function createMembersSetTokens(scope: CreateMembersScope, tokens: string[]) {
    const dom = createMembersDom(scope);
    if (!dom) return;
    dom.hidden.value = tokens.join(" ");
  }

  function renderCreateMembersChips(scope: CreateMembersScope) {
    const dom = createMembersDom(scope);
    if (!dom) return;
    const st = createMembersState(scope);

    const tokens = createMembersTokens(scope);
    const canonical = tokens.join(" ");
    if (dom.hidden.value !== canonical) dom.hidden.value = canonical;

    const chips = tokens.map((token) => {
      const status = st.status.get(token) || (normalizeMemberToken(token)?.kind === "invalid" ? "invalid" : "pending");
      const cls = "chip";
      return el(
        "span",
        { class: cls, role: "button", tabindex: "0", "data-action": "chip-edit", "data-token": token, "data-status": status, title: chipTitle(status) },
        [
          token,
          el("button", { class: "chip-remove", type: "button", "data-action": "chip-remove", "data-token": token, "aria-label": `Удалить: ${token}` }, [
            "×",
          ]),
        ]
      );
    });

    dom.chips.replaceChildren(...chips);
  }

  function membersAddTokens(): string[] {
    const dom = membersAddDom();
    if (!dom) return [];
    return Array.from(new Set(parseMembersInput(dom.hidden.value)));
  }

  function membersAddSetTokens(tokens: string[]) {
    const dom = membersAddDom();
    if (!dom) return;
    dom.hidden.value = tokens.join(" ");
  }

  function renderMembersAddChips() {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "members_add") return;
    const dom = membersAddDom();
    if (!dom) return;

    const tokens = membersAddTokens();
    // Keep hidden value canonical for submit.
    const canonical = tokens.join(" ");
    if (dom.hidden.value !== canonical) dom.hidden.value = canonical;

    const chips = tokens.map((token) => {
      const status = membersAddStatus.get(token) || (normalizeMemberToken(token)?.kind === "invalid" ? "invalid" : "pending");
      const cls = "chip";
      return el(
        "span",
        { class: cls, role: "button", tabindex: "0", "data-action": "chip-edit", "data-token": token, "data-status": status, title: chipTitle(status) },
        [
          token,
          el("button", { class: "chip-remove", type: "button", "data-action": "chip-remove", "data-token": token, "aria-label": `Удалить: ${token}` }, [
            "×",
          ]),
        ]
      );
    });

    dom.chips.replaceChildren(...chips);
  }

  function removeQueryFromQueue(query: string) {
    const idx = membersAddQueue.indexOf(query);
    if (idx >= 0) membersAddQueue.splice(idx, 1);
  }

  function removeTokenFromLookups(token: string) {
    for (const [q, t] of membersAddQueryToToken.entries()) {
      if (t !== token) continue;
      membersAddQueryToToken.delete(q);
      removeQueryFromQueue(q);
      if (membersAddInFlight === q) {
        membersAddInFlight = null;
        if (membersAddTimeout !== null) {
          window.clearTimeout(membersAddTimeout);
          membersAddTimeout = null;
        }
      }
    }
  }

  function membersAddRemoveToken(token: string) {
    const dom = membersAddDom();
    if (!dom) return;
    const tokens = membersAddTokens().filter((t) => t !== token);
    membersAddSetTokens(tokens);
    membersAddStatus.delete(token);
    membersAddHandleToId.delete(token);
    removeTokenFromLookups(token);
    renderMembersAddChips();
    membersAddDrainLookups();
  }

  function membersAddEditToken(token: string) {
    const dom = membersAddDom();
    if (!dom) return;
    membersAddRemoveToken(token);
    dom.entry.value = token;
    try {
      dom.entry.focus();
      dom.entry.setSelectionRange(token.length, token.length);
    } catch {
      // ignore
    }
    applyLegacyIdMask(dom.entry);
  }

  function membersAddAddNormalizedTokens(values: string[], targetKind: "group" | "board") {
    if (!values.length) return;
    const dom = membersAddDom();
    if (!dom) return;
    const current = new Set(membersAddTokens());
    for (const raw of values) {
      const norm = normalizeMemberToken(raw);
      if (!norm) continue;
      const token = norm.value;
      if (current.has(token)) continue;
      current.add(token);
      if (norm.kind === "invalid") {
        membersAddStatus.set(token, "invalid");
        continue;
      }
      if (!membersAddStatus.has(token)) membersAddStatus.set(token, "pending");
      if (norm.query) {
        membersAddQueryToToken.set(norm.query, token);
        if (!membersAddQueue.includes(norm.query) && membersAddInFlight !== norm.query) {
          membersAddQueue.push(norm.query);
        }
      }
    }
    membersAddSetTokens(Array.from(current));
    renderMembersAddChips();
    membersAddDrainLookups();
  }

  function consumeMembersAddEntry(forceAll: boolean) {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "members_add") return;
    const dom = membersAddDom();
    if (!dom) return;

    const value = dom.entry.value;
    if (!value.trim()) return;

    const hasTrailingSep = /[\s,]$/.test(value);
    const parts = value.split(/[\s,]+/);
    let tail = "";
    let toCommit = parts;
    if (!forceAll && !hasTrailingSep) {
      tail = parts.pop() || "";
      toCommit = parts;
    }
    const tokens = toCommit.map((t) => t.trim()).filter(Boolean);
    if (tokens.length) membersAddAddNormalizedTokens(tokens, modal.targetKind);

    dom.entry.value = forceAll || hasTrailingSep ? "" : tail;
    applyLegacyIdMask(dom.entry);
  }

  function membersAddDrainLookups() {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "members_add") return;
    if (!st.authed || st.conn !== "connected") return;
    if (membersAddInFlight) return;
    const next = membersAddQueue.shift() || null;
    if (!next) return;
    membersAddInFlight = next;
    membersIgnoreQueries.set(next, Date.now() + 10_000);
    gateway.send({ type: "search", query: next });
    if (membersAddTimeout !== null) window.clearTimeout(membersAddTimeout);
    membersAddTimeout = window.setTimeout(() => {
      const q = membersAddInFlight;
      if (q !== next) return;
      membersAddInFlight = null;
      membersAddTimeout = null;
      membersIgnoreQueries.delete(next);
      const token = membersAddQueryToToken.get(next);
      if (token) {
        membersAddStatus.set(token, "bad");
        membersAddHandleToId.delete(token);
      }
      membersAddQueryToToken.delete(next);
      renderMembersAddChips();
      membersAddDrainLookups();
    }, 2500);
  }

  function handleMembersAddSearchResult(msg: any): boolean {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "members_add") return false;
    const q = String(msg?.query ?? "").trim();
    if (!q) return false;
    const token = membersAddQueryToToken.get(q);
    if (!token) return false;
    membersIgnoreQueries.delete(q);

    const raw = Array.isArray(msg?.results) ? msg.results : [];
    const results: SearchResultEntry[] = raw
      .map((r: any) => ({
        id: String(r?.id ?? ""),
        online: r?.online === undefined ? undefined : Boolean(r.online),
        friend: r?.friend === undefined ? undefined : Boolean(r.friend),
        group: r?.group === undefined ? undefined : Boolean(r.group),
        board: r?.board === undefined ? undefined : Boolean(r.board),
      }))
      .filter((r: SearchResultEntry) => r.id);

    const norm = normalizeMemberToken(token) || { kind: "invalid" as const, value: token, query: null };
    const res = statusForSearchResult(norm, results, modal.targetKind);
    membersAddStatus.set(token, res.status);
    if (norm.kind === "handle") {
      if (res.resolvedId) membersAddHandleToId.set(token, res.resolvedId);
      else membersAddHandleToId.delete(token);
    }

    membersAddQueryToToken.delete(q);
    if (membersAddInFlight === q) {
      membersAddInFlight = null;
      if (membersAddTimeout !== null) {
        window.clearTimeout(membersAddTimeout);
        membersAddTimeout = null;
      }
    }

    renderMembersAddChips();
    membersAddDrainLookups();
    return true;
  }

  function removeCreateQueryFromQueue(scope: CreateMembersScope, query: string) {
    const st = createMembersState(scope);
    const idx = st.queue.indexOf(query);
    if (idx >= 0) st.queue.splice(idx, 1);
  }

  function removeCreateTokenFromLookups(scope: CreateMembersScope, token: string) {
    const st = createMembersState(scope);
    for (const [q, t] of st.queryToToken.entries()) {
      if (t !== token) continue;
      st.queryToToken.delete(q);
      removeCreateQueryFromQueue(scope, q);
      if (st.inFlight === q) {
        st.inFlight = null;
        if (st.timeout !== null) {
          window.clearTimeout(st.timeout);
          st.timeout = null;
        }
      }
    }
  }

  function createMembersRemoveToken(scope: CreateMembersScope, token: string) {
    const dom = createMembersDom(scope);
    if (!dom) return;
    const st = createMembersState(scope);
    const tokens = createMembersTokens(scope).filter((t) => t !== token);
    createMembersSetTokens(scope, tokens);
    st.status.delete(token);
    st.handleToId.delete(token);
    removeCreateTokenFromLookups(scope, token);
    renderCreateMembersChips(scope);
    createMembersDrainLookups(scope);
  }

  function createMembersEditToken(scope: CreateMembersScope, token: string) {
    const dom = createMembersDom(scope);
    if (!dom) return;
    createMembersRemoveToken(scope, token);
    dom.entry.value = token;
    try {
      dom.entry.focus();
      dom.entry.setSelectionRange(token.length, token.length);
    } catch {
      // ignore
    }
    applyLegacyIdMask(dom.entry);
  }

  function createMembersAddNormalizedTokens(scope: CreateMembersScope, values: string[]) {
    if (!values.length) return;
    const dom = createMembersDom(scope);
    if (!dom) return;
    const st = createMembersState(scope);
    const current = new Set(createMembersTokens(scope));
    for (const raw of values) {
      const norm = normalizeMemberToken(raw);
      if (!norm) continue;
      const token = norm.value;
      if (current.has(token)) continue;
      current.add(token);
      if (norm.kind === "invalid") {
        st.status.set(token, "invalid");
        continue;
      }
      if (!st.status.has(token)) st.status.set(token, "pending");
      if (norm.query) {
        st.queryToToken.set(norm.query, token);
        if (!st.queue.includes(norm.query) && st.inFlight !== norm.query) {
          st.queue.push(norm.query);
        }
      }
    }
    createMembersSetTokens(scope, Array.from(current));
    renderCreateMembersChips(scope);
    createMembersDrainLookups(scope);
  }

  function consumeCreateMembersEntry(scope: CreateMembersScope, forceAll: boolean) {
    const st = store.get();
    if (st.page !== scope) return;
    const dom = createMembersDom(scope);
    if (!dom) return;

    const value = dom.entry.value;
    if (!value.trim()) return;

    const hasTrailingSep = /[\s,]$/.test(value);
    const parts = value.split(/[\s,]+/);
    let tail = "";
    let toCommit = parts;
    if (!forceAll && !hasTrailingSep) {
      tail = parts.pop() || "";
      toCommit = parts;
    }
    const tokens = toCommit.map((t) => t.trim()).filter(Boolean);
    if (tokens.length) createMembersAddNormalizedTokens(scope, tokens);

    dom.entry.value = forceAll || hasTrailingSep ? "" : tail;
    applyLegacyIdMask(dom.entry);
  }

  function createMembersDrainLookups(scope: CreateMembersScope) {
    const st = store.get();
    if (st.page !== scope) return;
    if (!st.authed || st.conn !== "connected") return;
    const s = createMembersState(scope);
    if (s.inFlight) return;
    const next = s.queue.shift() || null;
    if (!next) return;
    s.inFlight = next;
    membersIgnoreQueries.set(next, Date.now() + 10_000);
    gateway.send({ type: "search", query: next });
    if (s.timeout !== null) window.clearTimeout(s.timeout);
    s.timeout = window.setTimeout(() => {
      const q = s.inFlight;
      if (q !== next) return;
      s.inFlight = null;
      s.timeout = null;
      membersIgnoreQueries.delete(next);
      const token = s.queryToToken.get(next);
      if (token) {
        s.status.set(token, "bad");
        s.handleToId.delete(token);
      }
      s.queryToToken.delete(next);
      renderCreateMembersChips(scope);
      createMembersDrainLookups(scope);
    }, 2500);
  }

  function handleCreateMembersSearchResult(scope: CreateMembersScope, msg: any): boolean {
    const st = store.get();
    if (st.page !== scope) return false;
    const s = createMembersState(scope);
    const q = String(msg?.query ?? "").trim();
    if (!q) return false;
    const token = s.queryToToken.get(q);
    if (!token) return false;
    membersIgnoreQueries.delete(q);

    const raw = Array.isArray(msg?.results) ? msg.results : [];
    const results: SearchResultEntry[] = raw
      .map((r: any) => ({
        id: String(r?.id ?? ""),
        online: r?.online === undefined ? undefined : Boolean(r.online),
        friend: r?.friend === undefined ? undefined : Boolean(r.friend),
        group: r?.group === undefined ? undefined : Boolean(r.group),
        board: r?.board === undefined ? undefined : Boolean(r.board),
      }))
      .filter((r: SearchResultEntry) => r.id);

    const targetKind = scope === "group_create" ? "group" : "board";
    const norm = normalizeMemberToken(token) || { kind: "invalid" as const, value: token, query: null };
    const res = statusForSearchResult(norm, results, targetKind);
    s.status.set(token, res.status);
    if (norm.kind === "handle") {
      if (res.resolvedId) s.handleToId.set(token, res.resolvedId);
      else s.handleToId.delete(token);
    }

    s.queryToToken.delete(q);
    if (s.inFlight === q) {
      s.inFlight = null;
      if (s.timeout !== null) {
        window.clearTimeout(s.timeout);
        s.timeout = null;
      }
    }

    renderCreateMembersChips(scope);
    createMembersDrainLookups(scope);
    return true;
  }

  function handleGroupCreateMembersSearchResult(msg: any): boolean {
    return handleCreateMembersSearchResult("group_create", msg);
  }

  function handleBoardCreateMembersSearchResult(msg: any): boolean {
    return handleCreateMembersSearchResult("board_create", msg);
  }

  function createGroup() {
    if (!store.get().authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    if (store.get().conn !== "connected") {
      store.set({ status: "Нет соединения", groupCreateMessage: "Нет соединения" });
      return;
    }
    const name = (document.getElementById("group-name") as HTMLInputElement | null)?.value?.trim() ?? "";
    if (!name) {
      store.set({ groupCreateMessage: "Введите название чата" });
      return;
    }
    consumeCreateMembersEntry("group_create", true);
    const raw = (document.getElementById("group-members") as HTMLInputElement | null)?.value ?? "";
    const tokens = Array.from(new Set(parseMembersInput(raw)));
    if (tokens.length) {
      const res = resolveMemberTokensForSubmit({
        tokens,
        statusByToken: groupCreateMembers.status,
        handleToId: groupCreateMembers.handleToId,
      });
      if (!res.ok) {
        if (res.reason === "pending") {
          store.set({ groupCreateMessage: "Проверяем участников… подождите" });
          createMembersDrainLookups("group_create");
          return;
        }
        if (res.reason === "invalid") {
          store.set({ groupCreateMessage: `Исправьте участников: ${res.invalid.slice(0, 6).join(", ")}${res.invalid.length > 6 ? "…" : ""}` });
          return;
        }
        store.set({ groupCreateMessage: `Не удалось найти: ${res.missing.slice(0, 6).join(", ")}${res.missing.length > 6 ? "…" : ""}` });
        return;
      }
      gateway.send({ type: "group_create", name, members: res.members });
    } else {
      gateway.send({ type: "group_create", name });
    }
    store.set({ status: "Создание чата…", groupCreateMessage: "" });
  }

  function createBoard() {
    if (!store.get().authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    if (store.get().conn !== "connected") {
      store.set({ status: "Нет соединения", boardCreateMessage: "Нет соединения" });
      return;
    }
    const name = (document.getElementById("board-name") as HTMLInputElement | null)?.value?.trim() ?? "";
    const handleRaw = (document.getElementById("board-handle") as HTMLInputElement | null)?.value ?? "";
    if (!name) {
      store.set({ boardCreateMessage: "Введите название доски" });
      return;
    }
    const handle = handleRaw ? normalizeHandle(handleRaw) : null;
    if (handleRaw && !handle) {
      store.set({ boardCreateMessage: "Некорректный хэндл (пример: @news)" });
      return;
    }
    consumeCreateMembersEntry("board_create", true);
    const raw = (document.getElementById("board-members") as HTMLInputElement | null)?.value ?? "";
    const tokens = Array.from(new Set(parseMembersInput(raw)));
    if (tokens.length) {
      const res = resolveMemberTokensForSubmit({
        tokens,
        statusByToken: boardCreateMembers.status,
        handleToId: boardCreateMembers.handleToId,
      });
      if (!res.ok) {
        if (res.reason === "pending") {
          store.set({ boardCreateMessage: "Проверяем участников… подождите" });
          createMembersDrainLookups("board_create");
          return;
        }
        if (res.reason === "invalid") {
          store.set({ boardCreateMessage: `Исправьте участников: ${res.invalid.slice(0, 6).join(", ")}${res.invalid.length > 6 ? "…" : ""}` });
          return;
        }
        store.set({ boardCreateMessage: `Не удалось найти: ${res.missing.slice(0, 6).join(", ")}${res.missing.length > 6 ? "…" : ""}` });
        return;
      }
      gateway.send({ type: "board_create", name, handle: handle || undefined, members: res.members });
    } else {
      gateway.send({ type: "board_create", name, handle: handle || undefined });
    }
    store.set({ status: "Создание доски…", boardCreateMessage: "" });
  }

  function membersAddSubmit() {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "members_add") return;
    if (!st.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    // Commit whatever user typed but hasn't turned into a chip yet.
    consumeMembersAddEntry(true);

    const raw = (document.getElementById("members-add-input") as HTMLInputElement | null)?.value ?? "";
    const tokens = Array.from(new Set(parseMembersInput(raw)));
    if (!tokens.length) {
      store.set({ modal: { ...modal, message: "Введите хотя бы один ID или @handle" } });
      return;
    }
    if (st.conn !== "connected") {
      store.set({ status: "Нет соединения" });
      return;
    }
    const res = resolveMemberTokensForSubmit({
      tokens,
      statusByToken: membersAddStatus,
      handleToId: membersAddHandleToId,
    });
    if (!res.ok) {
      if (res.reason === "pending") {
        store.set({ modal: { ...modal, message: "Проверяем участников… подождите" } });
        membersAddDrainLookups();
        return;
      }
      if (res.reason === "invalid") {
        store.set({ modal: { ...modal, message: `Исправьте участников: ${res.invalid.slice(0, 6).join(", ")}${res.invalid.length > 6 ? "…" : ""}` } });
        return;
      }
      store.set({ modal: { ...modal, message: `Не удалось найти: ${res.missing.slice(0, 6).join(", ")}${res.missing.length > 6 ? "…" : ""}` } });
      return;
    }
    const members = res.members;
    if (modal.targetKind === "group") {
      gateway.send({ type: "group_add", group_id: modal.targetId, members });
      store.set({ modal: { ...modal, message: "Отправляем приглашения…" }, status: "Приглашения отправляются…" });
      return;
    }
    gateway.send({ type: "board_add", board_id: modal.targetId, members });
    store.set({ modal: { ...modal, message: "Добавляем участников…" }, status: "Добавление участников…" });
  }

  function membersRemoveSubmit() {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "members_remove") return;
    if (!st.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    const raw = (document.getElementById("members-remove-input") as HTMLInputElement | null)?.value ?? "";
    const members = Array.from(new Set(parseMembersInput(raw))).filter((id) => id !== st.selfId);
    if (!members.length) {
      store.set({ modal: { ...modal, message: "Введите хотя бы один ID или @handle" } });
      return;
    }
    if (st.conn !== "connected") {
      store.set({ status: "Нет соединения" });
      return;
    }
    if (modal.targetKind === "group") {
      gateway.send({ type: "group_remove", group_id: modal.targetId, members });
      store.set({ modal: { ...modal, message: "Удаляем участников…" }, status: "Удаление участников…" });
      return;
    }
    gateway.send({ type: "board_remove", board_id: modal.targetId, members });
    store.set({ modal: { ...modal, message: "Удаляем участников…" }, status: "Удаление участников…" });
  }

  function renameSubmit() {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "rename") return;
    if (!st.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    const name = (document.getElementById("rename-name") as HTMLInputElement | null)?.value?.trim() ?? "";
    if (!name) {
      store.set({ modal: { ...modal, message: "Введите название" } });
      return;
    }
    if (name.length > 64) {
      store.set({ modal: { ...modal, message: "Название слишком длинное" } });
      return;
    }
    if (st.conn !== "connected") {
      store.set({ status: "Нет соединения" });
      return;
    }
    if (modal.targetKind === "group") {
      gateway.send({ type: "group_rename", group_id: modal.targetId, name });
      store.set({ modal: { ...modal, message: "Сохраняем…" }, status: "Переименование…" });
      return;
    }
    gateway.send({ type: "board_rename", board_id: modal.targetId, name });
    store.set({ modal: { ...modal, message: "Сохраняем…" }, status: "Переименование…" });
  }

  function inviteUserSubmit() {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "invite_user") return;
    if (!st.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    const peer = String(modal.peer || "").trim();
    if (!peer) {
      store.set({ modal: { ...modal, message: "Некорректный ID пользователя" } });
      return;
    }
    if (st.conn !== "connected") {
      store.set({ modal: { ...modal, message: "Нет соединения" }, status: "Нет соединения" });
      return;
    }

    const form = document.getElementById("invite-user-form");
    const groupIds = Array.from(form?.querySelectorAll("input[type='checkbox'][data-invite-kind='group']:checked") || [])
      .map((n) => String((n as HTMLInputElement).value || "").trim())
      .filter(Boolean);
    const boardIds = Array.from(form?.querySelectorAll("input[type='checkbox'][data-invite-kind='board']:checked") || [])
      .map((n) => String((n as HTMLInputElement).value || "").trim())
      .filter(Boolean);

    if (!groupIds.length && !boardIds.length) {
      store.set({ modal: { ...modal, message: "Выберите хотя бы один чат или доску" } });
      return;
    }

    for (const gid of groupIds) {
      gateway.send({ type: "group_add", group_id: gid, members: [peer] });
    }
    for (const bid of boardIds) {
      gateway.send({ type: "board_invite", board_id: bid, members: [peer] });
    }

    const total = groupIds.length + boardIds.length;
    store.set({ modal: null, status: `Приглашения отправляются (${total}): ${peer}` });
  }

  function confirmSubmit() {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "confirm") return;
    if (st.conn !== "connected" || !st.authed) {
      store.set({ modal: null, status: "Нет соединения" });
      return;
    }
    const action = modal.action;
    const close = () => store.set({ modal: null });

    if (action.kind === "chat_clear") {
      gateway.send({ type: "chat_clear", peer: action.peer });
      store.set({ status: `Очистка истории: ${action.peer}` });
      close();
      return;
    }
    if (action.kind === "friend_remove") {
      gateway.send({ type: "friend_remove", peer: action.peer });
      store.set({ status: `Удаление контакта: ${action.peer}` });
      close();
      return;
    }
    if (action.kind === "group_leave") {
      gateway.send({ type: "group_leave", group_id: action.groupId });
      store.set({ status: `Выход из чата: ${action.groupId}` });
      close();
      return;
    }
    if (action.kind === "board_leave") {
      gateway.send({ type: "board_leave", board_id: action.boardId });
      store.set({ status: `Выход из доски: ${action.boardId}` });
      close();
      return;
    }
    if (action.kind === "group_disband") {
      gateway.send({ type: "group_disband", group_id: action.groupId });
      store.set({ status: `Удаление чата: ${action.groupId}` });
      close();
      return;
    }
    if (action.kind === "board_disband") {
      gateway.send({ type: "board_disband", board_id: action.boardId });
      store.set({ status: `Удаление доски: ${action.boardId}` });
      close();
      return;
    }

    close();
  }

  function requestAuth(peer: string) {
    const id = peer.trim();
    if (!id) return;
    if (!store.get().authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    const st = store.get();
    if (st.friends.some((f) => f.id === id)) {
      store.set({ status: `Уже в контактах: ${id}` });
      return;
    }
    if (st.pendingOut.includes(id)) {
      store.set({ status: `Запрос уже отправлен: ${id}` });
      return;
    }
    if (st.pendingIn.includes(id)) {
      store.set({ status: `Есть входящий запрос: ${id}` });
      return;
    }
    gateway.send({ type: "authz_request", to: id });
    store.set({ status: `Запрос отправляется: ${id}` });
  }

  function acceptAuth(peer: string) {
    gateway.send({ type: "authz_response", peer, accept: true });
    store.set((prev) => {
      const key = dmKey(peer);
      const conv = prev.conversations[key] || [];
      const localId = `action:auth_in:${peer}`;
      const idx = conv.findIndex((m) => String(m.localId || "") === localId);
      const nextConv = idx >= 0 ? [...conv.slice(0, idx), { ...conv[idx], text: `Запрос принят: ${peer}`, attachment: null }, ...conv.slice(idx + 1)] : conv;
      return {
        ...prev,
        pendingIn: prev.pendingIn.filter((id) => id !== peer),
        ...(idx >= 0 ? { conversations: { ...prev.conversations, [key]: nextConv } } : {}),
        modal: null,
        status: `Принят запрос: ${peer}`,
      };
    });
  }

  function declineAuth(peer: string) {
    gateway.send({ type: "authz_response", peer, accept: false });
    store.set((prev) => {
      const key = dmKey(peer);
      const conv = prev.conversations[key] || [];
      const localId = `action:auth_in:${peer}`;
      const idx = conv.findIndex((m) => String(m.localId || "") === localId);
      const nextConv =
        idx >= 0 ? [...conv.slice(0, idx), { ...conv[idx], text: `Запрос отклонён: ${peer}`, attachment: null }, ...conv.slice(idx + 1)] : conv;
      return {
        ...prev,
        pendingIn: prev.pendingIn.filter((id) => id !== peer),
        ...(idx >= 0 ? { conversations: { ...prev.conversations, [key]: nextConv } } : {}),
        modal: null,
        status: `Отклонён запрос: ${peer}`,
      };
    });
  }

  function cancelAuth(peer: string) {
    gateway.send({ type: "authz_cancel", peer });
    store.set((prev) => {
      const key = dmKey(peer);
      const conv = prev.conversations[key] || [];
      const localId = `action:auth_out:${peer}`;
      const idx = conv.findIndex((m) => String(m.localId || "") === localId);
      const nextConv =
        idx >= 0 ? [...conv.slice(0, idx), { ...conv[idx], text: `Запрос отменён: ${peer}`, attachment: null }, ...conv.slice(idx + 1)] : conv;
      return {
        ...prev,
        pendingOut: prev.pendingOut.filter((id) => id !== peer),
        ...(idx >= 0 ? { conversations: { ...prev.conversations, [key]: nextConv } } : {}),
        modal: null,
        status: `Отменён запрос: ${peer}`,
      };
    });
  }

  function joinGroup(groupId: string) {
    const st = store.get();
    if (!st.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    if (st.groups.some((g) => g.id === groupId)) {
      store.set({ status: `Вы уже участник: ${groupId}` });
      return;
    }
    gateway.send({ type: "group_join_request", group_id: groupId });
    store.set({ status: `Запрос на вступление: ${groupId}` });
  }

  function joinBoard(boardId: string) {
    const st = store.get();
    if (!st.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    if (st.boards.some((b) => b.id === boardId)) {
      store.set({ status: `Вы уже участник: ${boardId}` });
      return;
    }
    gateway.send({ type: "board_join", board_id: boardId });
    store.set({ status: `Вступление в доску: ${boardId}` });
  }

  function acceptGroupInvite(groupId: string) {
    gateway.send({ type: "group_invite_response", group_id: groupId, accept: true });
    store.set((prev) => {
      const inv = prev.pendingGroupInvites.find((x) => x.groupId === groupId);
      const from = String(inv?.from || "").trim();
      let nextState: any = {
        ...prev,
        pendingGroupInvites: prev.pendingGroupInvites.filter((x) => x.groupId !== groupId),
        modal: null,
        status: `Принято приглашение: ${groupId}`,
      };
      if (from) {
        const key = dmKey(from);
        const conv = prev.conversations[key] || [];
        const localId = `action:group_invite:${groupId}:${from}`;
        const idx = conv.findIndex((m) => String(m.localId || "") === localId);
        if (idx >= 0) {
          const nextConv = [...conv.slice(0, idx), { ...conv[idx], text: `Приглашение принято: ${groupId}`, attachment: null }, ...conv.slice(idx + 1)];
          nextState = { ...nextState, conversations: { ...prev.conversations, [key]: nextConv } };
        }
      }
      return nextState;
    });
  }

  function declineGroupInvite(groupId: string) {
    gateway.send({ type: "group_invite_response", group_id: groupId, accept: false });
    store.set((prev) => {
      const inv = prev.pendingGroupInvites.find((x) => x.groupId === groupId);
      const from = String(inv?.from || "").trim();
      let nextState: any = {
        ...prev,
        pendingGroupInvites: prev.pendingGroupInvites.filter((x) => x.groupId !== groupId),
        modal: null,
        status: `Отклонено приглашение: ${groupId}`,
      };
      if (from) {
        const key = dmKey(from);
        const conv = prev.conversations[key] || [];
        const localId = `action:group_invite:${groupId}:${from}`;
        const idx = conv.findIndex((m) => String(m.localId || "") === localId);
        if (idx >= 0) {
          const nextConv = [...conv.slice(0, idx), { ...conv[idx], text: `Приглашение отклонено: ${groupId}`, attachment: null }, ...conv.slice(idx + 1)];
          nextState = { ...nextState, conversations: { ...prev.conversations, [key]: nextConv } };
        }
      }
      return nextState;
    });
  }

  function acceptGroupJoin(groupId: string, peer: string) {
    gateway.send({ type: "group_join_response", group_id: groupId, peer, accept: true });
    store.set((prev) => {
      const key = dmKey(peer);
      const conv = prev.conversations[key] || [];
      const localId = `action:group_join_request:${groupId}:${peer}`;
      const idx = conv.findIndex((m) => String(m.localId || "") === localId);
      const nextConv =
        idx >= 0
          ? [...conv.slice(0, idx), { ...conv[idx], text: `Запрос принят: ${peer}`, attachment: null }, ...conv.slice(idx + 1)]
          : conv;
      return {
        ...prev,
        pendingGroupJoinRequests: prev.pendingGroupJoinRequests.filter((req) => !(req.groupId === groupId && req.from === peer)),
        ...(idx >= 0 ? { conversations: { ...prev.conversations, [key]: nextConv } } : {}),
        modal: null,
        status: `Принят запрос: ${peer}`,
      };
    });
  }

  function declineGroupJoin(groupId: string, peer: string) {
    gateway.send({ type: "group_join_response", group_id: groupId, peer, accept: false });
    store.set((prev) => {
      const key = dmKey(peer);
      const conv = prev.conversations[key] || [];
      const localId = `action:group_join_request:${groupId}:${peer}`;
      const idx = conv.findIndex((m) => String(m.localId || "") === localId);
      const nextConv =
        idx >= 0
          ? [...conv.slice(0, idx), { ...conv[idx], text: `Запрос отклонён: ${peer}`, attachment: null }, ...conv.slice(idx + 1)]
          : conv;
      return {
        ...prev,
        pendingGroupJoinRequests: prev.pendingGroupJoinRequests.filter((req) => !(req.groupId === groupId && req.from === peer)),
        ...(idx >= 0 ? { conversations: { ...prev.conversations, [key]: nextConv } } : {}),
        modal: null,
        status: `Отклонён запрос: ${peer}`,
      };
    });
  }

  function joinBoardFromInvite(boardId: string) {
    gateway.send({ type: "board_join", board_id: boardId });
    store.set((prev) => {
      const inv = prev.pendingBoardInvites.find((x) => x.boardId === boardId);
      const from = String(inv?.from || "").trim();
      let nextState: any = {
        ...prev,
        pendingBoardInvites: prev.pendingBoardInvites.filter((x) => x.boardId !== boardId),
        modal: null,
        status: `Вступление в доску: ${boardId}`,
      };
      if (from) {
        const key = dmKey(from);
        const conv = prev.conversations[key] || [];
        const localId = `action:board_invite:${boardId}:${from}`;
        const idx = conv.findIndex((m) => String(m.localId || "") === localId);
        if (idx >= 0) {
          const nextConv = [...conv.slice(0, idx), { ...conv[idx], text: `Приглашение принято: ${boardId}`, attachment: null }, ...conv.slice(idx + 1)];
          nextState = { ...nextState, conversations: { ...prev.conversations, [key]: nextConv } };
        }
      }
      return nextState;
    });
  }

  function declineBoardInvite(boardId: string) {
    store.set((prev) => {
      const inv = prev.pendingBoardInvites.find((x) => x.boardId === boardId);
      const from = String(inv?.from || "").trim();
      let nextState: any = {
        ...prev,
        pendingBoardInvites: prev.pendingBoardInvites.filter((x) => x.boardId !== boardId),
        modal: null,
        status: `Отклонено приглашение: ${boardId}`,
      };
      if (from) {
        const key = dmKey(from);
        const conv = prev.conversations[key] || [];
        const localId = `action:board_invite:${boardId}:${from}`;
        const idx = conv.findIndex((m) => String(m.localId || "") === localId);
        if (idx >= 0) {
          const nextConv = [...conv.slice(0, idx), { ...conv[idx], text: `Приглашение отклонено: ${boardId}`, attachment: null }, ...conv.slice(idx + 1)];
          nextState = { ...nextState, conversations: { ...prev.conversations, [key]: nextConv } };
        }
      }
      return nextState;
    });
  }

  function nextTransferId() {
    transferSeq += 1;
    return `ft-${Date.now()}-${transferSeq}`;
  }

  function updateTransfers(match: (entry: FileTransferEntry) => boolean, apply: (entry: FileTransferEntry) => FileTransferEntry) {
    store.set((prev) => {
      let changed = false;
      const next = prev.fileTransfers.map((entry) => {
        if (!match(entry)) return entry;
        changed = true;
        return apply(entry);
      });
      return changed ? { ...prev, fileTransfers: next } : prev;
    });
    scheduleSaveFileTransfers(store);
  }

  function updateTransferByLocalId(localId: string, apply: (entry: FileTransferEntry) => FileTransferEntry) {
    updateTransfers((entry) => entry.localId === localId, apply);
  }

  function updateTransferByFileId(fileId: string, apply: (entry: FileTransferEntry) => FileTransferEntry) {
    updateTransfers((entry) => entry.id === fileId, apply);
  }

  function updateConversationFileMessage(key: string, localId: string, apply: (msg: any) => any) {
    store.set((prev) => {
      const conv = prev.conversations[key];
      if (!Array.isArray(conv) || conv.length === 0) return prev;
      const idx = conv.findIndex(
        (m: any) => m?.attachment?.kind === "file" && String(m.attachment?.localId ?? "") === String(localId)
      );
      if (idx < 0) return prev;
      const next = [...conv];
      next[idx] = apply(next[idx]);
      return { ...prev, conversations: { ...prev.conversations, [key]: next } };
    });
  }

  function addFileOffer(offer: FileOfferIn) {
    store.set((prev) => {
      if (prev.fileOffersIn.some((entry) => entry.id === offer.id)) return prev;
      return { ...prev, fileOffersIn: [...prev.fileOffersIn, offer] };
    });
  }

  function queueUpload(localId: string, file: File, target: TargetRef, caption?: string) {
    uploadQueue.push({
      localId,
      file,
      target,
      caption,
      bytesSent: 0,
      seq: 0,
      lastProgress: 0,
      aborted: false,
    });
    startNextUpload();
  }

  function startNextUpload() {
    if (activeUpload || uploadQueue.length === 0) return;
    const next = uploadQueue.shift();
    if (!next) return;
    activeUpload = next;
    const payload: Record<string, unknown> = {
      type: "file_offer",
      name: next.file.name || "файл",
      size: next.file.size || 0,
    };
    if (next.caption) payload.text = next.caption;
    if (next.target.kind === "dm") {
      payload.to = next.target.id;
    } else {
      payload.room = next.target.id;
    }
    gateway.send(payload);
    store.set({ status: `Предложение файла: ${next.file.name || "файл"}` });
  }

  async function uploadFileChunks(upload: UploadState) {
    const fileId = upload.fileId;
    if (!fileId) {
      updateTransferByLocalId(upload.localId, (entry) => ({ ...entry, status: "error", error: "missing_file_id" }));
      activeUpload = null;
      startNextUpload();
      return;
    }
    try {
      const size = upload.file.size || 0;
      const chunkSize = 32 * 1024;
      while (!upload.aborted && upload.bytesSent < size) {
        const slice = upload.file.slice(upload.bytesSent, upload.bytesSent + chunkSize);
        const buffer = await slice.arrayBuffer();
        if (upload.aborted) break;
        const data = arrayBufferToBase64(buffer);
        gateway.send({ type: "file_chunk", file_id: fileId, seq: upload.seq, data });
        upload.seq += 1;
        upload.bytesSent += buffer.byteLength;
        const pct = size > 0 ? Math.min(100, Math.round((upload.bytesSent / size) * 100)) : 0;
        if (pct !== upload.lastProgress) {
          upload.lastProgress = pct;
          updateTransferByLocalId(upload.localId, (entry) => ({ ...entry, progress: pct, status: "uploading" }));
        }
      }
      if (!upload.aborted) {
        gateway.send({ type: "file_upload_complete", file_id: fileId });
        updateTransferByLocalId(upload.localId, (entry) => ({ ...entry, status: "uploaded", progress: 100 }));
        store.set({ status: `Файл загружен: ${upload.file.name || "файл"}` });
      }
    } catch {
      updateTransferByLocalId(upload.localId, (entry) => ({ ...entry, status: "error", error: "upload_failed" }));
      store.set({ status: `Ошибка загрузки: ${upload.file.name || "файл"}` });
    } finally {
      uploadByFileId.delete(fileId);
      activeUpload = null;
      startNextUpload();
    }
  }

  function sendFile(file: File | null, target: TargetRef | null, caption?: string) {
    const st = store.get();
    if (!st.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    if (!file) {
      store.set({ status: "Выберите файл" });
      return;
    }
    if (!target) {
      store.set({ status: "Выберите адресата" });
      return;
    }
    if (file.size <= 0) {
      store.set({ status: "Нельзя отправить пустой файл" });
      return;
    }
    if (target.kind === "dm" && !st.friends.some((f) => f.id === target.id)) {
      store.set({ status: `Нет доступа к контакту: ${target.id}` });
      return;
    }
    if (target.kind === "group" && !st.groups.some((g) => g.id === target.id)) {
      store.set({ status: `Вы не участник чата: ${target.id}` });
      return;
    }
    if (target.kind === "board" && !st.boards.some((b) => b.id === target.id)) {
      store.set({ status: `Вы не участник доски: ${target.id}` });
      return;
    }
    if (target.kind === "board") {
      const b = st.boards.find((b) => b.id === target.id);
      const owner = String(b?.owner_id || "").trim();
      const me = String(st.selfId || "").trim();
      if (owner && me && owner !== me) {
        store.set({ status: "На доске писать может только владелец" });
        return;
      }
    }
    const captionText = String(caption ?? "").trimEnd();
    const localId = nextTransferId();
    const entry: FileTransferEntry = {
      localId,
      id: null,
      name: file.name || "файл",
      size: file.size || 0,
      direction: "out",
      peer: target.id,
      room: target.kind === "dm" ? null : target.id,
      status: "offering",
      progress: 0,
      acceptedBy: [],
      receivedBy: [],
    };
    const key = conversationKey(target);
    const outMsg = {
      kind: "out" as const,
      from: st.selfId || "",
      to: target.kind === "dm" ? target.id : undefined,
      room: target.kind === "dm" ? undefined : target.id,
      text: captionText,
      ts: nowTs(),
      id: null,
      attachment: {
        kind: "file" as const,
        localId,
        fileId: null,
        name: entry.name,
        size: entry.size,
        mime: file.type || null,
      },
    };

    let url: string | null = null;
    try {
      url = URL.createObjectURL(file);
    } catch {
      url = null;
    }
    if (url) entry.url = url;

    store.set((prev) => {
      const withMsg = upsertConversation(prev, key, outMsg);
      return { ...withMsg, fileTransfers: [entry, ...withMsg.fileTransfers], status: `Файл предложен: ${entry.name}` };
    });
    queueUpload(localId, file, target, captionText);
  }

  function acceptFileOffer(fileId: string) {
    const offer = store.get().fileOffersIn.find((entry) => entry.id === fileId);
    gateway.send({ type: "file_accept", file_id: fileId });
    store.set((prev) => {
      const transfers = [...prev.fileTransfers];
      if (offer) {
        transfers.unshift({
          localId: nextTransferId(),
          id: offer.id,
          name: offer.name || "файл",
          size: offer.size || 0,
          direction: "in",
          peer: offer.from || "—",
          room: offer.room ?? null,
          status: "offering",
          progress: 0,
        });
      }
      return {
        ...prev,
        fileOffersIn: prev.fileOffersIn.filter((entry) => entry.id !== fileId),
        fileTransfers: transfers,
        modal: null,
        status: offer ? `Принят файл: ${offer.name || "файл"}` : "Файл принят",
      };
    });
    scheduleSaveFileTransfers(store);
  }

  function rejectFileOffer(fileId: string) {
    const offer = store.get().fileOffersIn.find((entry) => entry.id === fileId);
    gateway.send({ type: "file_reject", file_id: fileId });
    store.set((prev) => ({
      ...prev,
      fileOffersIn: prev.fileOffersIn.filter((entry) => entry.id !== fileId),
      fileTransfers: offer
        ? [
            {
              localId: nextTransferId(),
              id: offer.id,
              name: offer.name || "файл",
              size: offer.size || 0,
              direction: "in",
              peer: offer.from || "—",
              room: offer.room ?? null,
              status: "rejected",
              progress: 0,
            },
            ...prev.fileTransfers,
          ]
        : prev.fileTransfers,
      modal: null,
      status: offer ? `Отклонен файл: ${offer.name || "файл"}` : "Файл отклонен",
    }));
    scheduleSaveFileTransfers(store);
  }

  function clearCompletedFiles() {
    const toRevoke = store
      .get()
      .fileTransfers.filter((entry) => ["complete", "uploaded", "error", "rejected"].includes(entry.status))
      .map((entry) => entry.url)
      .filter((url): url is string => Boolean(url));
    for (const url of toRevoke) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }
    store.set((prev) => ({
      ...prev,
      fileTransfers: prev.fileTransfers.filter((entry) => !["complete", "uploaded", "error", "rejected"].includes(entry.status)),
      status: "Список передач очищен",
    }));
    scheduleSaveFileTransfers(store);
  }

  function handleFileMessage(msg: any): boolean {
    const t = String(msg?.type ?? "");
    if (t === "file_offer") {
      const fileId = String(msg?.file_id ?? "").trim();
      if (!fileId) return true;
      const rawMsgId = msg?.msg_id;
      const msgId = typeof rawMsgId === "number" && Number.isFinite(rawMsgId) ? rawMsgId : null;
      const text = typeof msg?.text === "string" ? String(msg.text) : "";
      const offer: FileOfferIn = {
        id: fileId,
        from: String(msg?.from ?? "").trim() || "—",
        name: String(msg?.name ?? "файл"),
        size: Number(msg?.size ?? 0) || 0,
        room: typeof msg?.room === "string" ? msg.room : null,
      };
      const key = offer.room ? roomKey(offer.room) : dmKey(offer.from);
      const inMsg = {
        kind: "in" as const,
        from: offer.from,
        to: store.get().selfId || "",
        room: offer.room ?? undefined,
        text,
        ts: nowTs(),
        id: msgId ?? null,
        attachment: {
          kind: "file" as const,
          fileId,
          name: offer.name,
          size: offer.size,
        },
      };
      store.set((prev) => {
        const offers = prev.fileOffersIn.some((entry) => entry.id === offer.id) ? prev.fileOffersIn : [...prev.fileOffersIn, offer];
        const withOffer = offers === prev.fileOffersIn ? prev : { ...prev, fileOffersIn: offers };
        const withMsg = upsertConversation(withOffer, key, inMsg);
        return {
          ...withMsg,
          status: `Входящий файл: ${offer.name}`,
        };
      });
      return true;
    }
    if (t === "file_offer_result") {
      if (!activeUpload) return true;
      const ok = Boolean(msg?.ok);
      if (!ok) {
        const reason = String(msg?.reason ?? "ошибка");
        const localId = activeUpload.localId;
        updateTransferByLocalId(localId, (entry) => ({ ...entry, status: "error", error: reason }));
        activeUpload = null;
        store.set({ status: `Отправка отклонена: ${reason}` });
        startNextUpload();
        return true;
      }
      const fileId = String(msg?.file_id ?? "").trim();
      if (!fileId) {
        const localId = activeUpload.localId;
        updateTransferByLocalId(localId, (entry) => ({ ...entry, status: "error", error: "missing_file_id" }));
        activeUpload = null;
        startNextUpload();
        return true;
      }
      const rawMsgId = msg?.msg_id;
      const msgId = typeof rawMsgId === "number" && Number.isFinite(rawMsgId) ? rawMsgId : null;
      try {
        const key = conversationKey(activeUpload.target);
        updateConversationFileMessage(key, activeUpload.localId, (m) => {
          const att = m?.attachment?.kind === "file" ? m.attachment : null;
          if (!att) return m;
          return { ...m, ...(msgId !== null ? { id: msgId } : {}), attachment: { ...att, fileId } };
        });
      } catch {
        // ignore
      }
      activeUpload.fileId = fileId;
      uploadByFileId.set(fileId, activeUpload);
      updateTransferByLocalId(activeUpload.localId, (entry) => ({
        ...entry,
        id: fileId,
        status: "uploading",
        progress: 0,
        error: null,
      }));
      store.set({ status: `Загрузка на сервер: ${activeUpload.file.name || "файл"}` });
      void uploadFileChunks(activeUpload);
      return true;
    }
    if (t === "file_accept_notice") {
      const fileId = String(msg?.file_id ?? "").trim();
      const peer = String(msg?.peer ?? "").trim();
      if (fileId && peer) {
        updateTransferByFileId(fileId, (entry) => {
          if (entry.direction !== "out") return entry;
          const accepted = new Set(entry.acceptedBy ?? []);
          accepted.add(peer);
          return { ...entry, acceptedBy: Array.from(accepted) };
        });
        store.set({ status: `Получатель принял файл: ${peer}` });
      }
      return true;
    }
    if (t === "file_received") {
      const fileId = String(msg?.file_id ?? "").trim();
      const peer = String(msg?.peer ?? "").trim();
      if (fileId && peer) {
        updateTransferByFileId(fileId, (entry) => {
          if (entry.direction !== "out") return entry;
          const accepted = new Set(entry.acceptedBy ?? []);
          const received = new Set(entry.receivedBy ?? []);
          accepted.add(peer);
          received.add(peer);
          const nextStatus = entry.room ? entry.status : entry.status === "uploaded" ? "complete" : entry.status;
          return { ...entry, acceptedBy: Array.from(accepted), receivedBy: Array.from(received), status: nextStatus };
        });
        store.set({ status: `Файл получен: ${peer}` });
      }
      return true;
    }
    if (t === "file_download_begin") {
      const fileId = String(msg?.file_id ?? "").trim();
      if (!fileId) return true;
      const name = String(msg?.name ?? "файл");
      const size = Number(msg?.size ?? 0) || 0;
      const from = String(msg?.from ?? "").trim() || "—";
      const room = typeof msg?.room === "string" ? msg.room : null;
      downloadByFileId.set(fileId, { fileId, name, size, from, room, chunks: [], received: 0, lastProgress: 0 });
      store.set((prev) => {
        const transfers = [...prev.fileTransfers];
        const idx = transfers.findIndex((entry) => entry.id === fileId && entry.direction === "in");
        if (idx >= 0) {
          transfers[idx] = { ...transfers[idx], name, size, peer: from, room, status: "downloading", progress: 0 };
        } else {
          transfers.unshift({
            localId: nextTransferId(),
            id: fileId,
            name,
            size,
            direction: "in",
            peer: from,
            room,
            status: "downloading",
            progress: 0,
          });
        }
        return {
          ...prev,
          fileTransfers: transfers,
          fileOffersIn: prev.fileOffersIn.filter((entry) => entry.id !== fileId),
          status: `Скачивание: ${name}`,
        };
      });
      return true;
    }
    if (t === "file_chunk") {
      const fileId = String(msg?.file_id ?? "").trim();
      const download = fileId ? downloadByFileId.get(fileId) : null;
      if (!download) return true;
      const data = typeof msg?.data === "string" ? msg.data : "";
      if (!data) return true;
      const bytes = base64ToBytes(data);
      if (!bytes) return true;
      const buf = (bytes.buffer as ArrayBuffer).slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      download.chunks.push(buf);
      download.received += bytes.length;
      const pct = download.size > 0 ? Math.min(100, Math.round((download.received / download.size) * 100)) : 0;
      if (pct !== download.lastProgress) {
        download.lastProgress = pct;
        updateTransferByFileId(fileId, (entry) => ({ ...entry, progress: pct, status: "downloading" }));
      }
      return true;
    }
    if (t === "file_download_complete") {
      const fileId = String(msg?.file_id ?? "").trim();
      if (!fileId) return true;
      const download = downloadByFileId.get(fileId);
      if (download) {
        downloadByFileId.delete(fileId);
        const blob = new Blob(download.chunks, { type: guessMimeTypeByName(download.name) });
        const url = URL.createObjectURL(blob);
        updateTransferByFileId(fileId, (entry) => ({ ...entry, status: "complete", progress: 100, url }));
        store.set({ status: `Файл готов: ${download.name}` });
        if (pendingFileViewer && pendingFileViewer.fileId === fileId) {
          const pv = pendingFileViewer;
          pendingFileViewer = null;
          store.set({ modal: { kind: "file_viewer", url, name: pv.name, size: pv.size, mime: pv.mime } });
        }
      } else {
        updateTransferByFileId(fileId, (entry) => ({ ...entry, status: "complete", progress: 100 }));
      }
      return true;
    }
    if (t === "file_error") {
      const fileId = String(msg?.file_id ?? "").trim();
      const reason = String(msg?.reason ?? "ошибка");
      const peer = String(msg?.peer ?? "").trim();
      const detail = peer ? `${reason} (${peer})` : reason;
      if (fileId) {
        if (pendingFileViewer && pendingFileViewer.fileId === fileId) pendingFileViewer = null;
        const upload = uploadByFileId.get(fileId);
        if (upload) upload.aborted = true;
        if (downloadByFileId.has(fileId)) downloadByFileId.delete(fileId);
        updateTransferByFileId(fileId, (entry) => ({ ...entry, status: "error", error: detail }));
      }
      store.set({ status: `Ошибка файла: ${detail}` });
      return true;
    }
    return false;
  }

  function logout() {
    flushDrafts(store);
    flushPinnedMessages(store);
    flushOutbox(store);
    clearToast();
    const st = store.get();
    const id = String(st.selfId || "").trim();
    const rememberedId = id || String(st.authRememberedId || "").trim() || null;

    const session = getStoredSessionToken();
    if (st.conn === "connected" && st.authed) {
      gateway.send({ type: "logout", ...(session ? { session } : {}) });
    }

    if (id) storeAuthId(id);
    clearStoredSessionToken();

    autoAuthAttemptedForConn = false;
    historyRequested.clear();
    historyDeltaRequestedAt.clear();
    lastReadSentAt.clear();

    const toRevoke = (st.fileTransfers || [])
      .map((entry) => entry.url)
      .filter((url): url is string => Boolean(url));
    for (const url of toRevoke) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }

    store.set((prev) => ({
      ...prev,
      authed: false,
      selfId: null,
      friends: [],
      pendingIn: [],
      pendingOut: [],
      muted: [],
      blocked: [],
      blockedBy: [],
      pinned: [],
      pinnedMessages: {},
      pinnedMessageActive: {},
      pendingGroupInvites: [],
      pendingGroupJoinRequests: [],
      pendingBoardInvites: [],
      fileOffersIn: [],
      fileTransfers: [],
      groups: [],
      boards: [],
      selected: null,
      conversations: {},
      historyLoaded: {},
      historyCursor: {},
      historyHasMore: {},
      historyLoading: {},
      outbox: {},
      drafts: {},
      input: "",
      editing: null,
      chatSearchOpen: false,
      chatSearchQuery: "",
      chatSearchHits: [],
      chatSearchPos: 0,
      profiles: {},
      profileDraftDisplayName: "",
      profileDraftHandle: "",
      toast: null,
      page: "main",
      modal: null,
      authMode: rememberedId ? "login" : "register",
      authRememberedId: rememberedId,
      status: "Вы вышли. Нажмите «Войти», чтобы войти снова.",
    }));
    draftsLoadedForUser = null;
    pinsLoadedForUser = null;
    pinnedMessagesLoadedForUser = null;
    fileTransfersLoadedForUser = null;
    outboxLoadedForUser = null;
    try {
      layout.input.value = "";
      autosizeInput(layout.input);
    } catch {
      // ignore
    }

    // Сбрасываем серверную авторизацию через переподключение.
    gateway.close();
  }

  function authLogin() {
    if (store.get().conn !== "connected") {
      store.set({ status: "Нет соединения" });
      return;
    }
    const id = (document.getElementById("auth-id") as HTMLInputElement | null)?.value?.trim() ?? "";
    const pw = (document.getElementById("auth-pw") as HTMLInputElement | null)?.value ?? "";
    if (!id) {
      store.set({ modal: { kind: "auth", message: "Введите ID" } });
      return;
    }
    if (!pw) {
      store.set({ modal: { kind: "auth", message: "Введите пароль" } });
      return;
    }
    gateway.send({ type: "auth", id, password: pw });
  }

  function authRegister() {
    if (store.get().conn !== "connected") {
      store.set({ status: "Нет соединения" });
      return;
    }
    const pw1 = (document.getElementById("auth-pw1") as HTMLInputElement | null)?.value ?? "";
    const pw2 = (document.getElementById("auth-pw2") as HTMLInputElement | null)?.value ?? "";
    const pw = pw1;
    if (!pw) {
      store.set({ modal: { kind: "auth", message: "Введите пароль для регистрации" } });
      return;
    }
    if (pw1 !== pw2) {
      store.set({ modal: { kind: "auth", message: "Пароли не совпадают" } });
      return;
    }
    gateway.send({ type: "register", password: pw });
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

  function beginEditingMessage(key: string, msgId: number, text: string) {
    const k = String(key || "").trim();
    const id = Number.isFinite(Number(msgId)) ? Math.trunc(Number(msgId)) : 0;
    if (!k || id <= 0) return;
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

  function sendChat() {
    const st = store.get();
    const text = (layout.input.value || "").trimEnd();
    const sel = st.selected;
    const key = sel ? conversationKey(sel) : "";
    const editing = st.editing && key && st.editing.key === key ? st.editing : null;
    if (!text) return;
    if (text.length > APP_MSG_MAX_LEN) {
      store.set({ status: `Слишком длинное сообщение (${text.length}/${APP_MSG_MAX_LEN})` });
      return;
    }
    if (!st.authed) {
      const token = getStoredSessionToken();
      if (token) {
        if (isSessionAutoAuthBlocked()) {
          store.set({
            authMode: st.authRememberedId ? "login" : "register",
            modal: { kind: "auth", message: "Сессия активна в другом окне. Чтобы продолжить здесь — войдите снова." },
          });
          return;
        }
        store.set({ status: "Авторизация… подождите" });
        return;
      }
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    if (!sel) {
      store.set({ status: "Выберите контакт или чат слева" });
      return;
    }

    if (editing) {
      if (st.conn !== "connected") {
        store.set({ status: "Нет соединения: нельзя изменить сообщение" });
        return;
      }
      const msgId = Number.isFinite(Number(editing.id)) ? Math.trunc(Number(editing.id)) : 0;
      if (msgId <= 0) {
        store.set({ status: "Нельзя изменить это сообщение" });
        return;
      }
      const ok = gateway.send({ type: "message_edit", id: msgId, text });
      if (!ok) {
        store.set({ status: "Нет соединения: изменения не отправлены" });
        return;
      }
      store.set({ status: "Сохраняем изменения…" });

      const restore = editing.prevDraft || "";
      store.set((prev) => ({ ...prev, editing: null, input: restore }));
      try {
        layout.input.value = restore;
        autosizeInput(layout.input);
        layout.input.focus();
      } catch {
        // ignore
      }
      scheduleSaveDrafts(store);
      return;
    }

    const convKey = key;
    const localId = makeOutboxLocalId();
    const ts = nowTs();
    const nowMs = Date.now();
    const payload = sel.kind === "dm" ? { type: "send" as const, to: sel.id, text } : { type: "send" as const, room: sel.id, text };
    const sent = st.conn === "connected" ? gateway.send(payload) : false;
    const initialStatus = sent ? ("sending" as const) : ("queued" as const);

    const localMsg = {
      kind: "out" as const,
      from: st.selfId || "",
      to: sel.kind === "dm" ? sel.id : undefined,
      room: sel.kind === "dm" ? undefined : sel.id,
      text,
      ts,
      localId,
      id: null,
      status: initialStatus,
    };

    store.set((prev) => {
      const next = upsertConversation(prev, convKey, localMsg);
      const outbox = addOutboxEntry(next.outbox, convKey, {
        localId,
        ts,
        text,
        ...(sel.kind === "dm" ? { to: sel.id } : { room: sel.id }),
        status: sent ? "sending" : "queued",
        attempts: sent ? 1 : 0,
        lastAttemptAt: sent ? nowMs : 0,
      });
      return { ...next, outbox };
    });
    scheduleSaveOutbox(store);

    layout.input.value = "";
    autosizeInput(layout.input);
    layout.input.focus();
    store.set((prev) => {
      const drafts = updateDraftMap(prev.drafts, convKey, "");
      return { ...prev, input: "", drafts };
    });
    scheduleSaveDrafts(store);

    if (!sent) {
      store.set({ status: st.conn === "connected" ? "Сообщение в очереди" : "Нет соединения: сообщение в очереди" });
    }
  }

  const OUTBOX_RETRY_MIN_MS = 900;
  const OUTBOX_DRAIN_MAX = 12;

  function drainOutbox(limit = OUTBOX_DRAIN_MAX) {
    const st = store.get();
    if (st.conn !== "connected") return;
    if (!st.authed || !st.selfId) return;
    const entries = Object.entries(st.outbox || {});
    if (!entries.length) return;

    const nowMs = Date.now();
    const flat: Array<{ key: string; localId: string; to?: string; room?: string; text: string; ts: number; lastAttemptAt: number }> = [];
    for (const [k, list] of entries) {
      const arr = Array.isArray(list) ? list : [];
      for (const e of arr) {
        const lid = typeof e?.localId === "string" ? e.localId.trim() : "";
        if (!lid) continue;
        const text = typeof e?.text === "string" ? e.text : "";
        if (!text) continue;
        const to = typeof e?.to === "string" && e.to.trim() ? e.to.trim() : undefined;
        const room = typeof e?.room === "string" && e.room.trim() ? e.room.trim() : undefined;
        if (!to && !room) continue;
        const ts = Number.isFinite(e?.ts) ? Number(e.ts) : 0;
        const lastAttemptAtRaw = e?.lastAttemptAt;
        const lastAttemptAt =
          typeof lastAttemptAtRaw === "number" && Number.isFinite(lastAttemptAtRaw)
            ? Math.max(0, Math.trunc(lastAttemptAtRaw))
            : 0;
        flat.push({ key: k, localId: lid, to, room, text, ts, lastAttemptAt });
      }
    }
    if (!flat.length) return;
    flat.sort((a, b) => a.ts - b.ts);

    const sent: Array<{ key: string; localId: string }> = [];
    for (const it of flat) {
      if (sent.length >= limit) break;
      if (it.lastAttemptAt && nowMs - it.lastAttemptAt < OUTBOX_RETRY_MIN_MS) continue;
      const ok = gateway.send(it.to ? { type: "send", to: it.to, text: it.text } : { type: "send", room: it.room, text: it.text });
      if (!ok) break;
      sent.push({ key: it.key, localId: it.localId });
    }
    if (!sent.length) return;

    store.set((prev) => {
      let outbox = prev.outbox;
      let conversations = prev.conversations;
      for (const s of sent) {
        outbox = updateOutboxEntry(outbox, s.key, s.localId, (e) => ({
          ...e,
          status: "sending",
          attempts: (e.attempts ?? 0) + 1,
          lastAttemptAt: nowMs,
        }));
        const conv = conversations[s.key];
        if (Array.isArray(conv) && conv.length) {
          const idx = conv.findIndex((m) => m.kind === "out" && typeof m.localId === "string" && m.localId === s.localId);
          if (idx >= 0) {
            const next = [...conv];
            next[idx] = { ...next[idx], status: "sending" };
            conversations = { ...conversations, [s.key]: next };
          }
        }
      }
      return { ...prev, outbox, conversations, status: "Отправляем сообщения из очереди…" };
    });
    scheduleSaveOutbox(store);
  }

  const EMOJI_RECENTS_KEY = "yagodka:emoji_recents:v1";
  const EMOJI_RECENTS_MAX = 24;
  let emojiOpen = false;
  let emojiPopover: HTMLElement | null = null;

  function loadEmojiRecents(): string[] {
    try {
      const raw = localStorage.getItem(EMOJI_RECENTS_KEY);
      if (!raw) return [];
      const v = JSON.parse(raw);
      if (!Array.isArray(v)) return [];
      return v.filter((x) => typeof x === "string" && x && x.length <= 16).slice(0, EMOJI_RECENTS_MAX);
    } catch {
      return [];
    }
  }

  function saveEmojiRecents(recents: string[]) {
    try {
      localStorage.setItem(EMOJI_RECENTS_KEY, JSON.stringify(recents));
    } catch {
      // ignore
    }
  }

  function ensureEmojiPopover(): HTMLElement {
    if (emojiPopover) return emojiPopover;
    const pop = el("div", { class: "emoji-popover hidden", role: "dialog", "aria-label": "Эмодзи" });
    const field = layout.inputWrap.querySelector(".composer-field");
    (field || layout.inputWrap).append(pop);
    emojiPopover = pop;

    pop.addEventListener("click", (ev) => {
      const closeBtn = (ev.target as HTMLElement | null)?.closest("button[data-action='emoji-close']") as HTMLButtonElement | null;
      if (closeBtn) {
        ev.preventDefault();
        closeEmojiPopover();
        return;
      }

      const target = (ev.target as HTMLElement | null)?.closest("button[data-emoji]") as HTMLButtonElement | null;
      if (!target) return;
      ev.preventDefault();
      const emoji = String(target.dataset.emoji || "");
      if (!emoji) return;
      if (layout.input.disabled) return;

      const { value, caret } = insertTextAtSelection({
        value: layout.input.value || "",
        selectionStart: layout.input.selectionStart,
        selectionEnd: layout.input.selectionEnd,
        insertText: emoji,
      });
      layout.input.value = value;
      try {
        layout.input.setSelectionRange(caret, caret);
      } catch {
        // ignore
      }
      layout.input.dispatchEvent(new Event("input", { bubbles: true }));
      try {
        layout.input.focus({ preventScroll: true });
      } catch {
        layout.input.focus();
      }

      const recents = loadEmojiRecents();
      const next = updateEmojiRecents(recents, emoji, EMOJI_RECENTS_MAX);
      saveEmojiRecents(next);
      renderEmojiPopover();
    });

    pop.addEventListener("keydown", (ev) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      closeEmojiPopover();
    });

    return pop;
  }

  function renderEmojiPopover() {
    const pop = ensureEmojiPopover();
    const palette = mergeEmojiPalette(loadEmojiRecents(), DEFAULT_EMOJI);

    const closeBtn = el(
      "button",
      { class: "btn emoji-close", type: "button", "aria-label": "Закрыть эмодзи", "data-action": "emoji-close" },
      ["×"]
    );
    const head = el("div", { class: "emoji-head" }, [el("div", { class: "emoji-title" }, ["Эмодзи"]), closeBtn]);
    const grid = el(
      "div",
      { class: "emoji-grid", role: "listbox", "aria-label": "Список эмодзи" },
      palette.map((e) => el("button", { class: "emoji-btn", type: "button", "data-emoji": e, title: e, "aria-label": e }, [e]))
    );

    pop.replaceChildren(head, grid);
  }

  function openEmojiPopover() {
    if (layout.input.disabled) return;
    emojiOpen = true;
    layout.emojiBtn.classList.add("btn-active");
    const pop = ensureEmojiPopover();
    renderEmojiPopover();
    pop.classList.remove("hidden");
  }

  function closeEmojiPopover() {
    emojiOpen = false;
    layout.emojiBtn.classList.remove("btn-active");
    if (emojiPopover) emojiPopover.classList.add("hidden");
  }

  layout.emojiBtn.addEventListener("click", (e) => {
    e.preventDefault();
    if (emojiOpen) closeEmojiPopover();
    else openEmojiPopover();
  });

  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!emojiOpen) return;
      const t = e.target as Node | null;
      if (!t) return;
      if (emojiPopover && emojiPopover.contains(t)) return;
      if (layout.emojiBtn.contains(t)) return;
      closeEmojiPopover();
    },
    true
  );

  layout.input.addEventListener("input", () => {
    lastUserInputAt = Date.now();
    const value = layout.input.value || "";
    store.set((prev) => {
      const key = prev.selected ? conversationKey(prev.selected) : "";
      const isEditing = Boolean(prev.editing && key && prev.editing.key === key);
      const drafts = key && !isEditing ? updateDraftMap(prev.drafts, key, value) : prev.drafts;
      return { ...prev, input: value, drafts };
    });
    autosizeInput(layout.input);
    scheduleSaveDrafts(store);
  });

  layout.input.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && emojiOpen) {
      e.preventDefault();
      e.stopPropagation();
      closeEmojiPopover();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
    if (e.key === "Escape") {
      const st = store.get();
      if (st.editing) {
        e.preventDefault();
        e.stopPropagation();
        cancelEditing();
      }
    }
  });

  layout.sendBtn.addEventListener("click", () => sendChat());
  layout.inputWrap.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement | null)?.closest("button[data-action='composer-edit-cancel']") as HTMLButtonElement | null;
    if (!btn) return;
    e.preventDefault();
    cancelEditing();
  });

  // Telegram-like UX: paste/drop files прямо в поле ввода.
  layout.input.addEventListener("paste", (e) => {
    const ev = e as ClipboardEvent;
    const dt = ev.clipboardData;
    if (!dt) return;
    const files = Array.from(dt.files || []);
    if (!files.length) {
      try {
        for (const it of Array.from(dt.items || [])) {
          if (it.kind !== "file") continue;
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      } catch {
        // ignore
      }
    }
    if (!files.length) return;
    const st = store.get();
    if (st.conn !== "connected") {
      ev.preventDefault();
      store.set({ status: "Нет соединения" });
      return;
    }
    if (!st.authed) {
      ev.preventDefault();
      store.set({ status: "Нажмите «Войти», чтобы отправлять файлы" });
      return;
    }
    if (!st.selected) {
      ev.preventDefault();
      store.set({ status: "Выберите контакт или чат слева" });
      return;
    }
    ev.preventDefault();
    for (const f of files) sendFile(f, st.selected);
  });

  let dragDepth = 0;
  const setDragActive = (active: boolean) => {
    layout.inputWrap.classList.toggle("composer-drag", active);
  };
  const isFileDrag = (dt: DataTransfer | null) => {
    if (!dt) return false;
    try {
      if (dt.files && dt.files.length) return true;
    } catch {
      // ignore
    }
    try {
      return Array.from(dt.types || []).includes("Files");
    } catch {
      return false;
    }
  };
  layout.inputWrap.addEventListener("dragenter", (e) => {
    const ev = e as DragEvent;
    if (!isFileDrag(ev.dataTransfer)) return;
    ev.preventDefault();
    dragDepth += 1;
    setDragActive(true);
  });
  layout.inputWrap.addEventListener("dragover", (e) => {
    const ev = e as DragEvent;
    if (!isFileDrag(ev.dataTransfer)) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
    setDragActive(true);
  });
  layout.inputWrap.addEventListener("dragleave", (e) => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) setDragActive(false);
  });
  layout.inputWrap.addEventListener("drop", (e) => {
    const ev = e as DragEvent;
    const dt = ev.dataTransfer;
    if (!isFileDrag(dt)) return;
    ev.preventDefault();
    dragDepth = 0;
    setDragActive(false);
    const files = Array.from(dt?.files || []);
    if (!files.length) return;
    const st = store.get();
    if (st.conn !== "connected") {
      store.set({ status: "Нет соединения" });
      return;
    }
    if (!st.authed) {
      store.set({ status: "Нажмите «Войти», чтобы отправлять файлы" });
      return;
    }
    if (!st.selected) {
      store.set({ status: "Выберите контакт или чат слева" });
      return;
    }
    for (const f of files) sendFile(f, st.selected);
  });

  layout.attachBtn.addEventListener("click", () => {
    const st = store.get();
    if (st.conn !== "connected") {
      store.set({ status: "Нет соединения" });
      return;
    }
    if (!st.authed) {
      const token = getStoredSessionToken();
      if (token) {
        if (isSessionAutoAuthBlocked()) {
          store.set({
            authMode: st.authRememberedId ? "login" : "register",
            modal: { kind: "auth", message: "Сессия активна в другом окне. Чтобы продолжить здесь — войдите снова." },
          });
          return;
        }
        store.set({ status: "Авторизация… подождите" });
        return;
      }
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    const target = st.selected;
    if (!target) {
      store.set({ status: "Выберите контакт или чат слева" });
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.top = "-9999px";
    document.body.appendChild(input);
    input.addEventListener(
      "change",
      () => {
        const files = Array.from(input.files || []);
        input.remove();
        if (!files.length) return;
        const st2 = store.get();
        const canCaption = !st2.editing && files.length === 1;
        const caption = canCaption ? String(layout.input.value || "").trimEnd() : "";
        if (caption) {
          store.set((prev) => ({ ...prev, input: "" }));
          try {
            layout.input.value = "";
            autosizeInput(layout.input);
          } catch {
            // ignore
          }
          scheduleSaveDrafts(store);
        }
        for (let i = 0; i < files.length; i += 1) {
          sendFile(files[i], target, i === 0 ? caption : "");
        }
      },
      { once: true }
    );
    input.click();
  });

  function closeModal() {
    const st = store.get();
    if (!st.modal) return;
    if (st.modal.kind === "members_add") {
      clearMembersAddLookups();
    }
    if (st.modal.kind === "update") {
      store.set({ modal: null, updateDismissedLatest: st.updateLatest });
    } else {
      store.set({ modal: null });
    }
  }

  function openContextMenu(target: { kind: ContextMenuTargetKind; id: string }, x: number, y: number) {
    const st = store.get();
    if (st.modal) return;

    const canAct = st.conn === "connected" && st.authed;
    const items: { id: string; label: string; danger?: boolean; disabled?: boolean }[] = [];
    let title = "";
    const ak = avatarKindForTarget(target.kind);
    const hasAvatar = ak ? Boolean(getStoredAvatar(ak, target.id)) : false;

    if (target.kind === "dm") {
      title = `Контакт: ${target.id}`;
      items.push({ id: "open", label: "Открыть" });
      const pinKey = dmKey(target.id);
      items.push({ id: "pin_toggle", label: st.pinned.includes(pinKey) ? "Открепить" : "Закрепить" });
      items.push({ id: "copy_id", label: "Скопировать ID" });
      items.push({ id: "invite_user", label: "Пригласить в чат/доску…", disabled: !canAct });
      const unread = st.friends.find((f) => f.id === target.id)?.unread ?? 0;
      if (unread > 0) items.push({ id: "mark_read", label: "Пометить прочитанным", disabled: !canAct });
      items.push({ id: "avatar_set", label: hasAvatar ? "Сменить аватар…" : "Установить аватар…" });
      if (hasAvatar) items.push({ id: "avatar_remove", label: "Удалить аватар", danger: true });
      items.push({ id: "mute_toggle", label: st.muted.includes(target.id) ? "Включить звук" : "Заглушить", disabled: !canAct });
      items.push({ id: "block_toggle", label: st.blocked.includes(target.id) ? "Разблокировать" : "Заблокировать", disabled: !canAct });
      items.push({ id: "chat_clear", label: "Очистить историю", danger: true, disabled: !canAct });
      items.push({ id: "friend_remove", label: "Удалить контакт", danger: true, disabled: !canAct });
    } else if (target.kind === "group") {
      const g = st.groups.find((x) => x.id === target.id);
      const name = String(g?.name || target.id);
      const isOwner = Boolean(g?.owner_id && st.selfId && String(g.owner_id) === String(st.selfId));
      title = `Чат: ${name}`;
      items.push({ id: "open", label: "Открыть" });
      const pinKey = roomKey(target.id);
      items.push({ id: "pin_toggle", label: st.pinned.includes(pinKey) ? "Открепить" : "Закрепить" });
      items.push({ id: "copy_id", label: "Скопировать ID" });
      items.push({ id: "mute_toggle", label: st.muted.includes(target.id) ? "Включить звук" : "Заглушить", disabled: !canAct });
      if (isOwner) items.push({ id: "group_rename", label: "Переименовать…", disabled: !canAct });
      if (isOwner) items.push({ id: "group_add_members", label: "Добавить участников…", disabled: !canAct });
      if (isOwner) items.push({ id: "group_remove_members", label: "Удалить участников…", danger: true, disabled: !canAct });
      items.push({ id: "avatar_set", label: hasAvatar ? "Сменить аватар…" : "Установить аватар…" });
      if (hasAvatar) items.push({ id: "avatar_remove", label: "Удалить аватар", danger: true });
      if (isOwner) {
        items.push({ id: "group_disband", label: "Удалить чат (для всех)", danger: true, disabled: !canAct });
      } else {
        items.push({ id: "group_leave", label: "Покинуть чат", danger: true, disabled: !canAct });
      }
    } else if (target.kind === "board") {
      const b = st.boards.find((x) => x.id === target.id);
      const name = String(b?.name || target.id);
      const isOwner = Boolean(b?.owner_id && st.selfId && String(b.owner_id) === String(st.selfId));
      title = `Доска: ${name}`;
      items.push({ id: "open", label: "Открыть" });
      const pinKey = roomKey(target.id);
      items.push({ id: "pin_toggle", label: st.pinned.includes(pinKey) ? "Открепить" : "Закрепить" });
      items.push({ id: "copy_id", label: "Скопировать ID" });
      items.push({ id: "mute_toggle", label: st.muted.includes(target.id) ? "Включить звук" : "Заглушить", disabled: !canAct });
      if (isOwner) items.push({ id: "board_rename", label: "Переименовать…", disabled: !canAct });
      if (isOwner) items.push({ id: "board_add_members", label: "Добавить участников…", disabled: !canAct });
      if (isOwner) items.push({ id: "board_remove_members", label: "Удалить участников…", danger: true, disabled: !canAct });
      items.push({ id: "avatar_set", label: hasAvatar ? "Сменить аватар…" : "Установить аватар…" });
      if (hasAvatar) items.push({ id: "avatar_remove", label: "Удалить аватар", danger: true });
      if (isOwner) {
        items.push({ id: "board_disband", label: "Удалить доску (для всех)", danger: true, disabled: !canAct });
      } else {
        items.push({ id: "board_leave", label: "Покинуть доску", danger: true, disabled: !canAct });
      }
    } else if (target.kind === "auth_in") {
      title = `Запрос: ${target.id}`;
      items.push({ id: "copy_id", label: "Скопировать ID" });
      items.push({ id: "avatar_set", label: hasAvatar ? "Сменить аватар…" : "Установить аватар…" });
      if (hasAvatar) items.push({ id: "avatar_remove", label: "Удалить аватар", danger: true });
      items.push({ id: "auth_accept", label: "Принять", disabled: !canAct });
      items.push({ id: "auth_decline", label: "Отклонить", danger: true, disabled: !canAct });
      items.push({ id: "block_toggle", label: st.blocked.includes(target.id) ? "Разблокировать" : "Заблокировать", disabled: !canAct });
    } else if (target.kind === "auth_out") {
      title = `Ожидает: ${target.id}`;
      items.push({ id: "copy_id", label: "Скопировать ID" });
      items.push({ id: "avatar_set", label: hasAvatar ? "Сменить аватар…" : "Установить аватар…" });
      if (hasAvatar) items.push({ id: "avatar_remove", label: "Удалить аватар", danger: true });
      items.push({ id: "auth_cancel", label: "Отменить запрос", danger: true, disabled: !canAct });
    } else if (target.kind === "message") {
      const selKey = st.selected ? conversationKey(st.selected) : "";
      const idx = Number.isFinite(Number(target.id)) ? Math.trunc(Number(target.id)) : -1;
      const conv = selKey ? st.conversations[selKey] : null;
      const msg = conv && idx >= 0 && idx < conv.length ? conv[idx] : null;
      const msgId = msg && typeof msg.id === "number" && Number.isFinite(msg.id) ? msg.id : null;
      const canPin = Boolean(selKey && msgId !== null && msgId > 0);
      const isPinned = Boolean(canPin && msgId !== null && isPinnedMessage(st.pinnedMessages, selKey, msgId));

      const preview =
        msg?.attachment?.kind === "file"
          ? `Файл: ${String(msg.attachment.name || "файл")}`
          : String(msg?.text || "").trim() || "Сообщение";
      title = preview.length > 64 ? `${preview.slice(0, 61)}…` : preview;

      const caption = msg?.attachment?.kind === "file" ? String(msg?.text || "").trim() : "";
      items.push({
        id: "msg_copy",
        label: msg?.attachment?.kind === "file" ? (caption ? "Скопировать подпись" : "Скопировать имя файла") : "Скопировать текст",
        disabled: !msg,
      });
      items.push({ id: "msg_pin_toggle", label: isPinned ? "Открепить" : "Закрепить", disabled: !canPin });
      const canEdit = Boolean(canPin && msg?.kind === "out" && st.selfId && String(msg.from) === String(st.selfId));
      if (canEdit) items.push({ id: "msg_edit", label: msg?.attachment ? "Изменить подпись…" : "Изменить…", disabled: !canAct });
      items.push({ id: "msg_delete_local", label: "Удалить у меня", danger: true, disabled: !msg });
      const canDeleteForAll = Boolean(canPin && canAct && msg?.kind === "out" && st.selfId && String(msg.from) === String(st.selfId));
      if (canDeleteForAll) items.push({ id: "msg_delete", label: "Удалить", danger: true, disabled: !canAct });
    }

    store.set({
      modal: {
        kind: "context_menu",
        payload: {
          x,
          y,
          title,
          target,
          items,
        },
      },
    });
  }

  async function handleContextMenuAction(itemId: string) {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "context_menu") return;
    const t = modal.payload.target;

    const close = () => store.set({ modal: null });

    if (itemId === "pin_toggle") {
      if (t.kind !== "dm" && t.kind !== "group" && t.kind !== "board") {
        close();
        return;
      }
      const key = t.kind === "dm" ? dmKey(t.id) : roomKey(t.id);
      const next = togglePin(st.pinned, key);
      store.set({ pinned: next });
      if (st.selfId) savePinsForUser(st.selfId, next);
      showToast(st.pinned.includes(key) ? "Откреплено" : "Закреплено", { kind: "success" });
      close();
      return;
    }

    if (itemId === "avatar_set") {
      const kind = avatarKindForTarget(t.kind);
      if (kind) pickAvatarFor(kind, t.id);
      close();
      return;
    }
    if (itemId === "avatar_remove") {
      const kind = avatarKindForTarget(t.kind);
      if (kind) removeAvatar(kind, t.id);
      close();
      return;
    }

    if (itemId === "open") {
      if (t.kind === "dm" || t.kind === "group" || t.kind === "board") {
        selectTarget({ kind: t.kind, id: t.id });
      }
      close();
      return;
    }

    if (itemId === "invite_user") {
      if (t.kind !== "dm") {
        close();
        return;
      }
      if (st.conn !== "connected" || !st.authed) {
        store.set({ status: "Нет соединения" });
        close();
        return;
      }
      closeMobileSidebar();
      store.set({ modal: { kind: "invite_user", peer: t.id } });
      return;
    }

    if (itemId === "copy_id") {
      const ok = await copyText(t.id);
      store.set({ status: ok ? `Скопировано: ${t.id}` : `Не удалось скопировать: ${t.id}` });
      showToast(ok ? `Скопировано: ${t.id}` : `Не удалось скопировать: ${t.id}`, { kind: ok ? "success" : "error" });
      close();
      return;
    }

    if (t.kind === "message") {
      const selKey = st.selected ? conversationKey(st.selected) : "";
      const idx = Number.isFinite(Number(t.id)) ? Math.trunc(Number(t.id)) : -1;
      const conv = selKey ? st.conversations[selKey] : null;
      const msg = conv && idx >= 0 && idx < conv.length ? conv[idx] : null;
      const msgId = msg && typeof msg.id === "number" && Number.isFinite(msg.id) ? msg.id : null;

      if (itemId === "msg_copy") {
        const caption = msg?.attachment?.kind === "file" ? String(msg?.text || "").trim() : "";
        const text =
          msg?.attachment?.kind === "file" ? (caption || String(msg.attachment.name || "файл")) : String(msg?.text || "");
        const ok = await copyText(text);
        showToast(ok ? "Скопировано" : "Не удалось скопировать", { kind: ok ? "success" : "error" });
        close();
        return;
      }

      if (itemId === "msg_pin_toggle") {
        if (!selKey || msgId === null || msgId <= 0) {
          close();
          return;
        }
        const wasPinned = isPinnedMessage(st.pinnedMessages, selKey, msgId);
        const next = togglePinnedMessage(st.pinnedMessages, selKey, msgId);
        const nextIds = next[selKey] || [];
        const nextActive = { ...st.pinnedMessageActive };
        if (!wasPinned) {
          nextActive[selKey] = msgId;
        } else if (nextActive[selKey] === msgId || !nextIds.includes(nextActive[selKey])) {
          if (nextIds.length) nextActive[selKey] = nextIds[0];
          else delete nextActive[selKey];
        }
        store.set({ pinnedMessages: next, pinnedMessageActive: nextActive });
        if (st.selfId) savePinnedMessagesForUser(st.selfId, next);
        showToast(wasPinned ? "Откреплено" : "Закреплено", { kind: "success" });
        close();
        return;
      }

      if (itemId === "msg_edit") {
        if (!selKey || !msg || msgId === null || msgId <= 0) {
          close();
          return;
        }
        if (st.conn !== "connected" || !st.authed) {
          store.set({ status: "Нет соединения" });
          close();
          return;
        }
        beginEditingMessage(selKey, msgId, String(msg.text || ""));
        close();
        return;
      }

      if (itemId === "msg_delete_local") {
        if (!selKey || !conv || idx < 0 || idx >= conv.length) {
          close();
          return;
        }
        store.set((prev) => {
          const cur = prev.conversations[selKey];
          if (!cur || idx < 0 || idx >= cur.length) return prev;
          const deleted = cur[idx];
          const nextConv = [...cur.slice(0, idx), ...cur.slice(idx + 1)];
          if (!deleted || typeof deleted.id !== "number") {
            return { ...prev, conversations: { ...prev.conversations, [selKey]: nextConv } };
          }
          const ids = prev.pinnedMessages[selKey];
          if (!Array.isArray(ids) || !ids.includes(deleted.id)) {
            return { ...prev, conversations: { ...prev.conversations, [selKey]: nextConv } };
          }
          const nextList = ids.filter((x) => x !== deleted.id);
          const nextPinned = { ...prev.pinnedMessages };
          const nextActive = { ...prev.pinnedMessageActive };
          if (nextList.length) {
            nextPinned[selKey] = nextList;
            if (nextActive[selKey] === deleted.id || !nextList.includes(nextActive[selKey])) nextActive[selKey] = nextList[0];
          } else {
            delete nextPinned[selKey];
            delete nextActive[selKey];
          }
          if (prev.selfId) savePinnedMessagesForUser(prev.selfId, nextPinned);
          return {
            ...prev,
            conversations: { ...prev.conversations, [selKey]: nextConv },
            pinnedMessages: nextPinned,
            pinnedMessageActive: nextActive,
          };
        });
        showToast("Удалено у вас", { kind: "success" });
        close();
        return;
      }

      if (itemId === "msg_delete") {
        if (msgId === null || msgId <= 0) {
          close();
          return;
        }
        if (st.conn !== "connected" || !st.authed) {
          store.set({ status: "Нет соединения" });
          close();
          return;
        }
        gateway.send({ type: "message_delete", id: msgId });
        store.set({ status: "Удаляем сообщение…" });
        close();
        return;
      }

      close();
      return;
    }

    if (st.conn !== "connected" || !st.authed) {
      store.set({ status: "Нет соединения" });
      close();
      return;
    }

    if (itemId === "mark_read" && t.kind === "dm") {
      maybeSendMessageRead(t.id);
      showToast("Отмечено прочитанным", { kind: "success" });
      close();
      return;
    }

    if (itemId === "group_add_members" && t.kind === "group") {
      const g = st.groups.find((x) => x.id === t.id);
      const isOwner = Boolean(g?.owner_id && st.selfId && String(g.owner_id) === String(st.selfId));
      if (!isOwner) {
        store.set({ status: "Только владелец может добавлять участников" });
        close();
        return;
      }
      openMembersAddModal("group", t.id);
      return;
    }
    if (itemId === "board_add_members" && t.kind === "board") {
      const b = st.boards.find((x) => x.id === t.id);
      const isOwner = Boolean(b?.owner_id && st.selfId && String(b.owner_id) === String(st.selfId));
      if (!isOwner) {
        store.set({ status: "Только владелец может добавлять участников" });
        close();
        return;
      }
      openMembersAddModal("board", t.id);
      return;
    }

    if (itemId === "mute_toggle" && (t.kind === "dm" || t.kind === "group" || t.kind === "board")) {
      const nextValue = !st.muted.includes(t.id);
      gateway.send({ type: "mute_set", peer: t.id, value: nextValue });
      showToast(nextValue ? `Заглушено: ${t.id}` : `Звук включён: ${t.id}`, {
        kind: "info",
        undo: () => gateway.send({ type: "mute_set", peer: t.id, value: !nextValue }),
      });
      close();
      return;
    }
    if (itemId === "block_toggle" && (t.kind === "dm" || t.kind === "auth_in" || t.kind === "auth_out")) {
      const nextValue = !st.blocked.includes(t.id);
      gateway.send({ type: "block_set", peer: t.id, value: nextValue });
      showToast(nextValue ? `Заблокировано: ${t.id}` : `Разблокировано: ${t.id}`, {
        kind: nextValue ? "warn" : "info",
        undo: () => gateway.send({ type: "block_set", peer: t.id, value: !nextValue }),
      });
      close();
      return;
    }
    if (itemId === "chat_clear" && t.kind === "dm") {
      openConfirmModal({
        title: "Очистить историю?",
        message: `Удалить всю историю переписки с ${t.id}?`,
        confirmLabel: "Очистить",
        danger: true,
        action: { kind: "chat_clear", peer: t.id },
      });
      return;
    }
    if (itemId === "friend_remove" && t.kind === "dm") {
      openConfirmModal({
        title: "Удалить контакт?",
        message: `Удалить контакт ${t.id} из списка?`,
        confirmLabel: "Удалить",
        danger: true,
        action: { kind: "friend_remove", peer: t.id },
      });
      return;
    }
    if (itemId === "group_rename" && t.kind === "group") {
      const g = st.groups.find((x) => x.id === t.id);
      const isOwner = Boolean(g?.owner_id && st.selfId && String(g.owner_id) === String(st.selfId));
      if (!isOwner) {
        store.set({ status: "Только владелец может переименовать чат" });
        close();
        return;
      }
      openRenameModal("group", t.id);
      return;
    }
    if (itemId === "board_rename" && t.kind === "board") {
      const b = st.boards.find((x) => x.id === t.id);
      const isOwner = Boolean(b?.owner_id && st.selfId && String(b.owner_id) === String(st.selfId));
      if (!isOwner) {
        store.set({ status: "Только владелец может переименовать доску" });
        close();
        return;
      }
      openRenameModal("board", t.id);
      return;
    }
    if (itemId === "group_remove_members" && t.kind === "group") {
      const g = st.groups.find((x) => x.id === t.id);
      const isOwner = Boolean(g?.owner_id && st.selfId && String(g.owner_id) === String(st.selfId));
      if (!isOwner) {
        store.set({ status: "Только владелец может удалять участников" });
        close();
        return;
      }
      openMembersRemoveModal("group", t.id);
      return;
    }
    if (itemId === "board_remove_members" && t.kind === "board") {
      const b = st.boards.find((x) => x.id === t.id);
      const isOwner = Boolean(b?.owner_id && st.selfId && String(b.owner_id) === String(st.selfId));
      if (!isOwner) {
        store.set({ status: "Только владелец может удалять участников" });
        close();
        return;
      }
      openMembersRemoveModal("board", t.id);
      return;
    }
    if (itemId === "group_disband" && t.kind === "group") {
      openConfirmModal({
        title: "Удалить чат?",
        message: "Это удалит чат для всех участников. Действие необратимо.",
        confirmLabel: "Удалить чат",
        danger: true,
        action: { kind: "group_disband", groupId: t.id },
      });
      return;
    }
    if (itemId === "board_disband" && t.kind === "board") {
      openConfirmModal({
        title: "Удалить доску?",
        message: "Это удалит доску для всех участников. Действие необратимо.",
        confirmLabel: "Удалить доску",
        danger: true,
        action: { kind: "board_disband", boardId: t.id },
      });
      return;
    }
    if (itemId === "group_leave" && t.kind === "group") {
      openConfirmModal({
        title: "Покинуть чат?",
        message: "Вы перестанете получать сообщения из этого чата.",
        confirmLabel: "Выйти",
        danger: true,
        action: { kind: "group_leave", groupId: t.id },
      });
      return;
    }
    if (itemId === "board_leave" && t.kind === "board") {
      openConfirmModal({
        title: "Покинуть доску?",
        message: "Вы перестанете видеть обновления этой доски.",
        confirmLabel: "Выйти",
        danger: true,
        action: { kind: "board_leave", boardId: t.id },
      });
      return;
    }
    if (itemId === "auth_accept" && t.kind === "auth_in") {
      acceptAuth(t.id);
      close();
      return;
    }
    if (itemId === "auth_decline" && t.kind === "auth_in") {
      declineAuth(t.id);
      close();
      return;
    }
    if (itemId === "auth_cancel" && t.kind === "auth_out") {
      cancelAuth(t.id);
      close();
      return;
    }

    close();
  }

  const RESTART_STATE_KEY = "yagodka_restart_state_v1";

  function saveRestartState(st: AppState) {
    try {
      const selectedKey = st.selected ? conversationKey(st.selected) : "";
      const input = st.editing && selectedKey && st.editing.key === selectedKey ? st.editing.prevDraft || "" : st.input;
      const payload = {
        v: 1,
        page: st.page,
        userViewId: st.userViewId,
        selected: st.selected,
        input,
        drafts: st.drafts,
        pinned: st.pinned,
        chatSearchOpen: st.chatSearchOpen,
        chatSearchQuery: st.chatSearchQuery,
        chatSearchPos: st.chatSearchPos,
        searchQuery: st.searchQuery,
        profileDraftDisplayName: st.profileDraftDisplayName,
        profileDraftHandle: st.profileDraftHandle,
        profileDraftBio: st.profileDraftBio,
        profileDraftStatus: st.profileDraftStatus,
      };
      sessionStorage.setItem(RESTART_STATE_KEY, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }

  function consumeRestartState():
    | {
        page?: PageKind;
        userViewId?: string | null;
        selected?: TargetRef | null;
        input?: string;
        drafts?: Record<string, string>;
        pinned?: string[];
        chatSearchOpen?: boolean;
        chatSearchQuery?: string;
        chatSearchPos?: number;
        searchQuery?: string;
        profileDraftDisplayName?: string;
        profileDraftHandle?: string;
        profileDraftBio?: string;
        profileDraftStatus?: string;
      }
    | null {
    try {
      const raw = sessionStorage.getItem(RESTART_STATE_KEY);
      if (!raw) return null;
      sessionStorage.removeItem(RESTART_STATE_KEY);
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      const obj = parsed as any;
      if (obj.v !== 1) return null;

      const page: PageKind | undefined = ["main", "search", "profile", "user", "files"].includes(obj.page) ? obj.page : undefined;
      const userViewId = typeof obj.userViewId === "string" && obj.userViewId.trim() ? obj.userViewId.trim() : null;

      const selectedRaw = obj.selected;
      const selected: TargetRef | null =
        selectedRaw &&
        typeof selectedRaw === "object" &&
        ["dm", "group", "board"].includes(selectedRaw.kind) &&
        typeof selectedRaw.id === "string" &&
        String(selectedRaw.id || "").trim()
          ? { kind: selectedRaw.kind, id: String(selectedRaw.id).trim() }
          : null;

      const input = typeof obj.input === "string" ? obj.input : "";
      const drafts = sanitizeDraftMap(obj.drafts);
      const pinned = sanitizePins(obj.pinned);
      const chatSearchOpen = Boolean(obj.chatSearchOpen);
      const chatSearchQuery = typeof obj.chatSearchQuery === "string" ? obj.chatSearchQuery : "";
      const chatSearchPos = Number.isFinite(obj.chatSearchPos) ? Math.trunc(obj.chatSearchPos) : 0;
      const searchQuery = typeof obj.searchQuery === "string" ? obj.searchQuery : "";
      const profileDraftDisplayName = typeof obj.profileDraftDisplayName === "string" ? obj.profileDraftDisplayName : "";
      const profileDraftHandle = typeof obj.profileDraftHandle === "string" ? obj.profileDraftHandle : "";
      const profileDraftBio = typeof obj.profileDraftBio === "string" ? obj.profileDraftBio : "";
      const profileDraftStatus = typeof obj.profileDraftStatus === "string" ? obj.profileDraftStatus : "";

      return {
        page,
        userViewId,
        selected,
        input,
        drafts,
        pinned,
        chatSearchOpen,
        chatSearchQuery,
        chatSearchPos,
        searchQuery,
        profileDraftDisplayName,
        profileDraftHandle,
        profileDraftBio,
        profileDraftStatus,
      };
    } catch {
      return null;
    }
  }

  async function applyPwaUpdateNow() {
    flushDrafts(store);
    flushOutbox(store);
    saveRestartState(store.get());
    store.set({ status: "Применяем обновление веб-клиента…" });
    try {
      sessionStorage.setItem("yagodka_updating", "1");
    } catch {
      // ignore
    }
    try {
      await activatePwaUpdate();
    } catch {
      // ignore
    }
    // iOS/WebKit may occasionally produce a blank screen on `reload()` after a SW update.
    // `location.replace()` behaves more like a fresh navigation and is generally more reliable.
    try {
      window.location.replace(window.location.href);
      return;
    } catch {
      // ignore
    }
    window.location.reload();
  }

  function isSafeToAutoApplyUpdate(st: AppState): boolean {
    const hasActiveTransfer = (st.fileTransfers || []).some((t) => t.status === "uploading" || t.status === "downloading");
    if (hasActiveTransfer) return false;
    if (st.modal) return false;
    // Не перезапускаем приложение, пока пользователь находится в поле ввода (особенно на iOS).
    const ae = document.activeElement as HTMLElement | null;
    if (ae && (ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement || ae.isContentEditable)) return false;
    // Не дёргаем PWA/веб обновление, когда вкладка неактивна: на мобилках это часто даёт "чёрный экран" при возврате.
    if (document.visibilityState !== "visible") return false;
    const now = Date.now();
    const idleFor = Math.max(0, now - (lastUserInputAt || 0));
    // Даем пользователю чуть "тишины", чтобы не перезагружать в момент активного ввода/кликов.
    if (idleFor < 3_000) return false;
    return true;
  }

  function scheduleAutoApplyPwaUpdate() {
    if (pwaAutoApplyTimer !== null) return;
    pwaAutoApplyTimer = window.setTimeout(() => {
      pwaAutoApplyTimer = null;
      const st = store.get();
      if (!st.pwaUpdateAvailable) return;
      if (!isSafeToAutoApplyUpdate(st)) {
        scheduleAutoApplyPwaUpdate();
        return;
      }
      void applyPwaUpdateNow();
    }, 800);
  }

  window.addEventListener("yagodka:pwa-build", (ev) => {
    const detail = (ev as CustomEvent<any>).detail;
    const buildId = String(detail?.buildId ?? "").trim();
    if (!buildId) return;
    const current = store.get().clientVersion;
    if (current === buildId) return;
    store.set({ clientVersion: buildId });
    const st = store.get();
    if (st.conn === "connected" && st.authed) {
      gateway.send({ type: "client_info", client: "web", version: buildId });
    }
    // Если SW уже обновился до новой semver, а JS ещё старый — тихо перезапускаем приложение.
    if (shouldReloadForBuild(APP_VERSION, buildId)) {
      store.set((prev) => ({
        ...prev,
        pwaUpdateAvailable: true,
        status: prev.status || "Обновление веб-клиента…",
      }));
      scheduleAutoApplyPwaUpdate();
    }
  });

  window.addEventListener("yagodka:pwa-update", () => {
    store.set({ pwaUpdateAvailable: true, status: "Получено обновление веб-клиента (применится автоматически)" });
    scheduleAutoApplyPwaUpdate();
  });

  function handleHotkey(key: string) {
    const st = store.get();
    if (st.modal && st.modal.kind !== "auth") return;
    closeMobileSidebar();
    if (key === "F1") {
      if (st.modal) closeModal();
      setPage("help");
      return;
    }
    if (!st.authed) return;
    if (key === "F2") {
      setPage("profile");
      gateway.send({ type: "profile_get" });
      return;
    }
    if (key === "F3") {
      setPage("search");
      return;
    }
    if (key === "F5") {
      openGroupCreateModal();
      return;
    }
    if (key === "F6") {
      openBoardCreateModal();
      return;
    }
    if (key === "F7") {
      setPage("files");
      return;
    }
  }

  window.addEventListener("keydown", (e) => {
    const st = store.get();

    if (st.modal?.kind === "auth" && !st.authed) {
      if (e.key.startsWith("F")) {
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "u" || e.key === "U")) {
        e.preventDefault();
        return;
      }
    }

    if (st.modal?.kind === "pwa_update") {
      if ((e.ctrlKey || e.metaKey) && (e.key === "u" || e.key === "U")) {
        e.preventDefault();
        void applyPwaUpdateNow();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        void applyPwaUpdateNow();
        return;
      }
      if (!["Shift", "Control", "Alt", "Meta"].includes(e.key)) {
        e.preventDefault();
        closeModal();
      }
      return;
    }

    if (st.modal?.kind === "update") {
      if ((e.ctrlKey || e.metaKey) && (e.key === "u" || e.key === "U")) {
        e.preventDefault();
        window.location.reload();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        window.location.reload();
        return;
      }
      if (!["Shift", "Control", "Alt", "Meta"].includes(e.key)) {
        e.preventDefault();
        closeModal();
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === "u" || e.key === "U")) {
      e.preventDefault();
      if (!st.authed) return;
      if (st.pwaUpdateAvailable) {
        void applyPwaUpdateNow();
      } else if (st.updateLatest) {
        window.location.reload();
      } else {
        store.set({ status: "Обновлений веб-клиента нет" });
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
      if (st.page === "main" && !st.modal && st.selected) {
        e.preventDefault();
        openChatSearch();
      }
      return;
    }

    if (e.key === "Escape") {
      if (!st.modal && mobileSidebarOpen) {
        e.preventDefault();
        closeMobileSidebar();
        return;
      }
      if (st.modal) {
        e.preventDefault();
        closeModal();
        return;
      }
      if (st.chatSearchOpen) {
        e.preventDefault();
        closeChatSearch();
        return;
      }
      if (st.page !== "main") {
        e.preventDefault();
        setPage("main");
      }
      return;
    }

    if (e.key.startsWith("F")) {
      e.preventDefault();
      handleHotkey(e.key);
    }
  });

  layout.hotkeys.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement | null)?.closest("button[data-key]") as HTMLButtonElement | null;
    if (!btn) return;
    const key = btn.dataset.key || "";
    if (!key) return;
    handleHotkey(key);
  });

  // Desktop: prevent scroll jumps on right click / Ctrl+Click (macOS) before opening our context menu.
  let suppressSidebarClick = false;
  let suppressSidebarClickTimer: number | null = null;
  let sidebarCtxClickSuppression: CtxClickSuppressionState = { key: null, until: 0 };
  let sidebarCtxMouseFallbackSuppressUntil = 0;

  function armSidebarClickSuppression(ms: number) {
    suppressSidebarClick = true;
    if (suppressSidebarClickTimer !== null) {
      window.clearTimeout(suppressSidebarClickTimer);
      suppressSidebarClickTimer = null;
    }
    suppressSidebarClickTimer = window.setTimeout(() => {
      suppressSidebarClick = false;
      suppressSidebarClickTimer = null;
    }, ms);
  }

  function disarmSidebarClickSuppression() {
    suppressSidebarClick = false;
    if (suppressSidebarClickTimer !== null) {
      window.clearTimeout(suppressSidebarClickTimer);
      suppressSidebarClickTimer = null;
    }
  }

  // Some browsers (notably Safari) may scroll a focusable element into view on RMB/Ctrl+Click
  // *before* the `contextmenu` event fires. Remember the scroll position early so we can restore it.
  let sidebarCtxPrevTop = 0;
  let sidebarCtxPrevLeft = 0;
  let sidebarCtxPrevAt = 0;
  let sidebarCtxHasPrev = false;
  // Keep this low to avoid restoring a stale snapshot (which would look like a jump).
  const SIDEBAR_CTX_SCROLL_MAX_AGE_MS = 1200;

  function rememberSidebarCtxScroll() {
    sidebarCtxPrevTop = layout.sidebar.scrollTop;
    sidebarCtxPrevLeft = layout.sidebar.scrollLeft;
    sidebarCtxPrevAt = Date.now();
    sidebarCtxHasPrev = true;
  }

  function stabilizeSidebarScrollOnContextClick(top: number, left: number) {
    const restore = () => restoreSidebarCtxScroll(top, left);
    restore();
    window.requestAnimationFrame(restore);
    window.setTimeout(restore, 0);
    window.setTimeout(restore, 80);
  }

  function readSidebarCtxScrollSnapshot() {
    const r = readScrollSnapshot({
      curTop: layout.sidebar.scrollTop,
      curLeft: layout.sidebar.scrollLeft,
      prevTop: sidebarCtxPrevTop,
      prevLeft: sidebarCtxPrevLeft,
      prevAt: sidebarCtxPrevAt,
      hasPrev: sidebarCtxHasPrev,
      maxAgeMs: SIDEBAR_CTX_SCROLL_MAX_AGE_MS,
    });
    return { top: r.top, left: r.left };
  }

  function restoreSidebarCtxScroll(top: number, left: number) {
    if (layout.sidebar.scrollTop !== top) layout.sidebar.scrollTop = top;
    if (layout.sidebar.scrollLeft !== left) layout.sidebar.scrollLeft = left;
  }

  const sidebarCtxScrollLock = createRafScrollLock({
    restore: restoreSidebarCtxScroll,
    requestAnimationFrame: (cb) => window.requestAnimationFrame(cb),
    cancelAnimationFrame: (id) => window.cancelAnimationFrame(id),
  });

  store.subscribe(() => {
    const st = store.get();
    if (!st.modal || st.modal.kind !== "context_menu") sidebarCtxScrollLock.stop();
  });

  layout.sidebar.addEventListener(
    "pointerdown",
    (e) => {
      const ev = e as PointerEvent;
      if (ev.pointerType !== "mouse") return;
      const isContextClick = ev.button === 2 || (ev.button === 0 && ev.ctrlKey);
      if (!isContextClick) return;
      const btn = (ev.target as HTMLElement | null)?.closest("button[data-ctx-kind][data-ctx-id]") as HTMLButtonElement | null;
      if (!btn) return;
      sidebarCtxMouseFallbackSuppressUntil = Date.now() + 250;
      rememberSidebarCtxScroll();
      const { top, left } = readSidebarCtxScrollSnapshot();
      stabilizeSidebarScrollOnContextClick(top, left);
      ev.preventDefault();
      ev.stopPropagation();
      armSidebarClickSuppression(650);
    },
    true
  );

  layout.sidebar.addEventListener(
    "mousedown",
    (e) => {
      const ev = e as MouseEvent;
      if (Date.now() < sidebarCtxMouseFallbackSuppressUntil) return;
      const isContextClick = ev.button === 2 || (ev.button === 0 && ev.ctrlKey);
      if (!isContextClick) return;
      const btn = (ev.target as HTMLElement | null)?.closest("button[data-ctx-kind][data-ctx-id]") as HTMLButtonElement | null;
      if (!btn) return;
      rememberSidebarCtxScroll();
      const { top, left } = readSidebarCtxScrollSnapshot();
      stabilizeSidebarScrollOnContextClick(top, left);
      ev.preventDefault();
      ev.stopPropagation();
      armSidebarClickSuppression(650);
    },
    true
  );

  // Even show/restore scroll *before* our contextmenu handler, if the browser scrolls on mouseup.
  layout.sidebar.addEventListener(
    "pointerup",
    (e) => {
      const ev = e as PointerEvent;
      if (ev.pointerType !== "mouse") return;
      const isContextClick = ev.button === 2 || (ev.button === 0 && ev.ctrlKey);
      if (!isContextClick) return;
      const btn = (ev.target as HTMLElement | null)?.closest("button[data-ctx-kind][data-ctx-id]") as HTMLButtonElement | null;
      if (!btn) return;
      const { top, left } = readSidebarCtxScrollSnapshot();
      restoreSidebarCtxScroll(top, left);
    },
    true
  );

  layout.sidebar.addEventListener(
    "mouseup",
    (e) => {
      const ev = e as MouseEvent;
      const isContextClick = ev.button === 2 || (ev.button === 0 && ev.ctrlKey);
      if (!isContextClick) return;
      const btn = (ev.target as HTMLElement | null)?.closest("button[data-ctx-kind][data-ctx-id]") as HTMLButtonElement | null;
      if (!btn) return;
      const { top, left } = readSidebarCtxScrollSnapshot();
      restoreSidebarCtxScroll(top, left);
    },
    true
  );

  layout.sidebar.addEventListener("contextmenu", (e) => {
    const { top: prevTop, left: prevLeft } = readSidebarCtxScrollSnapshot();
    const btn = (e.target as HTMLElement | null)?.closest("button[data-ctx-kind][data-ctx-id]") as HTMLButtonElement | null;
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    // In some browsers Ctrl+Click may still generate a click; suppress it so the list doesn't jump/activate.
    armSidebarClickSuppression(650);

    const st = store.get();
    if (st.modal) {
      restoreSidebarCtxScroll(prevTop, prevLeft);
      return;
    }
    const kind = (btn.getAttribute("data-ctx-kind") || "").trim() as ContextMenuTargetKind;
    const id = (btn.getAttribute("data-ctx-id") || "").trim();
    if (!kind || !id) return;
    sidebarCtxClickSuppression = armCtxClickSuppression(sidebarCtxClickSuppression, kind, id, 1800);
    openContextMenu({ kind, id }, e.clientX, e.clientY);
    // Подстраховка от "скачков" скролла на некоторых браузерах при открытии контекстного меню.
    sidebarCtxScrollLock.start(prevTop, prevLeft);

    const onFocus = (ev: FocusEvent) => {
      const t = ev.target as HTMLElement | null;
      if (!t) return;
      if (!t.closest(".ctx-menu")) return;
      document.removeEventListener("focusin", onFocus, true);
      restoreSidebarCtxScroll(prevTop, prevLeft);
    };
    document.addEventListener("focusin", onFocus, true);
    window.setTimeout(() => document.removeEventListener("focusin", onFocus, true), 900);
  });

  // Keyboard access: open context menu with Menu key or Shift+F10.
  layout.sidebar.addEventListener("keydown", (e) => {
    const st = store.get();
    if (st.modal) return;
    const isMenuKey = e.key === "ContextMenu" || (e.shiftKey && e.key === "F10");
    if (!isMenuKey) return;
    const btn = (document.activeElement as HTMLElement | null)?.closest("button[data-ctx-kind][data-ctx-id]") as HTMLButtonElement | null;
    if (!btn) return;
    const kind = (btn.getAttribute("data-ctx-kind") || "").trim() as ContextMenuTargetKind;
    const id = (btn.getAttribute("data-ctx-id") || "").trim();
    if (!kind || !id) return;
    e.preventDefault();
    const rect = btn.getBoundingClientRect();
    const x = Math.round(rect.left + Math.min(24, Math.max(8, rect.width / 2)));
    const y = Math.round(rect.bottom - 2);
    openContextMenu({ kind, id }, x, y);
  });

  // Mobile/touch: open context menu on long-press (Telegram-like).
  let longPressTimer: number | null = null;
  let longPressStartX = 0;
  let longPressStartY = 0;

  const clearLongPress = () => {
    if (longPressTimer !== null) {
      window.clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };

  layout.sidebar.addEventListener("pointerdown", (e) => {
    const st = store.get();
    if (st.modal) return;
    const ev = e as PointerEvent;
    // Only long-press for touch/pen (mouse has right click).
    if (ev.pointerType === "mouse") return;
    if (ev.button !== 0) return;
    const btn = (ev.target as HTMLElement | null)?.closest("button[data-ctx-kind][data-ctx-id]") as HTMLButtonElement | null;
    if (!btn) return;
    const kind = (btn.getAttribute("data-ctx-kind") || "").trim() as ContextMenuTargetKind;
    const id = (btn.getAttribute("data-ctx-id") || "").trim();
    if (!kind || !id) return;
    clearLongPress();
    longPressStartX = ev.clientX;
    longPressStartY = ev.clientY;
      longPressTimer = window.setTimeout(() => {
        longPressTimer = null;
        armSidebarClickSuppression(600);
        const prevTop = layout.sidebar.scrollTop;
        const prevLeft = layout.sidebar.scrollLeft;
        sidebarCtxClickSuppression = armCtxClickSuppression(sidebarCtxClickSuppression, kind, id, 1800);
        openContextMenu({ kind, id }, longPressStartX, longPressStartY);
        window.requestAnimationFrame(() => {
          if (layout.sidebar.scrollTop !== prevTop) layout.sidebar.scrollTop = prevTop;
          if (layout.sidebar.scrollLeft !== prevLeft) layout.sidebar.scrollLeft = prevLeft;
      });
      window.setTimeout(() => {
        if (layout.sidebar.scrollTop !== prevTop) layout.sidebar.scrollTop = prevTop;
        if (layout.sidebar.scrollLeft !== prevLeft) layout.sidebar.scrollLeft = prevLeft;
      }, 0);
    }, 520);
  });

  layout.sidebar.addEventListener("pointermove", (e) => {
    if (longPressTimer === null) return;
    const ev = e as PointerEvent;
    const dx = Math.abs(ev.clientX - longPressStartX);
    const dy = Math.abs(ev.clientY - longPressStartY);
    if (dx > 12 || dy > 12) clearLongPress();
  });

  layout.sidebar.addEventListener("pointerup", () => clearLongPress());
  layout.sidebar.addEventListener("pointercancel", () => clearLongPress());
  layout.sidebar.addEventListener("scroll", () => clearLongPress(), { passive: true });

  // If long-press opened the menu, suppress the click that would otherwise activate the row.
  layout.sidebar.addEventListener(
    "click",
    (e) => {
      const btn = (e.target as HTMLElement | null)?.closest("button[data-ctx-kind][data-ctx-id]") as HTMLButtonElement | null;
      if (!btn) return;
      const kind = (btn.getAttribute("data-ctx-kind") || "").trim();
      const id = (btn.getAttribute("data-ctx-id") || "").trim();
      const consumed = consumeCtxClickSuppression(sidebarCtxClickSuppression, kind, id);
      sidebarCtxClickSuppression = consumed.state;
      const keySuppressed = consumed.suppressed;
      const shouldSuppress = suppressSidebarClick || keySuppressed;
      if (!shouldSuppress) return;
      e.preventDefault();
      e.stopPropagation();
      disarmSidebarClickSuppression();
    },
    true
  );

  // Chat messages: context menu (ПКМ / Ctrl+Click).
  layout.chat.addEventListener(
    "pointerdown",
    (e) => {
      const st = store.get();
      if (st.modal) return;
      const ev = e as PointerEvent;
      if (ev.pointerType !== "mouse") return;
      const isContextClick = ev.button === 2 || (ev.button === 0 && ev.ctrlKey);
      if (!isContextClick) return;
      const row = (ev.target as HTMLElement | null)?.closest("[data-msg-idx]") as HTMLElement | null;
      if (!row) return;
      ev.preventDefault();
    },
    true
  );

  layout.chat.addEventListener(
    "mousedown",
    (e) => {
      const st = store.get();
      if (st.modal) return;
      const ev = e as MouseEvent;
      const isContextClick = ev.button === 2 || (ev.button === 0 && ev.ctrlKey);
      if (!isContextClick) return;
      const row = (ev.target as HTMLElement | null)?.closest("[data-msg-idx]") as HTMLElement | null;
      if (!row) return;
      ev.preventDefault();
    },
    true
  );

  layout.chat.addEventListener("contextmenu", (e) => {
    const st = store.get();
    if (st.modal) return;
    if (!st.selected) return;
    const row = (e.target as HTMLElement | null)?.closest("[data-msg-idx]") as HTMLElement | null;
    if (!row) return;
    const idx = String(row.getAttribute("data-msg-idx") || "").trim();
    if (!idx) return;
    e.preventDefault();
    openContextMenu({ kind: "message", id: idx }, e.clientX, e.clientY);
  });

  // Mobile/touch: message context menu on long-press.
  let msgLongPressTimer: number | null = null;
  let msgLongPressStartX = 0;
  let msgLongPressStartY = 0;
  let msgLongPressIdx = "";

  const clearMsgLongPress = () => {
    if (msgLongPressTimer !== null) {
      window.clearTimeout(msgLongPressTimer);
      msgLongPressTimer = null;
    }
  };

  layout.chat.addEventListener("pointerdown", (e) => {
    const st = store.get();
    if (st.modal) return;
    if (!st.selected) return;
    const ev = e as PointerEvent;
    // Only long-press for touch/pen (mouse has right click).
    if (ev.pointerType === "mouse") return;
    if (ev.button !== 0) return;
    const row = (ev.target as HTMLElement | null)?.closest("[data-msg-idx]") as HTMLElement | null;
    if (!row) return;
    const idx = String(row.getAttribute("data-msg-idx") || "").trim();
    if (!idx) return;

    clearMsgLongPress();
    msgLongPressStartX = ev.clientX;
    msgLongPressStartY = ev.clientY;
    msgLongPressIdx = idx;
    msgLongPressTimer = window.setTimeout(() => {
      msgLongPressTimer = null;
      // После long-press обычно прилетает "click" — глушим его, чтобы не открывать вложения/не прыгать.
      suppressChatClickUntil = Date.now() + 800;
      openContextMenu({ kind: "message", id: msgLongPressIdx }, msgLongPressStartX, msgLongPressStartY);
    }, 520);
  });

  layout.chat.addEventListener("pointermove", (e) => {
    if (msgLongPressTimer === null) return;
    const ev = e as PointerEvent;
    const dx = Math.abs(ev.clientX - msgLongPressStartX);
    const dy = Math.abs(ev.clientY - msgLongPressStartY);
    if (dx > 12 || dy > 12) clearMsgLongPress();
  });

  layout.chat.addEventListener("pointerup", () => clearMsgLongPress());
  layout.chat.addEventListener("pointercancel", () => clearMsgLongPress());
  layout.chatHost.addEventListener("scroll", () => clearMsgLongPress(), { passive: true });

  const actions = {
    onSelectTarget: (t: TargetRef) => selectTarget(t),
    onOpenUser: (id: string) => openUserPage(id),
    onOpenActionModal: (payload: ActionModalPayload) => openActionModal(payload),
    onOpenHelp: () => setPage("help"),
    onOpenGroupCreate: () => openGroupCreateModal(),
    onOpenBoardCreate: () => openBoardCreateModal(),
    onSetPage: (page: PageKind) => {
      setPage(page);
      const st = store.get();
      if (page === "profile" && st.authed && st.conn === "connected") {
        gateway.send({ type: "profile_get" });
      }
    },
    onSetMobileSidebarTab: (tab: MobileSidebarTab) => setMobileSidebarTab(tab),
    onAuthLogin: () => authLogin(),
    onAuthRegister: () => authRegister(),
    onAuthModeChange: (mode: "register" | "login") => store.set({ authMode: mode, modal: { kind: "auth" } }),
    onCloseModal: () => closeModal(),
    onDismissUpdate: () => store.set({ modal: null, updateDismissedLatest: store.get().updateLatest }),
    onReloadUpdate: () => window.location.reload(),
    onApplyPwaUpdate: () => void applyPwaUpdateNow(),
    onSkinChange: (skinId: string) => setSkin(skinId),
    onGroupCreate: () => createGroup(),
    onBoardCreate: () => createBoard(),
    onMembersAdd: () => membersAddSubmit(),
    onMembersRemove: () => membersRemoveSubmit(),
    onRename: () => renameSubmit(),
    onInviteUser: () => inviteUserSubmit(),
    onAuthRequest: (peer: string) => requestAuth(peer),
    onAuthAccept: (peer: string) => acceptAuth(peer),
    onAuthDecline: (peer: string) => declineAuth(peer),
    onAuthCancel: (peer: string) => cancelAuth(peer),
    onGroupJoin: (groupId: string) => joinGroup(groupId),
    onBoardJoin: (boardId: string) => joinBoard(boardId),
    onGroupInviteAccept: (groupId: string) => acceptGroupInvite(groupId),
    onGroupInviteDecline: (groupId: string) => declineGroupInvite(groupId),
    onGroupJoinAccept: (groupId: string, peer: string) => acceptGroupJoin(groupId, peer),
    onGroupJoinDecline: (groupId: string, peer: string) => declineGroupJoin(groupId, peer),
    onBoardInviteJoin: (boardId: string) => joinBoardFromInvite(boardId),
    onBoardInviteDecline: (boardId: string) => declineBoardInvite(boardId),
    onFileSend: (file: File | null, target: TargetRef | null) => sendFile(file, target),
    onFileOfferAccept: (fileId: string) => acceptFileOffer(fileId),
    onFileOfferReject: (fileId: string) => rejectFileOffer(fileId),
    onClearCompletedFiles: () => clearCompletedFiles(),
    onSearchQueryChange: (query: string) => {
      if (store.get().searchQuery === query) return;
      lastUserInputAt = Date.now();
      store.set({ searchQuery: query });

      if (searchDebounceTimer !== null) {
        window.clearTimeout(searchDebounceTimer);
        searchDebounceTimer = null;
      }

      const st = store.get();
      if (!st.authed || st.conn !== "connected" || st.page !== "search") return;

      const q = query.trim();
      if (!q) {
        lastSearchIssued = "";
        store.set({ searchResults: [] });
        return;
      }

      const digits = q.replace(/\D/g, "");
      const shouldSearchNow = q.startsWith("@") ? q.length >= 4 : digits ? digits.length >= 3 : q.length >= 3;
      if (!shouldSearchNow) {
        store.set({ searchResults: [] });
        return;
      }

      searchDebounceTimer = window.setTimeout(() => {
        searchDebounceTimer = null;
        const q2 = store.get().searchQuery.trim();
        if (!q2) return;
        const st2 = store.get();
        if (!st2.authed || st2.conn !== "connected" || st2.page !== "search") return;
        if (q2 === lastSearchIssued) return;
        lastSearchIssued = q2;
        store.set({ searchResults: [] });
        gateway.send({ type: "search", query: q2 });
      }, 180);
    },
    onSearchSubmit: (query: string) => {
      const q = query.trim();
      lastUserInputAt = Date.now();
      store.set({ searchQuery: q, searchResults: [] });
      if (!q) return;
      lastSearchIssued = q;
      gateway.send({ type: "search", query: q });
    },
    onProfileDraftChange: (draft: { displayName: string; handle: string; bio: string; status: string }) => {
      lastUserInputAt = Date.now();
      store.set({
        profileDraftDisplayName: draft.displayName,
        profileDraftHandle: draft.handle,
        profileDraftBio: draft.bio,
        profileDraftStatus: draft.status,
      });
    },
    onProfileSave: (draft: { displayName: string; handle: string; bio: string; status: string }) => {
      const display_name = draft.displayName.trim();
      const handle = draft.handle.trim();
      const bio = draft.bio.trim();
      const status = draft.status.trim();
      gateway.send({
        type: "profile_set",
        display_name: display_name || null,
        handle: handle || null,
        bio: bio || null,
        status: status || null,
      });
      store.set({ status: "Сохранение профиля…" });
    },
    onProfileRefresh: () => gateway.send({ type: "profile_get" }),
    onProfileAvatarSelect: (file: File | null) => {
      const id = store.get().selfId;
      if (!id) return;
      if (!file) return;
      void (async () => {
        try {
          const dataUrl = await imageFileToAvatarDataUrl(file, 128);
          storeAvatar("dm", id, dataUrl);
          bumpAvatars("Аватар загружается…");
          const base64 = String(dataUrl.split(",")[1] || "").trim();
          if (!base64) throw new Error("bad_avatar_data");
          gateway.send({ type: "avatar_set", mime: "image/png", data: base64 });
        } catch (e) {
          bumpAvatars(`Не удалось загрузить аватар: ${String((e as any)?.message || "ошибка")}`);
        }
      })();
    },
    onProfileAvatarClear: () => {
      const id = store.get().selfId;
      if (!id) return;
      store.set({ status: "Удаляем аватар…" });
      gateway.send({ type: "avatar_clear" });
    },
    onContextMenuAction: (itemId: string) => void handleContextMenuAction(itemId),
    onConfirmModal: () => confirmSubmit(),
  };

  const restored = consumeRestartState();
	  if (restored) {
	    store.set((prev) => ({
	      ...prev,
	      ...(restored.page ? { page: restored.page } : {}),
	      userViewId: restored.userViewId ?? prev.userViewId,
	      ...(restored.selected ? { selected: restored.selected } : {}),
	      input: restored.input ?? prev.input,
	      drafts: restored.drafts ?? prev.drafts,
	      pinned: restored.pinned ?? prev.pinned,
	      chatSearchOpen: restored.chatSearchOpen ?? prev.chatSearchOpen,
	      chatSearchQuery: restored.chatSearchQuery ?? prev.chatSearchQuery,
	      chatSearchPos: restored.chatSearchPos ?? prev.chatSearchPos,
	      searchQuery: restored.searchQuery ?? prev.searchQuery,
	      profileDraftDisplayName: restored.profileDraftDisplayName ?? prev.profileDraftDisplayName,
	      profileDraftHandle: restored.profileDraftHandle ?? prev.profileDraftHandle,
	      profileDraftBio: restored.profileDraftBio ?? prev.profileDraftBio,
	      profileDraftStatus: restored.profileDraftStatus ?? prev.profileDraftStatus,
	    }));
	    try {
	      layout.input.value = restored.input ?? "";
	      autosizeInput(layout.input);
    } catch {
      // ignore
    }
  }

  let prevAuthed = store.get().authed;
  let prevEditing: { key: string; id: number } | null = (() => {
    const e = store.get().editing;
    return e ? { key: e.key, id: e.id } : null;
  })();

  store.subscribe(() => {
    const st = store.get();
    const cur = st.editing ? { key: st.editing.key, id: st.editing.id } : null;
    const ended = Boolean(prevEditing && !cur);
    prevEditing = cur;
    if (!ended) return;
    try {
      const next = st.input || "";
      if (layout.input.value !== next) layout.input.value = next;
      autosizeInput(layout.input);
    } catch {
      // ignore
    }
  });

	  store.subscribe(() => {
	    const st = store.get();
	    if (
	      st.authed &&
	      st.selfId &&
	      (draftsLoadedForUser !== st.selfId ||
	        pinsLoadedForUser !== st.selfId ||
	        pinnedMessagesLoadedForUser !== st.selfId ||
	        fileTransfersLoadedForUser !== st.selfId ||
	        outboxLoadedForUser !== st.selfId)
	    ) {
	      const needDrafts = draftsLoadedForUser !== st.selfId;
	      const needPins = pinsLoadedForUser !== st.selfId;
	      const needPinnedMessages = pinnedMessagesLoadedForUser !== st.selfId;
	      const needFileTransfers = fileTransfersLoadedForUser !== st.selfId;
	      const needOutbox = outboxLoadedForUser !== st.selfId;
	      if (needDrafts) draftsLoadedForUser = st.selfId;
	      if (needPins) pinsLoadedForUser = st.selfId;
	      if (needPinnedMessages) pinnedMessagesLoadedForUser = st.selfId;
	      if (needFileTransfers) fileTransfersLoadedForUser = st.selfId;
	      if (needOutbox) outboxLoadedForUser = st.selfId;

      const storedDrafts = needDrafts ? loadDraftsForUser(st.selfId) : {};
      const mergedDrafts = needDrafts ? { ...storedDrafts, ...st.drafts } : st.drafts;

      const storedPins = needPins ? loadPinsForUser(st.selfId) : [];
      const mergedPins = needPins ? [...st.pinned, ...storedPins.filter((x) => !st.pinned.includes(x))] : st.pinned;

      const storedPinnedMessages = needPinnedMessages ? loadPinnedMessagesForUser(st.selfId) : {};
      const mergedPinnedMessages = needPinnedMessages ? mergePinnedMessagesMaps(storedPinnedMessages, st.pinnedMessages) : st.pinnedMessages;

	      const storedFileTransfers = needFileTransfers ? loadFileTransfersForUser(st.selfId) : [];
	      const mergedFileTransfers = (() => {
	        if (!needFileTransfers) return st.fileTransfers;
        const present = new Set<string>();
        for (const e of st.fileTransfers) {
          const k = String(e.id || e.localId || "").trim();
          if (k) present.add(k);
        }
        const extras = storedFileTransfers.filter((e) => {
          const k = String(e.id || e.localId || "").trim();
          if (!k) return false;
          return !present.has(k);
        });
	        return extras.length ? [...st.fileTransfers, ...extras] : st.fileTransfers;
	      })();

	      const storedOutboxRaw = needOutbox ? loadOutboxForUser(st.selfId) : {};
	      const storedOutbox = (() => {
	        if (!needOutbox) return st.outbox;
	        const out: typeof st.outbox = {};
	        for (const [k, list] of Object.entries(storedOutboxRaw || {})) {
	          const arr = Array.isArray(list) ? list : [];
	          const normalized = arr
	            .map((e) => ({ ...e, status: "queued" as const }))
	            .filter((e) => typeof e.localId === "string" && Boolean(e.localId.trim()));
	          if (normalized.length) out[k] = normalized;
	        }
	        return out;
	      })();

	      const mergedOutbox = (() => {
	        if (!needOutbox) return st.outbox;
	        const out: typeof st.outbox = { ...storedOutbox };
	        for (const [k, list] of Object.entries(st.outbox || {})) {
	          const base = Array.isArray(out[k]) ? out[k] : [];
	          const seen = new Set(base.map((e) => String(e.localId || "").trim()).filter(Boolean));
	          const extras = (Array.isArray(list) ? list : []).filter((e) => {
	            const lid = typeof e?.localId === "string" ? e.localId.trim() : "";
	            return Boolean(lid) && !seen.has(lid);
	          });
	          if (extras.length) out[k] = [...base, ...extras].sort((a, b) => a.ts - b.ts);
	        }
	        return out;
	      })();

	      const mergedConversations = (() => {
	        if (!needOutbox) return st.conversations;
	        let changed = false;
	        const next: typeof st.conversations = { ...st.conversations };
	        for (const [k, list] of Object.entries(mergedOutbox)) {
	          const out = Array.isArray(list) ? list : [];
	          if (!out.length) continue;
	          const prevConv = next[k] ?? [];
	          const has = new Set(prevConv.map((m) => (typeof m.localId === "string" ? m.localId : "")).filter(Boolean));
	          const add = out
	            .filter((e) => !has.has(e.localId))
	            .map((e) => ({
	              kind: "out" as const,
	              from: st.selfId || "",
	              to: e.to,
	              room: e.room,
	              text: e.text,
	              ts: e.ts,
	              localId: e.localId,
	              id: null,
	              status: "queued" as const,
	            }));
	          if (!add.length) continue;
	          changed = true;
	          next[k] = [...prevConv, ...add].sort((a, b) => {
	            const sa = typeof a.id === "number" && Number.isFinite(a.id) ? a.id : a.ts;
	            const sb = typeof b.id === "number" && Number.isFinite(b.id) ? b.id : b.ts;
	            return sa - sb;
	          });
	        }
	        return changed ? next : st.conversations;
	      })();

      const selectedKey = st.selected ? conversationKey(st.selected) : "";
      const shouldRestoreInput = Boolean(selectedKey && !st.input.trim() && mergedDrafts[selectedKey]);
      const restoredInput = shouldRestoreInput ? (mergedDrafts[selectedKey] ?? "") : null;

	      store.set((prev) => ({
	        ...prev,
	        drafts: mergedDrafts,
	        pinned: mergedPins,
	        pinnedMessages: mergedPinnedMessages,
	        fileTransfers: mergedFileTransfers,
	        outbox: mergedOutbox,
	        conversations: mergedConversations,
	        ...(restoredInput !== null ? { input: restoredInput } : {}),
	      }));

	      if (restoredInput !== null) {
	        try {
	          layout.input.value = restoredInput;
	          autosizeInput(layout.input);
	        } catch {
	          // ignore
	        }
	      }
	      scheduleSaveOutbox(store);
	      return;
	    }

    if (st.page === "main" && st.chatSearchOpen && st.selected) {
      const q = st.chatSearchQuery || "";
      const hits = q.trim() ? computeChatSearchHits(searchableMessagesForSelected(st), q) : [];
      const nextPos = clampChatSearchPos(hits, st.chatSearchPos);
      const hitsChanged = !sameNumberArray(hits, st.chatSearchHits);
      const posChanged = nextPos !== st.chatSearchPos;
      const shouldClear = !q.trim() && (st.chatSearchHits.length > 0 || st.chatSearchPos !== 0);
      if (hitsChanged || posChanged || shouldClear) {
        store.set((prev) => ({ ...prev, chatSearchHits: hits, chatSearchPos: nextPos }));
        return;
      }
    }
    renderApp(layout, st, actions);
    if (historyPrependAnchor) {
      const selectedKey = st.selected ? conversationKey(st.selected) : "";
      const anchorKey = historyPrependAnchor.key;
      if (st.page !== "main" || !selectedKey || selectedKey !== anchorKey) {
        historyPrependAnchor = null;
      } else if (!st.historyLoading[anchorKey]) {
        const delta = layout.chatHost.scrollHeight - historyPrependAnchor.scrollHeight;
        if (Number.isFinite(delta) && delta !== 0) {
          // Не даём автозагрузчику истории сработать сразу после "компенсации" скролла.
          historyAutoBlockUntil = Date.now() + 350;
          layout.chatHost.scrollTop = historyPrependAnchor.scrollTop + delta;
        }
        historyPrependAnchor = null;
      }
    }
    scheduleChatJumpVisibility();
    if (st.modal?.kind === "members_add") {
      renderMembersAddChips();
      membersAddDrainLookups();
    }
    if (st.modal) {
      closeMobileSidebar();
    }
    // Mobile UX: при первом входе (и если чат не выбран) показываем список чатов как основной экран.
    if (
      mobileSidebarMq.matches &&
      !mobileSidebarOpen &&
      !mobileSidebarAutoOpened &&
      st.conn === "connected" &&
      st.authed &&
      st.page === "main" &&
      !st.modal &&
      !st.selected
    ) {
      mobileSidebarAutoOpened = true;
      setMobileSidebarOpen(true);
    }
    if (st.pwaUpdateAvailable) {
      scheduleAutoApplyPwaUpdate();
    }
    if (st.authed && !prevAuthed) {
      if (st.selected) {
        requestHistory(st.selected, { force: true, deltaLimit: 2000 });
        if (st.selected.kind === "dm") {
          maybeSendMessageRead(st.selected.id);
        }
      }
      if (st.page === "main" && st.selected && !st.modal && !mobileSidebarMq.matches) {
        scheduleFocusComposer();
      }
    }
    prevAuthed = st.authed;
  });

  renderApp(layout, store.get(), actions);

  void initSkins();
  gateway.connect();

  // Remove the boot screen only after the app is ready enough to render UI.
  try {
    const boot = root.querySelector(".boot");
    if (boot) boot.remove();
  } catch {
    // ignore
  }

  try {
    window.dispatchEvent(new Event("yagodka:booted"));
  } catch {
    // ignore
  }
}
