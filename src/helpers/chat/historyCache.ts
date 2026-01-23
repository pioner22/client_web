import type { ChatAttachment, ChatMessage, ChatMessageRef, MessageReactions } from "../../stores/types";
import type { StorageLike } from "./drafts";
import { APP_MSG_MAX_LEN } from "../../config/app";

const HISTORY_CACHE_VERSION = 2;
const HISTORY_CACHE_MAX_AGE_MS = 45 * 24 * 60 * 60 * 1000;
const HISTORY_CACHE_MAX_CONVERSATIONS = 400;
const HISTORY_CACHE_MAX_MESSAGES = 2800;
const HISTORY_CACHE_MAX_KEY_LEN = 96;

type HistoryCachePayload = {
  v: number;
  updated: number;
  conversations: Record<string, ChatMessage[]>;
  cursors: Record<string, number>;
  hasMore: Record<string, boolean>;
  loaded?: string[];
};

export type HistoryCache = {
  conversations: Record<string, ChatMessage[]>;
  historyCursor: Record<string, number>;
  historyHasMore: Record<string, boolean>;
  historyLoaded: Record<string, boolean>;
};

function storageKey(userId: string): string | null {
  const id = String(userId || "").trim();
  if (!id) return null;
  return `yagodka_chat_history_v${HISTORY_CACHE_VERSION}:${id}`;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== "undefined" ? (localStorage as unknown as StorageLike) : null;
  } catch {
    return null;
  }
}

function sanitizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  if (value.length <= APP_MSG_MAX_LEN) return value;
  return value.slice(0, APP_MSG_MAX_LEN);
}

function sanitizeAttachment(raw: unknown): ChatAttachment | null {
  if (!raw || typeof raw !== "object") return null;
  const att = raw as any;
  const kind = String(att.kind || "");
  if (kind === "file") {
    const name = String(att.name || "").trim();
    if (!name) return null;
    const size = Number(att.size ?? 0);
    const fileId = typeof att.fileId === "string" ? att.fileId : null;
    const localId = typeof att.localId === "string" ? att.localId : null;
    const mime = typeof att.mime === "string" ? att.mime : null;
    return {
      kind: "file",
      name,
      size: Number.isFinite(size) ? size : 0,
      ...(fileId ? { fileId } : {}),
      ...(localId ? { localId } : {}),
      ...(mime ? { mime } : {}),
    };
  }
  if (kind === "action") {
    const payload = att.payload && typeof att.payload === "object" ? att.payload : null;
    if (!payload) return null;
    return { kind: "action", payload };
  }
  return null;
}

function sanitizeRef(raw: unknown): ChatMessageRef | null {
  if (!raw || typeof raw !== "object") return null;
  const ref = raw as any;
  const next: ChatMessageRef = {};
  const id = ref.id;
  if (typeof id === "number" && Number.isFinite(id)) next.id = id;
  if (id === null) next.id = null;
  const localId = typeof ref.localId === "string" ? ref.localId.trim() : "";
  if (localId) next.localId = localId;
  const from = typeof ref.from === "string" ? ref.from.trim() : "";
  if (from) next.from = from;
  const text = sanitizeText(ref.text);
  if (text) next.text = text;
  const attachment = sanitizeAttachment(ref.attachment);
  if (attachment) next.attachment = attachment;
  const viaBot = typeof ref.via_bot === "string" ? ref.via_bot.trim() : "";
  if (viaBot) next.via_bot = viaBot;
  const postAuthor = typeof ref.post_author === "string" ? ref.post_author.trim() : "";
  if (postAuthor) next.post_author = postAuthor;
  if (ref.hidden_profile === true) next.hidden_profile = true;
  return Object.keys(next).length ? next : null;
}

function sanitizeReactions(raw: unknown): MessageReactions | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as any;
  const countsRaw = rec.counts;
  if (!countsRaw || typeof countsRaw !== "object") return null;
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(countsRaw as Record<string, unknown>)) {
    const key = String(k || "").trim();
    const num = Number(v);
    if (!key || !Number.isFinite(num) || num <= 0) continue;
    counts[key] = Math.floor(num);
  }
  const mine = typeof rec.mine === "string" ? rec.mine : null;
  if (!Object.keys(counts).length && !mine) return null;
  return mine ? { counts, mine } : { counts };
}

function sanitizeMessage(raw: unknown): ChatMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const msg = raw as any;
  const kind = msg.kind === "in" || msg.kind === "out" || msg.kind === "sys" ? msg.kind : null;
  if (!kind) return null;
  const ts = Number(msg.ts ?? 0);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  const from = typeof msg.from === "string" ? msg.from : kind === "sys" ? "" : "";
  if (!from && kind !== "sys") return null;
  const next: ChatMessage = {
    kind,
    ts,
    from,
    text: sanitizeText(msg.text),
  };
  const to = typeof msg.to === "string" ? msg.to.trim() : "";
  if (to) next.to = to;
  const room = typeof msg.room === "string" ? msg.room.trim() : "";
  if (room) next.room = room;
  const localId = typeof msg.localId === "string" ? msg.localId.trim() : "";
  if (localId) next.localId = localId;
  const id = msg.id;
  if (typeof id === "number" && Number.isFinite(id)) next.id = id;
  if (id === null) next.id = null;
  const status = msg.status;
  if (status === "sending" || status === "queued" || status === "sent" || status === "delivered" || status === "read" || status === "error")
    next.status = status;
  if (msg.edited === true) next.edited = true;
  if (typeof msg.edited_ts === "number" && Number.isFinite(msg.edited_ts)) next.edited_ts = msg.edited_ts;
  const attachment = sanitizeAttachment(msg.attachment);
  if (attachment) next.attachment = attachment;
  const reply = sanitizeRef(msg.reply);
  if (reply) next.reply = reply;
  const forward = sanitizeRef(msg.forward);
  if (forward) next.forward = forward;
  const reactions = sanitizeReactions(msg.reactions);
  if (reactions) next.reactions = reactions;
  if (msg.whenOnline === true) next.whenOnline = true;
  if (typeof msg.scheduleAt === "number" && Number.isFinite(msg.scheduleAt)) next.scheduleAt = msg.scheduleAt;
  return next;
}

function sortKey(m: ChatMessage): number {
  if (m.id !== undefined && m.id !== null) return Number(m.id);
  return Number(m.ts) || 0;
}

function sanitizeMessageList(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const item of raw) {
    const msg = sanitizeMessage(item);
    if (!msg) continue;
    out.push(msg);
  }
  out.sort((a, b) => sortKey(a) - sortKey(b));
  return out;
}

function oldestId(list: ChatMessage[]): number | null {
  let min: number | null = null;
  for (const m of list) {
    const id = m.id;
    if (typeof id !== "number" || !Number.isFinite(id) || id <= 0) continue;
    min = min === null ? id : Math.min(min, id);
  }
  return min;
}

function trimTail(list: ChatMessage[]): ChatMessage[] {
  if (list.length <= HISTORY_CACHE_MAX_MESSAGES) return list;
  return list.slice(Math.max(0, list.length - HISTORY_CACHE_MAX_MESSAGES));
}

function sanitizeConversationMap(raw: unknown): Record<string, ChatMessage[]> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, ChatMessage[]> = {};
  for (const [kRaw, vRaw] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof kRaw !== "string") continue;
    const key = kRaw.trim();
    if (!key || key.length > HISTORY_CACHE_MAX_KEY_LEN) continue;
    const list = sanitizeMessageList(vRaw);
    if (!list.length) continue;
    out[key] = trimTail(list);
  }
  return out;
}

function sanitizeCursorMap(raw: unknown, allowed: Set<string>): Record<string, number> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, number> = {};
  for (const [kRaw, vRaw] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof kRaw !== "string") continue;
    const key = kRaw.trim();
    if (!key || !allowed.has(key)) continue;
    const num = Number(vRaw);
    if (!Number.isFinite(num) || num <= 0) continue;
    out[key] = Math.floor(num);
  }
  return out;
}

function sanitizeHasMoreMap(raw: unknown, allowed: Set<string>): Record<string, boolean> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, boolean> = {};
  for (const [kRaw, vRaw] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof kRaw !== "string") continue;
    const key = kRaw.trim();
    if (!key || !allowed.has(key)) continue;
    if (typeof vRaw !== "boolean") continue;
    out[key] = vRaw;
  }
  return out;
}

function sanitizeLoadedKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const key = item.trim();
    if (!key || key.length > HISTORY_CACHE_MAX_KEY_LEN) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function loadHistoryCacheForUser(userId: string, storage?: StorageLike | null): HistoryCache {
  const key = storageKey(userId);
  if (!key) return { conversations: {}, historyCursor: {}, historyHasMore: {}, historyLoaded: {} };
  const st = storage ?? defaultStorage();
  if (!st) return { conversations: {}, historyCursor: {}, historyHasMore: {}, historyLoaded: {} };
  try {
    const raw = st.getItem(key);
    if (!raw) return { conversations: {}, historyCursor: {}, historyHasMore: {}, historyLoaded: {} };
    const parsed = JSON.parse(raw) as HistoryCachePayload;
    if (!parsed || typeof parsed !== "object") return { conversations: {}, historyCursor: {}, historyHasMore: {}, historyLoaded: {} };
    if (parsed.v !== HISTORY_CACHE_VERSION) return { conversations: {}, historyCursor: {}, historyHasMore: {}, historyLoaded: {} };
    const updated = Number(parsed.updated ?? 0);
    if (!Number.isFinite(updated) || Date.now() - updated > HISTORY_CACHE_MAX_AGE_MS) {
      return { conversations: {}, historyCursor: {}, historyHasMore: {}, historyLoaded: {} };
    }
    const conversations = sanitizeConversationMap(parsed.conversations);
    const loadedKeys = sanitizeLoadedKeys(parsed.loaded);
    const historyLoaded: Record<string, boolean> = {};
    for (const key of loadedKeys) historyLoaded[key] = true;
    for (const key of Object.keys(conversations)) historyLoaded[key] = true;
    const allowed = new Set(Object.keys(historyLoaded));
    const historyCursor = sanitizeCursorMap(parsed.cursors, allowed);
    const historyHasMore = sanitizeHasMoreMap(parsed.hasMore, allowed);
    return { conversations, historyCursor, historyHasMore, historyLoaded };
  } catch {
    return { conversations: {}, historyCursor: {}, historyHasMore: {}, historyLoaded: {} };
  }
}

export function saveHistoryCacheForUser(
  userId: string,
  payload: {
    conversations: Record<string, ChatMessage[]>;
    historyCursor: Record<string, number>;
    historyHasMore: Record<string, boolean>;
    historyLoaded: Record<string, boolean>;
  },
  storage?: StorageLike | null
): void {
  const key = storageKey(userId);
  if (!key) return;
  const st = storage ?? defaultStorage();
  if (!st) return;
  try {
    const safe = sanitizeConversationMap(payload.conversations);
    const entries = Object.entries(safe)
      .map(([k, list]) => {
        const last = list.length ? list[list.length - 1] : null;
        const lastKey = last ? Number(last.id ?? last.ts ?? 0) : 0;
        return { key: k, list, lastKey };
      })
      .sort((a, b) => b.lastKey - a.lastKey)
      .slice(0, HISTORY_CACHE_MAX_CONVERSATIONS);
    const conversations: Record<string, ChatMessage[]> = {};
    const cursors: Record<string, number> = {};
    const hasMore: Record<string, boolean> = {};
    const loaded: string[] = [];
    const loadedSeen = new Set<string>();
    for (const entry of entries) {
      const list = entry.list;
      conversations[entry.key] = list;
      loaded.push(entry.key);
      loadedSeen.add(entry.key);
      const cursor = oldestId(list);
      if (cursor !== null) cursors[entry.key] = cursor;
      const trimmed = list.length >= HISTORY_CACHE_MAX_MESSAGES;
      const known = payload.historyHasMore[entry.key];
      if (typeof known === "boolean") hasMore[entry.key] = trimmed ? true : known;
      else if (trimmed) hasMore[entry.key] = true;
    }
    if (loaded.length < HISTORY_CACHE_MAX_CONVERSATIONS) {
      const extra = Object.entries(payload.historyLoaded || {})
        .filter(([key, value]) => Boolean(value) && !loadedSeen.has(key))
        .map(([key]) => key.trim())
        .filter((key) => key && key.length <= HISTORY_CACHE_MAX_KEY_LEN);
      for (const key of extra) {
        if (loaded.length >= HISTORY_CACHE_MAX_CONVERSATIONS) break;
        if (loadedSeen.has(key)) continue;
        loaded.push(key);
        loadedSeen.add(key);
        const cursor = payload.historyCursor[key];
        if (typeof cursor === "number" && Number.isFinite(cursor) && cursor > 0) cursors[key] = Math.floor(cursor);
        const known = payload.historyHasMore[key];
        if (typeof known === "boolean") hasMore[key] = known;
      }
    }
    const encoded: HistoryCachePayload = {
      v: HISTORY_CACHE_VERSION,
      updated: Date.now(),
      conversations,
      cursors,
      hasMore,
      loaded,
    };
    if (!Object.keys(conversations).length && !loaded.length) {
      st.removeItem(key);
      return;
    }
    st.setItem(key, JSON.stringify(encoded));
  } catch {
    // ignore
  }
}
