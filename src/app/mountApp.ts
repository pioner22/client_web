import { createLayout } from "../components/layout/createLayout";
import { getGatewayUrl } from "../config/env";
import { APP_MSG_MAX_LEN, APP_VERSION } from "../config/app";
import { GatewayClient } from "../lib/net/gatewayClient";
import { Store } from "../stores/store";
import { el } from "../helpers/dom/el";
import type {
  ActionModalPayload,
  AppState,
  ChatMessage,
  MessageHelperDraft,
  ConnStatus,
  ConfirmAction,
  ContextMenuItem,
  ContextMenuTargetKind,
  FileOfferIn,
  FileTransferEntry,
  MobileSidebarTab,
  PageKind,
  SearchResultEntry,
  SidebarChatFilter,
  TargetRef,
  ThemeMode,
  MessageViewMode,
} from "../stores/types";
import { conversationKey, dmKey, roomKey } from "../helpers/chat/conversationKey";
import { messageSelectionKey } from "../helpers/chat/chatSelection";
import { newestServerMessageId } from "../helpers/chat/historySync";
import {
  HISTORY_VIRTUAL_OVERSCAN,
  HISTORY_VIRTUAL_WINDOW,
  clampVirtualAvg,
  getVirtualMaxStart,
  getVirtualStart,
  shouldVirtualize,
} from "../helpers/chat/virtualHistory";
import { loadDraftsForUser, sanitizeDraftMap, saveDraftsForUser, updateDraftMap } from "../helpers/chat/drafts";
import {
  clampChatSearchPos,
  computeChatSearchCounts,
  computeChatSearchHits,
  createChatSearchCounts,
  stepChatSearchPos,
  type ChatSearchFilter,
  type ChatSearchFlags,
} from "../helpers/chat/chatSearch";
import { loadPinsForUser, sanitizePins, savePinsForUser, togglePin } from "../helpers/chat/pins";
import {
  loadPinnedMessagesForUser,
  mergePinnedMessagesMaps,
  isPinnedMessage,
  savePinnedMessagesForUser,
  togglePinnedMessage,
} from "../helpers/chat/pinnedMessages";
import { cleanupFileCache, getCachedFileBlob, isImageLikeFile, putCachedFileBlob } from "../helpers/files/fileBlobCache";
import { fileBadge } from "../helpers/files/fileBadge";
import { loadFileCachePrefs, saveFileCachePrefs } from "../helpers/files/fileCachePrefs";
import { loadFileTransfersForUser, saveFileTransfersForUser } from "../helpers/files/fileTransferHistory";
import { upsertConversation } from "../helpers/chat/upsertConversation";
import { addOutboxEntry, loadOutboxForUser, makeOutboxLocalId, removeOutboxEntry, saveOutboxForUser, updateOutboxEntry } from "../helpers/chat/outbox";
import { activatePwaUpdate } from "../helpers/pwa/registerServiceWorker";
import { setPushOptOut } from "../helpers/pwa/pushPrefs";
import { setNotifyInAppEnabled, setNotifySoundEnabled } from "../helpers/notify/notifyPrefs";
import { installNotificationSoundUnlock } from "../helpers/notify/notifySound";
import { shouldReloadForBuild } from "../helpers/pwa/shouldReloadForBuild";
import {
  clearPwaInstallDismissed,
  isBeforeInstallPromptEvent,
  markPwaInstallDismissed,
  shouldOfferPwaInstall,
  type BeforeInstallPromptEvent,
} from "../helpers/pwa/installPrompt";
import { applySkin, fetchAvailableSkins, normalizeSkinId, storeSkinId } from "../helpers/skin/skin";
import { applyTheme, storeTheme } from "../helpers/theme/theme";
import { applyMessageView, normalizeMessageView, storeMessageView } from "../helpers/ui/messageView";
import { isMobileLikeUi } from "../helpers/ui/mobileLike";
import { saveLastActiveTarget } from "../helpers/ui/lastActiveTarget";
import { saveLastReadMarkers } from "../helpers/ui/lastReadMarkers";
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
import { installDebugHud } from "../helpers/ui/debugHud";
import { installSidebarLeftResize } from "../helpers/ui/sidebarLeftResize";
import {
  EMOJI_RECENTS_ID,
  buildEmojiSections,
  filterEmojiSections,
  insertTextAtSelection,
  updateEmojiRecents,
} from "../helpers/ui/emoji";
import { createRafScrollLock } from "../helpers/ui/rafScrollLock";
import { readScrollSnapshot } from "../helpers/ui/scrollSnapshot";
import { deriveServerSearchQuery } from "../helpers/search/serverSearchQuery";
import { renderBoardPost } from "../helpers/boards/boardPost";
import { loadBoardScheduleForUser, maxBoardScheduleDelayMs, saveBoardScheduleForUser } from "../helpers/boards/boardSchedule";

const ROOM_INFO_MAX = 2000;
const IOS_ACTIVE_CONV_LIMIT = 320;
const IOS_INACTIVE_CONV_LIMIT = 120;
const DEFAULT_ACTIVE_CONV_LIMIT = 800;
const DEFAULT_INACTIVE_CONV_LIMIT = 300;

function autosizeInput(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  const style = window.getComputedStyle(el);
  const max = Number.parseFloat(style.maxHeight || "");
  const next = el.scrollHeight;
  const height = Number.isFinite(max) && max > 0 ? Math.min(next, max) : next;
  el.style.height = `${Math.max(0, Math.ceil(height))}px`;

  const maxed = Number.isFinite(max) && max > 0 ? next > max + 1 : false;
  el.classList.toggle("input-maxed", maxed);

  if (!maxed) return;
  try {
    const ss = typeof el.selectionStart === "number" ? el.selectionStart : null;
    const se = typeof el.selectionEnd === "number" ? el.selectionEnd : null;
    const atEnd = ss !== null && se !== null && ss === se && se >= Math.max(0, el.value.length - 1);
    if (atEnd) el.scrollTop = el.scrollHeight;
  } catch {
    // ignore
  }
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
let boardScheduleLoadedForUser: string | null = null;

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
  mime?: string | null;
  chunks: ArrayBuffer[];
  received: number;
  lastProgress: number;
  streamId?: string | null;
  streaming?: boolean;
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
  if (n.endsWith(".heic")) return "image/heic";
  if (n.endsWith(".heif")) return "image/heif";
  if (n.endsWith(".svg")) return "image/svg+xml";
  if (n.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

export function mountApp(root: HTMLElement) {
  const store = new Store<AppState>(createInitialState());
  applyTheme(store.get().theme);
  applyMessageView(store.get().messageView);
  const iosStandalone = isIOS() && isStandaloneDisplayMode();
  const layout = createLayout(root, { iosStandalone });
  const debugHud = installDebugHud({ mount: root, chatHost: layout.chatHost, getState: () => store.get() });
  installSidebarLeftResize(layout.sidebar, layout.sidebarResizeHandle);
  installNotificationSoundUnlock();
  type PwaSharePayload = {
    files: File[];
    title: string;
    text: string;
    url: string;
  };
  const pendingShareQueue: PwaSharePayload[] = [];
  const pendingPushDeepLink = (() => {
    try {
      const loc = globalThis.location;
      const search = typeof loc?.search === "string" ? loc.search : "";
      const params = new URLSearchParams(search || "");
      const room = String(params.get("push_room") || "").trim();
      const from = String(params.get("push_from") || "").trim();
      if (!room && !from) return null;
      params.delete("push_room");
      params.delete("push_from");
      const next = params.toString();
      const pathname = typeof loc?.pathname === "string" ? loc.pathname : "/";
      const hash = typeof loc?.hash === "string" ? loc.hash : "";
      const url = next ? `${pathname}?${next}${hash}` : `${pathname}${hash}`;
      globalThis.history?.replaceState?.(null, "", url);
      return { room, from };
    } catch {
      return null;
    }
  })();

  function maybeApplyIosInputAssistant(target: EventTarget | null) {
    if (!iosStandalone) return;
    const t = target instanceof HTMLElement ? target : null;
    if (!t) return;
    const node =
      t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement
        ? t
        : (t.closest("input,textarea") as HTMLInputElement | HTMLTextAreaElement | null);
    if (!node) return;
    const modeAttr = node.getAttribute("data-ios-assistant");
    if (modeAttr === "off") return;
    if (node instanceof HTMLInputElement) {
      const type = String(node.type || "text").toLowerCase();
      if (["password", "file", "checkbox", "radio", "button", "submit", "reset", "hidden", "range", "color"].includes(type)) return;
    }
    applyIosInputAssistantWorkaround(node, modeAttr === "strict" ? "strict" : "predictive");
  }

  function normalizeSharePayload(raw: any): PwaSharePayload | null {
    if (!raw || typeof raw !== "object") return null;
    const filesRaw = Array.isArray(raw.files) ? raw.files : [];
    const files = filesRaw.filter((f: unknown) => f && typeof f === "object" && typeof (f as any).arrayBuffer === "function") as File[];
    const title = String(raw.title ?? "").trim();
    const text = String(raw.text ?? "").trim();
    const url = String(raw.url ?? "").trim();
    if (!files.length && !title && !text && !url) return null;
    return { files, title, text, url };
  }

  function formatShareCaption(payload: PwaSharePayload): string {
    const parts = [payload.title, payload.text, payload.url].map((v) => String(v || "").trim()).filter(Boolean);
    if (!parts.length) return "";
    let caption = parts.join("\n").trim();
    if (caption.length > APP_MSG_MAX_LEN) caption = caption.slice(0, APP_MSG_MAX_LEN);
    return caption;
  }

  function appendShareTextToComposer(text: string, target: TargetRef) {
    if (!text) return;
    const prevText = String(layout.input.value || "");
    const next = prevText ? `${prevText}\n${text}` : text;
    const nextTrimmed = next.length > APP_MSG_MAX_LEN ? next.slice(0, APP_MSG_MAX_LEN) : next;
    layout.input.value = nextTrimmed;
    autosizeInput(layout.input);
    store.set((prev) => {
      const key = conversationKey(target);
      const drafts = updateDraftMap(prev.drafts, key, nextTrimmed);
      return { ...prev, input: nextTrimmed, drafts };
    });
    scheduleSaveDrafts(store);
  }

  function clearChatSelection() {
    const st = store.get();
    if (!st.chatSelection) return;
    store.set({ chatSelection: null });
  }

  function toggleChatSelection(key: string, msg: ChatMessage) {
    if (!key) return;
    if (!msg || msg.kind === "sys") return;
    const selId = messageSelectionKey(msg);
    if (!selId) return;
    store.set((prev) => {
      const current = prev.chatSelection;
      if (!current || current.key !== key) {
        return { ...prev, chatSelection: { key, ids: [selId] } };
      }
      const ids = new Set(current.ids || []);
      if (ids.has(selId)) ids.delete(selId);
      else ids.add(selId);
      return { ...prev, chatSelection: ids.size ? { key, ids: Array.from(ids) } : null };
    });
  }

  function formatSearchServerShareLine(st: AppState, entry: SearchResultEntry): string {
    const id = String(entry?.id || "").trim();
    if (!id) return "";
    if (entry.board) {
      const board = st.boards.find((b) => b.id === id);
      const name = String(board?.name || "").trim();
      return name ? `${name} (#${id})` : `#${id}`;
    }
    if (entry.group) {
      const group = st.groups.find((g) => g.id === id);
      const name = String(group?.name || "").trim();
      return name ? `${name} (#${id})` : `#${id}`;
    }
    const profile = st.profiles?.[id];
    const displayName = String(profile?.display_name || "").trim();
    return displayName ? `${displayName} (ID: ${id})` : `ID: ${id}`;
  }

  function formatSearchServerShareText(st: AppState, items: SearchResultEntry[]): string {
    return items.map((entry) => formatSearchServerShareLine(st, entry)).filter(Boolean).join("\n").trim();
  }

  function formatSearchHistoryTargetLabel(st: AppState, target: TargetRef): string {
    const id = String(target?.id || "").trim();
    if (!id) return "";
    if (target.kind === "dm") {
      const friend = st.friends.find((f) => f.id === id);
      const profile = st.profiles?.[id];
      const displayName = String(friend?.display_name || profile?.display_name || "").trim();
      const handleRaw = String(friend?.handle || profile?.handle || "").trim();
      const handle = handleRaw ? (handleRaw.startsWith("@") ? handleRaw : `@${handleRaw}`) : "";
      if (displayName) return displayName;
      if (handle) return handle;
      return `ID: ${id}`;
    }
    const entry = target.kind === "group" ? st.groups.find((g) => g.id === id) : st.boards.find((b) => b.id === id);
    const name = String(entry?.name || "").trim();
    return name ? `${name} (#${id})` : `#${id}`;
  }

  function formatSearchHistorySenderLabel(st: AppState, senderId: string): string {
    const id = String(senderId || "").trim();
    if (!id) return "";
    if (String(st.selfId || "") === id) return "Я";
    const friend = st.friends.find((f) => f.id === id);
    const profile = st.profiles?.[id];
    const displayName = String(friend?.display_name || profile?.display_name || "").trim();
    const handleRaw = String(friend?.handle || profile?.handle || "").trim();
    const handle = handleRaw ? (handleRaw.startsWith("@") ? handleRaw : `@${handleRaw}`) : "";
    if (displayName) return displayName;
    if (handle) return handle;
    return id;
  }

  function formatSearchHistoryAttachmentLabel(attachment: ChatMessage["attachment"]): string {
    if (!attachment) return "";
    if (attachment.kind === "action") return "Действие";
    if (attachment.kind !== "file") return "";
    const name = String(attachment.name || "").trim();
    const badge = fileBadge(attachment.name, attachment.mime);
    let kindLabel = "Файл";
    if (badge.kind === "image") kindLabel = "Фото";
    else if (badge.kind === "video") kindLabel = "Видео";
    else if (badge.kind === "audio") kindLabel = "Аудио";
    else if (badge.kind === "archive") kindLabel = "Архив";
    else if (badge.kind === "doc") kindLabel = "Документ";
    else if (badge.kind === "pdf") kindLabel = "PDF";
    return name ? `${kindLabel}: ${name}` : kindLabel;
  }

  function formatSearchHistoryBody(msg: ChatMessage): string {
    const text = String(msg?.text || "").trim();
    if (text) return text;
    return formatSearchHistoryAttachmentLabel(msg?.attachment);
  }

  function formatSearchHistoryShareLine(st: AppState, item: { target: TargetRef; idx: number }): string {
    const key = conversationKey(item.target);
    if (!key) return "";
    const conv = st.conversations[key];
    if (!Array.isArray(conv)) return "";
    const msg = conv[item.idx];
    if (!msg) return "";
    const body = formatSearchHistoryBody(msg);
    const targetLabel = formatSearchHistoryTargetLabel(st, item.target);
    const senderLabel = formatSearchHistorySenderLabel(st, String(msg.from || ""));
    const header = [targetLabel, senderLabel].filter(Boolean).join(" — ");
    if (!body) return header;
    return header ? `${header}: ${body}` : body;
  }

  function formatSearchHistoryShareText(st: AppState, items: Array<{ target: TargetRef; idx: number }>): string {
    const list = Array.isArray(items) ? items : [];
    return list.map((item) => formatSearchHistoryShareLine(st, item)).filter(Boolean).join("\n").trim();
  }

  function canSendShareNow(st: AppState, target: TargetRef | null): { ok: boolean; reason: string } {
    if (st.conn !== "connected") return { ok: false, reason: "Нет соединения" };
    if (!st.authed) return { ok: false, reason: "Сначала войдите или зарегистрируйтесь" };
    if (!target) return { ok: false, reason: "Выберите контакт или чат слева" };
    if (target.kind === "group") {
      const g = st.groups.find((x) => x.id === target.id);
      const me = String(st.selfId || "").trim();
      const owner = String(g?.owner_id || "").trim();
      const banned = (g?.post_banned || []).map((x) => String(x || "").trim()).filter(Boolean);
      if (me && owner && me !== owner && banned.includes(me)) {
        return { ok: false, reason: "Вам запрещено писать в чате" };
      }
    }
    if (target.kind === "board") {
      const b = st.boards.find((x) => x.id === target.id);
      const owner = String(b?.owner_id || "").trim();
      const me = String(st.selfId || "").trim();
      if (owner && me && owner !== me) {
        return { ok: false, reason: "На доске писать может только владелец" };
      }
    }
    return { ok: true, reason: "" };
  }

  function flushPendingShareQueue() {
    if (!pendingShareQueue.length) return;
    const st = store.get();
    const target = st.selected;
    const canSend = canSendShareNow(st, target);
    if (!canSend.ok) {
      store.set({ status: canSend.reason });
      return;
    }
    if (!target) return;
    const payloads = pendingShareQueue.splice(0, pendingShareQueue.length);
    let sentFiles = 0;
    let textOnly = 0;
    for (const payload of payloads) {
      const caption = formatShareCaption(payload);
      const files = payload.files || [];
      if (files.length) {
        const canCaption = Boolean(caption) && files.length === 1 && !st.editing;
        for (let i = 0; i < files.length; i += 1) {
          sendFile(files[i], target, i === 0 && canCaption ? caption : "");
          sentFiles += 1;
        }
        if (caption && !canCaption) {
          if (!st.editing) appendShareTextToComposer(caption, target);
          else store.set({ status: "Подпись из share не добавлена: вы редактируете сообщение" });
        }
      } else if (caption) {
        textOnly += 1;
        if (!st.editing) appendShareTextToComposer(caption, target);
      }
    }
    if (sentFiles > 0) {
      showToast(`Поделиться: отправлено файлов — ${sentFiles}`, { kind: "success" });
    } else if (textOnly > 0) {
      showToast("Поделиться: текст добавлен в поле ввода", { kind: "info" });
    }
  }

  function enqueueSharePayload(payload: PwaSharePayload) {
    pendingShareQueue.push(payload);
    if (pendingShareQueue.length > 8) pendingShareQueue.splice(0, pendingShareQueue.length - 8);
    const fileCount = payload.files?.length || 0;
    const label = fileCount ? `Файлов: ${fileCount}` : "Текст";
    showToast(`Поделиться: получено (${label})`, { kind: "info", timeoutMs: 4000 });
    flushPendingShareQueue();
  }

  maybeApplyIosInputAssistant(layout.input);

  // iOS standalone (PWA): стараемся применить workaround ДО focus, т.к. WebKit решает,
  // какую "панель" показывать над клавиатурой, в момент фокуса.
  if (iosStandalone) {
    document.addEventListener("pointerdown", (e) => maybeApplyIosInputAssistant(e.target), true);
    document.addEventListener("touchstart", (e) => maybeApplyIosInputAssistant(e.target), true);
    document.addEventListener("focusin", (e) => maybeApplyIosInputAssistant(e.target), true);
  }

  window.addEventListener("yagodka:pwa-share", (e: Event) => {
    const ev = e as CustomEvent;
    const payload = normalizeSharePayload(ev?.detail);
    if (!payload) return;
    enqueueSharePayload(payload);
  });
  window.addEventListener("yagodka:pwa-stream-ready", (e: Event) => {
    const ev = e as CustomEvent;
    const detail = ev?.detail as any;
    const streamId = String(detail?.streamId || "").trim();
    const fileId = String(detail?.fileId || "").trim();
    if (!streamId) return;
    const req = pendingStreamRequests.get(streamId);
    if (!req) return;
    if (fileId && req.fileId !== fileId) return;
    pendingStreamRequests.delete(streamId);
    const st = store.get();
    if (st.conn !== "connected") {
      store.set({ status: "Нет соединения" });
      return;
    }
    downloadByFileId.set(req.fileId, {
      fileId: req.fileId,
      name: req.name || "файл",
      size: req.size || 0,
      from: "—",
      room: null,
      mime: req.mime,
      chunks: [],
      received: 0,
      lastProgress: 0,
      streamId,
      streaming: true,
    });
    gateway.send({ type: "file_get", file_id: req.fileId });
    store.set({ status: `Скачивание: ${req.name || "файл"}` });
  });
  window.addEventListener("yagodka:pwa-notification-click", (e: Event) => {
    const ev = e as CustomEvent;
    const detail = ev?.detail as any;
    const room = String(detail?.room || "").trim();
    const from = String(detail?.from || "").trim();
    if (!room && !from) return;
    setPage("main");
    if (room) {
      if (room.startsWith("b-")) selectTarget({ kind: "board", id: room });
      else selectTarget({ kind: "group", id: room });
      return;
    }
    if (from) selectTarget({ kind: "dm", id: from });
  });

  if (pendingPushDeepLink) {
    queueMicrotask(() => {
      const room = String(pendingPushDeepLink.room || "").trim();
      const from = String(pendingPushDeepLink.from || "").trim();
      if (!room && !from) return;
      setPage("main");
      if (room) {
        if (room.startsWith("b-")) selectTarget({ kind: "board", id: room });
        else selectTarget({ kind: "group", id: room });
        return;
      }
      if (from) selectTarget({ kind: "dm", id: from });
    });
  }

  function syncNotifyPrefsToServiceWorker(): void {
    try {
      if (!("serviceWorker" in navigator)) return;
    } catch {
      return;
    }
    const st = store.get();
    const prefs = { silent: !Boolean(st.notifySoundEnabled) };
    const msg = { type: "PWA_NOTIFY_PREFS", prefs };
    try {
      const controller = navigator.serviceWorker.controller;
      if (controller) {
        controller.postMessage(msg);
        return;
      }
    } catch {
      // ignore
    }
    try {
      navigator.serviceWorker.ready
        .then((reg) => {
          try {
            reg.active?.postMessage?.(msg);
          } catch {
            // ignore
          }
        })
        .catch(() => {});
    } catch {
      // ignore
    }
  }

  // Best-effort: keep SW notification prefs in sync (used for `silent` option).
  syncNotifyPrefsToServiceWorker();

  const pushSentByUser = new Map<string, string>();
  let pushAutoAttemptUser: string | null = null;
  let pushAutoAttemptAt = 0;
  let pushSyncInFlight = false;

  function readPushPermission(): "default" | "granted" | "denied" {
    try {
      return (Notification?.permission ?? "default") as "default" | "granted" | "denied";
    } catch {
      return "default";
    }
  }

  async function requestPushPermission(): Promise<"default" | "granted" | "denied"> {
    try {
      if (typeof Notification === "undefined" || typeof Notification.requestPermission !== "function") {
        return "default";
      }
      const request = Notification.requestPermission.bind(Notification);
      if (request.length >= 1) {
        return await new Promise((resolve) => {
          try {
            request((perm) => resolve(perm as "default" | "granted" | "denied"));
          } catch {
            resolve(readPushPermission());
          }
        });
      }
      const result = request();
      if (typeof result === "string") return result as "default" | "granted" | "denied";
      if (result && typeof (result as Promise<string>).then === "function") {
        return (await result) as "default" | "granted" | "denied";
      }
    } catch {
      // ignore
    }
    return readPushPermission();
  }

  function pushDeniedHelpText(): string {
    try {
      if (isIOS()) {
        return "Разрешение запрещено. Откройте: Настройки → Уведомления → Yagodka → Разрешить.";
      }
      const ua = String(navigator.userAgent || "");
      if (/Mac/i.test(ua)) {
        return "Разрешение запрещено. macOS: Настройки → Уведомления → браузер → Разрешить. В Safari: Настройки → Веб‑сайты → Уведомления → yagodka.org (и включите запрос уведомлений).";
      }
      if (/Android/i.test(ua)) {
        return "Разрешение запрещено. Откройте: Настройки телефона → Приложения → Yagodka → Уведомления.";
      }
    } catch {
      // ignore
    }
    return "Разрешение запрещено в настройках браузера/устройства.";
  }

  function describePushSubscribeError(err: unknown): string {
    const name = typeof (err as any)?.name === "string" ? String((err as any).name) : "";
    const message = typeof (err as any)?.message === "string" ? String((err as any).message).trim() : "";
    if (name === "NotAllowedError") return "доступ запрещен в браузере";
    if (name === "NotSupportedError") return "Push не поддерживается";
    if (name === "AbortError") return "операция отменена";
    if (name === "InvalidStateError") return "Service Worker не готов";
    if (name === "InvalidAccessError") return "некорректный ключ приложения";
    if (name === "QuotaExceededError") return "превышен лимит подписок";
    if (name === "NetworkError") return "ошибка сети";
    if (message) return message.slice(0, 120);
    return "неизвестная ошибка";
  }

  function vapidKeyToUint8Array(key: string): Uint8Array<ArrayBuffer> {
    const raw = String(key || "").trim();
    if (!raw) return new Uint8Array(new ArrayBuffer(0));
    const base64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const pad = base64.length % 4;
    const padded = base64 + (pad ? "=".repeat(4 - pad) : "");
    const bin = atob(padded);
    const bytes = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function getPushRegistration(): Promise<ServiceWorkerRegistration | null> {
    if (!("serviceWorker" in navigator)) return null;
    try {
      return await navigator.serviceWorker.ready;
    } catch {
      return null;
    }
  }

  function swStateLabel(reg: ServiceWorkerRegistration): string {
    if (reg.active) return "активен";
    if (reg.waiting) return "ожидает активации";
    if (reg.installing) return "устанавливается";
    return "не активен";
  }

  async function getPushRegistrationWithTimeout(mode: "auto" | "manual", timeoutMs: number): Promise<ServiceWorkerRegistration | null> {
    if (!("serviceWorker" in navigator)) return null;
    const prefix = mode === "auto" ? "Авто‑подписка: " : "";
    const ready = new Promise<ServiceWorkerRegistration | null>((resolve) => {
      let done = false;
      const timer = window.setTimeout(() => {
        if (done) return;
        done = true;
        resolve(null);
      }, timeoutMs);
      navigator.serviceWorker.ready
        .then((reg) => {
          if (done) return;
          done = true;
          window.clearTimeout(timer);
          resolve(reg);
        })
        .catch(() => {
          if (done) return;
          done = true;
          window.clearTimeout(timer);
          resolve(null);
        });
    });
    const reg = await ready;
    if (reg) return reg;
    let fallback: ServiceWorkerRegistration | null = null;
    try {
      fallback = (await navigator.serviceWorker.getRegistration()) ?? null;
    } catch {
      fallback = null;
    }
    if (!fallback) {
      store.set({ pwaPushStatus: `${prefix}Service Worker не зарегистрирован, пробуем зарегистрировать…` });
      try {
        const reg = await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
        return reg;
      } catch (err) {
        store.set({
          pwaPushStatus: `${prefix}Service Worker не зарегистрирован: ${describePushSubscribeError(err)}`,
        });
        return null;
      }
    }
    const state = swStateLabel(fallback);
    const controller = navigator.serviceWorker.controller;
    const suffix = controller ? "" : " (нет controller, перезапустите PWA)";
    store.set({ pwaPushStatus: `${prefix}Service Worker ${state}${suffix}` });
    return fallback;
  }

  function subscriptionFingerprint(sub: PushSubscription): string {
    try {
      const json = sub.toJSON() as any;
      const endpoint = String(json?.endpoint || "");
      const p256dh = String(json?.keys?.p256dh || "");
      const auth = String(json?.keys?.auth || "");
      return `${endpoint}|${p256dh}|${auth}`;
    } catch {
      return String(sub.endpoint || "");
    }
  }

  async function sendPushSubscription(sub: PushSubscription): Promise<boolean> {
    const st = store.get();
    if (!st.authed || st.conn !== "connected" || !st.selfId) return false;
    const json = sub.toJSON() as any;
    const endpoint = String(json?.endpoint || "").trim();
    if (!endpoint) return false;
    const fp = subscriptionFingerprint(sub);
    if (pushSentByUser.get(st.selfId) === fp) {
      store.set({ pwaPushSubscribed: true, pwaPushStatus: "Push уже включен" });
      return true;
    }
    gateway.send({
      type: "pwa_push_subscribe",
      subscription: json,
      ua: navigator.userAgent,
      client: "web",
    });
    pushSentByUser.set(st.selfId, fp);
    store.set({ pwaPushSubscribed: true, pwaPushStatus: "Подписка отправлена" });
    return true;
  }

  async function ensurePushSubscription(mode: "auto" | "manual"): Promise<boolean> {
    if (pushSyncInFlight) return false;
    pushSyncInFlight = true;
    try {
      const st = store.get();
      if (!st.authed || st.conn !== "connected" || !st.selfId) return false;
      if (!st.pwaPushSupported) {
        store.set({ pwaPushStatus: "Push не поддерживается" });
        return false;
      }
      if (!st.pwaPushPublicKey) {
        store.set({ pwaPushStatus: "Push отключен на сервере" });
        return false;
      }
      if (mode === "auto" && st.pwaPushOptOut) {
        store.set({ pwaPushSubscribed: false, pwaPushStatus: "Push отключен пользователем" });
        return false;
      }
      if (mode === "auto" && st.pwaPushSubscribed) {
        store.set({ pwaPushStatus: "Push уже включен" });
        return true;
      }
      let perm = readPushPermission();
      if (perm !== "granted" && mode === "manual") {
        store.set({ pwaPushStatus: "Запрашиваем разрешение…" });
        try {
          perm = await requestPushPermission();
        } catch {
          perm = readPushPermission();
        }
      }
      store.set({ pwaPushPermission: perm });
      if (perm !== "granted") {
        store.set({
          pwaPushSubscribed: false,
          pwaPushStatus: perm === "denied" ? pushDeniedHelpText() : "Разрешение не получено",
        });
        return false;
      }
      store.set({
        pwaPushStatus: mode === "auto" ? "Авто‑подписка: проверяем Service Worker…" : "Проверяем Service Worker…",
      });
      const reg = await getPushRegistrationWithTimeout(mode, 4000);
      if (!reg) {
        return false;
      }
      let sub: PushSubscription | null = null;
      try {
        sub = await reg.pushManager.getSubscription();
      } catch (err) {
        store.set({
          pwaPushSubscribed: false,
          pwaPushStatus: `Не удалось проверить подписку: ${describePushSubscribeError(err)}`,
        });
        return false;
      }
      if (!sub) {
        store.set({
          pwaPushStatus: mode === "auto" ? "Авто‑подписка: создаём подписку…" : "Создаём подписку…",
        });
        try {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: vapidKeyToUint8Array(st.pwaPushPublicKey),
          });
        } catch (err) {
          store.set({
            pwaPushSubscribed: false,
            pwaPushStatus: `Не удалось создать подписку: ${describePushSubscribeError(err)}`,
          });
          return false;
        }
      }
      const fp = subscriptionFingerprint(sub);
      if (pushSentByUser.get(st.selfId) === fp) {
        store.set({ pwaPushSubscribed: true, pwaPushStatus: "Push уже включен" });
        return true;
      }
      store.set({ pwaPushSubscribed: true });
      await sendPushSubscription(sub);
      return true;
    } finally {
      pushSyncInFlight = false;
    }
  }

  async function syncExistingPushSubscription(): Promise<void> {
    await ensurePushSubscription("auto");
  }

  async function enablePush(): Promise<void> {
    setPushOptOut(false);
    store.set({ pwaPushOptOut: false });
    await ensurePushSubscription("manual");
  }

  async function disablePush(): Promise<void> {
    const st = store.get();
    setPushOptOut(true);
    store.set({ pwaPushOptOut: true });
    const reg = await getPushRegistration();
    if (!reg) {
      store.set({ pwaPushStatus: "Service Worker не готов" });
      return;
    }
    let endpoint = "";
    try {
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        endpoint = String(sub.endpoint || "").trim();
        await sub.unsubscribe();
      }
    } catch {
      // ignore
    }
    if (st.authed && st.conn === "connected" && endpoint) {
      gateway.send({ type: "pwa_push_unsubscribe", endpoint });
    }
    if (st.selfId) pushSentByUser.delete(st.selfId);
    store.set({ pwaPushSubscribed: false, pwaPushStatus: "Push отключен пользователем" });
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
  let sharePrevConn: ConnStatus = store.get().conn;
  let sharePrevAuthed = store.get().authed;
  const initialSelected = store.get().selected;
  let sharePrevSelKey = initialSelected ? conversationKey(initialSelected) : "";
  store.subscribe(() => {
    if (!pendingShareQueue.length) {
      const st = store.get();
      sharePrevConn = st.conn;
      sharePrevAuthed = st.authed;
      sharePrevSelKey = st.selected ? conversationKey(st.selected) : "";
      return;
    }
    const st = store.get();
    const nextSelKey = st.selected ? conversationKey(st.selected) : "";
    const changed = st.conn !== sharePrevConn || st.authed !== sharePrevAuthed || nextSelKey !== sharePrevSelKey;
    sharePrevConn = st.conn;
    sharePrevAuthed = st.authed;
    sharePrevSelKey = nextSelKey;
    if (changed) flushPendingShareQueue();
  });
  store.subscribe(() => {
    const st = store.get();
    if (!st.authed || st.conn !== "connected" || !st.selfId) {
      pushAutoAttemptUser = null;
      pushAutoAttemptAt = 0;
      return;
    }
    if (!st.pwaPushSupported || !st.pwaPushPublicKey) return;
    if (st.pwaPushOptOut) return;
    if (st.pwaPushSubscribed) return;
    if (readPushPermission() !== "granted") return;
    const now = Date.now();
    if (pushAutoAttemptUser === st.selfId && now - pushAutoAttemptAt < 15000) return;
    pushAutoAttemptUser = st.selfId;
    pushAutoAttemptAt = now;
    void syncExistingPushSubscription();
  });

  const previewIdsSignature = (items: Array<{ id?: string }>) =>
    items.map((entry) => String(entry?.id || "").trim()).filter(Boolean).join("|");

  store.subscribe(() => {
    const st = store.get();
    const friendsRefChanged = st.friends !== previewFriendsRef;
    const groupsRefChanged = st.groups !== previewGroupsRef;
    const boardsRefChanged = st.boards !== previewBoardsRef;
    let nextFriendsSig = previewFriendsSig;
    let nextGroupsSig = previewGroupsSig;
    let nextBoardsSig = previewBoardsSig;
    if (friendsRefChanged) {
      previewFriendsRef = st.friends;
      nextFriendsSig = previewIdsSignature(st.friends || []);
    }
    if (groupsRefChanged) {
      previewGroupsRef = st.groups;
      nextGroupsSig = previewIdsSignature(st.groups || []);
    }
    if (boardsRefChanged) {
      previewBoardsRef = st.boards;
      nextBoardsSig = previewIdsSignature(st.boards || []);
    }
    const friendsChanged = nextFriendsSig !== previewFriendsSig;
    const groupsChanged = nextGroupsSig !== previewGroupsSig;
    const boardsChanged = nextBoardsSig !== previewBoardsSig;
    const connChanged = st.conn !== previewConn || st.authed !== previewAuthed;
    previewFriendsSig = nextFriendsSig;
    previewGroupsSig = nextGroupsSig;
    previewBoardsSig = nextBoardsSig;
    previewConn = st.conn;
    previewAuthed = st.authed;
    if (!st.authed || st.conn !== "connected") return;
    if (!friendsChanged && !groupsChanged && !boardsChanged && !connChanged) return;
    for (const f of st.friends || []) {
      const id = String(f?.id || "").trim();
      if (!id) continue;
      enqueueHistoryPreview({ kind: "dm", id });
    }
    for (const g of st.groups || []) {
      const id = String(g?.id || "").trim();
      if (!id) continue;
      enqueueHistoryPreview({ kind: "group", id });
    }
    for (const b of st.boards || []) {
      const id = String(b?.id || "").trim();
      if (!id) continue;
      enqueueHistoryPreview({ kind: "board", id });
    }
  });

  const friendOnlineSignature = (friends: Array<{ id?: string; online?: boolean }>) =>
    friends
      .map((f) => {
        const id = String(f?.id || "").trim();
        if (!id) return "";
        return `${id}:${f?.online ? "1" : "0"}`;
      })
      .filter(Boolean)
      .join("|");
  let prevFriendOnlineSig = friendOnlineSignature(store.get().friends || []);
  const hasWhenOnlineOutbox = (outbox: Record<string, Array<{ whenOnline?: boolean }>>) => {
    for (const list of Object.values(outbox || {})) {
      const arr = Array.isArray(list) ? list : [];
      if (arr.some((e) => Boolean(e?.whenOnline))) return true;
    }
    return false;
  };
  store.subscribe(() => {
    const st = store.get();
    const nextSig = friendOnlineSignature(st.friends || []);
    if (nextSig === prevFriendOnlineSig) return;
    prevFriendOnlineSig = nextSig;
    if (!st.authed || st.conn !== "connected") return;
    if (!hasWhenOnlineOutbox(st.outbox)) return;
    drainOutbox();
  });
  const historyRequested = new Set<string>();
  const historyDeltaRequestedAt = new Map<string, number>();
  const historyPreviewRequested = new Set<string>();
  const historyPreviewLastAt = new Map<string, number>();
  const historyPreviewQueue: TargetRef[] = [];
  let historyPreviewTimer: number | null = null;
  let autoAuthAttemptedForConn = false;
  let lastConn: ConnStatus = "connecting";
  const lastReadSentAt = new Map<string, number>();
  const lastReadSavedAt = new Map<string, number>();
  let pwaAutoApplyTimer: number | null = null;
  let pwaForceInFlight = false;
  let lastUserInputAt = Date.now();
  const markUserActivity = () => {
    lastUserInputAt = Date.now();
  };

  const recordRoomLastReadEntry = (key: string, msg: ChatMessage | null) => {
    const k = String(key || "").trim();
    if (!k || !k.startsWith("room:")) return;
    if (!msg) return;
    const st = store.get();
    if (!st.selfId) return;
    const ts = Number(msg.ts ?? 0);
    const id = Number(msg.id ?? 0);
    const prevEntry = st.lastRead?.[k] || {};
    const nextEntry = { ...prevEntry };
    let changed = false;
    if (Number.isFinite(id) && id > 0 && (!prevEntry.id || id > prevEntry.id)) {
      nextEntry.id = id;
      changed = true;
    }
    if (Number.isFinite(ts) && ts > 0 && (!prevEntry.ts || ts > prevEntry.ts)) {
      nextEntry.ts = ts;
      changed = true;
    }
    if (!changed) return;
    const now = Date.now();
    const lastSave = lastReadSavedAt.get(k) ?? 0;
    if (now - lastSave < 1200) return;
    lastReadSavedAt.set(k, now);
    const next = { ...(st.lastRead || {}), [k]: nextEntry };
    store.set({ lastRead: next });
    saveLastReadMarkers(st.selfId, next);
    const roomId = k.slice("room:".length);
    if (roomId && nextEntry.id) {
      maybeSendRoomRead(roomId, nextEntry.id);
    }
  };

  const maybeRecordLastRead = (key: string) => {
    const k = String(key || "").trim();
    if (!k || !k.startsWith("room:")) return;
    const st = store.get();
    const conv = st.conversations[k] || [];
    const last = conv.length ? conv[conv.length - 1] : null;
    recordRoomLastReadEntry(k, last);
  };
  // PWA auto-update: treat any pointer interaction as “activity” so we don’t reload while the user clicks/opens menus.
  window.addEventListener("pointerdown", markUserActivity, { capture: true, passive: true });
  window.addEventListener("mousedown", markUserActivity, { capture: true, passive: true });
  window.addEventListener("contextmenu", markUserActivity, { capture: true });
  window.addEventListener("wheel", markUserActivity, { capture: true, passive: true });
  window.addEventListener("touchstart", markUserActivity, { capture: true, passive: true });
  let previewFriendsRef = store.get().friends;
  let previewGroupsRef = store.get().groups;
  let previewBoardsRef = store.get().boards;
  let previewFriendsSig = previewIdsSignature(previewFriendsRef || []);
  let previewGroupsSig = previewIdsSignature(previewGroupsRef || []);
  let previewBoardsSig = previewIdsSignature(previewBoardsRef || []);
  let previewConn: ConnStatus = store.get().conn;
  let previewAuthed = store.get().authed;
  const uploadQueue: UploadState[] = [];
  let activeUpload: UploadState | null = null;
  const uploadByFileId = new Map<string, UploadState>();
  const downloadByFileId = new Map<string, DownloadState>();
  const pendingStreamRequests = new Map<string, { fileId: string; name: string; size: number; mime: string | null }>();
  let pendingFileViewer: {
    fileId: string;
    name: string;
    size: number;
    mime: string | null;
    caption: string | null;
    chatKey: string | null;
    msgIdx: number | null;
  } | null = null;
  const pendingFileDownloads = new Map<string, { name: string }>();
  let transferSeq = 0;
  let localChatMsgSeq = 0;
  const cachedPreviewsAttempted = new Set<string>();
  const previewPrefetchAttempted = new Set<string>();
  const silentFileGets = new Set<string>();
  let previewWarmupTimer: number | null = null;
  let previewWarmupInFlight = false;
  let previewWarmupLastKey = "";
  let previewWarmupLastSig = "";
  const mobileSidebarMq = window.matchMedia("(max-width: 600px)");
  const floatingSidebarMq = window.matchMedia("(min-width: 601px) and (max-width: 925px)");
  const coarsePointerMq = window.matchMedia("(pointer: coarse)");
  const anyFinePointerMq = window.matchMedia("(any-pointer: fine)");
  const hoverMq = window.matchMedia("(hover: hover)");
  let mobileSidebarOpen = false;
  let mobileSidebarAutoOpened = false;
  let mobileSidebarChatKey: string | null = null;
  let mobileSidebarChatWasAtBottom = false;
  let suppressMobileSidebarCloseStickBottom = false;
  let floatingSidebarOpen = false;
  let floatingSidebarAutoOpened = false;
  let floatingSidebarChatKey: string | null = null;
  let floatingSidebarChatWasAtBottom = false;
  let suppressFloatingSidebarCloseStickBottom = false;
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

  function trimConversation(conv: ChatMessage[], limit: number): { list: ChatMessage[]; cursor: number | null } {
    if (!Array.isArray(conv) || conv.length <= limit) return { list: conv, cursor: null };
    const next = conv.slice(Math.max(0, conv.length - limit));
    let minId: number | null = null;
    for (const m of next) {
      const id = m?.id;
      if (typeof id !== "number" || !Number.isFinite(id) || id <= 0) continue;
      minId = minId === null ? id : Math.min(minId, id);
    }
    return { list: next, cursor: minId };
  }

  function applyConversationLimits(prev: AppState, activeKey: string): { conversations: Record<string, ChatMessage[]>; historyCursor: Record<string, number> } | null {
    const ios = isIOS();
    const activeLimit = ios ? IOS_ACTIVE_CONV_LIMIT : DEFAULT_ACTIVE_CONV_LIMIT;
    const inactiveLimit = ios ? IOS_INACTIVE_CONV_LIMIT : DEFAULT_INACTIVE_CONV_LIMIT;
    let conversations = prev.conversations;
    let historyCursor = prev.historyCursor;
    let changed = false;
    for (const [key, conv] of Object.entries(prev.conversations || {})) {
      const limit = key === activeKey ? activeLimit : inactiveLimit;
      if (!Array.isArray(conv) || conv.length <= limit) continue;
      const trimmed = trimConversation(conv, limit);
      if (trimmed.list === conv) continue;
      if (!changed) {
        conversations = { ...prev.conversations };
        historyCursor = { ...prev.historyCursor };
        changed = true;
      }
      conversations[key] = trimmed.list;
      if (trimmed.cursor && Number.isFinite(trimmed.cursor)) historyCursor[key] = trimmed.cursor;
    }
    return changed ? { conversations, historyCursor } : null;
  }

  let chatJumpRaf: number | null = null;
  let lastChatScrollTop = 0;
  let lastChatUserScrollAt = 0;
  let historyAutoBlockUntil = 0;
  let lastHistoryAutoAt = 0;
  let lastHistoryAutoKey = "";
  let suppressChatClickUntil = 0;
  let pendingChatAutoScroll: { key: string; waitForHistory: boolean } | null = null;

  const computeRoomUnread = (key: string, st: AppState): number => {
    if (!key.startsWith("room:")) return 0;
    const conv = st.conversations?.[key] || [];
    if (!Array.isArray(conv) || conv.length === 0) return 0;
    const marker = st.lastRead?.[key];
    const lastReadId = Number(marker?.id ?? 0);
    const lastReadTs = Number(marker?.ts ?? 0);
    if (lastReadId <= 0 && lastReadTs <= 0) return 0;
    let count = 0;
    for (let i = conv.length - 1; i >= 0; i -= 1) {
      const msg = conv[i];
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
    return count;
  };

  const getMaxScrollTop = (host: HTMLElement) => Math.max(0, host.scrollHeight - host.clientHeight);

  const updateChatJumpVisibility = () => {
    chatJumpRaf = null;
    const btn = layout.chatJump;
    if (!btn) return;
    const key = String(layout.chatHost.getAttribute("data-chat-key") || "");
    const st = store.get();
    const badge = layout.chatJumpBadge;
    if (badge) {
      let unread = 0;
      if (st.selected?.kind === "dm") {
        unread = st.friends.find((f) => f.id === st.selected?.id)?.unread ?? 0;
      } else {
        unread = computeRoomUnread(key, st);
      }
      if (unread > 0) {
        badge.textContent = unread > 999 ? "999+" : String(unread);
        badge.classList.remove("hidden");
      } else {
        badge.textContent = "";
        badge.classList.add("hidden");
      }
    }
    if (!key) {
      btn.classList.add("hidden");
      return;
    }
    const host = layout.chatHost;
    const atBottom = host.scrollTop >= getMaxScrollTop(host) - 24;
    btn.classList.toggle("hidden", atBottom);
  };
  const scheduleChatJumpVisibility = () => {
    if (chatJumpRaf !== null) return;
    chatJumpRaf = window.requestAnimationFrame(updateChatJumpVisibility);
  };

  function markChatAutoScroll(key: string, waitForHistory = false) {
    const k = String(key || "").trim();
    if (!k) return;
    pendingChatAutoScroll = { key: k, waitForHistory };
  }

  function scrollChatToBottom(key: string) {
    const k = String(key || "").trim();
    if (!k) return;
    const host = layout.chatHost;
    const hostState = host as any;
    hostState.__stickBottom = { key: k, active: true, at: Date.now() };
    const stickNow = () => {
      if (String(host.getAttribute("data-chat-key") || "") !== k) return;
      const st = hostState.__stickBottom;
      if (!st || st.key !== k || !st.active) return;
      host.scrollTop = Math.max(0, host.scrollHeight - host.clientHeight);
      maybeRecordLastRead(k);
    };
    queueMicrotask(stickNow);
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(stickNow);
    } else {
      stickNow();
    }
    scheduleChatJumpVisibility();
  }

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

  let lastVirtualWindowUpdateAt = 0;
  function maybeUpdateVirtualWindow(scrollTop: number) {
    const st = store.get();
    if (st.page !== "main") return;
    if (!st.selected) return;
    if (st.chatSearchOpen && st.chatSearchQuery.trim()) return;
    const key = conversationKey(st.selected);
    if (!key) return;
    const msgs = st.conversations[key] || [];
    if (!shouldVirtualize(msgs.length, false)) return;

    const hostState = layout.chatHost as any;
    const avgMap: Map<string, number> | undefined = hostState.__chatVirtualAvgHeights;
    const avg = clampVirtualAvg(avgMap?.get(key));
    const maxStart = getVirtualMaxStart(msgs.length);
    let targetStart = Math.floor(scrollTop / avg) - HISTORY_VIRTUAL_OVERSCAN;
    targetStart = Math.max(0, Math.min(maxStart, targetStart));
    const stick = hostState.__stickBottom;
    if (stick && stick.active && stick.key === key) {
      targetStart = maxStart;
    }
    const currentStart = getVirtualStart(msgs.length, st.historyVirtualStart?.[key]);
    const delta = Math.abs(targetStart - currentStart);
    if (delta < Math.max(8, Math.floor(HISTORY_VIRTUAL_OVERSCAN / 2))) return;
    const now = Date.now();
    if (now - lastVirtualWindowUpdateAt < 120) return;
    lastVirtualWindowUpdateAt = now;
    store.set((prev) => ({
      ...prev,
      historyVirtualStart: { ...prev.historyVirtualStart, [key]: targetStart },
    }));
  }

  const findLastVisibleMessageIndex = (host: HTMLElement): number | null => {
    const linesEl = host.querySelector(".chat-lines");
    if (!(linesEl instanceof HTMLElement)) return null;
    const children = Array.from(linesEl.children);
    if (!children.length) return null;
    const hostRect = host.getBoundingClientRect();
    const topEdge = hostRect.top + 4;
    const bottomEdge = hostRect.bottom - 4;
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const child = children[i];
      if (!(child instanceof HTMLElement)) continue;
      const rawIdx = child.getAttribute("data-msg-idx");
      if (!rawIdx) continue;
      const rect = child.getBoundingClientRect();
      if (rect.bottom <= topEdge) break;
      if (rect.top >= bottomEdge) continue;
      const idx = Number(rawIdx);
      if (Number.isFinite(idx)) return idx;
    }
    return null;
  };

  const recordVisibleRead = () => {
    const st = store.get();
    if (st.page !== "main") return;
    if (!st.selected) return;
    if (st.chatSearchOpen && st.chatSearchQuery.trim()) return;
    const key = conversationKey(st.selected);
    if (!key) return;
    const msgIdx = findLastVisibleMessageIndex(layout.chatHost);
    if (msgIdx === null) return;
    const msgs = st.conversations[key] || [];
    let idx = msgIdx;
    let msg = msgs[idx];
    while (msg && msg.kind === "sys" && idx > 0) {
      idx -= 1;
      msg = msgs[idx];
    }
    if (!msg || msg.kind === "sys") return;
    if (key.startsWith("room:")) {
      recordRoomLastReadEntry(key, msg);
      return;
    }
    if (key.startsWith("dm:")) {
      const msgId = Number(msg.id ?? 0);
      if (!Number.isFinite(msgId) || msgId <= 0) return;
      const peerId = key.slice("dm:".length);
      if (!peerId) return;
      maybeSendMessageRead(peerId, msgId);
    }
  };

  let viewportReadRaf: number | null = null;
  let lastViewportReadAt = 0;
  const scheduleViewportReadUpdate = () => {
    if (viewportReadRaf !== null) return;
    viewportReadRaf = window.requestAnimationFrame(() => {
      viewportReadRaf = null;
      const now = Date.now();
      if (now - lastViewportReadAt < 160) return;
      lastViewportReadAt = now;
      recordVisibleRead();
    });
  };

  layout.chatHost.addEventListener(
    "scroll",
    () => {
      const scrollTop = layout.chatHost.scrollTop;
      const scrollingUp = scrollTop < lastChatScrollTop;
      lastChatScrollTop = scrollTop;
      const hostState = layout.chatHost as any;
      const key = String(layout.chatHost.getAttribute("data-chat-key") || "");
      const atBottom = scrollTop >= getMaxScrollTop(layout.chatHost) - 24;
      if (key) {
        const stick = hostState.__stickBottom;
        if (!stick || stick.key !== key) {
          hostState.__stickBottom = { key, active: atBottom, at: Date.now() };
        } else {
          const now = Date.now();
          const userScrollRecent = now - lastChatUserScrollAt < 2000;
          // Keep pinned-to-bottom stable during async layout shifts (media load, keyboard, viewport changes).
          // Only mark it "not active" when a real user scroll gesture happened recently.
          if (atBottom) {
            stick.active = true;
            stick.at = now;
          } else if (userScrollRecent) {
            stick.active = false;
            stick.at = now;
          }
        }
      }
      scheduleChatJumpVisibility();
      maybeAutoLoadMoreHistory(scrollTop, scrollingUp);
      maybeUpdateVirtualWindow(scrollTop);
      scheduleViewportReadUpdate();
      if (atBottom) maybeRecordLastRead(key);
    },
    { passive: true }
  );

  // Detect user-driven scroll gestures (wheel/touch/drag) to distinguish from async layout shifts.
  const markUserChatScroll = () => {
    lastChatUserScrollAt = Date.now();
  };
  layout.chatHost.addEventListener("wheel", markUserChatScroll, { passive: true });
  layout.chatHost.addEventListener("touchstart", markUserChatScroll, { passive: true });
  layout.chatHost.addEventListener("touchmove", markUserChatScroll, { passive: true });
  layout.chatHost.addEventListener("pointerdown", markUserChatScroll, { passive: true });

  // Keep the chat pinned to bottom on layout changes (keyboard open/close, composer autosize),
  // but only when the user is already at the bottom.
  let chatStickyResizeRaf: number | null = null;
  const scheduleChatStickyResize = () => {
    if (chatStickyResizeRaf !== null) return;
    chatStickyResizeRaf = window.requestAnimationFrame(() => {
      chatStickyResizeRaf = null;
      const host = layout.chatHost;
      const key = String(host.getAttribute("data-chat-key") || "");
      if (!key) return;
      const st = (host as any).__stickBottom;
      if (!st || !st.active || st.key !== key) return;
      st.at = Date.now();
      host.scrollTop = Math.max(0, host.scrollHeight - host.clientHeight);
      maybeRecordLastRead(key);
      scheduleViewportReadUpdate();
      scheduleChatJumpVisibility();
    });
  };

  const chatResizeObserver =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          scheduleChatStickyResize();
        })
      : null;
  try {
    chatResizeObserver?.observe(layout.chatHost);
    chatResizeObserver?.observe(layout.chat);
    chatResizeObserver?.observe(layout.inputWrap);
  } catch {
    // ignore
  }

  // Some mobile browsers can miss ResizeObserver updates for async media loads.
  // Keep pinned-to-bottom stable when images/videos load, but only if the user is already pinned.
  layout.chatHost.addEventListener(
    "load",
    (e) => {
      const target = e.target as unknown;
      if (!(target instanceof HTMLImageElement)) return;
      scheduleChatStickyResize();
    },
    true
  );
  layout.chatHost.addEventListener(
    "loadedmetadata",
    (e) => {
      const target = e.target as unknown;
      if (!(target instanceof HTMLVideoElement || target instanceof HTMLAudioElement)) return;
      scheduleChatStickyResize();
    },
    true
  );

  let chatTouchStartX = 0;
  let chatTouchStartY = 0;
  let chatTouchTracking = false;
  const resetChatTouch = () => {
    chatTouchTracking = false;
  };

  layout.chatHost.addEventListener(
    "touchstart",
    (e) => {
      const ev = e as TouchEvent;
      if (ev.touches.length !== 1) {
        chatTouchTracking = false;
        return;
      }
      const target = ev.target as HTMLElement | null;
      if (target && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable)) {
        chatTouchTracking = false;
        return;
      }
      chatTouchStartX = ev.touches[0].clientX;
      chatTouchStartY = ev.touches[0].clientY;
      chatTouchTracking = true;
    },
    { passive: true }
  );

  layout.chatHost.addEventListener(
    "touchmove",
    (e) => {
      if (!chatTouchTracking) return;
      const ev = e as TouchEvent;
      if (ev.touches.length !== 1) return;
      const dx = ev.touches[0].clientX - chatTouchStartX;
      const dy = ev.touches[0].clientY - chatTouchStartY;
      if (Math.abs(dx) > Math.abs(dy) + 6) {
        e.preventDefault();
        return;
      }
      const host = layout.chatHost;
      const top = host.scrollTop <= 0;
      const bottom = host.scrollTop >= getMaxScrollTop(host) - 1;
      if ((dy > 0 && top) || (dy < 0 && bottom)) {
        e.preventDefault();
      }
    },
    { passive: false }
  );

  layout.chatHost.addEventListener("touchend", resetChatTouch, { passive: true });
  layout.chatHost.addEventListener("touchcancel", resetChatTouch, { passive: true });

  function isVideoLikeFile(name: string, mime?: string | null): boolean {
    const mt = String(mime || "").toLowerCase();
    if (mt.startsWith("video/")) return true;
    const n = String(name || "").toLowerCase();
    return /\.(mp4|m4v|mov|webm|ogv|mkv|avi|3gp|3g2)$/.test(n);
  }

  function isMediaAttachment(att: ChatMessage["attachment"] | null | undefined): att is {
    kind: "file";
    localId?: string | null;
    fileId?: string | null;
    name: string;
    size: number;
    mime?: string | null;
  } {
    if (!att || att.kind !== "file") return false;
    return isImageLikeFile(att.name, att.mime) || isVideoLikeFile(att.name, att.mime);
  }

  function findNeighborMediaIndex(msgs: ChatMessage[], startIdx: number, direction: -1 | 1): number | null {
    if (!Number.isFinite(startIdx) || startIdx < 0 || startIdx >= msgs.length) return null;
    for (let i = startIdx + direction; i >= 0 && i < msgs.length; i += direction) {
      const msg = msgs[i];
      if (!msg || msg.kind === "sys") continue;
      if (isMediaAttachment(msg.attachment)) return i;
    }
    return null;
  }

  function buildFileViewerModalState(params: {
    url: string;
    name: string;
    size: number;
    mime: string | null;
    caption: string | null;
    chatKey: string | null;
    msgIdx: number | null;
  }) {
    const st = store.get();
    const chatKey = params.chatKey ? String(params.chatKey) : null;
    const msgIdx = Number.isFinite(params.msgIdx) ? Math.trunc(Number(params.msgIdx)) : null;
    const msgs = chatKey ? st.conversations[chatKey] || [] : [];
    const prevIdx = chatKey && msgIdx !== null ? findNeighborMediaIndex(msgs, msgIdx, -1) : null;
    const nextIdx = chatKey && msgIdx !== null ? findNeighborMediaIndex(msgs, msgIdx, 1) : null;
    return {
      kind: "file_viewer" as const,
      url: params.url,
      name: params.name,
      size: params.size,
      mime: params.mime,
      caption: params.caption,
      chatKey,
      msgIdx,
      prevIdx,
      nextIdx,
    };
  }

  async function openFileViewerFromMessageIndex(
    chatKey: string,
    msgIdx: number,
    fallback?: { url?: string | null; name?: string; size?: number; mime?: string | null; caption?: string | null; fileId?: string | null }
  ) {
    const st = store.get();
    const msgs = st.conversations[chatKey] || [];
    if (!Number.isFinite(msgIdx) || msgIdx < 0 || msgIdx >= msgs.length) return;
    const msg = msgs[msgIdx];
    const att = msg?.attachment;
    if (!isMediaAttachment(att)) return;
    const name = String(att.name || fallback?.name || "файл");
    const size = Number(att.size || fallback?.size || 0) || 0;
    const mime = (att.mime ?? fallback?.mime) || null;
    const rawCaption = String(msg.text || "").trim();
    const captionText = rawCaption && !rawCaption.startsWith("[file]") ? rawCaption : String(fallback?.caption || "").trim();
    const caption = captionText ? captionText : null;
    const fileId = att.fileId ? String(att.fileId) : fallback?.fileId || null;
    const localId = att.localId ? String(att.localId) : null;
    const entry = fileId
      ? st.fileTransfers.find((t) => String(t.id || "").trim() === fileId)
      : localId
        ? st.fileTransfers.find((t) => String(t.localId || "").trim() === localId)
        : null;
    const url = entry?.url || fallback?.url || null;
    if (url) {
      store.set({ modal: buildFileViewerModalState({ url, name, size, mime, caption, chatKey, msgIdx }) });
      return;
    }
    if (!fileId) {
      store.set({ status: "Файл пока недоступен" });
      return;
    }
    const opened = await tryOpenFileViewerFromCache(fileId, { name, size, mime, caption, chatKey, msgIdx });
    if (opened) return;
    pendingFileViewer = { fileId, name, size, mime, caption, chatKey, msgIdx };
    gateway.send({ type: "file_get", file_id: fileId });
    store.set({ status: `Скачивание: ${name}` });
  }

  function navigateFileViewer(dir: "prev" | "next") {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "file_viewer") return;
    const chatKey = modal.chatKey ? String(modal.chatKey) : "";
    const targetIdx = dir === "prev" ? modal.prevIdx : modal.nextIdx;
    if (!chatKey || typeof targetIdx !== "number" || !Number.isFinite(targetIdx)) return;
    void openFileViewerFromMessageIndex(chatKey, targetIdx);
  }

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

    const stForSelection = store.get();
    const selectionKey = stForSelection.selected ? conversationKey(stForSelection.selected) : "";
    const selectionActive =
      Boolean(selectionKey) &&
      Boolean(stForSelection.chatSelection && stForSelection.chatSelection.key === selectionKey) &&
      Boolean(stForSelection.chatSelection?.ids?.length);
    if (selectionActive) {
      if (target?.closest("button, a, input, textarea, [contenteditable='true']")) return;
      const row = target?.closest("[data-msg-idx]") as HTMLElement | null;
      if (row) {
        const idx = Math.trunc(Number(row.getAttribute("data-msg-idx") || ""));
        const conv = selectionKey ? stForSelection.conversations[selectionKey] : null;
        const msg = conv && idx >= 0 && idx < conv.length ? conv[idx] : null;
        if (msg) {
          e.preventDefault();
          e.stopPropagation();
          toggleChatSelection(selectionKey, msg);
          return;
        }
      }
    }

    const reactBtn = target?.closest("button[data-action='msg-react'][data-emoji]") as HTMLButtonElement | null;
    if (reactBtn) {
      const st = store.get();
      if (st.conn !== "connected") {
        store.set({ status: "Нет соединения" });
        return;
      }
      if (!st.authed) {
        store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
        return;
      }
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
      gateway.send({ type: "reaction_set", id: msgId, emoji: nextEmoji });
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
        const active = Boolean(
          st.rightPanel && st.rightPanel.kind === st.selected.kind && st.rightPanel.id === st.selected.id
        );
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

    const selectionCancelBtn = target?.closest("button[data-action='chat-selection-cancel']") as HTMLButtonElement | null;
    if (selectionCancelBtn) {
      e.preventDefault();
      clearChatSelection();
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
      const st = store.get();
      const msgIdx = Number(searchResultBtn.getAttribute("data-msg-idx"));
      if (!Number.isFinite(msgIdx)) return;
      let pos = Number(searchResultBtn.getAttribute("data-hit-pos"));
      if (!Number.isFinite(pos)) {
        pos = st.chatSearchHits.indexOf(msgIdx);
      }
      if (!Number.isFinite(pos) || pos < 0) return;
      e.preventDefault();
      setChatSearchPos(pos);
      store.set({ chatSearchResultsOpen: false });
      jumpToChatMsgIdx(msgIdx);
      focusChatSearch(false);
      return;
    }

    const jumpBtn = target?.closest("button[data-action='chat-jump-bottom']") as HTMLButtonElement | null;
    if (jumpBtn) {
      e.preventDefault();
      layout.chatHost.scrollTop = Math.max(0, layout.chatHost.scrollHeight - layout.chatHost.clientHeight);
      const key = String(layout.chatHost.getAttribute("data-chat-key") || "");
      if (key) (layout.chatHost as any).__stickBottom = { key, active: true, at: Date.now() };
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
          gateway.send({ type: "block_set", peer: from, value: true });
          showToast(`Заблокировано: ${from}`, { kind: "warn" });
        } else {
          store.set({ status: "Нет соединения" });
        }
      }
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
          gateway.send({ type: "block_set", peer: from, value: true });
          showToast(`Заблокировано: ${from}`, { kind: "warn" });
        } else {
          store.set({ status: "Нет соединения" });
        }
      }
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
      void (async () => {
        const meta = resolveFileMeta(fileId);
        const st = store.get();
        const fromCache = await tryServeFileFromCache(fileId, meta);
        if (fromCache) return;
        const entry = st.fileTransfers.find((t) => String(t.id || "").trim() === fileId);
        if (entry?.url) {
          triggerBrowserDownload(entry.url, meta.name || entry.name || "файл");
          return;
        }
        const canStream = Number(meta.size || 0) >= STREAM_MIN_BYTES && startStreamDownload(fileId, meta);
        if (canStream) {
          store.set({ status: `Скачивание: ${meta.name || "файл"}` });
          return;
        }
        pendingFileDownloads.set(fileId, { name: meta.name || "файл" });
        gateway.send({ type: "file_get", file_id: fileId });
        store.set({ status: `Скачивание: ${meta.name || fileId}` });
      })();
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
        void openFileViewerFromMessageIndex(chatKey, Math.trunc(msgIdx), { url, name, size, mime, caption: captionText, fileId: fileId || null });
        return;
      }
      if (url) {
        store.set({ modal: buildFileViewerModalState({ url, name, size, mime, caption: captionText, chatKey: null, msgIdx: null }) });
        return;
      }
      void (async () => {
        const existing = st.fileTransfers.find((t) => String(t.id || "").trim() === fileId && Boolean(t.url));
        if (existing?.url) {
          store.set({
            modal: buildFileViewerModalState({
              url: existing.url,
              name,
              size: size || existing.size || 0,
              mime: mime || existing.mime || null,
              caption: captionText,
              chatKey: null,
              msgIdx: null,
            }),
          });
          return;
        }
        const opened = await tryOpenFileViewerFromCache(fileId, { name, size, mime, caption: captionText, chatKey: null, msgIdx: null });
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
        pendingFileViewer = { fileId, name, size, mime, caption: captionText, chatKey: null, msgIdx: null };
        gateway.send({ type: "file_get", file_id: fileId });
        store.set({ status: `Скачивание: ${name}` });
      })();
      return;
    }
  });

  layout.chat.addEventListener("dblclick", (e) => {
    const st = store.get();
    if (coarsePointerMq.matches && !anyFinePointerMq.matches) return;
    if (st.editing) return;
    if (Date.now() < suppressChatClickUntil) return;
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
      lastUserInputAt = Date.now();
      setChatSearchQuery(t.value);
      return;
    }
    if (t.id === "chat-search-date") {
      lastUserInputAt = Date.now();
      setChatSearchDate(t.value);
    }
  });

  layout.chat.addEventListener("change", (e) => {
    const t = e.target as HTMLElement | null;
    if (!t || !(t instanceof HTMLInputElement)) return;
    if (t.id !== "chat-search-date") return;
    lastUserInputAt = Date.now();
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

  // iOS Safari/PWA: нет beforeinstallprompt, поэтому даём ненавязчивую подсказку,
  // как установить приложение через «Поделиться → На экран "Домой"».
  function maybeOfferIosInstallToast() {
    if (!isIOS()) return;
    const isStandalone = isStandaloneDisplayMode();
    if (!shouldOfferPwaInstall({ storage: localStorage, now: Date.now(), isStandalone })) return;
    showToast("iPhone/iPad: установить → Поделиться → «На экран Домой»", {
      kind: "info",
      timeoutMs: 14000,
      actions: [
        { id: "pwa-ios-help", label: "Инструкция", primary: true, onClick: () => setPage("help") },
        { id: "pwa-ios-later", label: "Позже", onClick: () => markPwaInstallDismissed(localStorage, Date.now()) },
      ],
    });
  }

  // Показываем после первого рендера, чтобы не конфликтовать со стартом/автовходом.
  if (isIOS() && !isStandaloneDisplayMode()) {
    window.setTimeout(() => {
      if (pwaInstallOffered) return;
      maybeOfferIosInstallToast();
    }, 1800);
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

  function isChatAtBottom(key: string): boolean {
    const k = String(key || "").trim();
    if (!k) return true;
    const host = layout.chatHost;
    const currentKey = String(host.getAttribute("data-chat-key") || "").trim();
    if (!currentKey || currentKey !== k) return true;
    const sticky = (host as any).__stickBottom;
    if (sticky && sticky.active && sticky.key === k) return true;
    return host.scrollTop >= getMaxScrollTop(host) - 24;
  }

  function shouldShowRightOverlay(st: AppState): boolean {
    return Boolean(st.rightPanel && st.page === "main" && !st.modal && floatingSidebarMq.matches);
  }

  function syncNavOverlay() {
    const st = store.get();
    const show = mobileSidebarOpen || floatingSidebarOpen || shouldShowRightOverlay(st);
    layout.navOverlay.classList.toggle("hidden", !show);
    layout.navOverlay.setAttribute("aria-hidden", show ? "false" : "true");
  }

  const markSidebarResetScroll = () => {
    try {
      layout.sidebar.dataset.sidebarResetScroll = "1";
      layout.sidebarBody.dataset.sidebarResetScroll = "1";
    } catch {
      // ignore
    }
  };

  const resetSidebarScrollTop = (behavior: ScrollBehavior = "auto") => {
    try {
      layout.sidebarBody.scrollTo({ top: 0, left: 0, behavior });
    } catch {
      layout.sidebarBody.scrollTop = 0;
      layout.sidebarBody.scrollLeft = 0;
    }
  };
  const scheduleSidebarScrollReset = () => {
    const resetScroll = () => resetSidebarScrollTop();
    queueMicrotask(() => resetScroll());
    try {
      if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => resetScroll());
      }
    } catch {
      // ignore
    }
    // iOS/WebKit: extra delayed pass helps avoid restored mid-scroll on open.
    try {
      if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
        window.setTimeout(() => resetScroll(), 120);
      }
    } catch {
      // ignore
    }
  };

  function setMobileSidebarOpen(open: boolean) {
    const st = store.get();
    const forcedOpen = Boolean(mobileSidebarMq.matches && st.page === "main" && !st.selected && !st.modal);
    const shouldOpen = Boolean((open || forcedOpen) && mobileSidebarMq.matches);
    if (mobileSidebarOpen === shouldOpen) return;

    const prevOpen = mobileSidebarOpen;
    const selKey = st.page === "main" && st.selected ? conversationKey(st.selected) : "";
    const restoreKey =
      !shouldOpen &&
      prevOpen &&
      !suppressMobileSidebarCloseStickBottom &&
      mobileSidebarChatWasAtBottom &&
      mobileSidebarChatKey &&
      selKey &&
      selKey === mobileSidebarChatKey
        ? selKey
        : "";

    if (shouldOpen) {
      mobileSidebarChatKey = selKey || null;
      mobileSidebarChatWasAtBottom = Boolean(selKey && isChatAtBottom(selKey));
    } else {
      mobileSidebarChatKey = null;
      mobileSidebarChatWasAtBottom = false;
    }

    mobileSidebarOpen = shouldOpen;
    layout.sidebar.classList.toggle("sidebar-mobile-open", shouldOpen);
    document.documentElement.classList.toggle("sidebar-mobile-open", shouldOpen);
    syncNavOverlay();
    if (shouldOpen) {
      markSidebarResetScroll();
      scheduleSidebarScrollReset();
      queueMicrotask(() => {
        const searchInput = layout.sidebar.querySelector(".sidebar-search-input") as HTMLInputElement | null;
        if (searchInput && !searchInput.disabled) {
          searchInput.focus();
          return;
        }
        const tabBtn = layout.sidebar.querySelector(".sidebar-tabs button") as HTMLButtonElement | null;
        if (tabBtn) {
          tabBtn.focus();
          return;
        }
        layout.sidebarBody?.focus?.();
      });
    } else if (restoreKey) {
      scrollChatToBottom(restoreKey);
    }
  }

  function setFloatingSidebarOpen(open: boolean) {
    const st = store.get();
    const forcedOpen = Boolean(floatingSidebarMq.matches && st.page === "main" && !st.selected && !st.modal);
    const shouldOpen = Boolean((open || forcedOpen) && floatingSidebarMq.matches);
    if (floatingSidebarOpen === shouldOpen) return;

    const prevOpen = floatingSidebarOpen;
    const selKey = st.page === "main" && st.selected ? conversationKey(st.selected) : "";
    const restoreKey =
      !shouldOpen &&
      prevOpen &&
      !suppressFloatingSidebarCloseStickBottom &&
      floatingSidebarChatWasAtBottom &&
      floatingSidebarChatKey &&
      selKey &&
      selKey === floatingSidebarChatKey
        ? selKey
        : "";

    if (shouldOpen) {
      floatingSidebarChatKey = selKey || null;
      floatingSidebarChatWasAtBottom = Boolean(selKey && isChatAtBottom(selKey));
    } else {
      floatingSidebarChatKey = null;
      floatingSidebarChatWasAtBottom = false;
    }

    floatingSidebarOpen = shouldOpen;
    layout.sidebar.classList.toggle("sidebar-float-open", shouldOpen);
    document.documentElement.classList.toggle("floating-sidebar-open", shouldOpen);
    syncNavOverlay();
    if (shouldOpen) {
      markSidebarResetScroll();
      scheduleSidebarScrollReset();
    }
    if (restoreKey) {
      scrollChatToBottom(restoreKey);
    }
  }

  function closeMobileSidebar() {
    if (!mobileSidebarOpen) {
      closeFloatingSidebar();
      return;
    }
    setMobileSidebarOpen(false);
    closeFloatingSidebar();
  }

  function closeFloatingSidebar() {
    if (!floatingSidebarOpen) return;
    setFloatingSidebarOpen(false);
  }

  function setMobileSidebarTab(tab: MobileSidebarTab) {
    const next: MobileSidebarTab = tab === "contacts" || tab === "menu" || tab === "boards" ? tab : "chats";
    // Telegram-like: tap on the active tab scrolls the list to top.
    if (store.get().mobileSidebarTab === next) {
      resetSidebarScrollTop("smooth");
      return;
    }
    markSidebarResetScroll();
    store.set({ mobileSidebarTab: next });
  }

  layout.navOverlay.addEventListener("click", () => {
    const st = store.get();
    if (shouldShowRightOverlay(st)) {
      closeRightPanel();
      return;
    }
    closeMobileSidebar();
  });

  layout.sidebar.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement | null)?.closest("button[data-action='sidebar-close']") as HTMLButtonElement | null;
    if (!btn) return;
    e.preventDefault();
    closeMobileSidebar();
  });

  layout.overlay.addEventListener("click", (e) => {
    const kind = store.get().modal?.kind;
    if (kind !== "context_menu" && kind !== "file_viewer") return;
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
    if (action === "nav-back") {
      e.preventDefault();
      const st = store.get();
      if (st.modal) return;
      setPage("main");
      return;
    }
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
    if (st.modal) return;
    if (mobileSidebarMq.matches) {
      setMobileSidebarOpen(!mobileSidebarOpen);
      return;
    }
    if (floatingSidebarMq.matches) {
      setFloatingSidebarOpen(!floatingSidebarOpen);
    }
  });

  const onMobileSidebarMqChange = () => {
    if (!mobileSidebarMq.matches) {
      closeMobileSidebar();
      mobileSidebarAutoOpened = false;
    }
  };
  const onFloatingSidebarMqChange = () => {
    if (!floatingSidebarMq.matches) {
      closeFloatingSidebar();
      floatingSidebarAutoOpened = false;
    }
  };
  if (typeof mobileSidebarMq.addEventListener === "function") {
    mobileSidebarMq.addEventListener("change", onMobileSidebarMqChange);
  } else {
    const legacy = mobileSidebarMq as MediaQueryList & { addListener?: (cb: (ev: MediaQueryListEvent) => void) => void };
    legacy.addListener?.(onMobileSidebarMqChange);
  }
  if (typeof floatingSidebarMq.addEventListener === "function") {
    floatingSidebarMq.addEventListener("change", onFloatingSidebarMqChange);
  } else {
    const legacy = floatingSidebarMq as MediaQueryList & { addListener?: (cb: (ev: MediaQueryListEvent) => void) => void };
    legacy.addListener?.(onFloatingSidebarMqChange);
  }

  async function initSkins() {
    const skins = await fetchAvailableSkins();
    if (!skins) return;
    store.set({ skins });
    const current = normalizeSkinId(store.get().skin);
    if (!skins.some((s) => s.id === current)) {
      store.set({ skin: "default" });
      storeSkinId("default");
      applySkin("default");
    }
  }

  function setTheme(mode: ThemeMode) {
    const theme: ThemeMode = mode === "light" ? "light" : "dark";
    store.set({ theme, status: `Тема: ${theme === "light" ? "светлая" : "тёмная"}` });
    storeTheme(theme);
    applyTheme(theme);
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

  function setMessageView(view: string) {
    const mode = normalizeMessageView(view);
    const label = mode === "plain" ? "Текстовый" : mode === "compact" ? "Компактный" : "Елочка";
    store.set({ messageView: mode, status: `Отображение сообщений: ${label}` });
    storeMessageView(mode);
    applyMessageView(mode);
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
        if (key) {
          historyRequested.delete(key);
          historyPreviewRequested.delete(key);
        }
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
      const nextStatus = detail ? `${base}: ${detail}` : base;
      store.set((prev) => {
        const clearWelcome = conn === "connected" && prev.modal?.kind === "welcome";
        if (!clearWelcome && prev.conn === conn && prev.status === nextStatus) return prev;
        return {
          ...prev,
          conn,
          status: nextStatus,
          ...(clearWelcome ? { modal: null } : {}),
        };
      });

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
    // Mobile: не допускаем "пустой экран" (main без выбранного чата) — в этом случае
    // возвращаем пользователя в список (sidebar) вместо закрытия drawer.
    const keepSidebar = Boolean(
      (mobileSidebarMq.matches || floatingSidebarMq.matches) && page === "main" && !store.get().selected && !store.get().modal
    );
    if (page !== "main" || !keepSidebar) {
      closeMobileSidebar();
    } else {
      if (mobileSidebarMq.matches) setMobileSidebarOpen(true);
      else if (floatingSidebarMq.matches) setFloatingSidebarOpen(true);
    }
    store.set((prev) => ({
      ...prev,
      page,
      ...(page !== "user" ? { userViewId: null } : {}),
      ...(page !== "group" ? { groupViewId: null } : {}),
      ...(page !== "board" ? { boardViewId: null } : {}),
      ...(page !== "main" ? { rightPanel: null } : {}),
      ...(page !== "main" ? { mobileSidebarTab: "menu" as MobileSidebarTab } : {}),
      ...(page !== "main"
        ? {
            chatSearchOpen: false,
            chatSearchResultsOpen: false,
            chatSearchQuery: "",
            chatSearchDate: "",
            chatSearchFilter: "all",
            chatSearchHits: [],
            chatSearchPos: 0,
            chatSearchCounts: createChatSearchCounts(),
          }
        : {}),
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

  function openGroupPage(id: string) {
    const gid = String(id || "").trim();
    if (!gid) return;
    setPage("group");
    store.set({ groupViewId: gid, status: `Чат: ${gid}` });
    const st = store.get();
    if (st.authed && st.conn === "connected") {
      gateway.send({ type: "group_info", group_id: gid });
    }
  }

  function openBoardPage(id: string) {
    const bid = String(id || "").trim();
    if (!bid) return;
    setPage("board");
    store.set({ boardViewId: bid, status: `Доска: ${bid}` });
    const st = store.get();
    if (st.authed && st.conn === "connected") {
      gateway.send({ type: "board_info", board_id: bid });
    }
  }

  function openRightPanel(target: TargetRef) {
    const kind = target.kind;
    const id = String(target.id || "").trim();
    if (!id) return;
    store.set({ rightPanel: { kind, id } });
    const st = store.get();
    if (st.authed && st.conn === "connected") {
      if (kind === "dm") gateway.send({ type: "profile_get", id });
      else if (kind === "group") gateway.send({ type: "group_info", group_id: id });
      else if (kind === "board") gateway.send({ type: "board_info", board_id: id });
    }
  }

  function closeRightPanel() {
    store.set({ rightPanel: null });
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
	      // UX: не ждём флага historyLoaded, чтобы сразу активировать pinned-bottom (особенно важно для медиа,
	      // которое догружает высоту позже на iOS/WebKit).
	      markChatAutoScroll(key, false);
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

  function requestHistoryPreview(t: TargetRef) {
    const st = store.get();
    if (!st.authed || st.conn !== "connected") return;
    const key = conversationKey(t);
    if (!key) return;
    if (historyPreviewRequested.has(key)) return;
    if (st.historyLoaded[key]) return;
    if ((st.conversations[key] || []).length) return;
    const last = historyPreviewLastAt.get(key) ?? 0;
    const now = Date.now();
    if (now - last < 5 * 60 * 1000) return;
    historyPreviewLastAt.set(key, now);
    historyPreviewRequested.add(key);
    if (t.kind === "dm") {
      gateway.send({ type: "history", peer: t.id, before_id: 0, limit: 1, preview: true });
    } else {
      gateway.send({ type: "history", room: t.id, before_id: 0, limit: 1, preview: true });
    }
  }

  function drainHistoryPreviewQueue() {
    historyPreviewTimer = null;
    const st = store.get();
    if (!st.authed || st.conn !== "connected") {
      historyPreviewQueue.length = 0;
      return;
    }
    let sent = 0;
    while (historyPreviewQueue.length && sent < 6) {
      const t = historyPreviewQueue.shift();
      if (!t) continue;
      requestHistoryPreview(t);
      sent += 1;
    }
    if (historyPreviewQueue.length) {
      historyPreviewTimer = window.setTimeout(drainHistoryPreviewQueue, 350);
    }
  }

  function enqueueHistoryPreview(t: TargetRef) {
    historyPreviewQueue.push(t);
    if (historyPreviewTimer !== null) return;
    historyPreviewTimer = window.setTimeout(drainHistoryPreviewQueue, 200);
  }

  type HistoryPrependAnchor = {
    key: string;
    msgKey?: string;
    msgId?: number;
    rectBottom?: number;
    scrollHeight: number;
    scrollTop: number;
  };

  let historyPrependAnchor: HistoryPrependAnchor | null = null;

  function findHistoryAnchorElement(): { element: HTMLElement; rect: DOMRect } | null {
    const host = layout.chatHost;
    const lines = host.firstElementChild as HTMLElement | null;
    if (!lines) return null;
    const hostRect = host.getBoundingClientRect();
    const children = Array.from(lines.children) as HTMLElement[];
    let fallback: HTMLElement | null = null;
    const visible: Array<{ element: HTMLElement; rect: DOMRect }> = [];
    for (const child of children) {
      if (!child.classList.contains("msg")) continue;
      if (!fallback) fallback = child;
      const rect = child.getBoundingClientRect();
      if (rect.bottom >= hostRect.top && rect.top <= hostRect.bottom) {
        visible.push({ element: child, rect });
      } else if (visible.length && rect.top > hostRect.bottom) {
        break;
      }
    }
    if (visible.length) return visible[visible.length - 1];
    if (fallback) return { element: fallback, rect: fallback.getBoundingClientRect() };
    return null;
  }

  function makeHistoryPrependAnchor(key: string): HistoryPrependAnchor {
    const host = layout.chatHost;
    const base: HistoryPrependAnchor = { key, scrollHeight: host.scrollHeight, scrollTop: host.scrollTop };
    const anchor = findHistoryAnchorElement();
    if (!anchor) return base;
    const msgKey = String(anchor.element.getAttribute("data-msg-key") || "").trim();
    const rawMsgId = anchor.element.getAttribute("data-msg-id");
    const msgId = rawMsgId ? Number(rawMsgId) : NaN;
    const next: HistoryPrependAnchor = { ...base, rectBottom: anchor.rect.bottom };
    if (msgKey) return { ...next, msgKey };
    if (Number.isFinite(msgId)) return { ...next, msgId };
    return base;
  }

  function findHistoryAnchorByKey(anchor: HistoryPrependAnchor): HTMLElement | null {
    const host = layout.chatHost;
    const lines = host.firstElementChild as HTMLElement | null;
    if (!lines) return null;
    const children = Array.from(lines.children) as HTMLElement[];
    for (const child of children) {
      if (!child.classList.contains("msg")) continue;
      if (anchor.msgKey) {
        if (child.getAttribute("data-msg-key") === anchor.msgKey) return child;
        continue;
      }
      if (anchor.msgId !== undefined) {
        const raw = child.getAttribute("data-msg-id");
        if (!raw) continue;
        const msgId = Number(raw);
        if (Number.isFinite(msgId) && msgId === anchor.msgId) return child;
      }
    }
    return null;
  }

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

    historyPrependAnchor = makeHistoryPrependAnchor(key);
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
    const hasUpTo = typeof upToId === "number" && Number.isFinite(upToId) && upToId > 0;
    if (unread <= 0 && !hasUpTo) return;

    const now = Date.now();
    const throttleKey = `dm:${peer}`;
    const last = lastReadSentAt.get(throttleKey) ?? 0;
    if (now - last < 300) return;
    lastReadSentAt.set(throttleKey, now);

    gateway.send({ type: "message_read", peer, ...(hasUpTo ? { up_to_id: upToId } : {}) });
    let shouldClearUnread = unread > 0;
    if (hasUpTo && unread > 0) {
      const conv = st.conversations?.[dmKey(peer)] || [];
      let lastInboundId = 0;
      for (let i = conv.length - 1; i >= 0; i -= 1) {
        const msg = conv[i];
        if (!msg || msg.kind !== "in") continue;
        const msgId = Number(msg.id ?? 0);
        if (Number.isFinite(msgId) && msgId > 0) {
          lastInboundId = msgId;
          break;
        }
      }
      shouldClearUnread = lastInboundId > 0 && upToId >= lastInboundId;
    }
    if (shouldClearUnread) {
      store.set((prev) => ({
        ...prev,
        friends: prev.friends.map((f) => (f.id === peer ? { ...f, unread: 0 } : f)),
      }));
    }
  }

  function maybeSendRoomRead(roomId: string, upToId: number) {
    const st = store.get();
    if (st.conn !== "connected") return;
    if (!st.authed) return;
    const room = String(roomId || "").trim();
    if (!room) return;
    const hasUpTo = typeof upToId === "number" && Number.isFinite(upToId) && upToId > 0;
    if (!hasUpTo) return;

    const now = Date.now();
    const throttleKey = `room:${room}`;
    const last = lastReadSentAt.get(throttleKey) ?? 0;
    if (now - last < 300) return;
    lastReadSentAt.set(throttleKey, now);

    gateway.send({ type: "message_read", room, up_to_id: upToId });
  }

  function selectTarget(t: TargetRef) {
    closeEmojiPopover();
    const composerHadFocus = document.activeElement === layout.input;
    const prev = store.get();
    if (prev.page === "main" && prev.selected && prev.selected.kind === t.kind && prev.selected.id === t.id) {
      // When tapping the already-selected chat in the mobile/floating sidebar,
      // allow the sidebar-close logic to restore "pinned to bottom" if it was at bottom.
      closeMobileSidebar();
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
    suppressMobileSidebarCloseStickBottom = true;
    suppressFloatingSidebarCloseStickBottom = true;
    try {
      closeMobileSidebar();
    } finally {
      suppressMobileSidebarCloseStickBottom = false;
      suppressFloatingSidebarCloseStickBottom = false;
    }
    const prevKey = prev.selected ? conversationKey(prev.selected) : "";
    const nextKey = conversationKey(t);
    if (nextKey) {
      // UX: открываем чат сразу "внизу" (Telegram-like), не завязываясь на historyLoaded,
      // чтобы даже медиа-последнее сообщение не "съедало" автоскролл.
      markChatAutoScroll(nextKey, false);
    }
    const leavingEdit = Boolean(prev.editing && prevKey && prev.editing.key === prevKey && prevKey !== nextKey);
    const prevText = leavingEdit ? prev.editing?.prevDraft || "" : layout.input.value || "";
    const nextDrafts = prevKey ? updateDraftMap(prev.drafts, prevKey, prevText) : prev.drafts;
    const nextText = nextDrafts[nextKey] ?? "";
    store.set((p) => {
      const trimmed = nextKey ? applyConversationLimits(p, nextKey) : null;
      const nextRightPanel = p.rightPanel ? { kind: t.kind, id: t.id } : p.rightPanel;
      const nextReplyDraft = p.replyDraft && p.replyDraft.key === nextKey ? p.replyDraft : null;
      const nextForwardDraft = p.forwardDraft && p.forwardDraft.key === nextKey ? p.forwardDraft : null;
      return {
        ...p,
        selected: t,
        page: "main",
        rightPanel: nextRightPanel,
        drafts: nextDrafts,
        input: nextText,
        editing: leavingEdit ? null : p.editing,
        replyDraft: nextReplyDraft,
        forwardDraft: nextForwardDraft,
        chatSelection: null,
        boardComposerOpen: t.kind === "board" ? p.boardComposerOpen : false,
        chatSearchOpen: false,
        chatSearchResultsOpen: false,
        chatSearchQuery: "",
        chatSearchDate: "",
        chatSearchFilter: "all",
        chatSearchHits: [],
        chatSearchPos: 0,
        chatSearchCounts: createChatSearchCounts(),
        ...(trimmed ? { conversations: trimmed.conversations, historyCursor: trimmed.historyCursor } : {}),
      };
    });
    if (prev.authed) {
      const userId = prev.selfId || prev.authRememberedId || "";
      if (userId) saveLastActiveTarget(userId, t);
    }
    try {
      if (layout.input.value !== nextText) layout.input.value = nextText;
      autosizeInput(layout.input);
      scheduleBoardEditorPreview();
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
    const linkRe = /(https?:\/\/|www\.)\S+/i;
    const senderTokensForMessage = (msg: ChatMessage): string => {
      const senderId = String(msg?.from || "").trim();
      if (!senderId) return "";
      const friend = st.friends.find((f) => f.id === senderId);
      const profile = st.profiles?.[senderId];
      const displayName = String(friend?.display_name || profile?.display_name || "").trim();
      const handleRaw = String(friend?.handle || profile?.handle || "").trim();
      const handle = handleRaw.startsWith("@") ? handleRaw : handleRaw ? `@${handleRaw}` : "";
      return [senderId, displayName, handleRaw, handle].filter(Boolean).join(" ");
    };
    const flagsForMessage = (msg: ChatMessage): ChatSearchFlags => {
      const flags: ChatSearchFlags = {};
      const attachment = msg?.attachment;
      if (attachment?.kind === "file") {
        const badge = fileBadge(attachment.name, attachment.mime);
        if (badge.kind === "image" || badge.kind === "video") {
          flags.media = true;
        } else if (badge.kind === "audio") {
          flags.audio = true;
        } else {
          flags.files = true;
        }
      }
      const text = String(msg?.text || "");
      if (text && linkRe.test(text)) flags.links = true;
      return flags;
    };
    return msgs.map((m) => ({
      text: m.text,
      attachmentName: m.attachment?.kind === "file" ? m.attachment.name : null,
      senderTokens: senderTokensForMessage(m),
      flags: flagsForMessage(m),
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

  function parseChatSearchDate(value: string): { start: number; end: number } | null {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const [yearRaw, monthRaw, dayRaw] = raw.split("-");
    const year = Number.parseInt(yearRaw, 10);
    const month = Number.parseInt(monthRaw, 10);
    const day = Number.parseInt(dayRaw, 10);
    if (!year || !month || !day) return null;
    const start = new Date(year, month - 1, day, 0, 0, 0, 0).getTime() / 1000;
    const end = new Date(year, month - 1, day + 1, 0, 0, 0, 0).getTime() / 1000;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return { start, end };
  }

  function jumpToChatMsgIdx(idx: number) {
    const msgIdx = Number(idx);
    if (!Number.isFinite(msgIdx) || msgIdx < 0) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tryJump = () => {
      const row = layout.chat.querySelector(`[data-msg-idx='${msgIdx}']`) as HTMLElement | null;
      if (!row) return false;
      try {
        row.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
      } catch {
        row.scrollIntoView();
      }
      row.classList.add("msg-jump");
      window.setTimeout(() => row.classList.remove("msg-jump"), 900);
      return true;
    };
    if (tryJump()) return;
    window.setTimeout(() => {
      if (tryJump()) return;
      window.setTimeout(tryJump, 160);
    }, 0);
  }

  function setChatSearchDate(value: string) {
    const v = String(value ?? "");
    store.set((prev) => ({ ...prev, chatSearchDate: v }));
    const range = parseChatSearchDate(v);
    if (!range) return;
    const st = store.get();
    if (!st.selected) return;
    const key = conversationKey(st.selected);
    if (!key) return;
    const msgs = st.conversations[key] || [];
    if (!Array.isArray(msgs) || !msgs.length) {
      showToast("Сообщения пока не загружены", { kind: "info" });
      return;
    }
    const idx = msgs.findIndex((m) => {
      const ts = Number(m?.ts ?? 0);
      return ts >= range.start && ts < range.end;
    });
    if (idx < 0) {
      showToast("Сообщений за эту дату нет", { kind: "info" });
      return;
    }
    const searchActive = Boolean(st.chatSearchOpen && st.chatSearchQuery.trim());
    if (shouldVirtualize(msgs.length, searchActive)) {
      const maxStart = getVirtualMaxStart(msgs.length);
      const targetStart = Math.max(0, Math.min(maxStart, idx - Math.floor(HISTORY_VIRTUAL_WINDOW / 2)));
      store.set((prev) => ({
        ...prev,
        historyVirtualStart: { ...prev.historyVirtualStart, [key]: targetStart },
      }));
    }
    jumpToChatMsgIdx(idx);
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
    store.set((prev) => ({
      ...prev,
      chatSearchOpen: false,
      chatSearchResultsOpen: false,
      chatSearchQuery: "",
      chatSearchDate: "",
      chatSearchFilter: "all",
      chatSearchHits: [],
      chatSearchPos: 0,
      chatSearchCounts: createChatSearchCounts(),
    }));
    queueMicrotask(() => scheduleFocusComposer());
  }

  function openChatSearch() {
    const st = store.get();
    if (st.page !== "main") return;
    if (st.modal) return;
    if (!st.selected) return;
    store.set((prev) => ({ ...prev, chatSearchOpen: true, chatSearchResultsOpen: false }));
    queueMicrotask(() => focusChatSearch(true));
  }

  function normalizeChatSearchFilter(filter: ChatSearchFilter, counts: ReturnType<typeof createChatSearchCounts>): ChatSearchFilter {
    if (filter === "all") return "all";
    return counts[filter] > 0 ? filter : "all";
  }

  function sameChatSearchCounts(a: ReturnType<typeof createChatSearchCounts>, b: ReturnType<typeof createChatSearchCounts>): boolean {
    return a.all === b.all && a.media === b.media && a.files === b.files && a.links === b.links && a.audio === b.audio;
  }

  function openChatFromSearch(target: TargetRef, query: string, msgIdx?: number) {
    const q = String(query || "").trim();
    selectTarget(target);
    const apply = () => {
      const st = store.get();
      if (!st.selected) return;
      if (conversationKey(st.selected) !== conversationKey(target)) return;
      store.set((prev) => ({
        ...prev,
        ...(q
          ? { chatSearchOpen: true, chatSearchResultsOpen: false, chatSearchQuery: q, chatSearchDate: "", chatSearchFilter: "all" }
          : {
              chatSearchOpen: false,
              chatSearchResultsOpen: false,
              chatSearchQuery: "",
              chatSearchDate: "",
              chatSearchFilter: "all",
              chatSearchHits: [],
              chatSearchPos: 0,
              chatSearchCounts: createChatSearchCounts(),
            }),
      }));
      if (Number.isFinite(msgIdx)) scrollToChatMsgIdx(Number(msgIdx));
    };
    queueMicrotask(apply);
    window.setTimeout(apply, 0);
    if (Number.isFinite(msgIdx)) {
      window.setTimeout(() => scrollToChatMsgIdx(Number(msgIdx)), 160);
    }
  }

  function setChatSearchQuery(query: string) {
    const q = String(query ?? "");
    const trimmed = q.trim();
    store.set((prev) => {
      if (!prev.selected) {
        return {
          ...prev,
          chatSearchQuery: q,
          chatSearchResultsOpen: trimmed ? prev.chatSearchResultsOpen : false,
          chatSearchFilter: "all",
          chatSearchHits: [],
          chatSearchPos: 0,
          chatSearchCounts: createChatSearchCounts(),
        };
      }
      const messages = searchableMessagesForSelected(prev);
      const counts = computeChatSearchCounts(messages, q);
      const nextFilter = normalizeChatSearchFilter(prev.chatSearchFilter, counts);
      const hits = computeChatSearchHits(messages, q, nextFilter);
      return {
        ...prev,
        chatSearchQuery: q,
        chatSearchResultsOpen: trimmed ? prev.chatSearchResultsOpen : false,
        chatSearchFilter: nextFilter,
        chatSearchHits: hits,
        chatSearchPos: 0,
        chatSearchCounts: counts,
      };
    });
    const st = store.get();
    if (st.chatSearchHits.length) scrollToChatMsgIdx(st.chatSearchHits[st.chatSearchPos] ?? st.chatSearchHits[0]);
  }

  function setChatSearchFilter(next: ChatSearchFilter) {
    const st = store.get();
    if (!st.selected) return;
    const messages = searchableMessagesForSelected(st);
    const counts = computeChatSearchCounts(messages, st.chatSearchQuery || "");
    const normalized = normalizeChatSearchFilter(next, counts);
    const hits = computeChatSearchHits(messages, st.chatSearchQuery || "", normalized);
    store.set((prev) => ({
      ...prev,
      chatSearchFilter: normalized,
      chatSearchHits: hits,
      chatSearchPos: 0,
      chatSearchCounts: counts,
    }));
    if (hits.length) scrollToChatMsgIdx(hits[0]);
    focusChatSearch(false);
  }

  function toggleChatSearchResults(force?: boolean) {
    const st = store.get();
    if (!st.chatSearchOpen) return;
    if (!String(st.chatSearchQuery || "").trim()) {
      store.set({ chatSearchResultsOpen: false });
      return;
    }
    const next = force === undefined ? !st.chatSearchResultsOpen : Boolean(force);
    store.set({ chatSearchResultsOpen: next });
  }

  function setChatSearchPos(pos: number) {
    const st = store.get();
    if (!st.chatSearchOpen) return;
    if (!st.chatSearchHits.length) return;
    const nextPos = clampChatSearchPos(st.chatSearchHits, pos);
    store.set({ chatSearchPos: nextPos });
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
    const rawDescription = (document.getElementById("group-description") as HTMLTextAreaElement | null)?.value ?? "";
    const rawRules = (document.getElementById("group-rules") as HTMLTextAreaElement | null)?.value ?? "";
    const description = rawDescription.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    const rules = rawRules.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    if (!name) {
      store.set({ groupCreateMessage: "Введите название чата" });
      return;
    }
    if (description.length > ROOM_INFO_MAX) {
      store.set({ groupCreateMessage: "Описание слишком длинное" });
      return;
    }
    if (rules.length > ROOM_INFO_MAX) {
      store.set({ groupCreateMessage: "Правила слишком длинные" });
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
      const payload: any = { type: "group_create", name, members: res.members };
      if (description) payload.description = description;
      if (rules) payload.rules = rules;
      gateway.send(payload);
    } else {
      const payload: any = { type: "group_create", name };
      if (description) payload.description = description;
      if (rules) payload.rules = rules;
      gateway.send(payload);
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
    const rawDescription = (document.getElementById("board-description") as HTMLTextAreaElement | null)?.value ?? "";
    const rawRules = (document.getElementById("board-rules") as HTMLTextAreaElement | null)?.value ?? "";
    const description = rawDescription.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    const rules = rawRules.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    if (!name) {
      store.set({ boardCreateMessage: "Введите название доски" });
      return;
    }
    if (description.length > ROOM_INFO_MAX) {
      store.set({ boardCreateMessage: "Описание слишком длинное" });
      return;
    }
    if (rules.length > ROOM_INFO_MAX) {
      store.set({ boardCreateMessage: "Правила слишком длинные" });
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
      const payload: any = { type: "board_create", name, handle: handle || undefined, members: res.members };
      if (description) payload.description = description;
      if (rules) payload.rules = rules;
      gateway.send(payload);
    } else {
      const payload: any = { type: "board_create", name, handle: handle || undefined };
      if (description) payload.description = description;
      if (rules) payload.rules = rules;
      gateway.send(payload);
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

  function sendScheduleSubmit() {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "send_schedule") return;
    if (!st.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    const rawWhen = (document.getElementById("send-schedule-at") as HTMLInputElement | null)?.value ?? "";
    const when = parseDatetimeLocal(rawWhen);
    if (!when) {
      store.set({ modal: { ...modal, message: "Выберите дату/время" } });
      return;
    }
    const now = Date.now();
    const maxAt = now + maxBoardScheduleDelayMs();
    if (when <= now) {
      store.set({ modal: { ...modal, message: "Время уже прошло — выберите будущее" } });
      return;
    }
    if (when > maxAt) {
      store.set({ modal: { ...modal, message: "Максимум — 7 дней вперёд" } });
      return;
    }
    store.set({ modal: null });
    sendChat({
      mode: "schedule",
      scheduleAt: when,
      target: modal.target,
      text: modal.text,
      replyDraft: modal.replyDraft ?? null,
      forwardDraft: modal.forwardDraft ?? null,
    });
  }

  function saveRoomInfo(kind: TargetRef["kind"], roomId: string, description: string, rules: string) {
    const st = store.get();
    const rid = String(roomId || "").trim();
    if (!rid) return;
    if (!st.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    if (st.conn !== "connected") {
      store.set({ status: "Нет соединения" });
      return;
    }
    const entry = kind === "group" ? st.groups.find((g) => g.id === rid) : st.boards.find((b) => b.id === rid);
    const ownerId = String(entry?.owner_id || "").trim();
    if (!ownerId || ownerId !== String(st.selfId || "").trim()) {
      store.set({ status: "Только владелец может менять описание" });
      return;
    }
    if (description.length > ROOM_INFO_MAX) {
      store.set({ status: "Описание слишком длинное" });
      return;
    }
    if (rules.length > ROOM_INFO_MAX) {
      store.set({ status: "Правила слишком длинные" });
      return;
    }
    if (kind === "group") {
      gateway.send({ type: "group_set_info", group_id: rid, description: description || null, rules: rules || null });
      store.set({ status: "Сохраняем информацию чата…" });
      return;
    }
    gateway.send({ type: "board_set_info", board_id: rid, description: description || null, rules: rules || null });
    store.set({ status: "Сохраняем информацию доски…" });
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
    if (action.kind === "group_member_remove") {
      gateway.send({ type: "group_remove", group_id: action.groupId, members: [action.memberId] });
      store.set({ status: `Удаление участника: ${action.memberId}` });
      close();
      return;
    }
    if (action.kind === "board_member_remove") {
      gateway.send({ type: "board_remove", board_id: action.boardId, members: [action.memberId] });
      store.set({ status: `Удаление участника: ${action.memberId}` });
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
    gateway.send({ type: "board_invite_response", board_id: boardId, accept: true });
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
    gateway.send({ type: "board_invite_response", board_id: boardId, accept: false });
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

  function supportsStreamDownload(): boolean {
    try {
      return Boolean(
        "serviceWorker" in navigator &&
          navigator.serviceWorker.controller &&
          "ReadableStream" in window
      );
    } catch {
      return false;
    }
  }

  function postStreamMessage(message: { type: string; streamId: string; [key: string]: any }, transfer?: Transferable[]): boolean {
    try {
      const controller = navigator.serviceWorker.controller;
      if (!controller) return false;
      if (transfer && transfer.length) {
        try {
          controller.postMessage(message, transfer);
          return true;
        } catch {
          // ignore and retry without transfer list
        }
      }
      controller.postMessage(message);
      return true;
    } catch {
      return false;
    }
  }

  function postStreamChunk(streamId: string, chunk: Uint8Array): boolean {
    return postStreamMessage({ type: "PWA_STREAM_CHUNK", streamId, chunk }, [chunk.buffer]);
  }

  function postStreamEnd(streamId: string): boolean {
    return postStreamMessage({ type: "PWA_STREAM_END", streamId });
  }

  function postStreamError(streamId: string, error: string): boolean {
    return postStreamMessage({ type: "PWA_STREAM_ERROR", streamId, error });
  }

  function makeStreamId(): string {
    try {
      const uuid = (globalThis.crypto as any)?.randomUUID?.();
      if (typeof uuid === "string" && uuid) return uuid;
    } catch {
      // ignore
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function buildStreamUrl(fileId: string, meta: { name: string; size: number; mime: string | null }, streamId: string): string {
    const params = new URLSearchParams();
    params.set("sid", streamId);
    if (meta.name) params.set("name", meta.name);
    if (meta.size) params.set("size", String(meta.size));
    if (meta.mime) params.set("mime", meta.mime);
    return `/__yagodka_stream__/files/${encodeURIComponent(fileId)}?${params.toString()}`;
  }

  function triggerBrowserDownload(url: string, name: string): void {
    try {
      const a = document.createElement("a");
      a.href = url;
      if (name) a.download = name;
      a.rel = "noopener";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      window.setTimeout(() => a.remove(), 0);
    } catch {
      window.location.href = url;
    }
  }

  function startStreamDownload(fileId: string, meta: { name: string; size: number; mime: string | null }): boolean {
    if (!supportsStreamDownload()) return false;
    if (pendingStreamRequests.size > 16) return false;
    const existing = Array.from(pendingStreamRequests.values()).some((req) => req.fileId === fileId);
    if (existing) return false;
    const streamId = makeStreamId();
    pendingStreamRequests.set(streamId, { fileId, name: meta.name, size: meta.size, mime: meta.mime });
    const url = buildStreamUrl(fileId, meta, streamId);
    triggerBrowserDownload(url, meta.name || "file");
    window.setTimeout(() => {
      if (pendingStreamRequests.has(streamId)) pendingStreamRequests.delete(streamId);
    }, 5000);
    return true;
  }

  const STREAM_MIN_BYTES = 8 * 1024 * 1024;

  function resolveFileMeta(fileId: string): { name: string; size: number; mime: string | null } {
    const st = store.get();
    const transfer = st.fileTransfers.find((t) => String(t.id || "").trim() === fileId);
    if (transfer) {
      return {
        name: transfer.name || "файл",
        size: Number(transfer.size || 0) || 0,
        mime: transfer.mime ?? null,
      };
    }
    const offer = st.fileOffersIn.find((o) => String(o.id || "").trim() === fileId);
    if (offer) {
      return {
        name: offer.name || "файл",
        size: Number(offer.size || 0) || 0,
        mime: offer.mime ?? null,
      };
    }
    const key = st.selected ? conversationKey(st.selected) : "";
    const msgs = key ? st.conversations[key] || [] : [];
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      const att = msgs[i]?.attachment;
      if (att?.kind !== "file") continue;
      const fid = String(att.fileId || "").trim();
      if (!fid || fid !== fileId) continue;
      return {
        name: att.name || "файл",
        size: Number(att.size || 0) || 0,
        mime: att.mime ?? null,
      };
    }
    return { name: "файл", size: 0, mime: null };
  }

  function getFileCachePrefsForUser(userId: string | null): { maxBytes: number; autoCleanMs: number; lastCleanAt: number } | null {
    if (!userId) return null;
    try {
      return loadFileCachePrefs(userId);
    } catch {
      return null;
    }
  }

  async function enforceFileCachePolicy(userId: string, opts: { force?: boolean } = {}): Promise<void> {
    const prefs = getFileCachePrefsForUser(userId);
    if (!prefs) return;
    const now = Date.now();
    const due = prefs.autoCleanMs > 0 && (now - prefs.lastCleanAt >= prefs.autoCleanMs);
    if (!opts.force && !due && !(prefs.maxBytes > 0)) return;
    await cleanupFileCache(userId, { maxBytes: prefs.maxBytes, ttlMs: prefs.autoCleanMs });
    if (due) {
      prefs.lastCleanAt = now;
      saveFileCachePrefs(userId, prefs);
    }
  }

  function shouldCachePreview(name: string, mime: string | null | undefined, size: number): boolean {
    const st = store.get();
    const prefs = getFileCachePrefsForUser(st.selfId || null);
    if (!prefs || prefs.maxBytes <= 0) return false;
    const bytes = Number(size ?? 0) || 0;
    if (bytes <= 0) return false;
    if (!isMediaLikeFile(name, mime)) return false;
    // Keep it small and safe for iOS storage limits; prefetch only small media.
    const cap = Math.min(6 * 1024 * 1024, prefs.maxBytes > 0 ? prefs.maxBytes : 6 * 1024 * 1024);
    return bytes <= cap;
  }

  function isMediaLikeFile(name: string, mime: string | null | undefined): boolean {
    const mt = String(mime || "").toLowerCase();
    if (mt.startsWith("image/") || mt.startsWith("video/") || mt.startsWith("audio/")) return true;
    const n = String(name || "").toLowerCase();
    if (isImageLikeFile(n, mt)) return true;
    return /\.(mp4|m4v|mov|webm|ogv|mkv|mp3|m4a|aac|wav|ogg|opus|flac)$/.test(n);
  }

  function shouldCacheFile(name: string, mime: string | null | undefined, size: number): boolean {
    const st = store.get();
    const prefs = getFileCachePrefsForUser(st.selfId || null);
    if (!prefs || prefs.maxBytes <= 0) return false;
    const bytes = Number(size ?? 0) || 0;
    if (bytes <= 0) return false;
    if (bytes > prefs.maxBytes) return false;
    return Boolean(name || mime);
  }

  async function tryOpenFileViewerFromCache(
    fileId: string,
    meta: { name: string; size: number; mime: string | null; caption?: string | null; chatKey?: string | null; msgIdx?: number | null }
  ): Promise<boolean> {
    const st = store.get();
    if (!st.selfId) return false;
    const cached = await getCachedFileBlob(st.selfId, fileId);
    if (!cached) return false;
    let url: string | null = null;
    try {
      url = URL.createObjectURL(cached.blob);
    } catch {
      url = null;
    }
    if (!url) return false;

    const entry = st.fileTransfers.find((t) => String(t.id || "").trim() === fileId);
    const name = meta.name || entry?.name || "файл";
    const size = meta.size || entry?.size || cached.size || 0;
    const mime = meta.mime || entry?.mime || cached.mime || null;
    const caption = meta.caption ? String(meta.caption).trim() : "";
    const direction = entry?.direction || "in";
    const peer = entry?.peer || "—";
    const room = typeof entry?.room === "string" ? entry.room : null;

    store.set((prev) => {
      const existing = prev.fileTransfers.find((t) => String(t.id || "").trim() === fileId);
      const nextTransfers = (() => {
        if (existing) {
          return prev.fileTransfers.map<FileTransferEntry>((t) => {
            if (String(t.id || "").trim() !== fileId) return t;
            if (t.url && t.url !== url) {
              try {
                URL.revokeObjectURL(t.url);
              } catch {
                // ignore
              }
            }
            return { ...t, name, size, mime, status: "complete", progress: 100, url };
          });
        }
        const next: FileTransferEntry = {
          localId: `ft-cache-${fileId}`,
          id: fileId,
          name,
          size,
          mime,
          direction,
          peer,
          room,
          status: "complete",
          progress: 100,
          url,
        };
        return [next, ...prev.fileTransfers];
      })();
      return {
        ...prev,
        fileTransfers: nextTransfers,
        modal: buildFileViewerModalState({
          url,
          name,
          size,
          mime,
          caption: caption || null,
          chatKey: meta.chatKey ? String(meta.chatKey) : null,
          msgIdx: typeof meta.msgIdx === "number" && Number.isFinite(meta.msgIdx) ? meta.msgIdx : null,
        }),
      };
    });
    scheduleSaveFileTransfers(store);
    return true;
  }

  async function tryServeFileFromCache(
    fileId: string,
    meta: { name: string; size: number; mime: string | null }
  ): Promise<boolean> {
    const st = store.get();
    if (!st.selfId) return false;
    const cached = await getCachedFileBlob(st.selfId, fileId);
    if (!cached) return false;
    let url: string | null = null;
    try {
      url = URL.createObjectURL(cached.blob);
    } catch {
      url = null;
    }
    if (!url) return false;

    const entry = st.fileTransfers.find((t) => String(t.id || "").trim() === fileId);
    const name = meta.name || entry?.name || "файл";
    const size = meta.size || entry?.size || cached.size || 0;
    const mime = meta.mime || entry?.mime || cached.mime || null;
    const direction = entry?.direction || "in";
    const peer = entry?.peer || "—";
    const room = typeof entry?.room === "string" ? entry.room : null;

    store.set((prev) => {
      const existing = prev.fileTransfers.find((t) => String(t.id || "").trim() === fileId);
      if (existing) {
        const nextTransfers = prev.fileTransfers.map<FileTransferEntry>((t) => {
          if (String(t.id || "").trim() !== fileId) return t;
          if (t.url && t.url !== url) {
            try {
              URL.revokeObjectURL(t.url);
            } catch {
              // ignore
            }
          }
          return {
            ...t,
            name,
            size,
            mime,
            url,
            status: t.status === "uploaded" ? "uploaded" : "complete",
            progress: 100,
          };
        });
        return { ...prev, fileTransfers: nextTransfers };
      }
      const nextEntry: FileTransferEntry = {
        localId: `ft-cache-${fileId}`,
        id: fileId,
        name,
        size,
        mime,
        direction,
        peer,
        room,
        status: "complete",
        progress: 100,
        url,
      };
      return { ...prev, fileTransfers: [nextEntry, ...prev.fileTransfers] };
    });
    scheduleSaveFileTransfers(store);
    triggerBrowserDownload(url, name);
    return true;
  }

  async function restoreCachedPreviewIntoTransfers(opts: {
    key: string;
    fileId: string;
    name: string;
    size: number;
    mime: string | null;
    direction: "in" | "out";
    peer: string;
    room: string | null;
  }): Promise<boolean> {
    const st = store.get();
    if (!st.authed || !st.selfId) return false;
    const uid = st.selfId;
    const cacheKey = `${uid}:${opts.fileId}`;
    if (cachedPreviewsAttempted.has(cacheKey)) return false;
    cachedPreviewsAttempted.add(cacheKey);

    const cached = await getCachedFileBlob(uid, opts.fileId);
    if (!cached) return false;
    let url: string | null = null;
    try {
      url = URL.createObjectURL(cached.blob);
    } catch {
      url = null;
    }
    if (!url) return false;

    store.set((prev) => {
      const existing = prev.fileTransfers.find((t) => String(t.id || "").trim() === opts.fileId);
      if (existing) {
        const nextTransfers = prev.fileTransfers.map((t) => {
          if (String(t.id || "").trim() !== opts.fileId) return t;
          if (t.url && t.url !== url) {
            try {
              URL.revokeObjectURL(t.url);
            } catch {
              // ignore
            }
          }
          return { ...t, url };
        });
        return { ...prev, fileTransfers: nextTransfers };
      }
      const entry: FileTransferEntry = {
        localId: `ft-cache-${opts.fileId}`,
        id: opts.fileId,
        name: opts.name,
        size: opts.size,
        mime: opts.mime || null,
        direction: opts.direction,
        peer: opts.peer || "—",
        room: opts.room,
        status: "complete",
        progress: 100,
        url,
      };
      return { ...prev, fileTransfers: [entry, ...prev.fileTransfers] };
    });
    scheduleSaveFileTransfers(store);
    return true;
  }

  function scheduleWarmupCachedPreviews() {
    if (previewWarmupTimer !== null) return;
    previewWarmupTimer = window.setTimeout(() => {
      previewWarmupTimer = null;
      void warmupCachedPreviewsForSelected();
    }, 120);
  }

  function convoSig(msgs: any[]): string {
    const last = msgs && msgs.length ? msgs[msgs.length - 1] : null;
    const lastKey = last ? String((last.id ?? last.ts ?? "") as any) : "";
    return `${msgs?.length || 0}:${lastKey}`;
  }

  async function warmupCachedPreviewsForSelected(): Promise<void> {
    if (previewWarmupInFlight) return;
    const st = store.get();
    if (!st.authed || !st.selfId) return;
    if (st.page !== "main") return;
    if (!st.selected) return;
    if (st.modal && st.modal.kind !== "context_menu") return;
    const key = conversationKey(st.selected);
    if (!key) return;
    if (!st.historyLoaded[key] || st.historyLoading[key]) return;

    const msgs = st.conversations[key] || [];
    if (!msgs.length) return;
    const sig = convoSig(msgs);
    if (key === previewWarmupLastKey && sig === previewWarmupLastSig) return;
    previewWarmupLastKey = key;
    previewWarmupLastSig = sig;

    previewWarmupInFlight = true;
    try {
      const MAX_SCAN = 80;
      const MAX_TASKS = 12;
      const PREFETCH_MAX_BYTES = 6 * 1024 * 1024;
      const RESTORE_MAX_BYTES = 24 * 1024 * 1024;
      const tail = msgs.slice(Math.max(0, msgs.length - MAX_SCAN));
      const tasks: Array<{
        fileId: string;
        name: string;
        size: number;
        mime: string | null;
        direction: "in" | "out";
        peer: string;
        room: string | null;
        prefetch: boolean;
      }> = [];
      const seen = new Set<string>();
      for (const m of tail.reverse()) {
        const att = m?.attachment;
        if (!att || att.kind !== "file") continue;
        const fid = typeof att.fileId === "string" ? att.fileId.trim() : "";
        if (!fid || seen.has(fid)) continue;
        const name = String(att.name || "");
        const mime = typeof att.mime === "string" ? att.mime : null;
        const size = Number(att.size ?? 0) || 0;
        const shouldPrefetch = shouldCachePreview(name, mime, size);
        const shouldAttemptRestore = shouldPrefetch || !mime || (isMediaLikeFile(name, mime) && size > 0 && size <= RESTORE_MAX_BYTES);
        if (!shouldAttemptRestore) continue;
        const already = st.fileTransfers.find((t) => String(t.id || "").trim() === fid && Boolean(t.url));
        if (already) continue;
        seen.add(fid);
        tasks.push({
          fileId: fid,
          name: name || "файл",
          size,
          mime,
          direction: m.kind === "out" ? "out" : "in",
          peer: String(m.kind === "out" ? (m.to || m.room || "") : (m.from || "")) || "—",
          room: typeof m.room === "string" ? m.room : null,
          prefetch: shouldPrefetch,
        });
        if (tasks.length >= MAX_TASKS) break;
      }
      for (const t of tasks) {
        const restored = await restoreCachedPreviewIntoTransfers({ key, ...t });
        if (!restored && t.prefetch) {
          try {
            const latest = store.get();
            const uid = latest.selfId;
            if (!uid) continue;
            if (latest.conn !== "connected") continue;
            // Only prefetch small media to avoid wasting traffic/storage.
            if (t.size > PREFETCH_MAX_BYTES) continue;
            const k = `${uid}:${t.fileId}`;
            if (previewPrefetchAttempted.has(k)) continue;
            previewPrefetchAttempted.add(k);
            silentFileGets.add(t.fileId);
            gateway.send({ type: "file_get", file_id: t.fileId });
          } catch {
            // ignore
          }
        }
      }
    } finally {
      previewWarmupInFlight = false;
    }
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

  function removeConversationFileMessage(key: string, localId: string) {
    const lid = String(localId || "").trim();
    if (!lid) return;
    store.set((prev) => {
      const conv = prev.conversations[key];
      if (!Array.isArray(conv) || conv.length === 0) return prev;
      const next = conv.filter((m: any) => String(m?.attachment?.localId ?? "") !== lid);
      if (next.length === conv.length) return prev;
      return { ...prev, conversations: { ...prev.conversations, [key]: next } };
    });
  }

  function formatFileOfferError(reason: string): string {
    const r = String(reason || "").trim();
    if (!r) return "ошибка";
    if (r === "file_too_large") return "слишком большой файл";
    if (r === "file_quota_exceeded") return "превышен лимит хранилища";
    if (r === "too_many_offers") return "слишком много активных отправок";
    if (r === "not_authorized") return "нет доступа к контакту";
    if (r === "blocked_by_recipient") return "получатель заблокировал вас";
    if (r === "blocked_by_sender") return "вы заблокировали получателя";
    if (r === "not_in_group") return "вы не участник чата";
    if (r === "group_post_forbidden") return "вам запрещено писать в чате";
    if (r === "board_post_forbidden") return "на доске писать может только владелец";
    if (r === "invalid_room_id") return "неверный адресат";
    if (r === "server_storage_error") return "ошибка хранения на сервере";
    return r;
  }

  function revokeFileSendPreviews(previewUrls?: Array<string | null>) {
    if (!previewUrls || !previewUrls.length) return;
    for (const url of previewUrls) {
      if (!url) continue;
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }
  }

  function restoreComposerInput(target: TargetRef, text: string) {
    if (!text) return;
    const key = conversationKey(target);
    store.set((prev) => {
      const drafts = updateDraftMap(prev.drafts, key, text);
      const isCurrent = prev.selected ? conversationKey(prev.selected) === key : false;
      return { ...prev, input: isCurrent ? text : prev.input, drafts };
    });
    const isCurrent = store.get().selected ? conversationKey(store.get().selected as TargetRef) === key : false;
    if (isCurrent) {
      try {
        layout.input.value = text;
        autosizeInput(layout.input);
      } catch {
        // ignore
      }
    }
    scheduleSaveDrafts(store);
  }

  function detachComposerCaption(st: AppState): { caption: string; restoreInput: string | null } {
    const caption = String(layout.input.value || "").trimEnd();
    if (!caption) return { caption: "", restoreInput: null };
    if (st.editing) {
      store.set({ status: "Подпись не добавлена: вы редактируете сообщение" });
      return { caption: "", restoreInput: null };
    }
    const key = st.selected ? conversationKey(st.selected) : "";
    store.set((prev) => ({
      ...prev,
      input: "",
      drafts: key ? updateDraftMap(prev.drafts, key, "") : prev.drafts,
    }));
    try {
      layout.input.value = "";
      autosizeInput(layout.input);
    } catch {
      // ignore
    }
    scheduleSaveDrafts(store);
    return { caption, restoreInput: caption };
  }

  function openFileSendModal(files: File[], target: TargetRef) {
    if (!files.length) return;
    const st = store.get();
    const captionDisabled = Boolean(st.editing) || files.length !== 1;
    let captionHint = "";
    if (st.editing) captionHint = "Подпись недоступна во время редактирования";
    else if (files.length !== 1) captionHint = "Подпись доступна только для одного файла";
    let caption = "";
    let restoreInput: string | null = null;
    if (!captionDisabled && st.page === "main") {
      const res = detachComposerCaption(st);
      caption = res.caption;
      restoreInput = res.restoreInput;
    } else if (files.length !== 1 && st.page === "main") {
      const draft = String(layout.input.value || "").trim();
      if (draft) store.set({ status: "Подпись доступна только для одного файла" });
    }
    const previewUrls = files.map((file) => {
      if (!isImageLikeFile(file?.name || "", file?.type || null)) return null;
      try {
        return URL.createObjectURL(file);
      } catch {
        return null;
      }
    });
    store.set({
      modal: {
        kind: "file_send",
        files,
        target,
        caption,
        captionDisabled,
        captionHint,
        restoreInput,
        previewUrls,
      },
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
    const mime = typeof next.file.type === "string" ? next.file.type.trim() : "";
    if (mime) payload.mime = mime;
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
    if (target.kind === "group") {
      const g = st.groups.find((g) => g.id === target.id);
      const me = String(st.selfId || "").trim();
      const owner = String(g?.owner_id || "").trim();
      const banned = (g?.post_banned || []).map((x) => String(x || "").trim()).filter(Boolean);
      if (me && owner && me !== owner && banned.includes(me)) {
        store.set({ status: "Вам запрещено писать в чате" });
        return;
      }
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
      mime: file.type || null,
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

    // UX: при отправке файла ожидаем, что история останется “у дна” и покажет только что добавленное сообщение.
    // Это важно для медиа (высота может меняться после загрузки), поэтому используем ту же логику pinned-bottom.
    if (key) markChatAutoScroll(key, false);

    store.set((prev) => {
      const withMsg = upsertConversation(prev, key, outMsg);
      return { ...withMsg, fileTransfers: [entry, ...withMsg.fileTransfers], status: `Файл предложен: ${entry.name}` };
    });
    queueUpload(localId, file, target, captionText);
  }

  function confirmFileSend(captionText: string) {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "file_send") return;
    const files = modal.files || [];
    const target = modal.target;
    revokeFileSendPreviews(modal.previewUrls);
    store.set({ modal: null });
    if (!files.length) return;
    const caption = String(captionText || "").trimEnd();
    const canCaption = files.length === 1 && Boolean(caption);
    for (let i = 0; i < files.length; i += 1) {
      sendFile(files[i], target, i === 0 && canCaption ? caption : "");
    }
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
          mime: offer.mime || null,
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
      const mimeRaw = msg?.mime;
      const mime = typeof mimeRaw === "string" && mimeRaw.trim() ? mimeRaw.trim() : null;
      const offer: FileOfferIn = {
        id: fileId,
        from: String(msg?.from ?? "").trim() || "—",
        name: String(msg?.name ?? "файл"),
        size: Number(msg?.size ?? 0) || 0,
        room: typeof msg?.room === "string" ? msg.room : null,
        ...(mime ? { mime } : {}),
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
          ...(mime ? { mime } : {}),
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
      const upload = activeUpload;
      if (!upload) return true;
      const ok = Boolean(msg?.ok);
      if (!ok) {
        const reason = String(msg?.reason ?? "ошибка");
        const localId = upload.localId;
        const targetKey = conversationKey(upload.target);
        removeConversationFileMessage(targetKey, localId);
        const readable = formatFileOfferError(reason);
        if (targetKey) {
          store.set((prev) => ({
            ...prev,
            status: `Отправка отклонена: ${readable}`,
            conversations: upsertConversation(prev, targetKey, {
              kind: "sys",
              from: "",
              to: "",
              room: upload.target.kind === "dm" ? undefined : upload.target.id,
              text: `Файл не отправлен: ${readable}`,
              ts: nowTs(),
              id: null,
            }).conversations,
          }));
        } else {
          store.set({ status: `Отправка отклонена: ${readable}` });
        }
        updateTransferByLocalId(localId, (entry) => ({ ...entry, status: "error", error: readable }));
        activeUpload = null;
        startNextUpload();
        return true;
      }
      const fileId = String(msg?.file_id ?? "").trim();
      if (!fileId) {
        const localId = upload.localId;
        updateTransferByLocalId(localId, (entry) => ({ ...entry, status: "error", error: "missing_file_id" }));
        activeUpload = null;
        startNextUpload();
        return true;
      }
      const rawMsgId = msg?.msg_id;
      const msgId = typeof rawMsgId === "number" && Number.isFinite(rawMsgId) ? rawMsgId : null;
      try {
        const key = conversationKey(upload.target);
        updateConversationFileMessage(key, upload.localId, (m) => {
          const att = m?.attachment?.kind === "file" ? m.attachment : null;
          if (!att) return m;
          return { ...m, ...(msgId !== null ? { id: msgId } : {}), attachment: { ...att, fileId } };
        });
      } catch {
        // ignore
      }
      upload.fileId = fileId;
      uploadByFileId.set(fileId, upload);
      updateTransferByLocalId(upload.localId, (entry) => ({
        ...entry,
        id: fileId,
        status: "uploading",
        progress: 0,
        error: null,
      }));
      try {
        const st = store.get();
        if (st.selfId && shouldCacheFile(upload.file.name || "файл", upload.file.type || null, upload.file.size || 0)) {
          void putCachedFileBlob(st.selfId, fileId, upload.file, { mime: upload.file.type || null, size: upload.file.size || 0 });
          void enforceFileCachePolicy(st.selfId, { force: true });
        }
      } catch {
        // ignore
      }
      store.set({ status: `Загрузка на сервер: ${upload.file.name || "файл"}` });
      void uploadFileChunks(upload);
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
      const mimeRaw = msg?.mime;
      const mime = typeof mimeRaw === "string" && mimeRaw.trim() ? mimeRaw.trim() : null;
      const silent = silentFileGets.has(fileId);
      const existing = downloadByFileId.get(fileId);
      const streamId = existing?.streamId ? String(existing.streamId) : null;
      const streaming = Boolean(existing?.streaming && streamId);
      downloadByFileId.set(fileId, {
        fileId,
        name,
        size,
        from,
        room,
        mime,
        chunks: [],
        received: 0,
        lastProgress: 0,
        streamId: streamId || null,
        streaming,
      });
      store.set((prev) => {
        const transfers = [...prev.fileTransfers];
        const idx = transfers.findIndex((entry) => entry.id === fileId && entry.direction === "in");
        if (idx >= 0) {
          transfers[idx] = {
            ...transfers[idx],
            name,
            size,
            peer: from,
            room,
            mime: mime || transfers[idx].mime || null,
            status: "downloading",
            progress: 0,
          };
        } else {
          transfers.unshift({
            localId: nextTransferId(),
            id: fileId,
            name,
            size,
            mime,
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
          ...(silent ? {} : { status: `Скачивание: ${name}` }),
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
      const silent = silentFileGets.has(fileId);
      const chunkLen = bytes.length;
      if (download.streaming && download.streamId) {
        const ok = postStreamChunk(download.streamId, bytes);
        if (!ok) {
          postStreamError(download.streamId, "stream_post_failed");
          downloadByFileId.delete(fileId);
          silentFileGets.delete(fileId);
          updateTransferByFileId(fileId, (entry) => ({ ...entry, status: "error", error: "stream_failed" }));
          if (!silent) store.set({ status: "Ошибка файла: stream_failed" });
          return true;
        }
      } else {
        const buf = (bytes.buffer as ArrayBuffer).slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        download.chunks.push(buf);
      }
      download.received += chunkLen;
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
      const silent = silentFileGets.has(fileId);
      const download = downloadByFileId.get(fileId);
      if (download) {
        downloadByFileId.delete(fileId);
        silentFileGets.delete(fileId);
        const isStreaming = Boolean(download.streaming && download.streamId);
        if (isStreaming && download.streamId) {
          postStreamEnd(download.streamId);
          updateTransferByFileId(fileId, (entry) => ({
            ...entry,
            status: "complete",
            progress: 100,
            ...(download.mime ? { mime: download.mime } : {}),
          }));
          if (!silent) store.set({ status: `Скачивание завершено: ${download.name}` });
          if (pendingFileViewer && pendingFileViewer.fileId === fileId) pendingFileViewer = null;
          return true;
        }
        const mime = download.mime || guessMimeTypeByName(download.name);
        const blob = new Blob(download.chunks, { type: mime });
        const url = URL.createObjectURL(blob);
        updateTransferByFileId(fileId, (entry) => ({
          ...entry,
          status: "complete",
          progress: 100,
          url,
          ...(download.mime ? { mime: download.mime } : {}),
        }));
        if (!silent) store.set({ status: `Файл готов: ${download.name}` });
        try {
          const st = store.get();
          if (st.selfId && shouldCacheFile(download.name || "файл", mime, download.size || blob.size || 0)) {
            void putCachedFileBlob(st.selfId, fileId, blob, { mime, size: download.size || blob.size || 0 });
            void enforceFileCachePolicy(st.selfId, { force: true });
          }
        } catch {
          // ignore
        }
        const pending = pendingFileDownloads.get(fileId);
        if (pending) {
          pendingFileDownloads.delete(fileId);
          triggerBrowserDownload(url, pending.name || download.name || "файл");
        }
        if (pendingFileViewer && pendingFileViewer.fileId === fileId) {
          const pv = pendingFileViewer;
          pendingFileViewer = null;
          store.set({
            modal: buildFileViewerModalState({
              url,
              name: pv.name,
              size: pv.size,
              mime: pv.mime,
              caption: pv.caption || null,
              chatKey: pv.chatKey,
              msgIdx: pv.msgIdx,
            }),
          });
        }
      } else {
        silentFileGets.delete(fileId);
        updateTransferByFileId(fileId, (entry) => ({ ...entry, status: "complete", progress: 100 }));
      }
      return true;
    }
    if (t === "file_error") {
      const fileId = String(msg?.file_id ?? "").trim();
      const reason = String(msg?.reason ?? "ошибка");
      const peer = String(msg?.peer ?? "").trim();
      const detail = peer ? `${reason} (${peer})` : reason;
      const silent = fileId ? silentFileGets.has(fileId) : false;
      if (fileId) {
        silentFileGets.delete(fileId);
        pendingFileDownloads.delete(fileId);
        if (pendingFileViewer && pendingFileViewer.fileId === fileId) pendingFileViewer = null;
        const upload = uploadByFileId.get(fileId);
        if (upload) upload.aborted = true;
        const download = downloadByFileId.get(fileId);
        if (download?.streamId) postStreamError(download.streamId, detail);
        if (download) downloadByFileId.delete(fileId);
        updateTransferByFileId(fileId, (entry) => ({ ...entry, status: "error", error: detail }));
      }
      if (!silent) store.set({ status: `Ошибка файла: ${detail}` });
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
    cachedPreviewsAttempted.clear();
    previewPrefetchAttempted.clear();
    pushAutoAttemptUser = null;
    pushAutoAttemptAt = 0;
    store.set({ pwaPushSubscribed: false, pwaPushStatus: null });
    silentFileGets.clear();
    pendingFileDownloads.clear();
    previewWarmupLastKey = "";
    previewWarmupLastSig = "";
    previewWarmupInFlight = false;
    if (previewWarmupTimer !== null) {
      window.clearTimeout(previewWarmupTimer);
      previewWarmupTimer = null;
    }

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
      historyVirtualStart: {},
      outbox: {},
      drafts: {},
      input: "",
      editing: null,
      boardComposerOpen: false,
      boardScheduledPosts: [],
      chatSearchOpen: false,
      chatSearchResultsOpen: false,
      chatSearchQuery: "",
      chatSearchDate: "",
      chatSearchFilter: "all",
      chatSearchHits: [],
      chatSearchPos: 0,
      chatSearchCounts: createChatSearchCounts(),
      profiles: {},
      profileDraftDisplayName: "",
      profileDraftHandle: "",
      toast: null,
      page: "main",
      modal: { kind: "logout" },
      authMode: rememberedId ? "login" : "register",
      authRememberedId: rememberedId,
      status: "Вы вышли из мессенджера. Нажмите «Войти», чтобы вернуться.",
    }));
    draftsLoadedForUser = null;
    pinsLoadedForUser = null;
    pinnedMessagesLoadedForUser = null;
    fileTransfersLoadedForUser = null;
    outboxLoadedForUser = null;
    boardScheduleLoadedForUser = null;
    clearBoardScheduleTimer();
    try {
      layout.input.value = "";
      autosizeInput(layout.input);
    } catch {
      // ignore
    }

    // Сбрасываем серверную авторизацию через переподключение.
    gateway.close();
    // Важно: после manual-close шлюз не делает авто-reconnect, поэтому сразу подключаемся заново.
    // Иначе пользователю приходится делать ручной refresh, чтобы снова войти.
    gateway.connect();
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

  function clearComposerHelper() {
    const st = store.get();
    if (!st.replyDraft && !st.forwardDraft) return;
    store.set({ replyDraft: null, forwardDraft: null });
  }

  function helperPreviewFromMessage(msg: ChatMessage): string {
    const rawText = String(msg.text || "")
      .replace(/\s+/g, " ")
      .trim();
    const text = rawText && !rawText.startsWith("[file]") ? rawText : "";
    if (text) return text;
    const attachment = msg.attachment;
    if (attachment?.kind === "file") {
      const name = String(attachment.name || "файл");
      const badge = fileBadge(name, attachment.mime);
      let kindLabel = "Файл";
      if (badge.kind === "image") kindLabel = "Фото";
      else if (badge.kind === "video") kindLabel = "Видео";
      else if (badge.kind === "audio") kindLabel = "Аудио";
      else if (badge.kind === "archive") kindLabel = "Архив";
      else if (badge.kind === "doc") kindLabel = "Документ";
      else if (badge.kind === "pdf") kindLabel = "PDF";
      return name ? `${kindLabel}: ${name}` : kindLabel;
    }
    if (attachment?.kind === "action") return "Действие";
    return "Сообщение";
  }

  function buildHelperDraft(st: AppState, key: string, msg: ChatMessage): MessageHelperDraft | null {
    const k = String(key || "").trim();
    if (!k) return null;
    if (!msg || msg.kind === "sys") return null;
    const preview = helperPreviewFromMessage(msg);
    const from = String(msg.from || "").trim();
    const rawText = String(msg.text || "").trim();
    const text = rawText && !rawText.startsWith("[file]") ? rawText : "";
    const attachment = msg.attachment ?? null;
    const id = typeof msg.id === "number" && Number.isFinite(msg.id) ? msg.id : null;
    const localId = typeof msg.localId === "string" && msg.localId.trim() ? msg.localId.trim() : null;
    return {
      key: k,
      preview,
      ...(from ? { from } : {}),
      ...(text ? { text } : {}),
      ...(attachment ? { attachment } : {}),
      ...(id !== null ? { id } : {}),
      ...(localId ? { localId } : {}),
    };
  }

  function helperDraftToRef(draft: MessageHelperDraft | null): ChatMessage["reply"] {
    if (!draft) return null;
    const { key, preview, ...rest } = draft;
    return rest;
  }

  function beginEditingMessage(key: string, msgId: number, text: string) {
    const k = String(key || "").trim();
    const id = Number.isFinite(Number(msgId)) ? Math.trunc(Number(msgId)) : 0;
    if (!k || id <= 0) return;
    clearComposerHelper();
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

  function sendChat(opts?: {
    mode?: "now" | "when_online" | "schedule";
    scheduleAt?: number;
    silent?: boolean;
    target?: TargetRef;
    text?: string;
    replyDraft?: MessageHelperDraft | null;
    forwardDraft?: MessageHelperDraft | null;
  }) {
    const st = store.get();
    const rawText = typeof opts?.text === "string" ? opts.text : String(layout.input.value || "");
    const text = rawText.trimEnd();
    const sel = opts?.target ?? st.selected;
    const key = sel ? conversationKey(sel) : "";
    const editing = st.editing && key && st.editing.key === key ? st.editing : null;
    const replyDraft =
      opts?.replyDraft !== undefined
        ? opts.replyDraft && opts.replyDraft.key === key
          ? opts.replyDraft
          : null
        : st.replyDraft && st.replyDraft.key === key
          ? st.replyDraft
          : null;
    const forwardDraft =
      opts?.forwardDraft !== undefined
        ? opts.forwardDraft && opts.forwardDraft.key === key
          ? opts.forwardDraft
          : null
        : st.forwardDraft && st.forwardDraft.key === key
          ? st.forwardDraft
          : null;
    const forwardFallback = !text && forwardDraft ? String(forwardDraft.text || forwardDraft.preview || "") : "";
    const finalText = text || forwardFallback;
    const mode = opts?.mode === "when_online" ? "when_online" : opts?.mode === "schedule" ? "schedule" : "now";
    const silent = Boolean(opts?.silent);
    const scheduleAtRaw = mode === "schedule" ? opts?.scheduleAt : undefined;
    const scheduleAt =
      typeof scheduleAtRaw === "number" && Number.isFinite(scheduleAtRaw) && scheduleAtRaw > 0 ? Math.trunc(scheduleAtRaw) : 0;
    if (!finalText) return;
    if (finalText.length > APP_MSG_MAX_LEN) {
      store.set({ status: `Слишком длинное сообщение (${finalText.length}/${APP_MSG_MAX_LEN})` });
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

    const whenOnline = mode === "when_online" && sel.kind === "dm";
    if (mode === "schedule" && scheduleAt <= 0) {
      store.set({ status: "Некорректная дата отправки" });
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
    if (convKey) markChatAutoScroll(convKey, false);
    const localId = makeOutboxLocalId();
    const ts = nowTs();
    const nowMs = Date.now();
    const payload = sel.kind === "dm"
      ? { type: "send" as const, to: sel.id, text: finalText, ...(silent ? { silent: true } : {}) }
      : { type: "send" as const, room: sel.id, text: finalText, ...(silent ? { silent: true } : {}) };
    const scheduled = mode === "schedule" && scheduleAt > 0;
    const sent = st.conn === "connected" && !whenOnline && !scheduled ? gateway.send(payload) : false;
    const initialStatus = sent ? ("sending" as const) : ("queued" as const);
    const replyRef = replyDraft ? helperDraftToRef(replyDraft) : null;
    const forwardRef = forwardDraft ? helperDraftToRef(forwardDraft) : null;

    const localMsg = {
      kind: "out" as const,
      from: st.selfId || "",
      to: sel.kind === "dm" ? sel.id : undefined,
      room: sel.kind === "dm" ? undefined : sel.id,
      text: finalText,
      ts,
      localId,
      id: null,
      status: initialStatus,
      ...(replyRef ? { reply: replyRef } : {}),
      ...(forwardRef ? { forward: forwardRef } : {}),
      ...(whenOnline ? { whenOnline: true } : {}),
      ...(scheduled ? { scheduleAt } : {}),
    };

    store.set((prev) => {
      const next = upsertConversation(prev, convKey, localMsg);
      const outbox = addOutboxEntry(next.outbox, convKey, {
        localId,
        ts,
        text: finalText,
        ...(sel.kind === "dm" ? { to: sel.id } : { room: sel.id }),
        ...(whenOnline ? { whenOnline: true } : {}),
        ...(silent ? { silent: true } : {}),
        ...(scheduled ? { scheduleAt } : {}),
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
    scheduleBoardEditorPreview();
    store.set((prev) => {
      const drafts = updateDraftMap(prev.drafts, convKey, "");
      return { ...prev, input: "", drafts, replyDraft: null, forwardDraft: null };
    });
    scheduleSaveDrafts(store);

    if (scheduled) {
      store.set({ status: "Сообщение запланировано" });
      drainOutbox();
      return;
    }
    if (whenOnline) {
      store.set({ status: "Сообщение будет отправлено, когда контакт в сети" });
      drainOutbox();
      return;
    }
    if (!sent) {
      store.set({ status: st.conn === "connected" ? "Сообщение в очереди" : "Нет соединения: сообщение в очереди" });
    }
  }

  function openBoardPostModal(boardId: string) {
    const bid = String(boardId || "").trim();
    if (!bid) return;
    const st = store.get();
    if (st.modal && st.modal.kind !== "context_menu") return;
    lastUserInputAt = Date.now();
    if (st.conn !== "connected") {
      store.set({ status: "Нет соединения" });
      return;
    }
    if (!st.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    const b = (st.boards || []).find((x) => x.id === bid);
    if (!b) {
      store.set({ status: `Доска не найдена: ${bid}` });
      return;
    }
    const owner = String(b.owner_id || "").trim();
    const me = String(st.selfId || "").trim();
    if (owner && me && owner !== me) {
      store.set({ status: "На доске писать может только владелец" });
      return;
    }
    store.set({ modal: { kind: "board_post", boardId: bid } });
  }

  function publishBoardPost(text: string) {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "board_post") return;
    const boardId = String(modal.boardId || "").trim();
    const body = String(text ?? "").trimEnd();
    lastUserInputAt = Date.now();
    if (!boardId) {
      store.set({ status: "Некорректная доска" });
      return;
    }
    if (!body) return;
    if (body.length > APP_MSG_MAX_LEN) {
      store.set({ status: `Слишком длинный пост (${body.length}/${APP_MSG_MAX_LEN})` });
      return;
    }
    if (!st.authed || !st.selfId) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    if (st.conn !== "connected") {
      store.set({ status: "Нет соединения: пост в очереди" });
    }
    const b = (st.boards || []).find((x) => x.id === boardId);
    if (!b) {
      store.set({ status: `Доска не найдена: ${boardId}` });
      return;
    }
    const owner = String(b.owner_id || "").trim();
    const me = String(st.selfId || "").trim();
    if (owner && me && owner !== me) {
      store.set({ status: "На доске писать может только владелец" });
      return;
    }

    const target: TargetRef = { kind: "board", id: boardId };
    const convKey = conversationKey(target);
    if (convKey) markChatAutoScroll(convKey, false);
    const localId = makeOutboxLocalId();
    const ts = nowTs();
    const nowMs = Date.now();
    const payload = { type: "send" as const, room: boardId, text: body };
    const sent = st.conn === "connected" ? gateway.send(payload) : false;
    const initialStatus = sent ? ("sending" as const) : ("queued" as const);

    const localMsg = {
      kind: "out" as const,
      from: st.selfId || "",
      room: boardId,
      text: body,
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
        text: body,
        room: boardId,
        status: sent ? "sending" : "queued",
        attempts: sent ? 1 : 0,
        lastAttemptAt: sent ? nowMs : 0,
      });
      return { ...next, outbox, modal: null };
    });
    scheduleSaveOutbox(store);

    store.set({ status: sent ? "Пост отправляется…" : "Нет соединения: пост в очереди" });
  }

  const OUTBOX_RETRY_MIN_MS = 900;
  const OUTBOX_DRAIN_MAX = 12;
  const OUTBOX_SCHEDULE_GRACE_MS = 1200;
  let outboxScheduleTimer: number | null = null;
  let outboxScheduleNextAt = 0;

  function clearOutboxScheduleTimer() {
    if (outboxScheduleTimer !== null) {
      window.clearTimeout(outboxScheduleTimer);
      outboxScheduleTimer = null;
    }
    outboxScheduleNextAt = 0;
  }

  function armOutboxScheduleTimer(nextAt: number) {
    if (!Number.isFinite(nextAt) || nextAt <= 0) {
      clearOutboxScheduleTimer();
      return;
    }
    if (outboxScheduleTimer !== null && outboxScheduleNextAt === nextAt) return;
    clearOutboxScheduleTimer();
    outboxScheduleNextAt = nextAt;
    const delay = Math.max(0, nextAt - Date.now());
    outboxScheduleTimer = window.setTimeout(() => {
      outboxScheduleTimer = null;
      outboxScheduleNextAt = 0;
      drainOutbox();
    }, delay);
  }

  function drainOutbox(limit = OUTBOX_DRAIN_MAX) {
    const st = store.get();
    const entries = Object.entries(st.outbox || {});
    if (!entries.length) {
      clearOutboxScheduleTimer();
      return;
    }

    const nowMs = Date.now();
    let nextScheduleAt = 0;
    const flat: Array<{
      key: string;
      localId: string;
      to?: string;
      room?: string;
      text: string;
      ts: number;
      lastAttemptAt: number;
      whenOnline?: boolean;
      silent?: boolean;
      scheduleAt?: number;
    }> = [];
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
        const whenOnline = Boolean(e?.whenOnline);
        const silent = Boolean(e?.silent);
        const scheduleAtRaw = e?.scheduleAt;
        const scheduleAt =
          typeof scheduleAtRaw === "number" && Number.isFinite(scheduleAtRaw) && scheduleAtRaw > 0 ? Math.trunc(scheduleAtRaw) : 0;
        if (scheduleAt && scheduleAt > nowMs + OUTBOX_SCHEDULE_GRACE_MS) {
          if (!nextScheduleAt || scheduleAt < nextScheduleAt) nextScheduleAt = scheduleAt;
          continue;
        }
        flat.push({
          key: k,
          localId: lid,
          to,
          room,
          text,
          ts,
          lastAttemptAt,
          ...(whenOnline ? { whenOnline: true } : {}),
          ...(silent ? { silent: true } : {}),
          ...(scheduleAt ? { scheduleAt } : {}),
        });
      }
    }
    if (nextScheduleAt) armOutboxScheduleTimer(nextScheduleAt);
    else clearOutboxScheduleTimer();
    if (!flat.length) return;
    if (st.conn !== "connected") return;
    if (!st.authed || !st.selfId) return;
    flat.sort((a, b) => a.ts - b.ts);

    const onlineById = new Map<string, boolean>();
    for (const f of st.friends || []) {
      const id = String(f?.id || "").trim();
      if (!id) continue;
      onlineById.set(id, Boolean(f?.online));
    }

    const sent: Array<{ key: string; localId: string }> = [];
    for (const it of flat) {
      if (sent.length >= limit) break;
      if (it.lastAttemptAt && nowMs - it.lastAttemptAt < OUTBOX_RETRY_MIN_MS) continue;
      if (it.whenOnline && it.to && !onlineById.get(it.to)) continue;
      const ok = gateway.send(
        it.to
          ? { type: "send", to: it.to, text: it.text, ...(it.silent ? { silent: true } : {}) }
          : { type: "send", room: it.room, text: it.text, ...(it.silent ? { silent: true } : {}) }
      );
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

  let boardScheduleTimer: number | null = null;
  let boardScheduleNextAt = 0;

  function clearBoardScheduleTimer() {
    if (boardScheduleTimer !== null) {
      window.clearTimeout(boardScheduleTimer);
      boardScheduleTimer = null;
    }
    boardScheduleNextAt = 0;
  }

  function armBoardScheduleTimer() {
    const st = store.get();
    if (!st.authed || !st.selfId) {
      clearBoardScheduleTimer();
      return;
    }
    const list = Array.isArray(st.boardScheduledPosts) ? st.boardScheduledPosts : [];
    if (!list.length) {
      clearBoardScheduleTimer();
      return;
    }
    const nextAt = list.reduce((min, it) => (it.scheduleAt && it.scheduleAt < min ? it.scheduleAt : min), Number.POSITIVE_INFINITY);
    if (!Number.isFinite(nextAt) || nextAt <= 0) {
      clearBoardScheduleTimer();
      return;
    }
    if (boardScheduleTimer !== null && boardScheduleNextAt === nextAt) return;
    clearBoardScheduleTimer();
    boardScheduleNextAt = nextAt;
    const now = Date.now();
    const delay = Math.max(0, nextAt - now);
    boardScheduleTimer = window.setTimeout(() => {
      boardScheduleTimer = null;
      boardScheduleNextAt = 0;
      drainBoardSchedule();
    }, delay);
  }

  function sendScheduledBoardPost(boardId: string, text: string) {
    const st = store.get();
    if (!st.authed || !st.selfId) return;
    const bid = String(boardId || "").trim();
    const body = String(text || "").trimEnd();
    if (!bid || !body.trim()) return;

    const b = (st.boards || []).find((x) => x.id === bid);
    if (!b) {
      showToast(`Запланированный пост: доска не найдена (${bid})`, { kind: "warn" });
      return;
    }
    const owner = String(b.owner_id || "").trim();
    const me = String(st.selfId || "").trim();
    if (owner && me && owner !== me) {
      showToast("Запланированный пост: писать может только владелец", { kind: "warn" });
      return;
    }

    const target: TargetRef = { kind: "board", id: bid };
    const convKey = conversationKey(target);
    const localId = makeOutboxLocalId();
    const ts = nowTs();
    const nowMs = Date.now();
    const payload = { type: "send" as const, room: bid, text: body };
    const sent = st.conn === "connected" ? gateway.send(payload) : false;
    const initialStatus = sent ? ("sending" as const) : ("queued" as const);

    const localMsg = {
      kind: "out" as const,
      from: st.selfId || "",
      room: bid,
      text: body,
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
        text: body,
        room: bid,
        status: sent ? "sending" : "queued",
        attempts: sent ? 1 : 0,
        lastAttemptAt: sent ? nowMs : 0,
      });
      return { ...next, outbox };
    });
    scheduleSaveOutbox(store);
  }

  function drainBoardSchedule() {
    const st = store.get();
    if (!st.authed || !st.selfId) {
      clearBoardScheduleTimer();
      return;
    }
    const list = Array.isArray(st.boardScheduledPosts) ? st.boardScheduledPosts : [];
    if (!list.length) {
      clearBoardScheduleTimer();
      return;
    }
    const now = Date.now();
    const due = list.filter((x) => x.scheduleAt <= now + 1200);
    if (!due.length) {
      armBoardScheduleTimer();
      return;
    }
    const dueIds = new Set(due.map((x) => x.id));
    const remaining = list.filter((x) => !dueIds.has(x.id));

    for (const it of due.sort((a, b) => a.scheduleAt - b.scheduleAt)) {
      sendScheduledBoardPost(it.boardId, it.text);
    }

    store.set((prev) => ({ ...prev, boardScheduledPosts: remaining }));
    saveBoardScheduleForUser(st.selfId, remaining);
    if (due.length === 1) showToast("Опубликован запланированный пост", { kind: "success" });
    else showToast(`Опубликовано запланированных постов: ${due.length}`, { kind: "success" });

    armBoardScheduleTimer();
  }

  const EMOJI_RECENTS_KEY = "yagodka:emoji_recents:v1";
  const EMOJI_RECENTS_MAX = 24;
  let emojiOpen = false;
  let emojiPopover: HTMLElement | null = null;
  let emojiTabs: HTMLElement | null = null;
  let emojiContent: HTMLElement | null = null;
  let emojiSearchInput: HTMLInputElement | null = null;
  let emojiSearchWrap: HTMLElement | null = null;
  let emojiActiveSection = EMOJI_RECENTS_ID;
  let emojiSearch = "";
  let emojiHideTimer: number | null = null;
  let emojiLastQuery = "";

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

  function clearEmojiHideTimer() {
    if (emojiHideTimer !== null) {
      window.clearTimeout(emojiHideTimer);
      emojiHideTimer = null;
    }
  }

  function setActiveEmojiTab(sectionId: string) {
    emojiActiveSection = sectionId;
    if (!emojiTabs) return;
    const tabs = emojiTabs.querySelectorAll<HTMLButtonElement>("button.emoji-tab[data-emoji-section]");
    tabs.forEach((btn) => {
      const active = btn.dataset.emojiSection === sectionId;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  function syncEmojiActiveTabFromScroll() {
    if (!emojiContent) return;
    const sections = Array.from(emojiContent.querySelectorAll<HTMLElement>(".emoji-section[data-section]"));
    if (!sections.length) return;
    const top = emojiContent.scrollTop + 8;
    let current = sections[0];
    for (const section of sections) {
      if (section.offsetTop <= top) current = section;
      else break;
    }
    const nextId = current.dataset.section;
    if (nextId) setActiveEmojiTab(nextId);
  }

  function scrollToEmojiSection(sectionId: string, behavior: ScrollBehavior = "smooth") {
    if (!emojiContent) return;
    const target = emojiContent.querySelector<HTMLElement>(`.emoji-section[data-section="${sectionId}"]`);
    if (!target) return;
    emojiContent.scrollTo({ top: Math.max(0, target.offsetTop - 4), behavior });
  }

  function ensureEmojiPopover(): HTMLElement {
    if (emojiPopover) return emojiPopover;
    const pop = el("div", { class: "emoji-popover hidden", role: "dialog", "aria-label": "Эмодзи" });
    const field = layout.inputWrap.querySelector(".composer-field");
    (field || layout.inputWrap).append(pop);
    emojiPopover = pop;

    const closeBtn = el(
      "button",
      { class: "btn emoji-close", type: "button", "aria-label": "Закрыть эмодзи", "data-action": "emoji-close" },
      ["×"]
    );
    const searchInput = el("input", {
      class: "emoji-search-input",
      type: "search",
      placeholder: "Поиск эмодзи",
      "aria-label": "Поиск эмодзи",
    });
    emojiSearchInput = searchInput;
    const clearBtn = el(
      "button",
      { class: "emoji-search-clear", type: "button", "aria-label": "Очистить поиск", "data-action": "emoji-search-clear" },
      ["×"]
    );
    const searchWrap = el("label", { class: "emoji-search", role: "search" }, [searchInput, clearBtn]);
    emojiSearchWrap = searchWrap;
    const head = el("div", { class: "emoji-head" }, [searchWrap, closeBtn]);
    const tabs = el("div", { class: "emoji-tabs", role: "tablist", "aria-label": "Категории эмодзи" });
    emojiTabs = tabs;
    const content = el("div", { class: "emoji-content", role: "tabpanel", "aria-label": "Список эмодзи" });
    emojiContent = content;
    pop.append(head, tabs, content);

    pop.addEventListener("click", (ev) => {
      const closeBtn = (ev.target as HTMLElement | null)?.closest("button[data-action='emoji-close']") as HTMLButtonElement | null;
      if (closeBtn) {
        ev.preventDefault();
        closeEmojiPopover();
        return;
      }

      const clearBtn = (ev.target as HTMLElement | null)?.closest("button[data-action='emoji-search-clear']") as HTMLButtonElement | null;
      if (clearBtn) {
        ev.preventDefault();
        emojiSearch = "";
        if (emojiSearchInput) emojiSearchInput.value = "";
        renderEmojiPopover();
        try {
          emojiSearchInput?.focus({ preventScroll: true });
        } catch {
          emojiSearchInput?.focus();
        }
        return;
      }

      const tabBtn = (ev.target as HTMLElement | null)?.closest("button[data-emoji-section]") as HTMLButtonElement | null;
      if (tabBtn) {
        ev.preventDefault();
        const nextId = String(tabBtn.dataset.emojiSection || "");
        if (nextId) {
          setActiveEmojiTab(nextId);
          scrollToEmojiSection(nextId);
        }
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

    searchInput.addEventListener("input", () => {
      emojiSearch = searchInput.value || "";
      renderEmojiPopover();
    });

    const onEmojiScroll = () => {
      if (!emojiOpen) return;
      syncEmojiActiveTabFromScroll();
    };
    content.addEventListener("scroll", onEmojiScroll, { passive: true });

    return pop;
  }

  function renderEmojiTabs(sections: ReturnType<typeof buildEmojiSections>) {
    if (!emojiTabs) return;
    if (!sections.length) {
      emojiTabs.replaceChildren();
      return;
    }
    if (!sections.some((s) => s.id === emojiActiveSection)) {
      emojiActiveSection = sections[0].id;
    }
    const buttons = sections.map((section) =>
      el(
        "button",
        {
          class: `emoji-tab${section.id === emojiActiveSection ? " is-active" : ""}`,
          type: "button",
          role: "tab",
          "data-emoji-section": section.id,
          "aria-selected": section.id === emojiActiveSection ? "true" : "false",
          "aria-controls": `emoji-section-${section.id}`,
          title: section.title,
        },
        [section.icon]
      )
    );
    emojiTabs.replaceChildren(...buttons);
  }

  function renderEmojiContent(sections: ReturnType<typeof buildEmojiSections>, hasQuery: boolean) {
    if (!emojiContent) return;
    const contentNodes: HTMLElement[] = [];
    for (const section of sections) {
      if (!section.items.length) continue;
      const title = el("div", { class: "emoji-section-title" }, [section.title]);
      const grid = el(
        "div",
        { class: "emoji-grid", role: "listbox", "aria-label": section.title },
        section.items.map((e) =>
          el("button", { class: "emoji-btn", type: "button", "data-emoji": e, title: e, "aria-label": e }, [e])
        )
      );
      const block = el(
        "section",
        { class: "emoji-section", id: `emoji-section-${section.id}`, "data-section": section.id },
        [title, grid]
      );
      contentNodes.push(block);
    }
    if (!contentNodes.length) {
      const empty = el("div", { class: "emoji-empty" }, [hasQuery ? "Ничего не найдено" : "Эмодзи пока нет"]);
      emojiContent.replaceChildren(empty);
      return;
    }
    emojiContent.replaceChildren(...contentNodes);
  }

  function renderEmojiPopover() {
    const pop = ensureEmojiPopover();
    const sections = buildEmojiSections(loadEmojiRecents());
    const filtered = filterEmojiSections(sections, emojiSearch);
    const hasQuery = emojiSearch.trim().length > 0;

    if (emojiSearchInput && emojiSearchInput.value !== emojiSearch) {
      emojiSearchInput.value = emojiSearch;
    }
    if (emojiSearchWrap) emojiSearchWrap.classList.toggle("has-value", hasQuery);
    pop.classList.toggle("emoji-searching", hasQuery);

    renderEmojiTabs(sections);
    renderEmojiContent(filtered, hasQuery);

    if (emojiContent && emojiLastQuery !== emojiSearch) {
      emojiContent.scrollTop = 0;
      emojiLastQuery = emojiSearch;
    }
    syncEmojiActiveTabFromScroll();
  }

  function openEmojiPopover() {
    if (layout.input.disabled) return;
    emojiOpen = true;
    layout.emojiBtn.classList.add("btn-active");
    const pop = ensureEmojiPopover();
    renderEmojiPopover();
    clearEmojiHideTimer();
    pop.classList.remove("hidden");
    requestAnimationFrame(() => pop.classList.add("emoji-open"));
  }

  function closeEmojiPopover() {
    emojiOpen = false;
    layout.emojiBtn.classList.remove("btn-active");
    if (!emojiPopover) return;
    emojiSearch = "";
    emojiLastQuery = "";
    if (emojiSearchInput) emojiSearchInput.value = "";
    if (emojiSearchWrap) emojiSearchWrap.classList.remove("has-value");
    emojiPopover.classList.remove("emoji-searching");
    emojiPopover.classList.remove("emoji-open");
    clearEmojiHideTimer();
    emojiHideTimer = window.setTimeout(() => {
      if (!emojiOpen) emojiPopover?.classList.add("hidden");
    }, 160);
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

  let autosizeRaf: number | null = null;
  let pendingInputValue: string | null = null;
  let lastCommittedInput = layout.input.value || "";
  let inputCommitTimer: number | null = null;
  let lastCommitAt = 0;
  const INPUT_COMMIT_MS = 140;

  const scheduleAutosize = () => {
    if (autosizeRaf !== null) return;
    autosizeRaf = window.requestAnimationFrame(() => {
      autosizeRaf = null;
      autosizeInput(layout.input);
    });
  };

  const commitInputUpdate = () => {
    if (inputCommitTimer !== null) {
      window.clearTimeout(inputCommitTimer);
      inputCommitTimer = null;
    }
    const value = pendingInputValue ?? layout.input.value ?? "";
    pendingInputValue = null;
    if (value === lastCommittedInput) return;
    lastCommittedInput = value;
    store.set((prev) => {
      const key = prev.selected ? conversationKey(prev.selected) : "";
      const isEditing = Boolean(prev.editing && key && prev.editing.key === key);
      const drafts = key && !isEditing ? updateDraftMap(prev.drafts, key, value) : prev.drafts;
      return { ...prev, input: value, drafts };
    });
    scheduleSaveDrafts(store);
  };

  let boardPreviewRaf: number | null = null;
  function scheduleBoardEditorPreview() {
    if (boardPreviewRaf !== null) return;
    boardPreviewRaf = window.requestAnimationFrame(() => {
      boardPreviewRaf = null;
      const st = store.get();
      if (!st.boardComposerOpen) return;
      if (st.selected?.kind !== "board") return;
      const raw = String(layout.input.value || "");
      const trimmed = raw.trimEnd();
      const preview = layout.boardEditorPreviewBody;
      const prevTop = preview.scrollTop;
      const bottomSlack = 48;
      const wasAtBottom = preview.scrollTop + preview.clientHeight >= preview.scrollHeight - bottomSlack;
      const caretAtEnd = (() => {
        try {
          const el = layout.input;
          const len = el.value.length;
          const s = typeof el.selectionStart === "number" ? el.selectionStart : len;
          const e = typeof el.selectionEnd === "number" ? el.selectionEnd : len;
          return s === len && e === len;
        } catch {
          return true;
        }
      })();
      if (!trimmed) {
        preview.replaceChildren(el("div", { class: "board-editor-preview-empty" }, ["Пусто — напишите новость выше"]));
        preview.scrollTop = 0;
        return;
      }
      preview.replaceChildren(renderBoardPost(trimmed));
      const applyScroll = () => {
        try {
          const maxTop = Math.max(0, preview.scrollHeight - preview.clientHeight);
          // Editor UX: if user types at the end — follow the bottom (like a live preview).
          // Otherwise preserve manual scroll position.
          if (wasAtBottom || caretAtEnd) preview.scrollTop = maxTop;
          else preview.scrollTop = Math.max(0, Math.min(maxTop, prevTop));
        } catch {
          // ignore
        }
      };
      // Some WebKit builds update scrollHeight lazily; apply twice to keep bottom stable.
      applyScroll();
      window.requestAnimationFrame(applyScroll);
    });
  }

  const updateComposerTypingUi = (forceOff = false) => {
    try {
      if (forceOff) {
        layout.inputWrap.classList.remove("composer-typing");
        return;
      }
      const active = Boolean(document.activeElement === layout.input && String(layout.input.value || "").trim());
      layout.inputWrap.classList.toggle("composer-typing", active);
    } catch {
      // ignore
    }
  };

  type IosNavDisabledField = { el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement; disabled: boolean };
  let iosNavDisabled: IosNavDisabledField[] = [];
  const restoreIosNavDisabled = () => {
    if (!iosNavDisabled.length) return;
    for (const it of iosNavDisabled) {
      try {
        it.el.disabled = it.disabled;
      } catch {
        // ignore
      }
    }
    iosNavDisabled = [];
  };
  const applyIosComposerNavLock = () => {
    if (!isIOS()) return;
    restoreIosNavDisabled();
    const keep = new Set<Element>([layout.input]);
    const candidates: Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> = [];
    try {
      const nodes = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select");
      for (const node of Array.from(nodes)) {
        if (!node || keep.has(node)) continue;
        candidates.push(node);
      }
    } catch {
      // ignore
    }
    for (const node of candidates) {
      try {
        iosNavDisabled.push({ el: node, disabled: node.disabled });
        node.disabled = true;
      } catch {
        // ignore
      }
    }
  };

  layout.input.addEventListener("input", () => {
    lastUserInputAt = Date.now();
    pendingInputValue = layout.input.value || "";
    scheduleAutosize();
    scheduleBoardEditorPreview();
    updateComposerTypingUi();
    const now = Date.now();
    if (now - lastCommitAt >= INPUT_COMMIT_MS) {
      lastCommitAt = now;
      commitInputUpdate();
      return;
    }
    if (inputCommitTimer !== null) return;
    const delay = Math.max(24, INPUT_COMMIT_MS - (now - lastCommitAt));
    inputCommitTimer = window.setTimeout(() => {
      lastCommitAt = Date.now();
      commitInputUpdate();
    }, delay);
  });
  layout.input.addEventListener("focus", () => {
    scheduleAutosize();
    updateComposerTypingUi();
    applyIosComposerNavLock();
  });
  layout.input.addEventListener("blur", () => {
    scheduleAutosize();
    updateComposerTypingUi(true);
    commitInputUpdate();
    restoreIosNavDisabled();
  });

  layout.boardScheduleInput.addEventListener("input", () => store.set((prev) => prev));
  layout.boardScheduleInput.addEventListener("change", () => store.set((prev) => prev));

  const vv = window.visualViewport;
  const onViewportResize = () => {
    if (document.activeElement !== layout.input) return;
    autosizeInput(layout.input);
  };
  vv?.addEventListener("resize", onViewportResize, { passive: true });

  function normalizeClipboardFile(file: File): File {
    const name = String(file?.name || "").trim();
    if (name) return file;
    const type = String(file?.type || "").toLowerCase();
    let ext = "";
    if (type.includes("/")) {
      const raw = type.split("/")[1] || "";
      const base = raw.replace("+xml", "");
      if (base === "jpeg") ext = "jpg";
      else if (base === "svg") ext = "svg";
      else if (base === "x-icon") ext = "ico";
      else ext = base;
    }
    const suffix = ext ? `.${ext}` : "";
    const filename = `clipboard-${Date.now()}${suffix}`;
    try {
      return new File([file], filename, { type: file.type || undefined, lastModified: file.lastModified || Date.now() });
    } catch {
      return file;
    }
  }

  layout.input.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && emojiOpen) {
      e.preventDefault();
      e.stopPropagation();
      closeEmojiPopover();
      return;
    }
    const st = store.get();
    const boardEditorOpen = Boolean(st.boardComposerOpen && st.selected?.kind === "board");

    if (e.key === "Enter" && !e.shiftKey) {
      if (boardEditorOpen) {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          sendChat();
        }
        return;
      }
      e.preventDefault();
      sendChat();
      return;
    }

    if (e.key === "Escape") {
      if (st.editing) {
        e.preventDefault();
        e.stopPropagation();
        cancelEditing();
        return;
      }
      if (st.replyDraft || st.forwardDraft) {
        e.preventDefault();
        e.stopPropagation();
        clearComposerHelper();
        return;
      }
      if (boardEditorOpen) {
        e.preventDefault();
        e.stopPropagation();
        store.set((prev) => (prev.boardComposerOpen ? { ...prev, boardComposerOpen: false } : prev));
        return;
      }
    }
  });

  layout.boardPublishBtn.addEventListener("click", () => sendChat());

  let sendMenuClickSuppression: CtxClickSuppressionState = { key: null, until: 0 };
  let sendMenuLongPressTimer: number | null = null;
  let sendMenuLongPressStartX = 0;
  let sendMenuLongPressStartY = 0;

  const clearSendMenuLongPress = () => {
    if (sendMenuLongPressTimer !== null) {
      window.clearTimeout(sendMenuLongPressTimer);
      sendMenuLongPressTimer = null;
    }
  };

  const getComposerFinalText = (st: AppState): string => {
    const raw = String(layout.input.value || "");
    const text = raw.trimEnd();
    const key = st.selected ? conversationKey(st.selected) : "";
    const forwardDraft = st.forwardDraft && key && st.forwardDraft.key === key ? st.forwardDraft : null;
    const forwardFallback = !text && forwardDraft ? String(forwardDraft.text || forwardDraft.preview || "") : "";
    return text || forwardFallback;
  };

  const parseDatetimeLocal = (value: string): number | null => {
    const v = String(value || "").trim();
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) return null;
    const y = Number(m[1]);
    const mon = Number(m[2]);
    const day = Number(m[3]);
    const h = Number(m[4]);
    const min = Number(m[5]);
    if (!Number.isFinite(y) || !Number.isFinite(mon) || !Number.isFinite(day) || !Number.isFinite(h) || !Number.isFinite(min)) return null;
    const d = new Date(y, mon - 1, day, h, min, 0, 0);
    const ts = d.getTime();
    return Number.isFinite(ts) ? ts : null;
  };

  const openSendMenu = (x: number, y: number) => {
    const st = store.get();
    if (st.modal) return;
    const sel = st.selected;
    if (!sel) {
      store.set({ status: "Выберите контакт или чат слева" });
      return;
    }
    markUserActivity();
    const key = conversationKey(sel);
    const editing = st.editing && key && st.editing.key === key;
    const friend = sel.kind === "dm" ? st.friends.find((f) => f.id === sel.id) : null;
    const friendOnline = Boolean(friend?.online);
    const canSend = Boolean(getComposerFinalText(st));
    const canSendNow = canSend && !editing;
    const whenOnlineAllowed = sel.kind === "dm" && !friendOnline && !editing;
    const items: ContextMenuItem[] = [
      { id: "composer_send_silent", label: "Отправить без звука", icon: "🔕", disabled: !canSendNow },
      { id: "composer_send_schedule", label: "Запланировать", icon: "🗓", disabled: !canSendNow },
      { id: "composer_send_when_online", label: "Когда будет онлайн", icon: "🕓", disabled: !canSend || !whenOnlineAllowed },
    ];
    store.set({
      modal: {
        kind: "context_menu",
        payload: {
          x,
          y,
          title: "Отправка",
          target: { kind: "composer_send", id: sel.id },
          items,
        },
      },
    });
  };

  const openSendScheduleModal = () => {
    const st = store.get();
    if (st.modal) return;
    const sel = st.selected;
    if (!sel) {
      store.set({ status: "Выберите контакт или чат слева" });
      return;
    }
    if (!st.authed) {
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return;
    }
    const key = conversationKey(sel);
    const editing = st.editing && key && st.editing.key === key ? st.editing : null;
    if (editing) {
      store.set({ status: "Сначала завершите редактирование" });
      return;
    }
    const text = getComposerFinalText(st);
    if (!text) {
      store.set({ status: "Введите сообщение" });
      return;
    }
    const replyDraft = st.replyDraft && st.replyDraft.key === key ? st.replyDraft : null;
    const forwardDraft = st.forwardDraft && st.forwardDraft.key === key ? st.forwardDraft : null;
    store.set({
      modal: {
        kind: "send_schedule",
        target: sel,
        text,
        replyDraft,
        forwardDraft,
        suggestedAt: Date.now() + 60 * 60 * 1000,
      },
    });
  };

  layout.sendBtn.addEventListener("contextmenu", (e) => {
    const ev = e as MouseEvent;
    ev.preventDefault();
    openSendMenu(ev.clientX, ev.clientY);
  });

  layout.sendBtn.addEventListener("pointerdown", (e) => {
    const st = store.get();
    if (st.modal) return;
    const ev = e as PointerEvent;
    if (ev.pointerType === "mouse") return;
    if (ev.button !== 0) return;
    clearSendMenuLongPress();
    sendMenuLongPressStartX = ev.clientX;
    sendMenuLongPressStartY = ev.clientY;
    sendMenuLongPressTimer = window.setTimeout(() => {
      sendMenuLongPressTimer = null;
      sendMenuClickSuppression = armCtxClickSuppression(sendMenuClickSuppression, "composer_send", "send", 2000);
      openSendMenu(sendMenuLongPressStartX, sendMenuLongPressStartY);
    }, 520);
  });

  layout.sendBtn.addEventListener("pointermove", (e) => {
    if (sendMenuLongPressTimer === null) return;
    const ev = e as PointerEvent;
    const dx = Math.abs(ev.clientX - sendMenuLongPressStartX);
    const dy = Math.abs(ev.clientY - sendMenuLongPressStartY);
    if (dx > 12 || dy > 12) clearSendMenuLongPress();
  });

  layout.sendBtn.addEventListener("pointerup", () => clearSendMenuLongPress());
  layout.sendBtn.addEventListener("pointercancel", () => clearSendMenuLongPress());
  layout.inputWrap.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;

    const sendBtn = target?.closest("button[data-action='composer-send']") as HTMLButtonElement | null;
    if (sendBtn) {
      const consumed = consumeCtxClickSuppression(sendMenuClickSuppression, "composer_send", "send");
      sendMenuClickSuppression = consumed.state;
      if (consumed.suppressed) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      if (!sendBtn.disabled) sendChat();
      return;
    }

    const btn = target?.closest("button[data-action='composer-edit-cancel']") as HTMLButtonElement | null;
    if (btn) {
      e.preventDefault();
      cancelEditing();
      return;
    }

    const helperBtn = target?.closest("button[data-action='composer-helper-cancel']") as HTMLButtonElement | null;
    if (helperBtn) {
      e.preventDefault();
      clearComposerHelper();
      return;
    }

    const boardToggle = target?.closest("button[data-action='board-editor-toggle']") as HTMLButtonElement | null;
    if (boardToggle) {
      const st = store.get();
      if (!st.selected || st.selected.kind !== "board") return;
      e.preventDefault();
      const b = (st.boards || []).find((x) => x.id === st.selected?.id);
      const owner = String(b?.owner_id || "").trim();
      const me = String(st.selfId || "").trim();
      if (!st.authed) {
        store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
        return;
      }
      if (owner && me && owner !== me) {
        store.set({ status: "На доске писать может только владелец" });
        return;
      }
      store.set((prev) => ({ ...prev, boardComposerOpen: !prev.boardComposerOpen }));
      queueMicrotask(() => {
        scheduleBoardEditorPreview();
        scheduleFocusComposer();
      });
      return;
    }

    const scheduleAddBtn = target?.closest("button[data-action='board-schedule-add']") as HTMLButtonElement | null;
    if (scheduleAddBtn) {
      e.preventDefault();
      const st = store.get();
      const sel = st.selected;
      if (!sel || sel.kind !== "board") return;
      if (!st.authed || !st.selfId) {
        store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
        return;
      }
      const b = (st.boards || []).find((x) => x.id === sel.id);
      const owner = String(b?.owner_id || "").trim();
      const me = String(st.selfId || "").trim();
      if (owner && me && owner !== me) {
        store.set({ status: "На доске писать может только владелец" });
        return;
      }

      const rawText = String(layout.input.value || "").trimEnd();
      const body = rawText.trim();
      if (!body) return;
      if (body.length > APP_MSG_MAX_LEN) {
        store.set({ status: `Слишком длинный пост (${body.length}/${APP_MSG_MAX_LEN})` });
        return;
      }

      const rawWhen = String(layout.boardScheduleInput.value || "").trim();
      const m = rawWhen.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
      if (!m) {
        store.set({ status: "Выберите дату/время" });
        return;
      }
      const y = Number(m[1]);
      const mon = Number(m[2]);
      const day = Number(m[3]);
      const h = Number(m[4]);
      const min = Number(m[5]);
      const when = new Date(y, mon - 1, day, h, min, 0, 0).getTime();
      if (!Number.isFinite(when)) {
        store.set({ status: "Некорректная дата" });
        return;
      }
      const now = Date.now();
      const maxAt = now + maxBoardScheduleDelayMs();
      if (when < now) {
        store.set({ status: "Время уже прошло — выберите будущее" });
        return;
      }
      if (when > maxAt) {
        store.set({ status: "Максимум — 7 дней вперёд" });
        return;
      }

      const id = `sched-${now}-${Math.random().toString(16).slice(2, 10)}`;
      const item = { id, boardId: sel.id, text: rawText, scheduleAt: Math.trunc(when), createdAt: now };
      const nextList = [...(Array.isArray(st.boardScheduledPosts) ? st.boardScheduledPosts : []), item].sort((a, b) => a.scheduleAt - b.scheduleAt);
      store.set((prev) => ({ ...prev, boardScheduledPosts: nextList }));
      saveBoardScheduleForUser(st.selfId, nextList);
      armBoardScheduleTimer();

      layout.boardScheduleInput.value = "";
      store.set((prev) => prev);

      const convKey = conversationKey(sel);
      store.set((prev) => ({ ...prev, input: "", drafts: convKey ? updateDraftMap(prev.drafts, convKey, "") : prev.drafts }));
      scheduleSaveDrafts(store);
      try {
        layout.input.value = "";
        autosizeInput(layout.input);
        layout.input.focus();
        scheduleBoardEditorPreview();
      } catch {
        // ignore
      }
      showToast("Пост запланирован", { kind: "success" });
      return;
    }

    const scheduleClearBtn = target?.closest("button[data-action='board-schedule-clear']") as HTMLButtonElement | null;
    if (scheduleClearBtn) {
      e.preventDefault();
      layout.boardScheduleInput.value = "";
      store.set((prev) => prev);
      return;
    }

    const scheduleCancelBtn = target?.closest("button[data-action='board-schedule-cancel']") as HTMLButtonElement | null;
    if (scheduleCancelBtn) {
      e.preventDefault();
      const id = String(scheduleCancelBtn.getAttribute("data-sched-id") || "").trim();
      const st = store.get();
      if (!id) return;
      const next = (st.boardScheduledPosts || []).filter((x) => x.id !== id);
      if (next.length === (st.boardScheduledPosts || []).length) return;
      store.set((prev) => ({ ...prev, boardScheduledPosts: next }));
      if (st.selfId) saveBoardScheduleForUser(st.selfId, next);
      armBoardScheduleTimer();
      showToast("Запланированная публикация отменена", { kind: "info" });
      return;
    }

    const toolBtn = target?.closest("button[data-action^='board-tool-']") as HTMLButtonElement | null;
    if (!toolBtn) return;
    const action = String(toolBtn.getAttribute("data-action") || "").trim();
    if (!action) return;
    e.preventDefault();

    const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
    const lineStartIndex = (value: string, pos: number) => {
      const i = value.lastIndexOf("\n", Math.max(0, pos - 1));
      return i === -1 ? 0 : i + 1;
    };
    const lineEndIndex = (value: string, pos: number) => {
      const i = value.indexOf("\n", Math.max(0, pos));
      return i === -1 ? value.length : i;
    };
    const prefixCurrentLine = (value: string, caret: number, prefix: string) => {
      const start = lineStartIndex(value, caret);
      const next = value.slice(0, start) + prefix + value.slice(start);
      return { value: next, caret: caret + prefix.length };
    };
    const prefixSelectedLines = (value: string, selStart: number, selEnd: number, prefix: string) => {
      const a = Math.min(selStart, selEnd);
      const b = Math.max(selStart, selEnd);
      const start = lineStartIndex(value, a);
      const end = lineEndIndex(value, b);
      const region = value.slice(start, end);
      const lines = region.split("\n");
      const nextRegion = lines.map((line) => (line ? prefix + line : prefix.trimEnd() ? prefix.trimEnd() : prefix)).join("\n");
      const next = value.slice(0, start) + nextRegion + value.slice(end);
      const added = prefix.length * lines.length;
      return { value: next, caret: b + added };
    };

    const applyValue = (next: { value: string; caret: number }) => {
      layout.input.value = next.value;
      try {
        const caret = clamp(next.caret, 0, next.value.length);
        layout.input.selectionStart = caret;
        layout.input.selectionEnd = caret;
      } catch {
        // ignore
      }
      layout.input.dispatchEvent(new Event("input", { bubbles: true }));
      try {
        layout.input.focus();
      } catch {
        // ignore
      }
    };

    const value = String(layout.input.value || "");
    const start = typeof layout.input.selectionStart === "number" ? layout.input.selectionStart : value.length;
    const end = typeof layout.input.selectionEnd === "number" ? layout.input.selectionEnd : start;

    if (action === "board-tool-heading") {
      applyValue(prefixCurrentLine(value, start, "# "));
      return;
    }
    if (action === "board-tool-list") {
      applyValue(prefixSelectedLines(value, start, end, "• "));
      return;
    }
    if (action === "board-tool-quote") {
      applyValue(prefixSelectedLines(value, start, end, "> "));
      return;
    }
    if (action === "board-tool-divider") {
      const insertText = "\n—\n";
      applyValue(insertTextAtSelection({ value, selectionStart: start, selectionEnd: end, insertText }));
      return;
    }

    const ensureBlockPrefix = (base: string, pos: number) => {
      const before = base.slice(0, Math.max(0, pos));
      if (!before) return "";
      if (before.endsWith("\n\n")) return "";
      if (before.endsWith("\n")) return "\n";
      return "\n\n";
    };
    const insertChangelogBlock = (marker: string) => {
      const prefix = ensureBlockPrefix(value, Math.min(start, end));
      const basePos = Math.min(start, end);
      const insertText = `${prefix}##${marker} \n- `;
      const out = insertTextAtSelection({ value, selectionStart: start, selectionEnd: end, insertText });
      const caret = basePos + prefix.length + 2 + marker.length + 1;
      applyValue({ value: out.value, caret });
    };

    if (action === "board-tool-kind-added") return insertChangelogBlock("+");
    if (action === "board-tool-kind-improved") return insertChangelogBlock("^");
    if (action === "board-tool-kind-fixed") return insertChangelogBlock("!");
    if (action === "board-tool-kind-notes") return insertChangelogBlock("?");
  });

  // Telegram-like UX: paste/drop files прямо в поле ввода.
  layout.input.addEventListener("paste", (e) => {
    const ev = e as ClipboardEvent;
    const dt = ev.clipboardData;
    if (!dt) return;
    const files = Array.from(dt.files || []).map(normalizeClipboardFile);
    if (!files.length) {
      try {
        for (const it of Array.from(dt.items || [])) {
          if (it.kind !== "file") continue;
          const f = it.getAsFile();
          if (f) files.push(normalizeClipboardFile(f));
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
    openFileSendModal(files, st.selected);
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
    openFileSendModal(files, st.selected);
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
        openFileSendModal(files, target);
      },
      { once: true }
    );
    input.click();
  });

  function closeModal() {
    const st = store.get();
    if (!st.modal) return;
    if (st.modal.kind === "file_send") {
      revokeFileSendPreviews(st.modal.previewUrls);
      if (st.modal.restoreInput) restoreComposerInput(st.modal.target, st.modal.restoreInput);
      store.set({ modal: null });
      return;
    }
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
    markUserActivity();

    const canAct = st.conn === "connected" && st.authed;
    const items: ContextMenuItem[] = [];
    let reactionBar: { emojis: string[]; active?: string | null } | undefined;
    let title = "";
    const ak = avatarKindForTarget(target.kind);
    const hasAvatar = ak ? Boolean(getStoredAvatar(ak, target.id)) : false;
    let sepId = 0;
    const addSeparator = () => {
      if (!items.length) return;
      const last = items[items.length - 1];
      if (last?.separator) return;
      sepId += 1;
      items.push({ id: `sep-${sepId}`, label: "", separator: true });
    };
    const addGroup = (group: ContextMenuItem[]) => {
      if (!group.length) return;
      if (items.length) addSeparator();
      items.push(...group);
    };
    const makeItem = (
      id: string,
      label: string,
      icon: string,
      opts: Pick<ContextMenuItem, "danger" | "disabled"> = {}
    ): ContextMenuItem => ({
      id,
      label,
      icon,
      ...opts,
    });

    if (target.kind === "sidebar_tools") {
      title = "Меню";
      const statusLabel = st.conn === "connected" ? "Подключено" : "Нет соединения";
      addGroup([makeItem("sidebar_status", statusLabel, st.conn === "connected" ? "●" : "○", { disabled: true })]);
      addGroup([
        makeItem("sidebar_profile", "Профиль", "☺", { disabled: !canAct }),
        makeItem("sidebar_files", "Файлы", "▦", { disabled: !canAct }),
        makeItem("sidebar_info", "Info", "?", { disabled: false }),
      ]);
      addGroup([
        makeItem("sidebar_create_chat", "Создать чат", "+", { disabled: !canAct }),
        makeItem("sidebar_create_board", "Создать доску", "+", { disabled: !canAct }),
      ]);
      if (st.conn === "connected" && !st.authed) {
        addGroup([makeItem("sidebar_login", "Войти", "→")]);
      } else if (st.authed) {
        addGroup([makeItem("sidebar_logout", "Выход", "⎋", { danger: true })]);
      }
    } else if (target.kind === "dm") {
      title = `Контакт: ${target.id}`;
      const pinKey = dmKey(target.id);
      const unread = st.friends.find((f) => f.id === target.id)?.unread ?? 0;
      const isPinned = st.pinned.includes(pinKey);
      const isMuted = st.muted.includes(target.id);
      const isBlocked = st.blocked.includes(target.id);
      addGroup([
        makeItem("open", "Открыть", "💬"),
        makeItem("profile", "Профиль", "👤"),
        makeItem("pin_toggle", isPinned ? "Открепить" : "Закрепить", isPinned ? "📍" : "📌"),
      ]);
      addGroup([
        makeItem("copy_id", "Скопировать ID", "🆔"),
        makeItem("invite_user", "Пригласить в чат/доску…", "➕", { disabled: !canAct }),
        ...(unread > 0 ? [makeItem("mark_read", "Пометить прочитанным", "✅", { disabled: !canAct })] : []),
      ]);
      addGroup([
        makeItem("avatar_set", hasAvatar ? "Сменить аватар…" : "Установить аватар…", "🖼️"),
        ...(hasAvatar ? [makeItem("avatar_remove", "Удалить аватар", "🗑️", { danger: true })] : []),
      ]);
      addGroup([
        makeItem("mute_toggle", isMuted ? "Включить звук" : "Заглушить", isMuted ? "🔔" : "🔕", { disabled: !canAct }),
        makeItem("block_toggle", isBlocked ? "Разблокировать" : "Заблокировать", isBlocked ? "🔓" : "⛔", {
          disabled: !canAct,
        }),
      ]);
      addGroup([
        makeItem("chat_clear", "Очистить историю", "🧹", { danger: true, disabled: !canAct }),
        makeItem("friend_remove", "Удалить контакт", "🗑️", { danger: true, disabled: !canAct }),
      ]);
    } else if (target.kind === "group") {
      const g = st.groups.find((x) => x.id === target.id);
      const name = String(g?.name || target.id);
      const isOwner = Boolean(g?.owner_id && st.selfId && String(g.owner_id) === String(st.selfId));
      title = `Чат: ${name}`;
      const pinKey = roomKey(target.id);
      const isPinned = st.pinned.includes(pinKey);
      const isMuted = st.muted.includes(target.id);
      addGroup([
        makeItem("open", "Открыть", "💬"),
        makeItem("group_profile", "Профиль чата", "👥"),
      ]);
      addGroup([
        makeItem("pin_toggle", isPinned ? "Открепить" : "Закрепить", isPinned ? "📍" : "📌"),
        makeItem("copy_id", "Скопировать ID", "🆔"),
        makeItem("mute_toggle", isMuted ? "Включить звук" : "Заглушить", isMuted ? "🔔" : "🔕", {
          disabled: !canAct,
        }),
      ]);
      if (isOwner) {
        addGroup([
          makeItem("group_rename", "Переименовать…", "🏷️", { disabled: !canAct }),
          makeItem("group_add_members", "Добавить участников…", "➕", { disabled: !canAct }),
          makeItem("group_remove_members", "Удалить участников…", "➖", { danger: true, disabled: !canAct }),
        ]);
      }
      addGroup([
        makeItem("avatar_set", hasAvatar ? "Сменить аватар…" : "Установить аватар…", "🖼️"),
        ...(hasAvatar ? [makeItem("avatar_remove", "Удалить аватар", "🗑️", { danger: true })] : []),
      ]);
      addGroup([
        isOwner
          ? makeItem("group_disband", "Удалить чат (для всех)", "🗑️", { danger: true, disabled: !canAct })
          : makeItem("group_leave", "Покинуть чат", "🚪", { danger: true, disabled: !canAct }),
      ]);
    } else if (target.kind === "board") {
      const b = st.boards.find((x) => x.id === target.id);
      const name = String(b?.name || target.id);
      const isOwner = Boolean(b?.owner_id && st.selfId && String(b.owner_id) === String(st.selfId));
      title = `Доска: ${name}`;
      const pinKey = roomKey(target.id);
      const isPinned = st.pinned.includes(pinKey);
      const isMuted = st.muted.includes(target.id);
      addGroup([
        makeItem("open", "Открыть", "💬"),
        makeItem("board_profile", "Профиль доски", "📋"),
      ]);
      addGroup([
        makeItem("pin_toggle", isPinned ? "Открепить" : "Закрепить", isPinned ? "📍" : "📌"),
        makeItem("copy_id", "Скопировать ID", "🆔"),
        makeItem("mute_toggle", isMuted ? "Включить звук" : "Заглушить", isMuted ? "🔔" : "🔕", {
          disabled: !canAct,
        }),
      ]);
      if (isOwner) {
        addGroup([
          makeItem("board_rename", "Переименовать…", "✏️", { disabled: !canAct }),
          makeItem("board_add_members", "Добавить участников…", "➕", { disabled: !canAct }),
          makeItem("board_remove_members", "Удалить участников…", "➖", { danger: true, disabled: !canAct }),
        ]);
      }
      addGroup([
        makeItem("avatar_set", hasAvatar ? "Сменить аватар…" : "Установить аватар…", "🖼️"),
        ...(hasAvatar ? [makeItem("avatar_remove", "Удалить аватар", "🗑️", { danger: true })] : []),
      ]);
      addGroup([
        isOwner
          ? makeItem("board_disband", "Удалить доску (для всех)", "🗑️", { danger: true, disabled: !canAct })
          : makeItem("board_leave", "Покинуть доску", "🚪", { danger: true, disabled: !canAct }),
      ]);
    } else if (target.kind === "auth_in") {
      title = `Запрос: ${target.id}`;
      const isBlocked = st.blocked.includes(target.id);
      addGroup([
        makeItem("copy_id", "Скопировать ID", "🆔"),
        makeItem("avatar_set", hasAvatar ? "Сменить аватар…" : "Установить аватар…", "🖼️"),
        ...(hasAvatar ? [makeItem("avatar_remove", "Удалить аватар", "🗑️", { danger: true })] : []),
      ]);
      addGroup([
        makeItem("auth_accept", "Принять", "✅", { disabled: !canAct }),
        makeItem("auth_decline", "Отклонить", "❌", { danger: true, disabled: !canAct }),
        makeItem("block_toggle", isBlocked ? "Разблокировать" : "Заблокировать", isBlocked ? "🔓" : "⛔", {
          disabled: !canAct,
        }),
      ]);
    } else if (target.kind === "auth_out") {
      title = `Ожидает: ${target.id}`;
      addGroup([
        makeItem("copy_id", "Скопировать ID", "🆔"),
        makeItem("avatar_set", hasAvatar ? "Сменить аватар…" : "Установить аватар…", "🖼️"),
        ...(hasAvatar ? [makeItem("avatar_remove", "Удалить аватар", "🗑️", { danger: true })] : []),
      ]);
      addGroup([makeItem("auth_cancel", "Отменить запрос", "❌", { danger: true, disabled: !canAct })]);
    } else if (target.kind === "message") {
      const selKey = st.selected ? conversationKey(st.selected) : "";
      const idx = Number.isFinite(Number(target.id)) ? Math.trunc(Number(target.id)) : -1;
      const conv = selKey ? st.conversations[selKey] : null;
      const msg = conv && idx >= 0 && idx < conv.length ? conv[idx] : null;
      const msgId = msg && typeof msg.id === "number" && Number.isFinite(msg.id) ? msg.id : null;
      const selectionId = msg ? messageSelectionKey(msg) : null;
      const selectionActive = Boolean(st.chatSelection && st.chatSelection.key === selKey);
      const selectionSelected = Boolean(selectionActive && selectionId && st.chatSelection?.ids?.includes(selectionId));
      const canSelect = Boolean(selectionId && msg?.kind !== "sys");
      const canPin = Boolean(selKey && msgId !== null && msgId > 0);
      const isPinned = Boolean(canPin && msgId !== null && isPinnedMessage(st.pinnedMessages, selKey, msgId));
      const mine = typeof msg?.reactions?.mine === "string" ? msg.reactions.mine : null;
      reactionBar = { emojis: ["👍", "❤️", "😂", "😮", "😢", "🔥"], active: mine };

      const preview =
        msg?.attachment?.kind === "file"
          ? `Файл: ${String(msg.attachment.name || "файл")}`
          : String(msg?.text || "").trim() || "Сообщение";
      title = preview.length > 64 ? `${preview.slice(0, 61)}…` : preview;

      const fromId = msg?.from ? String(msg.from).trim() : "";
      const caption = msg?.attachment?.kind === "file" ? String(msg?.text || "").trim() : "";
      const copyLabel =
        msg?.attachment?.kind === "file"
          ? caption
            ? "Скопировать подпись"
            : "Скопировать имя файла"
          : "Скопировать текст";
      const canEdit = Boolean(canPin && msg?.kind === "out" && st.selfId && String(msg.from) === String(st.selfId));
      const canDeleteForAll = Boolean(canPin && canAct && msg?.kind === "out" && st.selfId && String(msg.from) === String(st.selfId));
      const canReply = Boolean(msg && msg.kind !== "sys");
      const helperBlocked = Boolean(st.editing);
      const primary: ContextMenuItem[] = [];
      if (fromId) primary.push(makeItem("msg_profile", "Профиль отправителя", "👤", { disabled: !canAct }));
      primary.push(
        makeItem(
          "msg_select_toggle",
          selectionSelected ? "Снять выбор" : "Выбрать",
          selectionSelected ? "☑️" : "✅",
          { disabled: !canSelect }
        )
      );
      primary.push(makeItem("msg_copy", copyLabel, "📋", { disabled: !msg }));
      primary.push(makeItem("msg_reply", "Ответить", "↩", { disabled: !canReply || helperBlocked }));
      primary.push(makeItem("msg_forward", "Переслать", "↪", { disabled: !canReply || helperBlocked }));
      addGroup(primary);

      const editGroup: ContextMenuItem[] = [
        makeItem("msg_pin_toggle", isPinned ? "Открепить" : "Закрепить", isPinned ? "📍" : "📌", {
          disabled: !canPin,
        }),
      ];
      if (canEdit) {
        editGroup.push(
          makeItem("msg_edit", msg?.attachment ? "Изменить подпись…" : "Изменить…", st.selected?.kind === "board" ? "✏️" : "🛠️", {
            disabled: !canAct,
          })
        );
      }
      addGroup(editGroup);

      const dangerGroup: ContextMenuItem[] = [makeItem("msg_delete_local", "Удалить у меня", "🧹", { danger: true, disabled: !msg })];
      if (canDeleteForAll) {
        dangerGroup.push(makeItem("msg_delete", "Удалить", "🗑️", { danger: true, disabled: !canAct }));
      }
      addGroup(dangerGroup);
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
          ...(reactionBar ? { reactionBar } : {}),
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

    if (itemId === "composer_send_when_online") {
      close();
      sendChat({ mode: "when_online" });
      return;
    }
    if (itemId === "composer_send_silent") {
      close();
      sendChat({ silent: true });
      return;
    }
    if (itemId === "composer_send_schedule") {
      close();
      openSendScheduleModal();
      return;
    }

    if (itemId === "sidebar_profile") {
      close();
      setPage("profile");
      const stSnapshot = store.get();
      if (stSnapshot.authed && stSnapshot.conn === "connected") {
        gateway.send({ type: "profile_get" });
      }
      return;
    }
    if (itemId === "sidebar_files") {
      close();
      setPage("files");
      return;
    }
    if (itemId === "sidebar_info") {
      close();
      setPage("help");
      return;
    }
    if (itemId === "sidebar_create_chat") {
      close();
      openGroupCreateModal();
      return;
    }
    if (itemId === "sidebar_create_board") {
      close();
      openBoardCreateModal();
      return;
    }
    if (itemId === "sidebar_login") {
      close();
      store.set((prev) => ({
        ...prev,
        authMode: prev.authRememberedId ? "login" : "register",
        modal: { kind: "auth" },
      }));
      return;
    }
    if (itemId === "sidebar_logout") {
      close();
      logout();
      return;
    }

    if (itemId.startsWith("react:")) {
      if (t.kind !== "message") {
        close();
        return;
      }
      const emoji = String(itemId.slice("react:".length) || "").trim();
      if (!emoji) {
        close();
        return;
      }
      if (st.conn !== "connected") {
        store.set({ status: "Нет соединения" });
        close();
        return;
      }
      if (!st.authed) {
        store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
        return;
      }
      const selKey = st.selected ? conversationKey(st.selected) : "";
      const idx = Number.isFinite(Number(t.id)) ? Math.trunc(Number(t.id)) : -1;
      const conv = selKey ? st.conversations[selKey] : null;
      const msg = conv && idx >= 0 && idx < conv.length ? conv[idx] : null;
      const msgId = msg && typeof msg.id === "number" && Number.isFinite(msg.id) ? msg.id : null;
      if (!msg || msgId === null || msgId <= 0) {
        close();
        return;
      }
      const mine = typeof msg.reactions?.mine === "string" ? msg.reactions.mine : null;
      const nextEmoji = mine === emoji ? null : emoji;
      gateway.send({ type: "reaction_set", id: msgId, emoji: nextEmoji });
      close();
      return;
    }

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

    if (itemId === "msg_profile") {
      if (t.kind !== "message") {
        close();
        return;
      }
      const selKey = st.selected ? conversationKey(st.selected) : "";
      const idx = Number.isFinite(Number(t.id)) ? Math.trunc(Number(t.id)) : -1;
      const conv = selKey ? st.conversations[selKey] : null;
      const msg = conv && idx >= 0 && idx < conv.length ? conv[idx] : null;
      const fromId = msg?.from ? String(msg.from).trim() : "";
      if (fromId) openUserPage(fromId);
      close();
      return;
    }

    if (itemId === "profile") {
      if (t.kind !== "dm") {
        close();
        return;
      }
      openUserPage(t.id);
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

    if (itemId === "group_profile" && t.kind === "group") {
      openGroupPage(t.id);
      close();
      return;
    }
    if (itemId === "board_profile" && t.kind === "board") {
      openBoardPage(t.id);
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

      if (itemId === "msg_select_toggle") {
        if (!selKey || !msg) {
          close();
          return;
        }
        toggleChatSelection(selKey, msg);
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

      if (itemId === "msg_reply" || itemId === "msg_forward") {
        if (!selKey || !msg) {
          close();
          return;
        }
        const draft = buildHelperDraft(st, selKey, msg);
        if (!draft) {
          close();
          return;
        }
        if (itemId === "msg_reply") {
          store.set({ replyDraft: draft, forwardDraft: null });
        } else {
          store.set({ forwardDraft: draft, replyDraft: null });
        }
        scheduleFocusComposer();
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
        groupViewId: st.groupViewId,
        boardViewId: st.boardViewId,
        selected: st.selected,
        input,
        drafts: st.drafts,
        pinned: st.pinned,
        chatSearchOpen: st.chatSearchOpen,
        chatSearchQuery: st.chatSearchQuery,
        chatSearchDate: st.chatSearchDate,
        chatSearchFilter: st.chatSearchFilter,
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
        groupViewId?: string | null;
        boardViewId?: string | null;
        selected?: TargetRef | null;
        input?: string;
        drafts?: Record<string, string>;
        pinned?: string[];
        chatSearchOpen?: boolean;
        chatSearchQuery?: string;
        chatSearchDate?: string;
        chatSearchFilter?: ChatSearchFilter;
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

      const page: PageKind | undefined = ["main", "search", "profile", "user", "group", "board", "files"].includes(obj.page) ? obj.page : undefined;
      const userViewId = typeof obj.userViewId === "string" && obj.userViewId.trim() ? obj.userViewId.trim() : null;
      const groupViewId = typeof obj.groupViewId === "string" && obj.groupViewId.trim() ? obj.groupViewId.trim() : null;
      const boardViewId = typeof obj.boardViewId === "string" && obj.boardViewId.trim() ? obj.boardViewId.trim() : null;

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
      const chatSearchDate = typeof obj.chatSearchDate === "string" ? obj.chatSearchDate : "";
      const chatSearchFilter =
        typeof obj.chatSearchFilter === "string" && ["all", "media", "files", "links", "audio"].includes(obj.chatSearchFilter)
          ? (obj.chatSearchFilter as ChatSearchFilter)
          : "all";
      const chatSearchPos = Number.isFinite(obj.chatSearchPos) ? Math.trunc(obj.chatSearchPos) : 0;
      const searchQuery = typeof obj.searchQuery === "string" ? obj.searchQuery : "";
      const profileDraftDisplayName = typeof obj.profileDraftDisplayName === "string" ? obj.profileDraftDisplayName : "";
      const profileDraftHandle = typeof obj.profileDraftHandle === "string" ? obj.profileDraftHandle : "";
      const profileDraftBio = typeof obj.profileDraftBio === "string" ? obj.profileDraftBio : "";
      const profileDraftStatus = typeof obj.profileDraftStatus === "string" ? obj.profileDraftStatus : "";

      return {
        page,
        userViewId,
        groupViewId,
        boardViewId,
        selected,
        input,
        drafts,
        pinned,
        chatSearchOpen,
        chatSearchQuery,
        chatSearchDate,
        chatSearchFilter,
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

  async function forcePwaUpdate() {
    if (pwaForceInFlight) return;
    if (!("serviceWorker" in navigator)) {
      store.set({ status: "PWA обновление недоступно в этом браузере" });
      return;
    }
    pwaForceInFlight = true;
    store.set({ status: "Принудительное обновление PWA…" });
    try {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) await reg.update();
      } catch {
        // ignore
      }
      await applyPwaUpdateNow();
    } finally {
      pwaForceInFlight = false;
    }
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

  window.addEventListener("yagodka:pwa-sw-error", (ev) => {
    const detail = (ev as CustomEvent<any>).detail;
    const err = String(detail?.error ?? "").trim();
    if (!err) return;
    const st = store.get();
    if (st.pwaPushSubscribed) return;
    store.set({ pwaPushStatus: `Service Worker: ${err}` });
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
    if (key === "F10") {
      if (st.authed) {
        logout();
        return;
      }
      store.set((prev) => ({
        ...prev,
        authMode: prev.authRememberedId ? "login" : "register",
        modal: { kind: "auth" },
      }));
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
    if (key === "F12") {
      debugHud.toggle();
      store.set({ status: debugHud.isEnabled() ? "Debug HUD: включён" : "Debug HUD: выключен" });
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

    if (st.modal?.kind === "file_viewer") {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        navigateFileViewer("prev");
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        navigateFileViewer("next");
        return;
      }
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
      if (!st.modal && (mobileSidebarOpen || floatingSidebarOpen)) {
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
      if (st.rightPanel) {
        e.preventDefault();
        closeRightPanel();
        return;
      }
      if (st.page !== "main") {
        e.preventDefault();
        setPage("main");
      }
      return;
    }

    if (e.key === "F10" && e.shiftKey) return;

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
    if (typeof document !== "undefined") {
      document.documentElement.dataset.sidebarClickSuppressUntil = String(Date.now() + ms);
    }
    suppressSidebarClickTimer = window.setTimeout(() => {
      suppressSidebarClick = false;
      suppressSidebarClickTimer = null;
      if (typeof document !== "undefined") {
        delete document.documentElement.dataset.sidebarClickSuppressUntil;
      }
    }, ms);
  }

  function disarmSidebarClickSuppression() {
    suppressSidebarClick = false;
    if (suppressSidebarClickTimer !== null) {
      window.clearTimeout(suppressSidebarClickTimer);
      suppressSidebarClickTimer = null;
    }
    if (typeof document !== "undefined") {
      delete document.documentElement.dataset.sidebarClickSuppressUntil;
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
    sidebarCtxPrevTop = layout.sidebarBody.scrollTop;
    sidebarCtxPrevLeft = layout.sidebarBody.scrollLeft;
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
      curTop: layout.sidebarBody.scrollTop,
      curLeft: layout.sidebarBody.scrollLeft,
      prevTop: sidebarCtxPrevTop,
      prevLeft: sidebarCtxPrevLeft,
      prevAt: sidebarCtxPrevAt,
      hasPrev: sidebarCtxHasPrev,
      maxAgeMs: SIDEBAR_CTX_SCROLL_MAX_AGE_MS,
    });
    return { top: r.top, left: r.left };
  }

  function restoreSidebarCtxScroll(top: number, left: number) {
    if (layout.sidebarBody.scrollTop !== top) layout.sidebarBody.scrollTop = top;
    if (layout.sidebarBody.scrollLeft !== left) layout.sidebarBody.scrollLeft = left;
  }

  const sidebarCtxScrollLock = createRafScrollLock({
    restore: restoreSidebarCtxScroll,
    requestAnimationFrame: (cb) => window.requestAnimationFrame(cb),
    cancelAnimationFrame: (id) => window.cancelAnimationFrame(id),
  });

  let sidebarCtxHoldTimer: number | null = null;

  function disarmSidebarCtxScrollHold() {
    if (sidebarCtxHoldTimer !== null) {
      window.clearTimeout(sidebarCtxHoldTimer);
      sidebarCtxHoldTimer = null;
    }
    sidebarCtxScrollLock.stop();
  }

  function armSidebarCtxScrollHold(top: number, left: number) {
    sidebarCtxScrollLock.start(top, left);
    if (sidebarCtxHoldTimer !== null) {
      window.clearTimeout(sidebarCtxHoldTimer);
      sidebarCtxHoldTimer = null;
    }
    // Если по какой-то причине контекстное меню не открылось, не держим лок бесконечно.
    sidebarCtxHoldTimer = window.setTimeout(() => {
      sidebarCtxHoldTimer = null;
      const st = store.get();
      if (st.modal && st.modal.kind === "context_menu") return;
      sidebarCtxScrollLock.stop();
    }, 900);
  }

  store.subscribe(() => {
    const st = store.get();
    if (!st.modal || st.modal.kind !== "context_menu") disarmSidebarCtxScrollHold();
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
      armSidebarCtxScrollHold(top, left);
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
      armSidebarCtxScrollHold(top, left);
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
    const isTouchContext = Boolean(coarsePointerMq?.matches) && (e as MouseEvent).button === 0;
    if (isTouchContext) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
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
      disarmSidebarCtxScrollHold();
      return;
    }
    // Extra stabilization: restore/lock scroll *before* rendering the menu to avoid rare jumps.
    stabilizeSidebarScrollOnContextClick(prevTop, prevLeft);
    armSidebarCtxScrollHold(prevTop, prevLeft);
    const kind = (btn.getAttribute("data-ctx-kind") || "").trim() as ContextMenuTargetKind;
    const id = (btn.getAttribute("data-ctx-id") || "").trim();
    if (!kind || !id) return;
    sidebarCtxClickSuppression = armCtxClickSuppression(sidebarCtxClickSuppression, kind, id, 1800);
    openContextMenu({ kind, id }, e.clientX, e.clientY);
    // Подстраховка от "скачков" скролла на некоторых браузерах при открытии контекстного меню.

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

  // Mobile: swipe left/right on the sidebar list switches tabs (Telegram-like).
  const MOBILE_SIDEBAR_TAB_ORDER: MobileSidebarTab[] = ["contacts", "boards", "chats", "menu"];
  let sidebarSwipePointerId: number | null = null;
  let sidebarSwipeStartX = 0;
  let sidebarSwipeStartY = 0;
  let sidebarSwipeStartAt = 0;
  let sidebarSwipeLastX = 0;
  let sidebarSwipeLastY = 0;
  let sidebarSwipeHorizontal = false;
  let sidebarSwipeLockUntil = 0;
  let sidebarSwipeScrollWasHidden = false;

  const resetSidebarSwipe = () => {
    sidebarSwipePointerId = null;
    sidebarSwipeStartX = 0;
    sidebarSwipeStartY = 0;
    sidebarSwipeStartAt = 0;
    sidebarSwipeLastX = 0;
    sidebarSwipeLastY = 0;
    sidebarSwipeHorizontal = false;
  };

  const clearSidebarSwipeFx = () => {
    const sidebar = layout.sidebar;
    if (sidebarSwipeScrollWasHidden) {
      sidebarSwipeScrollWasHidden = false;
      layout.sidebarBody.style.overflowY = "";
    }
    delete sidebar.dataset.swipeActive;
    delete sidebar.dataset.swipeAnim;
    sidebar.style.removeProperty("--sidebar-swipe-x");
    sidebar.style.removeProperty("--sidebar-swipe-scale");
    sidebar.style.removeProperty("--sidebar-swipe-opacity");
  };

  const setSidebarSwipeFx = (xPx: number, opts?: { anim?: boolean; scale?: number; opacity?: number }) => {
    const anim = Boolean(opts?.anim);
    const scale = Number.isFinite(opts?.scale) ? Number(opts?.scale) : 1;
    const opacity = Number.isFinite(opts?.opacity) ? Number(opts?.opacity) : 1;
    const sidebar = layout.sidebar;
    sidebar.dataset.swipeActive = "1";
    if (anim) sidebar.dataset.swipeAnim = "1";
    else delete sidebar.dataset.swipeAnim;
    sidebar.style.setProperty("--sidebar-swipe-x", `${Math.round(xPx)}px`);
    sidebar.style.setProperty("--sidebar-swipe-scale", String(Math.max(0.9, Math.min(1, scale))));
    sidebar.style.setProperty("--sidebar-swipe-opacity", String(Math.max(0.3, Math.min(1, opacity))));
  };

  const canUseSidebarTabSwipe = (ev: PointerEvent, target: HTMLElement | null): boolean => {
    const st = store.get();
    if (st.modal) return false;
    if (!mobileSidebarMq.matches) return false;
    if (!mobileSidebarOpen) return false;
    if (Date.now() < sidebarSwipeLockUntil) return false;
    if (ev.pointerType === "mouse") return false;
    if (ev.button !== 0) return false;
    if (!target) return false;
    if ((target as HTMLElement).isContentEditable) return false;
    if (target.closest(".sidebar-searchbar")) return false;
    if (target.closest(".sidebar-tabs")) return false;
    if (target.closest("button[data-action='sidebar-close']")) return false;

    const vw = Math.max(0, document.documentElement.clientWidth || window.innerWidth || 0);
    const edge = Math.min(28, Math.max(18, Math.round(vw * 0.06)));
    if (vw > 0 && (ev.clientX <= edge || ev.clientX >= vw - edge)) return false;
    return true;
  };

  const sidebarSwipeThresholdPx = (): number => {
    const vw = Math.max(0, document.documentElement.clientWidth || window.innerWidth || 0);
    if (!vw) return 64;
    return Math.round(Math.min(110, Math.max(50, vw * 0.14)));
  };

  const stepMobileSidebarTab = (dir: -1 | 1) => {
    const cur = store.get().mobileSidebarTab;
    const idx = MOBILE_SIDEBAR_TAB_ORDER.indexOf(cur);
    const safeIdx = idx >= 0 ? idx : MOBILE_SIDEBAR_TAB_ORDER.indexOf("chats");
    const nextIdx = safeIdx + dir;
    if (nextIdx < 0 || nextIdx >= MOBILE_SIDEBAR_TAB_ORDER.length) return;
    setMobileSidebarTab(MOBILE_SIDEBAR_TAB_ORDER[nextIdx]);
  };

  const nextMobileSidebarTab = (dir: -1 | 1): MobileSidebarTab | null => {
    const cur = store.get().mobileSidebarTab;
    const idx = MOBILE_SIDEBAR_TAB_ORDER.indexOf(cur);
    const safeIdx = idx >= 0 ? idx : MOBILE_SIDEBAR_TAB_ORDER.indexOf("chats");
    const nextIdx = safeIdx + dir;
    if (nextIdx < 0 || nextIdx >= MOBILE_SIDEBAR_TAB_ORDER.length) return null;
    return MOBILE_SIDEBAR_TAB_ORDER[nextIdx] || null;
  };

  const sidebarSwipeWidth = (): number => {
    const rect = layout.sidebar.getBoundingClientRect();
    const w = Math.round(rect.width || 0);
    return w > 0 ? w : Math.max(0, document.documentElement.clientWidth || window.innerWidth || 0);
  };

  const applySwipeResistance = (dx: number): number => {
    const w = sidebarSwipeWidth() || 1;
    const softMax = Math.max(72, Math.round(w * 0.28));
    const adx = Math.abs(dx);
    if (adx <= softMax) return dx;
    const extra = adx - softMax;
    return Math.sign(dx) * (softMax + extra * 0.22);
  };

  const applySidebarSwipeDragFx = (dx: number) => {
    const w = sidebarSwipeWidth() || 1;
    const x = applySwipeResistance(dx);
    const progress = Math.min(1, Math.abs(dx) / w);
    const scale = 1 - 0.025 * progress;
    const opacity = 1 - 0.1 * progress;
    setSidebarSwipeFx(x, { anim: false, scale, opacity });
  };

  const afterSidebarSwipeTransition = (cb: () => void, timeoutMs = 260) => {
    let done = false;
    let timer = 0;
    const body = layout.sidebarBody;
    const sticky = layout.sidebar.querySelector(".sidebar-mobile-sticky") as HTMLElement | null;
    const finish = () => {
      if (done) return;
      done = true;
      body.removeEventListener("transitionend", onEnd);
      sticky?.removeEventListener("transitionend", onEnd);
      window.clearTimeout(timer);
      cb();
    };
    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName !== "transform") return;
      finish();
    };
    body.addEventListener("transitionend", onEnd);
    sticky?.addEventListener("transitionend", onEnd);
    timer = window.setTimeout(finish, timeoutMs);
  };

  const snapSidebarSwipeBack = () => {
    setSidebarSwipeFx(0, { anim: true, scale: 1, opacity: 1 });
    afterSidebarSwipeTransition(() => clearSidebarSwipeFx());
  };

  const runSidebarSwipeCommit = (dir: -1 | 1) => {
    const nextTab = nextMobileSidebarTab(dir);
    if (!nextTab) {
      snapSidebarSwipeBack();
      return;
    }

    const w = sidebarSwipeWidth();
    const outX = dir === 1 ? -w : w;
    sidebarSwipeLockUntil = Date.now() + 650;
    armSidebarClickSuppression(650);

    setSidebarSwipeFx(outX, { anim: true, scale: 0.98, opacity: 0.6 });
    afterSidebarSwipeTransition(() => {
      // Put the next tab offscreen without animation, then render it.
      setSidebarSwipeFx(-outX, { anim: false, scale: 0.98, opacity: 0.6 });
      store.set({ mobileSidebarTab: nextTab });
      // Animate the new tab into place.
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          setSidebarSwipeFx(0, { anim: true, scale: 1, opacity: 1 });
          afterSidebarSwipeTransition(() => clearSidebarSwipeFx(), 320);
        });
      });
    }, 320);
  };

  layout.sidebarBody.addEventListener("pointerdown", (e) => {
    const ev = e as PointerEvent;
    const target = ev.target as HTMLElement | null;
    if (!canUseSidebarTabSwipe(ev, target)) return;
    clearSidebarSwipeFx();
    resetSidebarSwipe();
    sidebarSwipePointerId = ev.pointerId;
    sidebarSwipeStartX = ev.clientX;
    sidebarSwipeStartY = ev.clientY;
    sidebarSwipeStartAt = Date.now();
    sidebarSwipeLastX = ev.clientX;
    sidebarSwipeLastY = ev.clientY;
  });

  layout.sidebarBody.addEventListener("pointermove", (e) => {
    if (sidebarSwipePointerId === null) return;
    const ev = e as PointerEvent;
    if (ev.pointerId !== sidebarSwipePointerId) return;
    sidebarSwipeLastX = ev.clientX;
    sidebarSwipeLastY = ev.clientY;

    const dx = ev.clientX - sidebarSwipeStartX;
    const dy = ev.clientY - sidebarSwipeStartY;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);

    if (!sidebarSwipeHorizontal) {
      // If the user scrolls vertically, stop tracking this gesture as a tab swipe.
      if (ady > 14 && ady > adx + 6) {
        clearSidebarSwipeFx();
        resetSidebarSwipe();
        return;
      }
      // If the movement is clearly horizontal, treat it as a swipe gesture.
      if (adx > 14 && adx > ady + 6) {
        sidebarSwipeHorizontal = true;
        clearLongPress();
        if (!sidebarSwipeScrollWasHidden) {
          sidebarSwipeScrollWasHidden = true;
          layout.sidebarBody.style.overflowY = "hidden";
        }
      }
      return;
    }

    applySidebarSwipeDragFx(dx);

    // Too diagonal/vertical movement -> cancel to avoid accidental tab switch.
    if (ady > 140) {
      snapSidebarSwipeBack();
      resetSidebarSwipe();
    }
  });

  const consumeSidebarSwipe = (ev: PointerEvent): boolean => {
    if (sidebarSwipePointerId === null) return false;
    if (ev.pointerId !== sidebarSwipePointerId) return false;
    const dx = sidebarSwipeLastX - sidebarSwipeStartX;
    const dy = sidebarSwipeLastY - sidebarSwipeStartY;
    const dt = Date.now() - sidebarSwipeStartAt;
    resetSidebarSwipe();

    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    const threshold = sidebarSwipeThresholdPx();
    if (dt > 900) {
      snapSidebarSwipeBack();
      return false;
    }

    const vel = adx / Math.max(1, dt); // px/ms
    const fast = vel > 0.9 && adx > 34;
    const strongHorizontal = adx >= ady * 1.5;
    const shouldCommit = strongHorizontal && (adx >= threshold || fast);
    if (!shouldCommit) {
      snapSidebarSwipeBack();
      return false;
    }

    // Telegram-like: swipe left -> next tab (to the right), swipe right -> prev tab.
    runSidebarSwipeCommit(dx < 0 ? 1 : -1);
    return true;
  };

  layout.sidebarBody.addEventListener("pointerup", (e) => void consumeSidebarSwipe(e as PointerEvent));
  layout.sidebarBody.addEventListener("pointercancel", () => {
    clearSidebarSwipeFx();
    resetSidebarSwipe();
  });

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
        const suppressUntil = Date.now() + 2400;
        btn.setAttribute("data-ctx-suppress-until", String(suppressUntil));
        if (typeof document !== "undefined" && document.documentElement) {
          document.documentElement.dataset.sidebarLongPressUntil = String(suppressUntil);
        }
        armSidebarClickSuppression(2400);
        const prevTop = layout.sidebarBody.scrollTop;
        const prevLeft = layout.sidebarBody.scrollLeft;
        sidebarCtxClickSuppression = armCtxClickSuppression(sidebarCtxClickSuppression, kind, id, 2400);
        openContextMenu({ kind, id }, longPressStartX, longPressStartY);
        window.requestAnimationFrame(() => {
          if (layout.sidebarBody.scrollTop !== prevTop) layout.sidebarBody.scrollTop = prevTop;
          if (layout.sidebarBody.scrollLeft !== prevLeft) layout.sidebarBody.scrollLeft = prevLeft;
      });
      window.setTimeout(() => {
        if (layout.sidebarBody.scrollTop !== prevTop) layout.sidebarBody.scrollTop = prevTop;
        if (layout.sidebarBody.scrollLeft !== prevLeft) layout.sidebarBody.scrollLeft = prevLeft;
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
  layout.sidebarBody.addEventListener(
    "scroll",
    () => {
      clearSidebarSwipeFx();
      resetSidebarSwipe();
      clearLongPress();
    },
    { passive: true }
  );

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
      const root = typeof document !== "undefined" ? document.documentElement : null;
      const longPressUntil = Number(root?.dataset.sidebarLongPressUntil || 0);
      const longPressSuppressed = Number.isFinite(longPressUntil) && longPressUntil > Date.now();
      const shouldSuppress = suppressSidebarClick || keySuppressed || longPressSuppressed;
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
    const isTouchContext = Boolean(coarsePointerMq?.matches) && (e as MouseEvent).button === 0;
    if (isTouchContext) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
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

  let msgSwipeRow: HTMLElement | null = null;
  let msgSwipeIdx = -1;
  let msgSwipeKey = "";
  let msgSwipePointerId: number | null = null;
  let msgSwipeStartX = 0;
  let msgSwipeStartY = 0;
  let msgSwipeActive = false;
  const MSG_SWIPE_ACTIVATE = 10;
  const MSG_SWIPE_TRIGGER = 56;
  const MSG_SWIPE_MAX = 84;
  const resetMsgSwipe = () => {
    if (msgSwipeRow) {
      msgSwipeRow.style.setProperty("--msg-swipe-x", "0px");
      msgSwipeRow.style.setProperty("--msg-swipe-alpha", "0");
      msgSwipeRow.removeAttribute("data-reply-swipe");
    }
    msgSwipeRow = null;
    msgSwipeIdx = -1;
    msgSwipeKey = "";
    msgSwipePointerId = null;
    msgSwipeActive = false;
  };
  const applyMsgSwipe = (dx: number) => {
    if (!msgSwipeRow) return;
    const clamped = Math.max(0, Math.min(MSG_SWIPE_MAX, dx));
    const alpha = Math.max(0, Math.min(1, clamped / MSG_SWIPE_TRIGGER));
    msgSwipeRow.style.setProperty("--msg-swipe-x", `${clamped}px`);
    msgSwipeRow.style.setProperty("--msg-swipe-alpha", String(alpha));
    msgSwipeRow.setAttribute("data-reply-swipe", "1");
  };

  layout.chat.addEventListener("pointerdown", (e) => {
    const st = store.get();
    if (st.modal) return;
    if (!st.selected) return;
    if (st.editing) return;
    if (Date.now() < suppressChatClickUntil) return;
    const ev = e as PointerEvent;
    if (ev.pointerType === "mouse") return;
    if (ev.button !== 0) return;
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    if (target.closest("button, a, input, textarea, [contenteditable='true']")) return;
    const row = target.closest("[data-msg-idx]") as HTMLElement | null;
    if (!row) return;
    const idx = Math.trunc(Number(row.getAttribute("data-msg-idx") || ""));
    if (!Number.isFinite(idx) || idx < 0) return;
    const key = conversationKey(st.selected);
    if (!key) return;
    const conv = st.conversations[key] || null;
    const msg = conv && idx >= 0 && idx < conv.length ? conv[idx] : null;
    if (!msg || msg.kind === "sys") return;
    msgSwipeRow = row;
    msgSwipeIdx = idx;
    msgSwipeKey = key;
    msgSwipePointerId = ev.pointerId;
    msgSwipeStartX = ev.clientX;
    msgSwipeStartY = ev.clientY;
    msgSwipeActive = false;
  });

  layout.chat.addEventListener(
    "pointermove",
    (e) => {
      if (!msgSwipeRow || msgSwipePointerId === null) return;
      const ev = e as PointerEvent;
      if (ev.pointerId !== msgSwipePointerId) return;
      const dx = ev.clientX - msgSwipeStartX;
      const dy = ev.clientY - msgSwipeStartY;
      if (!msgSwipeActive) {
        if (dx < MSG_SWIPE_ACTIVATE) return;
        if (Math.abs(dx) < Math.abs(dy) + 12) return;
        msgSwipeActive = true;
        clearMsgLongPress();
      }
      if (dx <= 0) {
        applyMsgSwipe(0);
        return;
      }
      applyMsgSwipe(dx);
      ev.preventDefault();
    },
    { passive: false }
  );

  layout.chat.addEventListener("pointerup", (e) => {
    if (!msgSwipeRow || msgSwipePointerId === null) return;
    const ev = e as PointerEvent;
    if (ev.pointerId !== msgSwipePointerId) return;
    const dx = ev.clientX - msgSwipeStartX;
    const shouldReply = msgSwipeActive && dx >= MSG_SWIPE_TRIGGER;
    if (shouldReply) {
      const st = store.get();
      if (!st.editing && st.selected && msgSwipeKey) {
        const key = conversationKey(st.selected);
        if (key && key === msgSwipeKey) {
          const conv = st.conversations[key] || null;
          const msg = conv && msgSwipeIdx >= 0 && msgSwipeIdx < conv.length ? conv[msgSwipeIdx] : null;
          const draft = msg ? buildHelperDraft(st, key, msg) : null;
          if (draft) {
            suppressChatClickUntil = Date.now() + 800;
            store.set({ replyDraft: draft, forwardDraft: null });
            scheduleFocusComposer();
          }
        }
      }
    }
    resetMsgSwipe();
  });

  layout.chat.addEventListener("pointercancel", () => resetMsgSwipe());
  layout.chatHost.addEventListener("scroll", () => resetMsgSwipe(), { passive: true });

  layout.chat.addEventListener("pointerdown", (e) => {
    const st = store.get();
    if (st.modal) return;
    if (!st.selected) return;
    if (st.chatSelection && st.selected && st.chatSelection.key === conversationKey(st.selected)) return;
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
      suppressChatClickUntil = Date.now() + 1200;
      const stSnapshot = store.get();
      if (!stSnapshot.selected) return;
      const selKey = conversationKey(stSnapshot.selected);
      if (!selKey) return;
      const idxNum = Math.trunc(Number(msgLongPressIdx));
      if (!Number.isFinite(idxNum) || idxNum < 0) return;
      const conv = stSnapshot.conversations[selKey] || null;
      const msg = conv && idxNum >= 0 && idxNum < conv.length ? conv[idxNum] : null;
      if (!msg || msg.kind === "sys") return;
      toggleChatSelection(selKey, msg);
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
    onCloseRightPanel: () => closeRightPanel(),
    onOpenActionModal: (payload: ActionModalPayload) => openActionModal(payload),
    onOpenHelp: () => setPage("help"),
    onOpenGroupCreate: () => openGroupCreateModal(),
    onOpenBoardCreate: () => openBoardCreateModal(),
    onSetPage: (page: PageKind) => {
      setPage(page);
      const st = store.get();
      if (page === "profile" && st.authed && st.conn === "connected") {
        gateway.send({ type: "profile_get" });
      } else if (page === "group" && st.authed && st.conn === "connected" && st.groupViewId) {
        gateway.send({ type: "group_info", group_id: st.groupViewId });
      } else if (page === "board" && st.authed && st.conn === "connected" && st.boardViewId) {
        gateway.send({ type: "board_info", board_id: st.boardViewId });
      }
    },
    onOpenSidebarToolsMenu: (x: number, y: number) => openContextMenu({ kind: "sidebar_tools", id: "main" }, x, y),
    onRoomMemberRemove: (kind: TargetRef["kind"], roomId: string, memberId: string) => {
      const st = store.get();
      const rid = String(roomId || "").trim();
      const mid = String(memberId || "").trim();
      if (!rid || !mid) return;
      if (st.conn !== "connected" || !st.authed) {
        store.set({ status: "Нет соединения" });
        return;
      }
      if (kind === "group") {
        const g = st.groups.find((x) => x.id === rid);
        const isOwner = Boolean(g?.owner_id && st.selfId && String(g.owner_id) === String(st.selfId));
        if (!isOwner) {
          store.set({ status: "Только владелец может удалять участников" });
          return;
        }
        openConfirmModal({
          title: "Удалить участника?",
          message: `Удалить ${mid} из чата?`,
          confirmLabel: "Удалить",
          danger: true,
          action: { kind: "group_member_remove", groupId: rid, memberId: mid },
        });
        return;
      }
      if (kind === "board") {
        const b = st.boards.find((x) => x.id === rid);
        const isOwner = Boolean(b?.owner_id && st.selfId && String(b.owner_id) === String(st.selfId));
        if (!isOwner) {
          store.set({ status: "Только владелец может удалять участников" });
          return;
        }
        openConfirmModal({
          title: "Удалить участника?",
          message: `Удалить ${mid} из доски?`,
          confirmLabel: "Удалить",
          danger: true,
          action: { kind: "board_member_remove", boardId: rid, memberId: mid },
        });
      }
    },
    onBlockToggle: (memberId: string) => {
      const st = store.get();
      const mid = String(memberId || "").trim();
      if (!mid) return;
      if (st.conn !== "connected" || !st.authed) {
        store.set({ status: "Нет соединения" });
        return;
      }
      const nextValue = !st.blocked.includes(mid);
      gateway.send({ type: "block_set", peer: mid, value: nextValue });
      showToast(nextValue ? `Заблокировано: ${mid}` : `Разблокировано: ${mid}`, {
        kind: nextValue ? "warn" : "info",
        undo: () => gateway.send({ type: "block_set", peer: mid, value: !nextValue }),
      });
    },
    onRoomWriteToggle: (kind: TargetRef["kind"], roomId: string, memberId: string, value: boolean) => {
      const st = store.get();
      const rid = String(roomId || "").trim();
      const mid = String(memberId || "").trim();
      if (!rid || !mid) return;
      if (kind !== "group") return;
      if (st.conn !== "connected" || !st.authed) {
        store.set({ status: "Нет соединения" });
        return;
      }
      const g = st.groups.find((x) => x.id === rid);
      const isOwner = Boolean(g?.owner_id && st.selfId && String(g.owner_id) === String(st.selfId));
      if (!isOwner) {
        store.set({ status: "Только владелец может менять права" });
        return;
      }
      if (mid === st.selfId) {
        store.set({ status: "Нельзя запретить писать владельцу" });
        return;
      }
      gateway.send({ type: "group_post_set", group_id: rid, member_id: mid, value });
      showToast(value ? `Запрет писать: ${mid}` : `Разрешено писать: ${mid}`, {
        kind: value ? "warn" : "info",
        undo: () => gateway.send({ type: "group_post_set", group_id: rid, member_id: mid, value: !value }),
      });
    },
    onRoomRefresh: (kind: TargetRef["kind"], roomId: string) => {
      const st = store.get();
      const rid = String(roomId || "").trim();
      if (!rid || st.conn !== "connected" || !st.authed) {
        store.set({ status: "Нет соединения" });
        return;
      }
      if (kind === "group") gateway.send({ type: "group_info", group_id: rid });
      else if (kind === "board") gateway.send({ type: "board_info", board_id: rid });
    },
    onRoomInfoSave: (kind: TargetRef["kind"], roomId: string, description: string, rules: string) => {
      saveRoomInfo(kind, roomId, description, rules);
    },
    onRoomLeave: (kind: TargetRef["kind"], roomId: string) => {
      const st = store.get();
      const rid = String(roomId || "").trim();
      if (!rid) return;
      if (st.conn !== "connected" || !st.authed) {
        store.set({ status: "Нет соединения" });
        return;
      }
      const entry = kind === "group" ? st.groups.find((x) => x.id === rid) : st.boards.find((x) => x.id === rid);
      const name = String(entry?.name || rid);
      const ownerId = String(entry?.owner_id || "");
      const isOwner = Boolean(ownerId && st.selfId && String(ownerId) === String(st.selfId));
      if (isOwner) {
        store.set({ status: `Создатель не может покинуть ${kind === "group" ? "чат" : "доску"} — удалите её` });
        return;
      }
      if (kind === "group") {
        openConfirmModal({
          title: "Покинуть чат?",
          message: `Покинуть чат «${name}»?`,
          confirmLabel: "Выйти",
          danger: true,
          action: { kind: "group_leave", groupId: rid },
        });
      } else if (kind === "board") {
        openConfirmModal({
          title: "Покинуть доску?",
          message: `Покинуть доску «${name}»?`,
          confirmLabel: "Выйти",
          danger: true,
          action: { kind: "board_leave", boardId: rid },
        });
      }
    },
    onRoomDisband: (kind: TargetRef["kind"], roomId: string) => {
      const st = store.get();
      const rid = String(roomId || "").trim();
      if (!rid) return;
      if (st.conn !== "connected" || !st.authed) {
        store.set({ status: "Нет соединения" });
        return;
      }
      const entry = kind === "group" ? st.groups.find((x) => x.id === rid) : st.boards.find((x) => x.id === rid);
      const name = String(entry?.name || rid);
      const ownerId = String(entry?.owner_id || "");
      const isOwner = Boolean(ownerId && st.selfId && String(ownerId) === String(st.selfId));
      if (!isOwner) {
        store.set({ status: "Только владелец может удалить чат/доску" });
        return;
      }
      if (kind === "group") {
        openConfirmModal({
          title: "Удалить чат?",
          message: `Удалить чат «${name}» для всех?`,
          confirmLabel: "Удалить",
          danger: true,
          action: { kind: "group_disband", groupId: rid },
        });
      } else if (kind === "board") {
        openConfirmModal({
          title: "Удалить доску?",
          message: `Удалить доску «${name}» для всех?`,
          confirmLabel: "Удалить",
          danger: true,
          action: { kind: "board_disband", boardId: rid },
        });
      }
    },
    onSetMobileSidebarTab: (tab: MobileSidebarTab) => setMobileSidebarTab(tab),
    onSetSidebarChatFilter: (filter: SidebarChatFilter) => {
      const next = filter === "unread" ? "unread" : "all";
      if (store.get().sidebarChatFilter === next) return;
      store.set({ sidebarChatFilter: next });
    },
    onSetSidebarQuery: (query: string) => {
      const q = String(query ?? "");
      if (store.get().sidebarQuery === q) return;
      store.set({ sidebarQuery: q });
    },
    onAuthOpen: () =>
      store.set((prev) => ({
        ...prev,
        authMode: prev.authRememberedId ? "login" : "register",
        modal: { kind: "auth" },
      })),
    onAuthLogout: () => logout(),
    onAuthLogin: () => authLogin(),
    onAuthRegister: () => authRegister(),
    onAuthModeChange: (mode: "register" | "login") => store.set({ authMode: mode, modal: { kind: "auth" } }),
    onCloseModal: () => closeModal(),
    onDismissUpdate: () => store.set({ modal: null, updateDismissedLatest: store.get().updateLatest }),
    onReloadUpdate: () => window.location.reload(),
    onApplyPwaUpdate: () => void applyPwaUpdateNow(),
    onSkinChange: (skinId: string) => setSkin(skinId),
    onThemeChange: (theme: ThemeMode) => setTheme(theme),
    onMessageViewChange: (view: MessageViewMode) => setMessageView(view),
    onGroupCreate: () => createGroup(),
    onBoardCreate: () => createBoard(),
    onMembersAdd: () => membersAddSubmit(),
    onMembersRemove: () => membersRemoveSubmit(),
    onRename: () => renameSubmit(),
    onSendSchedule: () => sendScheduleSubmit(),
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
    onFileSendConfirm: (captionText: string) => confirmFileSend(captionText),
    onFileViewerNavigate: (dir: "prev" | "next") => navigateFileViewer(dir),
    onFileSend: (file: File | null, target: TargetRef | null) => {
      const st = store.get();
      if (st.conn !== "connected") {
        store.set({ status: "Нет соединения" });
        return;
      }
      if (!st.authed) {
        store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
        return;
      }
      if (!file) {
        store.set({ status: "Выберите файл" });
        return;
      }
      const tgt = target ?? st.selected;
      if (!tgt) {
        store.set({ status: "Выберите контакт или чат слева" });
        return;
      }
      openFileSendModal([file], tgt);
    },
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

      const derived = deriveServerSearchQuery(q);
      if (!derived) {
        store.set({ searchResults: [] });
        return;
      }

      searchDebounceTimer = window.setTimeout(() => {
        searchDebounceTimer = null;
        const q2 = store.get().searchQuery.trim();
        if (!q2) return;
        const st2 = store.get();
        if (!st2.authed || st2.conn !== "connected" || st2.page !== "search") return;
        const d2 = deriveServerSearchQuery(q2);
        if (!d2) return;
        if (d2.query === lastSearchIssued) return;
        lastSearchIssued = d2.query;
        store.set({ searchResults: [] });
        gateway.send({ type: "search", query: d2.query });
      }, 180);
    },
    onSearchSubmit: (query: string) => {
      const q = query.trim();
      lastUserInputAt = Date.now();
      store.set({ searchQuery: q, searchResults: [] });
      if (!q) return;
      const derived = deriveServerSearchQuery(q);
      if (!derived) return;
      lastSearchIssued = derived.query;
      gateway.send({ type: "search", query: derived.query });
    },
    onBoardPostPublish: (text: string) => publishBoardPost(text),
    onOpenHistoryHit: (target: TargetRef, query: string, msgIdx?: number) => {
      openChatFromSearch(target, query, msgIdx);
    },
    onSearchHistoryDelete: (items: Array<{ target: TargetRef; idx: number }>, mode: "local" | "remote") => {
      if (!Array.isArray(items) || !items.length) return;
      const st = store.get();
      if (mode === "remote") {
        if (st.conn !== "connected" || !st.authed) {
          store.set({ status: "Нет соединения" });
          return;
        }
      }
      const grouped = new Map<string, Array<{ target: TargetRef; idx: number }>>();
      for (const item of items) {
        const key = conversationKey(item.target);
        if (!key) continue;
        const list = grouped.get(key);
        if (list) list.push(item);
        else grouped.set(key, [item]);
      }
      if (!grouped.size) return;
      if (mode === "remote") {
        const ids: number[] = [];
        for (const [key, list] of grouped) {
          const conv = st.conversations[key];
          if (!Array.isArray(conv)) continue;
          for (const entry of list) {
            const msg = conv[entry.idx];
            const id = typeof msg?.id === "number" ? msg.id : null;
            if (id && id > 0) ids.push(id);
          }
        }
        if (!ids.length) {
          store.set({ status: "Нет сообщений для удаления" });
          return;
        }
        ids.forEach((id) => gateway.send({ type: "message_delete", id }));
        store.set({ status: "Удаляем сообщения…" });
        return;
      }
      store.set((prev) => {
        const nextConversations = { ...prev.conversations };
        const nextPinned = { ...prev.pinnedMessages };
        const nextActive = { ...prev.pinnedMessageActive };
        for (const [key, list] of grouped) {
          const cur = nextConversations[key];
          if (!Array.isArray(cur) || !cur.length) continue;
          const removeIdx = new Set<number>();
          const removedIds = new Set<number>();
          for (const entry of list) {
            const idx = entry.idx;
            if (idx < 0 || idx >= cur.length) continue;
            removeIdx.add(idx);
            const msg = cur[idx];
            if (typeof msg?.id === "number") removedIds.add(msg.id);
          }
          if (!removeIdx.size) continue;
          nextConversations[key] = cur.filter((_, i) => !removeIdx.has(i));
          if (removedIds.size) {
            const pinned = nextPinned[key];
            if (Array.isArray(pinned) && pinned.length) {
              const nextList = pinned.filter((id) => !removedIds.has(id));
              if (nextList.length) {
                nextPinned[key] = nextList;
                if (!nextList.includes(nextActive[key])) nextActive[key] = nextList[0];
              } else {
                delete nextPinned[key];
                delete nextActive[key];
              }
            }
          }
        }
        if (prev.selfId) savePinnedMessagesForUser(prev.selfId, nextPinned);
        return {
          ...prev,
          conversations: nextConversations,
          pinnedMessages: nextPinned,
          pinnedMessageActive: nextActive,
        };
      });
      showToast("Удалено у вас", { kind: "success" });
    },
    onSearchHistoryForward: (items: Array<{ target: TargetRef; idx: number }>) => {
      const st = store.get();
      const list = Array.isArray(items) ? items : [];
      const text = formatSearchHistoryShareText(st, list);
      if (!text) {
        store.set({ status: "Нет сообщений для пересылки" });
        return;
      }
      const target = st.selected;
      const canSend = canSendShareNow(st, target);
      if (canSend.ok && target) {
        appendShareTextToComposer(text, target);
        store.set({ status: list.length > 1 ? "Пересланы сообщения в поле ввода" : "Переслано сообщение в поле ввода" });
        return;
      }
      copyText(text).then((ok) => {
        store.set({ status: ok ? (list.length > 1 ? "Сообщения скопированы" : "Сообщение скопировано") : "Не удалось скопировать сообщение" });
      });
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
    onSearchServerForward: (items: SearchResultEntry[]) => {
      const st = store.get();
      const list = Array.isArray(items) ? items : [];
      const text = formatSearchServerShareText(st, list);
      if (!text) return;
      const target = st.selected;
      const canSend = canSendShareNow(st, target);
      if (canSend.ok && target) {
        appendShareTextToComposer(text, target);
        store.set({ status: list.length > 1 ? "Пересланы ID в поле ввода" : "Переслан ID в поле ввода" });
        return;
      }
      copyText(text).then((ok) => {
        store.set({ status: ok ? "ID скопирован" : "Не удалось скопировать ID" });
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
    onPushEnable: () => {
      void enablePush();
    },
    onPushDisable: () => {
      void disablePush();
    },
    onNotifyInAppEnable: () => {
      setNotifyInAppEnabled(true);
      store.set({ notifyInAppEnabled: true, status: "Уведомления в приложении: включены" });
    },
    onNotifyInAppDisable: () => {
      setNotifyInAppEnabled(false);
      store.set({ notifyInAppEnabled: false, status: "Уведомления в приложении: выключены" });
    },
    onNotifySoundEnable: () => {
      setNotifySoundEnabled(true);
      store.set({ notifySoundEnabled: true, status: "Звук уведомлений: включен" });
      syncNotifyPrefsToServiceWorker();
    },
    onNotifySoundDisable: () => {
      setNotifySoundEnabled(false);
      store.set({ notifySoundEnabled: false, status: "Звук уведомлений: выключен" });
      syncNotifyPrefsToServiceWorker();
    },
    onForcePwaUpdate: () => {
      void forcePwaUpdate();
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
      groupViewId: restored.groupViewId ?? prev.groupViewId,
      boardViewId: restored.boardViewId ?? prev.boardViewId,
      input: restored.input ?? prev.input,
	      drafts: restored.drafts ?? prev.drafts,
	      pinned: restored.pinned ?? prev.pinned,
	      chatSearchOpen: restored.chatSearchOpen ?? prev.chatSearchOpen,
	      chatSearchQuery: restored.chatSearchQuery ?? prev.chatSearchQuery,
	      chatSearchDate: restored.chatSearchDate ?? prev.chatSearchDate,
	      chatSearchFilter: restored.chatSearchFilter ?? prev.chatSearchFilter,
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
      scheduleBoardEditorPreview();
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
	        outboxLoadedForUser !== st.selfId ||
          boardScheduleLoadedForUser !== st.selfId)
	    ) {
	      const needDrafts = draftsLoadedForUser !== st.selfId;
	      const needPins = pinsLoadedForUser !== st.selfId;
	      const needPinnedMessages = pinnedMessagesLoadedForUser !== st.selfId;
	      const needFileTransfers = fileTransfersLoadedForUser !== st.selfId;
	      const needOutbox = outboxLoadedForUser !== st.selfId;
          const needBoardSchedule = boardScheduleLoadedForUser !== st.selfId;
	      if (needDrafts) draftsLoadedForUser = st.selfId;
	      if (needPins) pinsLoadedForUser = st.selfId;
	      if (needPinnedMessages) pinnedMessagesLoadedForUser = st.selfId;
	      if (needFileTransfers) fileTransfersLoadedForUser = st.selfId;
	      if (needOutbox) outboxLoadedForUser = st.selfId;
          if (needBoardSchedule) boardScheduleLoadedForUser = st.selfId;

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
              ...(e.whenOnline ? { whenOnline: true } : {}),
              ...(typeof e.scheduleAt === "number" && Number.isFinite(e.scheduleAt) ? { scheduleAt: e.scheduleAt } : {}),
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

      const storedBoardSchedule = needBoardSchedule ? loadBoardScheduleForUser(st.selfId) : [];
      const mergedBoardSchedule = (() => {
        if (!needBoardSchedule) return st.boardScheduledPosts;
        const base = Array.isArray(storedBoardSchedule) ? storedBoardSchedule : [];
        const cur = Array.isArray(st.boardScheduledPosts) ? st.boardScheduledPosts : [];
        if (!cur.length) return base;
        const seen = new Set(base.map((x) => String(x.id || "").trim()).filter(Boolean));
        const extras = cur.filter((x) => {
          const id = String(x?.id || "").trim();
          return Boolean(id) && !seen.has(id);
        });
        const merged = extras.length ? [...base, ...extras] : base;
        merged.sort((a, b) => a.scheduleAt - b.scheduleAt);
        return merged;
      })();

	      store.set((prev) => ({
	        ...prev,
	        drafts: mergedDrafts,
	        pinned: mergedPins,
	        pinnedMessages: mergedPinnedMessages,
	        fileTransfers: mergedFileTransfers,
	        outbox: mergedOutbox,
	        conversations: mergedConversations,
          boardScheduledPosts: mergedBoardSchedule,
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
        armBoardScheduleTimer();
        drainOutbox();
      return;
    }

    if (st.page === "main" && st.chatSearchOpen && st.selected) {
      const q = st.chatSearchQuery || "";
      const messages = searchableMessagesForSelected(st);
      const counts = computeChatSearchCounts(messages, q);
      const nextFilter = normalizeChatSearchFilter(st.chatSearchFilter, counts);
      const hits = q.trim() ? computeChatSearchHits(messages, q, nextFilter) : [];
      const nextPos = clampChatSearchPos(hits, st.chatSearchPos);
      const hitsChanged = !sameNumberArray(hits, st.chatSearchHits);
      const posChanged = nextPos !== st.chatSearchPos;
      const countsChanged = !sameChatSearchCounts(counts, st.chatSearchCounts);
      const filterChanged = nextFilter !== st.chatSearchFilter;
      const shouldClear = !q.trim() && (st.chatSearchHits.length > 0 || st.chatSearchPos !== 0);
      if (hitsChanged || posChanged || countsChanged || filterChanged || shouldClear) {
        store.set((prev) => ({
          ...prev,
          chatSearchFilter: nextFilter,
          chatSearchHits: hits,
          chatSearchPos: nextPos,
          chatSearchCounts: counts,
        }));
        return;
      }
    }
    renderApp(layout, st, actions);
    syncNavOverlay();
    if (historyPrependAnchor) {
      const selectedKey = st.selected ? conversationKey(st.selected) : "";
      const anchorKey = historyPrependAnchor.key;
      if (st.page !== "main" || !selectedKey || selectedKey !== anchorKey) {
        historyPrependAnchor = null;
      } else if (!st.historyLoading[anchorKey]) {
        let applied = false;
        if ((historyPrependAnchor.msgKey || historyPrependAnchor.msgId !== undefined) && historyPrependAnchor.rectBottom !== undefined) {
          const anchor = findHistoryAnchorByKey(historyPrependAnchor);
          if (anchor) {
            const rect = anchor.getBoundingClientRect();
            const delta = rect.bottom - historyPrependAnchor.rectBottom;
            if (Number.isFinite(delta) && delta !== 0) {
              // Не даём автозагрузчику истории сработать сразу после "компенсации" скролла.
              historyAutoBlockUntil = Date.now() + 350;
              layout.chatHost.scrollTop += delta;
            }
            applied = true;
          }
        }
        if (!applied) {
          const delta = layout.chatHost.scrollHeight - historyPrependAnchor.scrollHeight;
          if (Number.isFinite(delta) && delta !== 0) {
            // Не даём автозагрузчику истории сработать сразу после "компенсации" скролла.
            historyAutoBlockUntil = Date.now() + 350;
            layout.chatHost.scrollTop = historyPrependAnchor.scrollTop + delta;
          }
        }
        historyPrependAnchor = null;
      }
    }
    const autoScrollKey = st.selected ? conversationKey(st.selected) : "";
    if (pendingChatAutoScroll && pendingChatAutoScroll.key !== autoScrollKey) {
      pendingChatAutoScroll = null;
    }
    if (pendingChatAutoScroll && autoScrollKey && st.page === "main" && (!st.modal || st.modal.kind === "context_menu")) {
      const waitForHistory = pendingChatAutoScroll.waitForHistory;
      const loaded = Boolean(st.historyLoaded && st.historyLoaded[autoScrollKey]);
      if (!waitForHistory || loaded) {
        scrollChatToBottom(autoScrollKey);
        pendingChatAutoScroll = null;
      }
    }
    scheduleChatJumpVisibility();
    if (st.modal?.kind === "members_add") {
      renderMembersAddChips();
      membersAddDrainLookups();
    }
    if (st.modal && st.modal.kind !== "context_menu") {
      closeMobileSidebar();
    }
    // Mobile/floating UX: если чат не выбран — основной экран это список (никаких "пустых" экранов).
    if (st.page === "main" && !st.modal && !st.selected) {
      if (mobileSidebarMq.matches && !mobileSidebarOpen) {
        mobileSidebarAutoOpened = true;
        setMobileSidebarOpen(true);
      } else if (floatingSidebarMq.matches && !floatingSidebarOpen) {
        floatingSidebarAutoOpened = true;
        setFloatingSidebarOpen(true);
      }
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
    if (st.authed && st.selfId) {
      scheduleWarmupCachedPreviews();
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
