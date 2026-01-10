import type { GatewayClient } from "../lib/net/gatewayClient";
import type {
  ActionModalPayload,
  ActionModalBoardInvite,
  ActionModalGroupInvite,
  ActionModalGroupJoinRequest,
	  AppState,
	  BoardEntry,
	  ChatAttachment,
	  ChatMessage,
    ChatMessageRef,
	  FriendEntry,
	  GroupEntry,
    MessageReactions,
	  OutboxEntry,
	  SearchResultEntry,
	  UserProfile,
	} from "../stores/types";
import { dmKey, roomKey } from "../helpers/chat/conversationKey";
import { nowTs } from "../helpers/time";
import { parseRoster } from "../helpers/roster/parseRoster";
import { upsertConversation } from "../helpers/chat/upsertConversation";
import { mergeMessages } from "../helpers/chat/mergeMessages";
import { clearStoredAvatar, getStoredAvatar, getStoredAvatarRev, storeAvatar, storeAvatarRev } from "../helpers/avatar/avatarStore";
import {
  blockSessionAutoAuth,
  clearSessionAutoAuthBlock,
  clearStoredSessionToken,
  getStoredAuthId,
  getStoredSessionToken,
  storeAuthId,
  storeSessionToken,
} from "../helpers/auth/session";
import { clearOutboxForUser } from "../helpers/pwa/outboxSync";
import { removeOutboxEntry } from "../helpers/chat/outbox";
import { isMobileLikeUi } from "../helpers/ui/mobileLike";
import { loadLastReadMarkers, saveLastReadMarkers } from "../helpers/ui/lastReadMarkers";
import { deriveServerSearchQuery } from "../helpers/search/serverSearchQuery";
import { playNotificationSound } from "../helpers/notify/notifySound";

function upsertConversationByLocalId(state: any, key: string, msg: ChatMessage, localId: string): any {
  const convMap = state?.conversations && typeof state.conversations === "object" ? state.conversations : {};
  const prev = Array.isArray(convMap[key]) ? convMap[key] : [];
  if (prev.some((m: any) => String(m?.localId ?? "") === localId)) return state;
  return { ...state, conversations: { ...convMap, [key]: [...prev, msg] } };
}

function updateConversationByLocalId(
  state: any,
  key: string,
  localId: string,
  update: (msg: ChatMessage) => ChatMessage
): any {
  const convMap = state?.conversations && typeof state.conversations === "object" ? state.conversations : {};
  const prev = Array.isArray(convMap[key]) ? convMap[key] : [];
  const idx = prev.findIndex((m: any) => String(m?.localId ?? "") === localId);
  if (idx < 0) return state;
  const next = [...prev];
  next[idx] = update(next[idx] as ChatMessage);
  return { ...state, conversations: { ...convMap, [key]: next } };
}

function sysActionMessage(peer: string, text: string, payload: ActionModalPayload, localId: string): ChatMessage {
  return {
    ts: nowTs(),
    from: peer,
    text,
    kind: "sys",
    localId,
    id: null,
    attachment: { kind: "action", payload },
  };
}

function oldestLoadedId(msgs: ChatMessage[]): number | null {
  let min: number | null = null;
  for (const m of msgs) {
    const id = m.id;
    if (typeof id !== "number" || !Number.isFinite(id) || id <= 0) continue;
    if (min === null || id < min) min = id;
  }
  return min;
}

function updateLastOutgoing(state: AppState, key: string, update: (msg: ChatMessage) => ChatMessage): AppState {
  const conv = state.conversations[key];
  if (!conv || conv.length === 0) return state;
  // ACK от сервера приходит в порядке отправки, поэтому обновляем "самое старое" исходящее без id,
  // иначе при быстрой отправке нескольких сообщений можно перепутать msg_id.
  for (let i = 0; i < conv.length; i += 1) {
    const msg = conv[i];
    if (msg.kind !== "out") continue;
    if (msg.id !== undefined && msg.id !== null) continue;
    const next = [...conv];
    next[i] = update(msg);
    return { ...state, conversations: { ...state.conversations, [key]: next } };
  }
  return state;
}

function updateFirstPendingOutgoing(
  state: AppState,
  key: string,
  update: (msg: ChatMessage) => ChatMessage
): { state: AppState; localId: string | null } {
  const conv = state.conversations[key];
  if (!conv || conv.length === 0) return { state, localId: null };
  for (let i = 0; i < conv.length; i += 1) {
    const msg = conv[i];
    if (msg.kind !== "out") continue;
    if (msg.id !== undefined && msg.id !== null) continue;
    const next = [...conv];
    next[i] = update(msg);
    const lid = typeof msg.localId === "string" && msg.localId.trim() ? msg.localId.trim() : null;
    return { state: { ...state, conversations: { ...state.conversations, [key]: next } }, localId: lid };
  }
  return { state, localId: null };
}

function humanizeError(raw: string): string {
  const code = String(raw ?? "").trim();
  if (!code) return "ошибка";
  const map: Record<string, string> = {
    not_in_group: "Вы не участник этого чата (примите приглашение или попросите добавить вас)",
    group_post_forbidden: "В этом чате вам запрещено писать",
    board_post_forbidden: "На доске писать может только владелец",
    board_check_failed: "Не удалось проверить права на доску",
    group_check_failed: "Не удалось проверить доступ к чату",
    broadcast_disabled: "Рассылка всем отключена",
    message_too_long: "Слишком длинное сообщение",
    bad_text: "Некорректный текст сообщения",
    bad_recipient: "Некорректный получатель",
    rate_limited: "Слишком часто. Попробуйте позже",
  };
  return map[code] ?? code;
}

function parseAttachment(raw: any): ChatAttachment | null {
  if (!raw || typeof raw !== "object") return null;
  const kind = String((raw as any).kind ?? "");
  if (kind !== "file") return null;
  const fileIdRaw = (raw as any).file_id ?? (raw as any).fileId ?? (raw as any).id ?? null;
  const fileId = typeof fileIdRaw === "string" && fileIdRaw.trim() ? fileIdRaw.trim() : null;
  const name = String((raw as any).name ?? "файл");
  const size = Number((raw as any).size ?? 0) || 0;
  const mimeRaw = (raw as any).mime;
  const mime = typeof mimeRaw === "string" && mimeRaw.trim() ? String(mimeRaw) : null;
  return { kind: "file", fileId, name, size, mime };
}

function parseMessageRef(raw: any): ChatMessageRef | null {
  if (!raw || typeof raw !== "object") return null;
  const ref: ChatMessageRef = {};
  const idRaw = (raw as any).id ?? (raw as any).msg_id ?? null;
  const id = typeof idRaw === "number" && Number.isFinite(idRaw) ? Math.trunc(idRaw) : Math.trunc(Number(idRaw) || 0);
  if (id > 0) ref.id = id;
  const localIdRaw = (raw as any).localId ?? (raw as any).local_id ?? null;
  if (typeof localIdRaw === "string" && localIdRaw.trim()) ref.localId = localIdRaw.trim();
  const fromRaw = (raw as any).from;
  if (typeof fromRaw === "string" && fromRaw.trim()) ref.from = fromRaw.trim();
  const textRaw = (raw as any).text;
  if (typeof textRaw === "string" && textRaw.trim()) ref.text = textRaw;
  const attachment = parseAttachment((raw as any).attachment);
  if (attachment) ref.attachment = attachment;
  const viaBotRaw = (raw as any).via_bot ?? (raw as any).viaBot ?? null;
  if (typeof viaBotRaw === "string" && viaBotRaw.trim()) ref.via_bot = viaBotRaw.trim();
  const postAuthorRaw = (raw as any).post_author ?? (raw as any).postAuthor ?? null;
  if (typeof postAuthorRaw === "string" && postAuthorRaw.trim()) ref.post_author = postAuthorRaw.trim();
  const hiddenRaw = (raw as any).hidden_profile ?? (raw as any).hiddenProfile ?? null;
  const hidden_profile =
    hiddenRaw === true || hiddenRaw === 1 || hiddenRaw === "1" || hiddenRaw === "true" || hiddenRaw === "yes";
  if (hidden_profile) ref.hidden_profile = true;
  return Object.keys(ref).length ? ref : null;
}

function parseReactions(raw: any): MessageReactions | null {
  if (!raw || typeof raw !== "object") return null;
  const countsRaw = (raw as any).counts;
  if (!countsRaw || typeof countsRaw !== "object") return null;
  const counts: Record<string, number> = {};
  for (const [emoji, cnt] of Object.entries(countsRaw as Record<string, unknown>)) {
    const e = String(emoji || "").trim();
    const n = typeof cnt === "number" && Number.isFinite(cnt) ? Math.trunc(cnt) : Math.trunc(Number(cnt) || 0);
    if (!e || n <= 0) continue;
    counts[e] = n;
  }
  const mineRaw = (raw as any).mine;
  const mine = typeof mineRaw === "string" && mineRaw.trim() ? String(mineRaw) : null;
  if (!Object.keys(counts).length && mine === null) return null;
  return { counts, mine };
}

function isDocHidden(): boolean {
  try {
    return typeof document !== "undefined" && document.visibilityState !== "visible";
  } catch {
    return false;
  }
}

function notifyPermission(): "default" | "granted" | "denied" {
  try {
    return (Notification?.permission ?? "default") as "default" | "granted" | "denied";
  } catch {
    return "default";
  }
}

function showInAppNotification(state: AppState, title: string, body: string, tag: string): void {
  if (!state.notifyInAppEnabled) return;
  if (!isDocHidden()) return;
  if (notifyPermission() !== "granted") return;
  try {
    // We control notification sound ourselves (see notifySound toggle). Ask the OS to keep it silent
    // to avoid double sounds / inconsistent platform behavior.
    new Notification(title, { body, tag, silent: true });
  } catch {
    // ignore
  }
}

function maybePlaySound(state: AppState, kind: Parameters<typeof playNotificationSound>[0], shouldPlay: boolean): void {
  if (!shouldPlay) return;
  if (!state.notifySoundEnabled) return;
  void playNotificationSound(kind).catch(() => {});
}

export function handleServerMessage(
  msg: any,
  state: AppState,
  gateway: GatewayClient,
  patch: (p: Partial<AppState> | ((prev: AppState) => AppState)) => void
) {
  const t = String(msg?.type ?? "");

  if (t === "welcome") {
    const sv = typeof msg?.server_version === "string" ? msg.server_version : state.serverVersion;
    const pushKey = typeof msg?.pwa_push_public_key === "string" ? String(msg.pwa_push_public_key).trim() : "";
    const pushPermission = (() => {
      try {
        return (Notification?.permission ?? state.pwaPushPermission ?? "default") as "default" | "granted" | "denied";
      } catch {
        return state.pwaPushPermission ?? "default";
      }
    })();
    patch({
      serverVersion: sv,
      status: "Handshake OK",
      pwaPushPermission: pushPermission,
      ...(pushKey ? { pwaPushPublicKey: pushKey } : {}),
    });
    return;
  }
  if (t === "session_replaced") {
    // Важно: не чистим общий session token в localStorage/cookie — он общий для вкладок/PWA.
    // Иначе “победившая” вкладка тоже потеряет автовход. Вместо этого блокируем автовход
    // только для текущей вкладки (sessionStorage) и просим войти вручную, если нужно.
    blockSessionAutoAuth();
    patch((prev) => ({
      ...prev,
      authed: false,
      authMode: getStoredAuthId() ? "login" : "register",
      // “В тишине”: не открываем модалку автоматически.
      status: "Сессия активна в другом окне. Нажмите «Войти», чтобы продолжить здесь.",
    }));
    return;
  }
  if (t === "auth_ok") {
    const selfId = String(msg?.id ?? state.selfId ?? "");
    const sess = typeof msg?.session === "string" ? msg.session : null;
    const lastRead = selfId ? loadLastReadMarkers(selfId) : state.lastRead;
    if (selfId) storeAuthId(selfId);
    if (sess) storeSessionToken(sess);
    else {
      // Refresh cookie/localStorage TTL for an existing token (server doesn't resend it on session auth).
      const existing = getStoredSessionToken();
      if (existing) storeSessionToken(existing);
    }
    clearSessionAutoAuthBlock();
    patch({
      authed: true,
      selfId,
      authRememberedId: selfId || state.authRememberedId,
      ...(sess ? { authMode: "auto" as const } : {}),
      modal: null,
      status: "Connected",
      lastRead,
    });
    gateway.send({ type: "client_info", client: "web", version: state.clientVersion });
    gateway.send({ type: "group_list" });
    gateway.send({ type: "board_list" });
    gateway.send({ type: "profile_get" });
    return;
  }
  if (t === "pwa_push_subscribe_result") {
    const ok = Boolean(msg?.ok);
    const active = Boolean(msg?.active);
    const status = ok ? (active ? "Push подписка активна" : "Push подписка сохранена (сервер выключен)") : "Не удалось включить Push";
    patch({
      pwaPushSubscribed: ok,
      pwaPushStatus: status,
    });
    return;
  }
  if (t === "pwa_push_unsubscribe_result") {
    const ok = Boolean(msg?.ok);
    patch({
      pwaPushSubscribed: !ok ? state.pwaPushSubscribed : false,
      pwaPushStatus: ok ? "Push отключен" : "Не удалось отключить Push",
    });
    return;
  }
  if (t === "auth_fail") {
    const reason = String(msg?.reason ?? "auth_failed");
    if (reason === "session_invalid" || reason === "session_expired") {
      const uid = String(state.selfId || "").trim();
      if (uid) void clearOutboxForUser(uid);
      clearStoredSessionToken();
      patch({
        authMode: getStoredAuthId() ? "login" : "register",
        // “В тишине”: не открываем модалку сами — только статус, дальше пользователь сам нажмёт «Войти».
        modal: null,
        status: "Сессия устарела или недействительна. Нажмите «Войти», чтобы войти снова.",
      });
      return;
    }
    const message =
      reason === "no_such_user"
        ? "Пользователь не найден"
        : reason === "bad_id_format"
          ? "Неверный формат ID/@логина"
        : reason === "bad_password"
          ? "Неверный пароль"
          : reason === "rate_limited"
          ? "Слишком много попыток. Попробуйте позже."
            : "Не удалось выполнить вход";
    if (state.modal?.kind === "auth") {
      patch({ modal: { kind: "auth", message }, status: "Auth failed" });
    } else {
      patch({ status: message });
    }
    return;
  }
  if (t === "register_ok") {
    const selfId = String(msg?.id ?? "");
    const sess = typeof msg?.session === "string" ? msg.session : null;
    if (selfId) storeAuthId(selfId);
    if (sess) storeSessionToken(sess);
    else {
      const existing = getStoredSessionToken();
      if (existing) storeSessionToken(existing);
    }
    clearSessionAutoAuthBlock();
    patch({
      authed: true,
      selfId,
      authRememberedId: selfId || state.authRememberedId,
      ...(sess ? { authMode: "auto" as const } : {}),
      modal: null,
      status: "Registered",
    });
    gateway.send({ type: "client_info", client: "web", version: state.clientVersion });
    gateway.send({ type: "group_list" });
    gateway.send({ type: "board_list" });
    gateway.send({ type: "profile_get" });
    return;
  }
  if (t === "register_fail") {
    const reason = String(msg?.reason ?? "register_failed");
    const message =
      reason === "empty_password"
        ? "Введите пароль для регистрации"
        : reason === "password_too_short"
          ? "Пароль слишком короткий"
          : reason === "password_too_long"
            ? "Пароль слишком длинный"
            : reason === "rate_limited"
              ? "Слишком много попыток. Попробуйте позже."
              : "Регистрация не удалась";
    patch({ modal: { kind: "auth", message }, status: "Register failed" });
    return;
  }
  if (t === "roster_full" || t === "roster") {
    const r = parseRoster(msg);
    let avatarChanged = false;
    for (const f of r.friends) {
      const id = String(f?.id ?? "").trim();
      if (!id) continue;
      const rev = typeof (f as any).avatar_rev === "number" ? Math.max(0, Math.trunc((f as any).avatar_rev)) : 0;
      const mimeRaw = (f as any).avatar_mime;
      const mime = typeof mimeRaw === "string" && mimeRaw.trim() ? String(mimeRaw).trim() : null;
      const storedUrl = getStoredAvatar("dm", id);
      const storedRev = getStoredAvatarRev("dm", id);
      const hasAvatar = Boolean(mime);

      if (!hasAvatar) {
        if (storedUrl) {
          clearStoredAvatar("dm", id);
          storeAvatarRev("dm", id, rev);
          avatarChanged = true;
        } else if (storedRev !== rev) {
          storeAvatarRev("dm", id, rev);
        }
        continue;
      }
      if (storedRev !== rev || !storedUrl) {
        gateway.send({ type: "avatar_get", id });
      }
    }

    patch((prev) => {
      let nextProfiles: Record<string, UserProfile> | null = null;
      for (const f of r.friends) {
        const id = String(f?.id ?? "").trim();
        if (!id) continue;
        const hasExtra =
          (f as any).display_name !== undefined || (f as any).handle !== undefined || (f as any).avatar_rev !== undefined || (f as any).avatar_mime !== undefined;
        if (!hasExtra) continue;
        const cur = prev.profiles[id] ?? { id };
        const next: UserProfile = {
          ...cur,
          id,
          ...((f as any).display_name === undefined ? {} : { display_name: (f as any).display_name }),
          ...((f as any).handle === undefined ? {} : { handle: (f as any).handle }),
          ...((f as any).avatar_rev === undefined ? {} : { avatar_rev: (f as any).avatar_rev }),
          ...((f as any).avatar_mime === undefined ? {} : { avatar_mime: (f as any).avatar_mime }),
        };
        if (!nextProfiles) nextProfiles = { ...prev.profiles };
        nextProfiles[id] = next;
      }
      let nextState: any = {
        ...prev,
        friends: r.friends,
        topPeers: r.topPeers,
        pendingIn: r.pendingIn,
        pendingOut: r.pendingOut,
        ...(nextProfiles ? { profiles: nextProfiles } : {}),
        ...(avatarChanged ? { avatarsRev: (prev.avatarsRev || 0) + 1 } : {}),
      };
      for (const peer of r.pendingIn) {
        const id = String(peer || "").trim();
        if (!id) continue;
        const localId = `action:auth_in:${id}`;
        nextState = upsertConversationByLocalId(
          nextState,
          dmKey(id),
          sysActionMessage(id, `Входящий запрос на контакт: ${id}`, { kind: "auth_in", peer: id }, localId),
          localId
        );
      }
      for (const peer of r.pendingOut) {
        const id = String(peer || "").trim();
        if (!id) continue;
        const localId = `action:auth_out:${id}`;
        nextState = upsertConversationByLocalId(
          nextState,
          dmKey(id),
          sysActionMessage(id, `Ожидает подтверждения: ${id}`, { kind: "auth_out", peer: id }, localId),
          localId
        );
      }
      return nextState;
    });
    return;
  }
  if (t === "friends") {
    const raw = Array.isArray(msg?.friends) ? msg.friends : [];
    const ids: string[] = raw.map((x: any) => String(x || "").trim()).filter((x: string) => Boolean(x));
    patch((prev) => {
      const byId = new Map<string, FriendEntry>(prev.friends.map((f) => [f.id, f]));
      const next: FriendEntry[] = ids.map((id) => byId.get(id) ?? { id, online: false, unread: 0, last_seen_at: null });
      next.sort((a: FriendEntry, b: FriendEntry) => a.id.localeCompare(b.id));
      return { ...prev, friends: next };
    });
    return;
  }
  if (t === "prefs") {
    const muted = (Array.isArray(msg?.muted) ? msg.muted : []).map((x: any) => String(x || "").trim()).filter(Boolean);
    const blocked = (Array.isArray(msg?.blocked) ? msg.blocked : []).map((x: any) => String(x || "").trim()).filter(Boolean);
    const blockedBy = (Array.isArray(msg?.blocked_by) ? msg.blocked_by : [])
      .map((x: any) => String(x || "").trim())
      .filter(Boolean);
    patch({ muted, blocked, blockedBy });
    return;
  }
  if (t === "mute_set_result") {
    const ok = Boolean(msg?.ok);
    const peer = String(msg?.peer ?? "").trim();
    const value = Boolean(msg?.value);
    if (!peer) return;
    if (!ok) {
      patch({ status: `Не удалось изменить mute: ${peer}` });
      return;
    }
    patch((prev) => ({
      ...prev,
      muted: value ? Array.from(new Set([...prev.muted, peer])) : prev.muted.filter((x) => x !== peer),
      status: value ? `Заглушено: ${peer}` : `Звук включён: ${peer}`,
    }));
    return;
  }
  if (t === "block_set_result") {
    const ok = Boolean(msg?.ok);
    const peer = String(msg?.peer ?? "").trim();
    const value = Boolean(msg?.value);
    if (!peer) return;
    if (!ok) {
      patch({ status: `Не удалось изменить блокировку: ${peer}` });
      return;
    }
    patch((prev) => ({
      ...prev,
      blocked: value ? Array.from(new Set([...prev.blocked, peer])) : prev.blocked.filter((x) => x !== peer),
      status: value ? `Заблокировано: ${peer}` : `Разблокировано: ${peer}`,
    }));
    return;
  }
  if (t === "blocked_by_update") {
    const peer = String(msg?.peer ?? "").trim();
    const value = Boolean(msg?.value);
    if (!peer) return;
    patch((prev) => ({
      ...prev,
      blockedBy: value ? Array.from(new Set([...prev.blockedBy, peer])) : prev.blockedBy.filter((x) => x !== peer),
      status: value ? `Вы заблокированы пользователем: ${peer}` : `Разблокировано пользователем: ${peer}`,
    }));
    return;
  }
  if (t === "chat_cleared") {
    const ok = Boolean(msg?.ok);
    const peer = String(msg?.peer ?? "").trim();
    if (!peer) return;
    if (!ok) {
      patch({ status: `Не удалось очистить историю: ${peer}` });
      return;
    }
    patch((prev) => {
      const key = dmKey(peer);
      const conv = { ...prev.conversations };
      delete conv[key];
      const loaded = { ...prev.historyLoaded };
      delete loaded[key];
      return {
        ...prev,
        conversations: conv,
        historyLoaded: loaded,
        friends: prev.friends.map((f) => (f.id === peer ? { ...f, unread: 0 } : f)),
        status: `История очищена: ${peer}`,
      };
    });
    return;
  }
  if (t === "friend_remove_result") {
    const ok = Boolean(msg?.ok);
    const peer = String(msg?.peer ?? "").trim();
    if (!peer) return;
    patch({ status: ok ? `Контакт удалён: ${peer}` : `Не удалось удалить контакт: ${peer}` });
    return;
  }
  if (t === "presence_update") {
    const id = String(msg?.id ?? "");
    if (!id) return;
    const online = Boolean(msg?.online);
    patch((prev) => ({
      ...prev,
      friends: prev.friends.map((f) => (f.id === id ? { ...f, online } : f)),
    }));
    return;
  }
  if (t === "unread_counts") {
    const raw = msg?.counts && typeof msg.counts === "object" ? msg.counts : {};
    patch((prev) => ({
      ...prev,
      // `counts` is an authoritative snapshot; absent keys mean 0 unread.
      friends: prev.friends.map((f) => ({ ...f, unread: Number((raw as any)[f.id] ?? 0) || 0 })),
    }));
    return;
  }
  if (t === "room_reads") {
    const raw = msg?.reads && typeof msg.reads === "object" ? msg.reads : {};
    patch((prev) => {
      const next = { ...(prev.lastRead || {}) };
      let changed = false;
      for (const [roomId, rawId] of Object.entries(raw as Record<string, unknown>)) {
        const id = Number(rawId);
        if (!Number.isFinite(id) || id <= 0) continue;
        const key = roomKey(String(roomId));
        const prevEntry = next[key] || {};
        if (prevEntry.id && id <= prevEntry.id) continue;
        next[key] = { ...prevEntry, id };
        changed = true;
      }
      if (!changed) return prev;
      if (prev.selfId) saveLastReadMarkers(prev.selfId, next);
      return { ...prev, lastRead: next };
    });
    return;
  }
  if (t === "authz_pending") {
    const raw = msg?.from;
    const pending = Array.isArray(raw) ? raw.map((x: any) => String(x || "").trim()).filter((x: string) => x) : [];
    if (!pending.length) return;
    patch((prev) => {
      const prevPending = Array.isArray((prev as any).pendingIn) ? (prev as any).pendingIn : [];
      let nextState: any = {
        ...prev,
        pendingIn: Array.from(new Set([...prevPending, ...pending])),
        status: `Ожидают авторизации: ${pending.length}`,
      };
      for (const peer of pending) {
        const id = String(peer || "").trim();
        if (!id) continue;
        const localId = `action:auth_in:${id}`;
        nextState = upsertConversationByLocalId(
          nextState,
          dmKey(id),
          sysActionMessage(id, `Входящий запрос на контакт: ${id}`, { kind: "auth_in", peer: id }, localId),
          localId
        );
      }
      return nextState;
    });
    return;
  }
  if (t === "authz_request") {
    const from = String(msg?.from ?? "").trim();
    if (!from) return;
    const hidden = isDocHidden();
    const viewingSame = Boolean(state.page === "main" && !state.modal && state.selected?.kind === "dm" && state.selected.id === from);
    const fromLabel = (() => {
      const p = state.profiles?.[from];
      const dn = p?.display_name ? String(p.display_name).trim() : "";
      const h = p?.handle ? String(p.handle).trim() : "";
      const handle = h ? (h.startsWith("@") ? h : `@${h}`) : "";
      return dn || handle || from;
    })();
    const note = String(msg?.note ?? "").trim();
    showInAppNotification(state, "Запрос авторизации", note ? `${fromLabel}: ${note}` : `От: ${fromLabel}`, `yagodka:authz_request:${from}`);
    maybePlaySound(state, "auth", hidden || !viewingSame);
    patch((prev) => {
      const prevPending = Array.isArray((prev as any).pendingIn) ? (prev as any).pendingIn : [];
      const nextPending = prevPending.includes(from) ? prevPending : [...prevPending, from];
      const localId = `action:auth_in:${from}`;
      let nextState: any = { ...prev, pendingIn: nextPending, status: `Входящий запрос: ${from}` };
      nextState = upsertConversationByLocalId(
        nextState,
        dmKey(from),
        sysActionMessage(from, `Входящий запрос на контакт: ${from}`, { kind: "auth_in", peer: from }, localId),
        localId
      );
      return nextState;
    });
    return;
  }
  if (t === "authz_request_result") {
    const ok = Boolean(msg?.ok);
    const to = String(msg?.to ?? "");
    if (!ok) {
      patch({ status: `Запрос не отправлен: ${String(msg?.reason ?? "ошибка")}` });
      return;
    }
    if (to) {
      patch((prev) => {
        const prevPending = Array.isArray((prev as any).pendingOut) ? (prev as any).pendingOut : [];
        const nextPending = prevPending.includes(to) ? prevPending : [...prevPending, to];
        const localId = `action:auth_out:${to}`;
        let nextState: any = { ...prev, pendingOut: nextPending, status: `Запрос отправлен: ${to}` };
        nextState = upsertConversationByLocalId(
          nextState,
          dmKey(to),
          sysActionMessage(to, `Запрос на контакт отправлен: ${to}`, { kind: "auth_out", peer: to }, localId),
          localId
        );
        return nextState;
      });
    }
    return;
  }
  if (t === "authz_response_result") {
    const ok = Boolean(msg?.ok);
    if (!ok) {
      patch({ status: `Ответ не принят: ${String(msg?.reason ?? "ошибка")}` });
      return;
    }
    const peer = String(msg?.peer ?? "");
    if (peer) {
      patch((prev) => {
        const prevPending = Array.isArray((prev as any).pendingIn) ? (prev as any).pendingIn : [];
        const nextPending = prevPending.filter((id: string) => id !== peer);
        const localId = `action:auth_in:${peer}`;
        let nextState: any = { ...prev, pendingIn: nextPending, status: `Ответ отправлен: ${peer}` };
        nextState = updateConversationByLocalId(nextState, dmKey(peer), localId, (m) => ({ ...m, text: `Ответ отправлен: ${peer}`, attachment: null }));
        return nextState;
      });
    }
    return;
  }
  if (t === "authz_cancel_result") {
    const ok = Boolean(msg?.ok);
    const peer = String(msg?.peer ?? "");
    if (!ok) {
      patch({ status: `Отмена не удалась: ${String(msg?.reason ?? "ошибка")}` });
      return;
    }
    if (peer) {
      patch((prev) => {
        const prevPending = Array.isArray((prev as any).pendingOut) ? (prev as any).pendingOut : [];
        const nextPending = prevPending.filter((id: string) => id !== peer);
        const localId = `action:auth_out:${peer}`;
        let nextState: any = { ...prev, pendingOut: nextPending, status: `Отмена запроса: ${peer}` };
        nextState = updateConversationByLocalId(nextState, dmKey(peer), localId, (m) => ({ ...m, text: `Запрос отменён: ${peer}`, attachment: null }));
        return nextState;
      });
    }
    return;
  }
  if (t === "authz_accepted") {
    const id = String(msg?.id ?? "").trim();
    if (!id) return;
    patch((prev) => {
      const prevIn = Array.isArray((prev as any).pendingIn) ? (prev as any).pendingIn : [];
      const prevOut = Array.isArray((prev as any).pendingOut) ? (prev as any).pendingOut : [];
      let nextState: any = {
        ...prev,
        pendingIn: prevIn.filter((x: string) => x !== id),
        pendingOut: prevOut.filter((x: string) => x !== id),
        status: `Запрос принят: ${id}`,
      };
      nextState = updateConversationByLocalId(nextState, dmKey(id), `action:auth_in:${id}`, (m) => ({ ...m, text: `Запрос принят: ${id}`, attachment: null }));
      nextState = updateConversationByLocalId(nextState, dmKey(id), `action:auth_out:${id}`, (m) => ({ ...m, text: `Запрос принят: ${id}`, attachment: null }));
      return nextState;
    });
    return;
  }
  if (t === "authz_declined") {
    const id = String(msg?.id ?? "").trim();
    if (!id) return;
    patch((prev) => {
      const prevIn = Array.isArray((prev as any).pendingIn) ? (prev as any).pendingIn : [];
      const prevOut = Array.isArray((prev as any).pendingOut) ? (prev as any).pendingOut : [];
      let nextState: any = {
        ...prev,
        pendingIn: prevIn.filter((x: string) => x !== id),
        pendingOut: prevOut.filter((x: string) => x !== id),
        status: `Запрос отклонён: ${id}`,
      };
      nextState = updateConversationByLocalId(nextState, dmKey(id), `action:auth_in:${id}`, (m) => ({ ...m, text: `Запрос отклонён: ${id}`, attachment: null }));
      nextState = updateConversationByLocalId(nextState, dmKey(id), `action:auth_out:${id}`, (m) => ({ ...m, text: `Запрос отклонён: ${id}`, attachment: null }));
      return nextState;
    });
    return;
  }
  if (t === "authz_cancelled") {
    const peer = String(msg?.peer ?? "").trim();
    if (!peer) return;
    patch((prev) => {
      const prevIn = Array.isArray((prev as any).pendingIn) ? (prev as any).pendingIn : [];
      const prevOut = Array.isArray((prev as any).pendingOut) ? (prev as any).pendingOut : [];
      let nextState: any = {
        ...prev,
        pendingIn: prevIn.filter((x: string) => x !== peer),
        pendingOut: prevOut.filter((x: string) => x !== peer),
        status: `Запрос отменён: ${peer}`,
      };
      nextState = updateConversationByLocalId(nextState, dmKey(peer), `action:auth_in:${peer}`, (m) => ({ ...m, text: `Запрос отменён: ${peer}`, attachment: null }));
      nextState = updateConversationByLocalId(nextState, dmKey(peer), `action:auth_out:${peer}`, (m) => ({ ...m, text: `Запрос отменён: ${peer}`, attachment: null }));
      return nextState;
    });
    return;
  }
  if (t === "groups") {
    const raw = Array.isArray(msg?.groups) ? msg.groups : [];
    patch((prev) => {
      const prevMap = new Map(prev.groups.map((g) => [g.id, g]));
      const groups: GroupEntry[] = raw
        .map((g: any) => {
          const id = String(g?.id ?? "");
          const prevEntry = prevMap.get(id);
          const hasDescription = g && Object.prototype.hasOwnProperty.call(g, "description");
          const hasRules = g && Object.prototype.hasOwnProperty.call(g, "rules");
          const description = hasDescription ? (g?.description ?? null) : (prevEntry?.description ?? null);
          const rules = hasRules ? (g?.rules ?? null) : (prevEntry?.rules ?? null);
          const nextMembers = Array.isArray(g?.members) ? (g.members as any[]).map((m) => String(m || "").trim()).filter(Boolean) : null;
          const nextPostBanned = Array.isArray(g?.post_banned)
            ? (g.post_banned as any[]).map((m) => String(m || "").trim()).filter(Boolean)
            : null;
          return {
            id,
            name: (g?.name ?? prevEntry?.name ?? null) as any,
            owner_id: (g?.owner_id ?? prevEntry?.owner_id ?? null) as any,
            handle: (g?.handle ?? prevEntry?.handle ?? null) as any,
            description,
            rules,
            ...(nextMembers ? { members: nextMembers } : prevEntry?.members ? { members: prevEntry.members } : {}),
            ...(nextPostBanned ? { post_banned: nextPostBanned } : prevEntry?.post_banned ? { post_banned: prevEntry.post_banned } : {}),
          } as GroupEntry;
        })
        .filter((g: GroupEntry) => g.id);
      return { ...prev, groups };
    });
    return;
  }
  if (t === "group_added" || t === "group_updated") {
    const g = msg?.group ?? null;
    patch((prev) => {
      const id = g ? String(g?.id ?? "") : "";
      if (!id) return prev;
      const hasDescription = g && Object.prototype.hasOwnProperty.call(g, "description");
      const hasRules = g && Object.prototype.hasOwnProperty.call(g, "rules");
      const hasMembers = Array.isArray(g?.members);
      const nextMembers = hasMembers ? (g.members as any[]).map((m) => String(m || "").trim()).filter(Boolean) : null;
      const hasPostBanned = Array.isArray(g?.post_banned);
      const nextPostBanned = hasPostBanned ? (g.post_banned as any[]).map((m) => String(m || "").trim()).filter(Boolean) : null;
      const prevEntry = prev.groups.find((x) => x.id === id);
      const description = hasDescription ? (g?.description ?? null) : (prevEntry?.description ?? null);
      const rules = hasRules ? (g?.rules ?? null) : (prevEntry?.rules ?? null);
      const upd: GroupEntry = {
        id,
        name: (g?.name ?? prevEntry?.name ?? null) as any,
        owner_id: (g?.owner_id ?? prevEntry?.owner_id ?? null) as any,
        handle: (g?.handle ?? prevEntry?.handle ?? null) as any,
        description,
        rules,
        ...(hasMembers ? { members: nextMembers || [] } : prevEntry?.members ? { members: prevEntry.members } : {}),
        ...(hasPostBanned ? { post_banned: nextPostBanned || [] } : prevEntry?.post_banned ? { post_banned: prevEntry.post_banned } : {}),
      };
      const next = prev.groups.filter((x) => x.id !== upd.id);
      next.push(upd);
      next.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
      return { ...prev, groups: next, pendingGroupInvites: prev.pendingGroupInvites.filter((inv) => inv.groupId !== upd.id) };
    });
    return;
  }
  if (t === "group_info_result") {
    const ok = Boolean(msg?.ok);
    const g = msg?.group ?? null;
    const gid = String(g?.id ?? msg?.group_id ?? "").trim();
    if (!ok) {
      const reason = String(msg?.reason || "ошибка");
      patch({ status: `Не удалось получить чат: ${reason}` });
      return;
    }
    if (!gid) return;
    const members = Array.isArray(g?.members) ? g.members.map((m: any) => String(m || "").trim()).filter(Boolean) : [];
    const postBanned = Array.isArray(g?.post_banned) ? g.post_banned.map((m: any) => String(m || "").trim()).filter(Boolean) : [];
    patch((prev) => {
      const prevEntry = prev.groups.find((x) => x.id === gid);
      const hasDescription = g && Object.prototype.hasOwnProperty.call(g, "description");
      const hasRules = g && Object.prototype.hasOwnProperty.call(g, "rules");
      const upd: GroupEntry = {
        id: gid,
        name: (g?.name ?? prevEntry?.name ?? null) as any,
        owner_id: (g?.owner_id ?? prevEntry?.owner_id ?? null) as any,
        handle: (g?.handle ?? prevEntry?.handle ?? null) as any,
        description: (hasDescription ? g?.description : prevEntry?.description) as any,
        rules: (hasRules ? g?.rules : prevEntry?.rules) as any,
        members,
        post_banned: postBanned,
      };
      const next = prev.groups.filter((x) => x.id !== gid);
      next.push(upd);
      next.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
      return { ...prev, groups: next };
    });
    return;
  }
  if (t === "group_post_set_result") {
    const ok = Boolean(msg?.ok);
    const gid = String(msg?.group_id ?? "").trim();
    const member = String(msg?.member_id ?? "").trim();
    const value = Boolean(msg?.value);
    if (!ok) {
      const reason = String(msg?.reason ?? "ошибка");
      const message =
        reason === "bad_args"
          ? "Некорректные данные"
          : reason === "forbidden_or_not_found"
            ? "Только владелец может менять права"
            : reason === "not_in_group"
              ? "Пользователь не найден в чате"
              : "Не удалось изменить права";
      patch({ status: `Изменение прав не выполнено: ${message}` });
      return;
    }
    if (!gid || !member) return;
    patch((prev) => {
      const prevEntry = prev.groups.find((x) => x.id === gid);
      if (!prevEntry) return prev;
      const nextBanned = new Set((prevEntry.post_banned || []).map((x) => String(x || "").trim()).filter(Boolean));
      if (value) nextBanned.add(member);
      else nextBanned.delete(member);
      const upd: GroupEntry = { ...prevEntry, post_banned: Array.from(nextBanned) };
      const next = prev.groups.filter((x) => x.id !== gid);
      next.push(upd);
      next.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
      return { ...prev, groups: next, status: value ? `Запрещено писать: ${member}` : `Разрешено писать: ${member}` };
    });
    return;
  }
  if (t === "group_post_update") {
    const gid = String(msg?.group_id ?? "").trim();
    const member = String(msg?.member_id ?? "").trim();
    const value = Boolean(msg?.value);
    if (!gid || !member) return;
    patch((prev) => {
      const prevEntry = prev.groups.find((x) => x.id === gid);
      if (!prevEntry) return prev;
      const nextBanned = new Set((prevEntry.post_banned || []).map((x) => String(x || "").trim()).filter(Boolean));
      if (value) nextBanned.add(member);
      else nextBanned.delete(member);
      const upd: GroupEntry = { ...prevEntry, post_banned: Array.from(nextBanned) };
      const next = prev.groups.filter((x) => x.id !== gid);
      next.push(upd);
      next.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
      return { ...prev, groups: next };
    });
    return;
  }
  if (t === "group_removed") {
    const id = String(msg?.id ?? msg?.group_id ?? "");
    if (!id) return;
    const by = String(msg?.by ?? "").trim();
    const name = String(msg?.name ?? "").trim();
    const label = name ? `${name} (${id})` : id;
    const key = roomKey(id);
    patch((prev) => {
      const sel = prev.selected;
      const selectedRemoved = Boolean(sel && sel.kind === "group" && sel.id === id);
      const { [key]: _dropConv, ...restConv } = prev.conversations;
      const { [key]: _dropLoaded, ...restLoaded } = prev.historyLoaded;
      return {
        ...prev,
        groups: prev.groups.filter((g) => g.id !== id),
        selected: selectedRemoved ? null : prev.selected,
        conversations: selectedRemoved ? restConv : prev.conversations,
        historyLoaded: selectedRemoved ? restLoaded : prev.historyLoaded,
        status: by ? `Удалены из чата: ${label} (by ${by})` : `Удалены из чата: ${label}`,
      };
    });
    return;
  }
  if (t === "boards") {
    const raw = Array.isArray(msg?.boards) ? msg.boards : [];
    const boards: BoardEntry[] = raw
      .map((b: any) => {
        const hasDescription = b && Object.prototype.hasOwnProperty.call(b, "description");
        const hasRules = b && Object.prototype.hasOwnProperty.call(b, "rules");
        return {
          id: String(b?.id ?? ""),
          name: (b?.name ?? null) as any,
          owner_id: (b?.owner_id ?? null) as any,
          handle: (b?.handle ?? null) as any,
          description: (hasDescription ? b?.description : null) as any,
          rules: (hasRules ? b?.rules : null) as any,
          ...(Array.isArray(b?.members)
            ? { members: (b.members as any[]).map((m) => String(m || "").trim()).filter(Boolean) }
            : {}),
        };
      })
      .filter((b: BoardEntry) => b.id);
    patch({ boards });
    return;
  }
  if (t === "board_added" || t === "board_updated") {
    const b = msg?.board ?? null;
    patch((prev) => {
      const id = b ? String(b?.id ?? "") : "";
      if (!id) return prev;
      const hasDescription = b && Object.prototype.hasOwnProperty.call(b, "description");
      const hasRules = b && Object.prototype.hasOwnProperty.call(b, "rules");
      const hasMembers = Array.isArray(b?.members);
      const nextMembers = hasMembers ? (b.members as any[]).map((m) => String(m || "").trim()).filter(Boolean) : null;
      const prevEntry = prev.boards.find((x) => x.id === id);
      const description = hasDescription ? (b?.description ?? null) : (prevEntry?.description ?? null);
      const rules = hasRules ? (b?.rules ?? null) : (prevEntry?.rules ?? null);
      const upd: BoardEntry = {
        id,
        name: (b?.name ?? prevEntry?.name ?? null) as any,
        owner_id: (b?.owner_id ?? prevEntry?.owner_id ?? null) as any,
        handle: (b?.handle ?? prevEntry?.handle ?? null) as any,
        description,
        rules,
        ...(hasMembers ? { members: nextMembers || [] } : prevEntry?.members ? { members: prevEntry.members } : {}),
      };
      const next = prev.boards.filter((x) => x.id !== upd.id);
      next.push(upd);
      next.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
      return { ...prev, boards: next, pendingBoardInvites: prev.pendingBoardInvites.filter((inv) => inv.boardId !== upd.id) };
    });
    return;
  }
  if (t === "board_info_result") {
    const ok = Boolean(msg?.ok);
    const b = msg?.board ?? null;
    const bid = String(b?.id ?? msg?.board_id ?? "").trim();
    if (!ok) {
      const reason = String(msg?.reason || "ошибка");
      patch({ status: `Не удалось получить доску: ${reason}` });
      return;
    }
    if (!bid) return;
    const members = Array.isArray(b?.members) ? b.members.map((m: any) => String(m || "").trim()).filter(Boolean) : [];
    patch((prev) => {
      const prevEntry = prev.boards.find((x) => x.id === bid);
      const hasDescription = b && Object.prototype.hasOwnProperty.call(b, "description");
      const hasRules = b && Object.prototype.hasOwnProperty.call(b, "rules");
      const upd: BoardEntry = {
        id: bid,
        name: (b?.name ?? prevEntry?.name ?? null) as any,
        owner_id: (b?.owner_id ?? prevEntry?.owner_id ?? null) as any,
        handle: (b?.handle ?? prevEntry?.handle ?? null) as any,
        description: (hasDescription ? b?.description : prevEntry?.description) as any,
        rules: (hasRules ? b?.rules : prevEntry?.rules) as any,
        members,
      };
      const next = prev.boards.filter((x) => x.id !== bid);
      next.push(upd);
      next.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
      return { ...prev, boards: next };
    });
    return;
  }
  if (t === "board_removed") {
    const id = String(msg?.id ?? msg?.board_id ?? "");
    if (!id) return;
    const by = String(msg?.by ?? "").trim();
    const name = String(msg?.name ?? "").trim();
    const label = name ? `${name} (${id})` : id;
    const key = roomKey(id);
    patch((prev) => {
      const sel = prev.selected;
      const selectedRemoved = Boolean(sel && sel.kind === "board" && sel.id === id);
      const { [key]: _dropConv, ...restConv } = prev.conversations;
      const { [key]: _dropLoaded, ...restLoaded } = prev.historyLoaded;
      return {
        ...prev,
        boards: prev.boards.filter((b) => b.id !== id),
        selected: selectedRemoved ? null : prev.selected,
        conversations: selectedRemoved ? restConv : prev.conversations,
        historyLoaded: selectedRemoved ? restLoaded : prev.historyLoaded,
        status: by ? `Удалены из доски: ${label} (by ${by})` : `Удалены из доски: ${label}`,
      };
    });
    return;
  }
  if (t === "group_rename_result") {
    const ok = Boolean(msg?.ok);
    const gid = String(msg?.group_id ?? "").trim();
    if (!ok) {
      const reason = String(msg?.reason ?? "ошибка");
      const message =
        reason === "not_authenticated"
          ? "Нужно авторизоваться"
          : reason === "rate_limited"
            ? "Слишком часто. Попробуйте позже"
            : reason === "bad_args"
              ? "Некорректные данные"
              : reason === "name_too_long"
                ? "Название слишком длинное"
                : reason === "forbidden_or_not_found"
                  ? "Только владелец может переименовать чат"
                  : "Не удалось переименовать чат";
      patch((prev) => ({
        ...prev,
        modal: prev.modal?.kind === "rename" && prev.modal.targetKind === "group" && (!gid || prev.modal.targetId === gid) ? { ...prev.modal, message } : prev.modal,
        status: `Переименование не выполнено: ${message}`,
      }));
      return;
    }
    const name = String(msg?.name ?? "").trim();
    patch((prev) => ({
      ...prev,
      modal: prev.modal?.kind === "rename" && prev.modal.targetKind === "group" && (!gid || prev.modal.targetId === gid) ? null : prev.modal,
      status: name ? `Чат переименован: ${name}` : "Чат переименован",
    }));
    return;
  }
  if (t === "group_set_info_result") {
    const ok = Boolean(msg?.ok);
    const gid = String(msg?.group_id ?? msg?.group?.id ?? "").trim();
    if (!ok) {
      const reason = String(msg?.reason ?? "ошибка");
      const message =
        reason === "not_authenticated"
          ? "Нужно авторизоваться"
          : reason === "rate_limited"
            ? "Слишком часто. Попробуйте позже"
            : reason === "bad_gid"
              ? "Некорректный ID чата"
              : reason === "description_too_long"
                ? "Описание слишком длинное"
                : reason === "rules_too_long"
                  ? "Правила слишком длинные"
                  : reason === "forbidden_or_not_found"
                    ? "Только владелец может менять информацию"
                    : "Не удалось обновить информацию";
      patch({ status: `Обновление не выполнено: ${message}` });
      return;
    }
    const g = msg?.group ?? null;
    if (g?.id) {
      patch((prev) => {
        const id = String(g?.id ?? "");
        if (!id) return prev;
        const prevEntry = prev.groups.find((x) => x.id === id);
        const hasDescription = g && Object.prototype.hasOwnProperty.call(g, "description");
        const hasRules = g && Object.prototype.hasOwnProperty.call(g, "rules");
        const upd: GroupEntry = {
          id,
          name: (g?.name ?? prevEntry?.name ?? null) as any,
          owner_id: (g?.owner_id ?? prevEntry?.owner_id ?? null) as any,
          handle: (g?.handle ?? prevEntry?.handle ?? null) as any,
          description: (hasDescription ? g?.description : prevEntry?.description) as any,
          rules: (hasRules ? g?.rules : prevEntry?.rules) as any,
          members: prevEntry?.members,
          post_banned: prevEntry?.post_banned,
        };
        const next = prev.groups.filter((x) => x.id !== upd.id);
        next.push(upd);
        next.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
        return { ...prev, groups: next, status: "Информация чата обновлена" };
      });
      return;
    }
    patch({ status: gid ? `Информация чата обновлена: ${gid}` : "Информация чата обновлена" });
    return;
  }
  if (t === "board_rename_result") {
    const ok = Boolean(msg?.ok);
    const bid = String(msg?.board_id ?? "").trim();
    if (!ok) {
      const reason = String(msg?.reason ?? "ошибка");
      const message =
        reason === "not_authenticated"
          ? "Нужно авторизоваться"
          : reason === "rate_limited"
            ? "Слишком часто. Попробуйте позже"
            : reason === "bad_args"
              ? "Некорректные данные"
              : reason === "name_too_long"
                ? "Название слишком длинное"
                : reason === "forbidden_or_not_found"
                  ? "Только владелец может переименовать доску"
                  : "Не удалось переименовать доску";
      patch((prev) => ({
        ...prev,
        modal: prev.modal?.kind === "rename" && prev.modal.targetKind === "board" && (!bid || prev.modal.targetId === bid) ? { ...prev.modal, message } : prev.modal,
        status: `Переименование не выполнено: ${message}`,
      }));
      return;
    }
    const name = String(msg?.name ?? "").trim();
    patch((prev) => ({
      ...prev,
      modal: prev.modal?.kind === "rename" && prev.modal.targetKind === "board" && (!bid || prev.modal.targetId === bid) ? null : prev.modal,
      status: name ? `Доска переименована: ${name}` : "Доска переименована",
    }));
    return;
  }
  if (t === "board_set_info_result") {
    const ok = Boolean(msg?.ok);
    const bid = String(msg?.board_id ?? msg?.board?.id ?? "").trim();
    if (!ok) {
      const reason = String(msg?.reason ?? "ошибка");
      const message =
        reason === "not_authenticated"
          ? "Нужно авторизоваться"
          : reason === "rate_limited"
            ? "Слишком часто. Попробуйте позже"
            : reason === "bad_id"
              ? "Некорректный ID доски"
              : reason === "description_too_long"
                ? "Описание слишком длинное"
                : reason === "rules_too_long"
                  ? "Правила слишком длинные"
                  : reason === "forbidden_or_not_found"
                    ? "Только владелец может менять информацию"
                    : "Не удалось обновить информацию";
      patch({ status: `Обновление не выполнено: ${message}` });
      return;
    }
    const b = msg?.board ?? null;
    if (b?.id) {
      patch((prev) => {
        const id = String(b?.id ?? "");
        if (!id) return prev;
        const prevEntry = prev.boards.find((x) => x.id === id);
        const hasDescription = b && Object.prototype.hasOwnProperty.call(b, "description");
        const hasRules = b && Object.prototype.hasOwnProperty.call(b, "rules");
        const upd: BoardEntry = {
          id,
          name: (b?.name ?? prevEntry?.name ?? null) as any,
          owner_id: (b?.owner_id ?? prevEntry?.owner_id ?? null) as any,
          handle: (b?.handle ?? prevEntry?.handle ?? null) as any,
          description: (hasDescription ? b?.description : prevEntry?.description) as any,
          rules: (hasRules ? b?.rules : prevEntry?.rules) as any,
          members: prevEntry?.members,
        };
        const next = prev.boards.filter((x) => x.id !== upd.id);
        next.push(upd);
        next.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
        return { ...prev, boards: next, status: "Информация доски обновлена" };
      });
      return;
    }
    patch({ status: bid ? `Информация доски обновлена: ${bid}` : "Информация доски обновлена" });
    return;
  }
  if (t === "group_disband_result") {
    const ok = Boolean(msg?.ok);
    if (!ok) {
      patch({ status: `Чат не удалён: ${String(msg?.reason ?? "ошибка")}` });
      return;
    }
    const gid = String(msg?.group_id ?? "").trim();
    patch({ status: gid ? `Чат удалён: ${gid}` : "Чат удалён" });
    return;
  }
  if (t === "board_disband_result") {
    const ok = Boolean(msg?.ok);
    if (!ok) {
      patch({ status: `Доска не удалена: ${String(msg?.reason ?? "ошибка")}` });
      return;
    }
    const bid = String(msg?.board_id ?? "").trim();
    patch({ status: bid ? `Доска удалена: ${bid}` : "Доска удалена" });
    return;
  }
  if (t === "group_remove_result") {
    const ok = Boolean(msg?.ok);
    const gid = String(msg?.group_id ?? "").trim();
    if (!ok) {
      const reason = String(msg?.reason ?? "ошибка");
      const message =
        reason === "bad_args"
          ? "Некорректные данные"
          : reason === "forbidden_or_not_found"
            ? "Только владелец может удалять участников"
            : reason === "no_members"
              ? "Не найдено подходящих участников"
              : "Не удалось удалить участников";
      patch((prev) => ({
        ...prev,
        modal: prev.modal?.kind === "members_remove" && prev.modal.targetKind === "group" && (!gid || prev.modal.targetId === gid) ? { ...prev.modal, message } : prev.modal,
        status: `Удаление не выполнено: ${message}`,
      }));
      return;
    }
    const removed = (Array.isArray(msg?.removed) ? msg.removed : []).map((x: any) => String(x || "").trim()).filter(Boolean);
    const preview = removed.length <= 3 ? removed.join(", ") : `${removed.slice(0, 3).join(", ")}…`;
    patch((prev) => ({
      ...prev,
      modal: prev.modal?.kind === "members_remove" && prev.modal.targetKind === "group" && (!gid || prev.modal.targetId === gid) ? null : prev.modal,
      status: removed.length ? `Удалены из чата: ${removed.length} (${preview})` : "Удаление выполнено",
    }));
    return;
  }
  if (t === "board_remove_result") {
    const ok = Boolean(msg?.ok);
    const bid = String(msg?.board_id ?? "").trim();
    if (!ok) {
      const reason = String(msg?.reason ?? "ошибка");
      const message =
        reason === "bad_args"
          ? "Некорректные данные"
          : reason === "forbidden_or_not_found"
            ? "Только владелец может удалять участников"
            : reason === "no_members"
              ? "Не найдено подходящих участников"
              : "Не удалось удалить участников";
      patch((prev) => ({
        ...prev,
        modal: prev.modal?.kind === "members_remove" && prev.modal.targetKind === "board" && (!bid || prev.modal.targetId === bid) ? { ...prev.modal, message } : prev.modal,
        status: `Удаление не выполнено: ${message}`,
      }));
      return;
    }
    const removed = (Array.isArray(msg?.removed) ? msg.removed : []).map((x: any) => String(x || "").trim()).filter(Boolean);
    const preview = removed.length <= 3 ? removed.join(", ") : `${removed.slice(0, 3).join(", ")}…`;
    patch((prev) => ({
      ...prev,
      modal: prev.modal?.kind === "members_remove" && prev.modal.targetKind === "board" && (!bid || prev.modal.targetId === bid) ? null : prev.modal,
      status: removed.length ? `Удалены из доски: ${removed.length} (${preview})` : "Удаление выполнено",
    }));
    return;
  }
  if (t === "group_create_result") {
    const ok = Boolean(msg?.ok);
    if (!ok) {
      const reason = String(msg?.reason ?? "ошибка");
      const message =
        reason === "empty_name"
          ? "Введите название чата"
          : reason === "name_too_long"
            ? "Название слишком длинное"
            : reason === "description_too_long"
              ? "Описание слишком длинное"
              : reason === "rules_too_long"
                ? "Правила слишком длинные"
            : reason === "rate_limited"
              ? "Слишком часто. Попробуйте позже"
              : reason === "not_authenticated"
                ? "Нужно авторизоваться"
                : "Не удалось создать чат";
      patch((prev) => ({
        ...prev,
        groupCreateMessage: prev.page === "group_create" ? message : prev.groupCreateMessage,
        status: `Чат не создан: ${message}`,
      }));
      return;
    }
    const g = msg?.group ?? null;
    if (g?.id) {
      patch((prev) => ({
        ...prev,
        groups: [
          ...prev.groups.filter((x) => x.id !== String(g.id)),
          {
            id: String(g.id),
            name: g.name ?? null,
            owner_id: g.owner_id ?? null,
            handle: g.handle ?? null,
            description: g.description ?? null,
            rules: g.rules ?? null,
          },
        ],
        groupCreateMessage: "",
        page: prev.page === "group_create" ? "main" : prev.page,
        status: `Чат создан: ${String(g.name || g.id)}`,
      }));
    }
    return;
  }
  if (t === "board_create_result") {
    const ok = Boolean(msg?.ok);
    if (!ok) {
      const reason = String(msg?.reason ?? "ошибка");
      const message =
        reason === "empty_name"
          ? "Введите название доски"
          : reason === "name_too_long"
            ? "Название слишком длинное"
            : reason === "description_too_long"
              ? "Описание слишком длинное"
              : reason === "rules_too_long"
                ? "Правила слишком длинные"
            : reason === "handle_invalid"
              ? "Некорректный хэндл"
              : reason === "handle_taken"
                ? "Хэндл уже занят"
                : reason === "rate_limited"
                  ? "Слишком часто. Попробуйте позже"
                  : reason === "not_authenticated"
                    ? "Нужно авторизоваться"
                    : "Не удалось создать доску";
      patch((prev) => ({
        ...prev,
        boardCreateMessage: prev.page === "board_create" ? message : prev.boardCreateMessage,
        status: `Доска не создана: ${message}`,
      }));
      return;
    }
    const b = msg?.board ?? null;
    if (b?.id) {
      patch((prev) => ({
        ...prev,
        boards: [
          ...prev.boards.filter((x) => x.id !== String(b.id)),
          {
            id: String(b.id),
            name: b.name ?? null,
            owner_id: b.owner_id ?? null,
            handle: b.handle ?? null,
            description: b.description ?? null,
            rules: b.rules ?? null,
          },
        ],
        boardCreateMessage: "",
        page: prev.page === "board_create" ? "main" : prev.page,
        status: `Доска создана: ${String(b.name || b.id)}`,
      }));
    }
    return;
  }
  if (t === "group_add_result") {
    const ok = Boolean(msg?.ok);
    const gid = String(msg?.group_id ?? "").trim();
    if (!ok) {
      const reason = String(msg?.reason ?? "ошибка");
      const message =
        reason === "bad_gid"
          ? "Некорректный ID чата"
          : reason === "not_found"
            ? "Чат не найден"
            : reason === "forbidden"
              ? "Только владелец может добавлять участников"
              : "Не удалось отправить приглашения";
      patch((prev) => ({
        ...prev,
        modal:
          prev.modal?.kind === "members_add" && prev.modal.targetKind === "group" && (!gid || prev.modal.targetId === gid)
            ? { ...prev.modal, message }
            : prev.modal,
        status: `Приглашения не отправлены: ${message}`,
      }));
      return;
    }
    const invited = (Array.isArray(msg?.invited) ? msg.invited : []).map((x: any) => String(x || "").trim()).filter(Boolean);
    if (!invited.length) {
      const message = "Не найдено подходящих пользователей (существующие + дружба)";
      patch((prev) => ({
        ...prev,
        modal:
          prev.modal?.kind === "members_add" && prev.modal.targetKind === "group" && (!gid || prev.modal.targetId === gid)
            ? { ...prev.modal, message }
            : prev.modal,
        status: message,
      }));
      return;
    }
    const preview = invited.length <= 3 ? invited.join(", ") : `${invited.slice(0, 3).join(", ")}…`;
    patch((prev) => ({
      ...prev,
      modal:
        prev.modal?.kind === "members_add" && prev.modal.targetKind === "group" && (!gid || prev.modal.targetId === gid) ? null : prev.modal,
      status: `Приглашены в чат: ${invited.length} (${preview})`,
    }));
    return;
  }
  if (t === "board_add_result") {
    const ok = Boolean(msg?.ok);
    const bid = String(msg?.board_id ?? "").trim();
    if (!ok) {
      const reason = String(msg?.reason ?? "ошибка");
      const message =
        reason === "bad_id"
          ? "Некорректный ID доски"
          : reason === "forbidden_or_not_found"
            ? "Только владелец может добавлять участников"
            : reason === "no_members"
              ? "Не найдено подходящих пользователей"
              : "Не удалось добавить участников";
      patch((prev) => ({
        ...prev,
        modal:
          prev.modal?.kind === "members_add" && prev.modal.targetKind === "board" && (!bid || prev.modal.targetId === bid)
            ? { ...prev.modal, message }
            : prev.modal,
        status: `Добавление не выполнено: ${message}`,
      }));
      return;
    }
    const added = (Array.isArray(msg?.added) ? msg.added : []).map((x: any) => String(x || "").trim()).filter(Boolean);
    const preview = !added.length ? "" : added.length <= 3 ? added.join(", ") : `${added.slice(0, 3).join(", ")}…`;
    patch((prev) => ({
      ...prev,
      modal:
        prev.modal?.kind === "members_add" && prev.modal.targetKind === "board" && (!bid || prev.modal.targetId === bid) ? null : prev.modal,
      status: added.length ? `Добавлены в доску: ${added.length} (${preview})` : "Добавление выполнено",
    }));
    return;
  }
  if (t === "group_invite") {
    const group = msg?.group ?? null;
    const groupId = String(msg?.group_id ?? group?.id ?? "");
    const from = String(msg?.from ?? "");
    if (!groupId || !from) return;
    const hidden = isDocHidden();
    const viewingSame = Boolean(state.page === "main" && !state.modal && state.selected?.kind === "dm" && state.selected.id === from);
    const label = String(msg?.name ?? group?.name ?? msg?.handle ?? group?.handle ?? groupId).trim() || groupId;
    const fromLabel = (() => {
      const p = state.profiles?.[from];
      const dn = p?.display_name ? String(p.display_name).trim() : "";
      const h = p?.handle ? String(p.handle).trim() : "";
      const handle = h ? (h.startsWith("@") ? h : `@${h}`) : "";
      return dn || handle || from;
    })();
    showInAppNotification(state, `Приглашение в чат: ${label}`, `От: ${fromLabel}`, `yagodka:group_invite:${groupId}:${from}`);
    maybePlaySound(state, "invite", hidden || !viewingSame);
    const entry: ActionModalGroupInvite = {
      kind: "group_invite",
      groupId,
      from,
      name: (msg?.name ?? group?.name ?? null) as any,
      handle: (msg?.handle ?? group?.handle ?? null) as any,
      description: (msg?.description ?? group?.description ?? null) as any,
      rules: (msg?.rules ?? group?.rules ?? null) as any,
    };
    patch((prev) => {
      const prevInv = Array.isArray((prev as any).pendingGroupInvites) ? (prev as any).pendingGroupInvites : [];
      const pendingGroupInvites = prevInv.some((inv: any) => inv.groupId === groupId && inv.from === from) ? prevInv : [...prevInv, entry];
      const label = String(entry.name || entry.handle || groupId);
      const localId = `action:group_invite:${groupId}:${from}`;
      let nextState: any = { ...prev, pendingGroupInvites, status: `Приглашение в чат: ${label}` };
      nextState = upsertConversationByLocalId(
        nextState,
        dmKey(from),
        sysActionMessage(from, `Приглашение в чат: ${label}`, entry, localId),
        localId
      );
      return nextState;
    });
    return;
  }
  if (t === "group_invite_result") {
    const ok = Boolean(msg?.ok);
    if (!ok) {
      patch({ status: `Приглашение не отправлено: ${String(msg?.reason ?? "ошибка")}` });
      return;
    }
    const gid = String(msg?.group_id ?? "");
    if (gid) patch({ status: `Приглашение отправлено: ${gid}` });
    return;
  }
  if (t === "group_join_request") {
    const groupId = String(msg?.group_id ?? "");
    const from = String(msg?.from ?? "");
    if (!groupId || !from) return;
    const hidden = isDocHidden();
    const viewingSame = Boolean(state.page === "main" && !state.modal && state.selected?.kind === "dm" && state.selected.id === from);
    const label = String(msg?.name ?? msg?.handle ?? groupId).trim() || groupId;
    const fromLabel = (() => {
      const p = state.profiles?.[from];
      const dn = p?.display_name ? String(p.display_name).trim() : "";
      const h = p?.handle ? String(p.handle).trim() : "";
      const handle = h ? (h.startsWith("@") ? h : `@${h}`) : "";
      return dn || handle || from;
    })();
    showInAppNotification(state, `Запрос на вступление: ${label}`, `От: ${fromLabel}`, `yagodka:group_join_request:${groupId}:${from}`);
    maybePlaySound(state, "auth", hidden || !viewingSame);
    const entry: ActionModalGroupJoinRequest = {
      kind: "group_join_request",
      groupId,
      from,
      name: (msg?.name ?? null) as any,
      handle: (msg?.handle ?? null) as any,
    };
    patch((prev) => {
      const prevReq = Array.isArray((prev as any).pendingGroupJoinRequests) ? (prev as any).pendingGroupJoinRequests : [];
      const pendingGroupJoinRequests = prevReq.some((req: any) => req.groupId === groupId && req.from === from) ? prevReq : [...prevReq, entry];
      const label = String(entry.name || entry.handle || groupId);
      const localId = `action:group_join_request:${groupId}:${from}`;
      let nextState: any = { ...prev, pendingGroupJoinRequests, status: `Запрос на вступление: ${label}` };
      nextState = upsertConversationByLocalId(
        nextState,
        dmKey(from),
        sysActionMessage(from, `Запрос на вступление в чат: ${label}`, entry, localId),
        localId
      );
      return nextState;
    });
    return;
  }
  if (t === "group_join_request_result") {
    const ok = Boolean(msg?.ok);
    if (!ok) {
      patch({ status: `Запрос не отправлен: ${String(msg?.reason ?? "ошибка")}` });
      return;
    }
    const gid = String(msg?.group_id ?? "");
    if (gid) patch({ status: `Запрос отправлен: ${gid}` });
    return;
  }
  if (t === "group_join_declined") {
    const gid = String(msg?.group_id ?? "");
    if (gid) patch({ status: `Запрос отклонён: ${gid}` });
    return;
  }
  if (t === "group_join_response_result") {
    const ok = Boolean(msg?.ok);
    if (!ok) {
      patch({ status: `Ответ не принят: ${String(msg?.reason ?? "ошибка")}` });
      return;
    }
    const gid = String(msg?.group_id ?? "");
    const peer = String(msg?.peer ?? "");
    if (gid && peer) patch({ status: `Ответ отправлен: ${peer}` });
    return;
  }
  if (t === "board_invite") {
    const board = msg?.board ?? null;
    const boardId = String(msg?.board_id ?? board?.id ?? "");
    const from = String(msg?.from ?? "");
    if (!boardId || !from) return;
    const hidden = isDocHidden();
    const viewingSame = Boolean(state.page === "main" && !state.modal && state.selected?.kind === "dm" && state.selected.id === from);
    const label = String(msg?.name ?? board?.name ?? msg?.handle ?? board?.handle ?? boardId).trim() || boardId;
    const fromLabel = (() => {
      const p = state.profiles?.[from];
      const dn = p?.display_name ? String(p.display_name).trim() : "";
      const h = p?.handle ? String(p.handle).trim() : "";
      const handle = h ? (h.startsWith("@") ? h : `@${h}`) : "";
      return dn || handle || from;
    })();
    showInAppNotification(state, `Приглашение в доску: ${label}`, `От: ${fromLabel}`, `yagodka:board_invite:${boardId}:${from}`);
    maybePlaySound(state, "invite", hidden || !viewingSame);
    const entry: ActionModalBoardInvite = {
      kind: "board_invite",
      boardId,
      from,
      name: (msg?.name ?? board?.name ?? null) as any,
      handle: (msg?.handle ?? board?.handle ?? null) as any,
      description: (msg?.description ?? board?.description ?? null) as any,
      rules: (msg?.rules ?? board?.rules ?? null) as any,
    };
    patch((prev) => {
      const prevInv = Array.isArray((prev as any).pendingBoardInvites) ? (prev as any).pendingBoardInvites : [];
      const pendingBoardInvites = prevInv.some((inv: any) => inv.boardId === boardId && inv.from === from) ? prevInv : [...prevInv, entry];
      const label = String(entry.name || entry.handle || boardId);
      const localId = `action:board_invite:${boardId}:${from}`;
      let nextState: any = { ...prev, pendingBoardInvites, status: `Приглашение в доску: ${label}` };
      nextState = upsertConversationByLocalId(
        nextState,
        dmKey(from),
        sysActionMessage(from, `Приглашение в доску: ${label}`, entry, localId),
        localId
      );
      return nextState;
    });
    return;
  }
  if (t === "board_invite_result") {
    const ok = Boolean(msg?.ok);
    if (!ok) {
      patch({ status: `Инвайт не отправлен: ${String(msg?.reason ?? "ошибка")}` });
      return;
    }
    const bid = String(msg?.board_id ?? "");
    if (bid) patch({ status: `Инвайт отправлен: ${bid}` });
    return;
  }
  if (t === "board_invite_response_result") {
    const ok = Boolean(msg?.ok);
    if (!ok) {
      const reason = String(msg?.reason ?? "ошибка");
      const friendly =
        reason === "no_invite"
          ? "Нет активного приглашения (возможно, уже обработано)"
          : reason === "not_found"
            ? "Доска не найдена"
            : reason === "bad_args"
              ? "Некорректные данные"
              : reason;
      patch({ status: `Не удалось обработать приглашение: ${friendly}` });
      return;
    }
    const bid = String(msg?.board_id ?? "");
    const accept = msg?.accept === undefined ? null : Boolean(msg.accept);
    if (bid && accept === true) patch({ status: `Приглашение принято: ${bid}` });
    else if (bid && accept === false) patch({ status: `Приглашение отклонено: ${bid}` });
    else patch({ status: "Приглашение обработано" });
    return;
  }
  if (t === "board_join_result") {
    const ok = Boolean(msg?.ok);
    if (!ok) {
      patch({ status: `Не удалось вступить: ${String(msg?.reason ?? "ошибка")}` });
      return;
    }
    const bid = String(msg?.board_id ?? "");
    if (bid) patch({ status: `Вступление: ${bid}` });
    return;
  }
  if (t === "search_result") {
    const q = String(msg?.query ?? "").trim();
    const expected = deriveServerSearchQuery(state.searchQuery)?.query ?? null;
    if (!expected || q !== expected) {
      // Ignore stale/out-of-order search results (keeps UI consistent with current input).
      return;
    }
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
    patch({ searchResults: results, status: results.length ? `Найдено: ${results.length}` : "Ничего не найдено" });
    return;
  }
  if (t === "profile") {
    const id = String(msg?.id ?? "");
    if (!id) return;
    const avatarRev = Math.max(0, Math.trunc(Number(msg?.avatar_rev ?? 0) || 0));
    const avatarMimeRaw = msg?.avatar_mime;
    const avatarMime = typeof avatarMimeRaw === "string" && avatarMimeRaw.trim() ? String(avatarMimeRaw).trim() : null;
    const prof: UserProfile = {
      id,
      display_name: (msg?.display_name ?? null) as any,
      handle: (msg?.handle ?? null) as any,
      bio: (msg?.bio ?? null) as any,
      status: (msg?.status ?? null) as any,
      avatar_rev: avatarRev,
      avatar_mime: (avatarMime ?? null) as any,
      client_version: (msg?.client_version ?? null) as any,
      client_web_version: (msg?.client_web_version ?? null) as any,
    };
    const isFriend = Boolean(state.selfId && id === state.selfId) || state.friends.some((f) => f.id === id);
    if (isFriend) {
      const hasAvatar = Boolean(avatarMime);
      if (!hasAvatar) {
        const storedUrl = getStoredAvatar("dm", id);
        const storedRev = getStoredAvatarRev("dm", id);
        if (storedUrl) {
          clearStoredAvatar("dm", id);
          storeAvatarRev("dm", id, avatarRev);
          patch((prev) => ({ ...prev, avatarsRev: (prev.avatarsRev || 0) + 1 }));
        } else if (storedRev !== avatarRev) {
          storeAvatarRev("dm", id, avatarRev);
        }
      } else {
        const storedRev = getStoredAvatarRev("dm", id);
        const storedUrl = getStoredAvatar("dm", id);
        if (storedRev !== avatarRev || !storedUrl) gateway.send({ type: "avatar_get", id });
      }
    }
    patch((prev) => {
      const next: AppState = { ...prev, profiles: { ...prev.profiles, [id]: prof } };
      if (id === prev.selfId) {
        // Keep drafts in sync unless user is actively editing on the Profile page.
        const draftsEmpty = !prev.profileDraftDisplayName && !prev.profileDraftHandle && !prev.profileDraftBio && !prev.profileDraftStatus;
        if (prev.page !== "profile" || draftsEmpty) {
          next.profileDraftDisplayName = String(prof.display_name ?? "");
          next.profileDraftHandle = String(prof.handle ?? "");
          next.profileDraftBio = String(prof.bio ?? "");
          next.profileDraftStatus = String(prof.status ?? "");
        }
      }
      return next;
    });
    return;
  }
  if (t === "profile_updated") {
    const id = String(msg?.id ?? "");
    if (!id) return;
    const hasAvatarRev = msg?.avatar_rev !== undefined;
    const avatarRev = hasAvatarRev ? Math.max(0, Math.trunc(Number(msg?.avatar_rev ?? 0) || 0)) : null;
    const hasAvatarMime = msg?.avatar_mime !== undefined;
    const avatarMimeRaw = msg?.avatar_mime;
    const avatarMime = typeof avatarMimeRaw === "string" && avatarMimeRaw.trim() ? String(avatarMimeRaw).trim() : null;
    const isFriend = Boolean(state.selfId && id === state.selfId) || state.friends.some((f) => f.id === id);
    if (isFriend && hasAvatarRev) {
      const hasAvatar = Boolean(avatarMime);
      if (hasAvatarMime && !hasAvatar) {
        const storedUrl = getStoredAvatar("dm", id);
        const storedRev = getStoredAvatarRev("dm", id);
        if (storedUrl) {
          clearStoredAvatar("dm", id);
          storeAvatarRev("dm", id, avatarRev || 0);
          patch((prev) => ({ ...prev, avatarsRev: (prev.avatarsRev || 0) + 1 }));
        } else if (storedRev !== (avatarRev || 0)) {
          storeAvatarRev("dm", id, avatarRev || 0);
        }
      } else if (hasAvatar) {
        const storedRev = getStoredAvatarRev("dm", id);
        const storedUrl = getStoredAvatar("dm", id);
        if (storedRev !== avatarRev || !storedUrl) gateway.send({ type: "avatar_get", id });
      }
    }
    patch((prev) => {
      const cur = prev.profiles[id] ?? { id };
      const nextProfile: UserProfile = {
        ...cur,
        id,
        ...(msg?.display_name === undefined ? {} : { display_name: (msg?.display_name ?? null) as any }),
        ...(msg?.handle === undefined ? {} : { handle: (msg?.handle ?? null) as any }),
        ...(msg?.bio === undefined ? {} : { bio: (msg?.bio ?? null) as any }),
        ...(msg?.status === undefined ? {} : { status: (msg?.status ?? null) as any }),
        ...(msg?.avatar_rev === undefined ? {} : { avatar_rev: (avatarRev ?? 0) as any }),
        ...(msg?.avatar_mime === undefined ? {} : { avatar_mime: (avatarMime ?? null) as any }),
      };
      return { ...prev, profiles: { ...prev.profiles, [id]: nextProfile } };
    });
    return;
  }
  if (t === "profile_set_result") {
    const ok = Boolean(msg?.ok);
    if (!ok) {
      const reason = String(msg?.reason ?? "ошибка");
      const message =
        reason === "handle_taken"
          ? "Этот @handle уже занят"
            : reason === "handle_invalid"
              ? "Некорректный @handle (только a-z, 0-9, _; длина 3–16)"
            : reason === "too_long"
              ? "Слишком длинное значение"
            : reason === "empty"
                ? "Поле не должно быть пустым"
              : reason === "no_such_user"
                ? "Пользователь не найден"
                : reason === "server_error"
                  ? "Ошибка сервера"
                    : reason;
      patch({ status: `Не удалось сохранить профиль: ${message}` });
      return;
    }
    patch((prev) => {
      if (!prev.selfId) return { ...prev, status: "Профиль сохранён" };
      const cur = prev.profiles[prev.selfId] ?? { id: prev.selfId };
      const displayName = (msg?.display_name ?? null) as any;
      const handle = (msg?.handle ?? null) as any;
      const bio = (msg?.bio ?? null) as any;
      const statusText = (msg?.status ?? null) as any;
      const nextProfile: UserProfile = { ...cur, display_name: displayName, handle, bio, status: statusText };
      return {
        ...prev,
        profiles: { ...prev.profiles, [prev.selfId]: nextProfile },
        profileDraftDisplayName: String(displayName ?? ""),
        profileDraftHandle: String(handle ?? ""),
        profileDraftBio: String(bio ?? ""),
        profileDraftStatus: String(statusText ?? ""),
        status: "Профиль сохранён",
      };
    });
    return;
  }
  if (t === "avatar") {
    const id = String(msg?.id ?? "").trim();
    if (!id) return;
    const rev = Math.max(0, Math.trunc(Number(msg?.rev ?? 0) || 0));
    const mime = typeof msg?.mime === "string" && msg.mime.trim() ? String(msg.mime).trim() : null;
    const data = typeof msg?.data === "string" && msg.data.trim() ? String(msg.data).trim() : null;

    if (mime && data) {
      const dataUrl = `data:${mime};base64,${data}`;
      try {
        storeAvatar("dm", id, dataUrl);
      } catch {
        clearStoredAvatar("dm", id);
      }
    } else {
      clearStoredAvatar("dm", id);
    }
    storeAvatarRev("dm", id, rev);

    patch((prev) => {
      const cur = prev.profiles[id] ?? { id };
      const nextProfile: UserProfile = { ...cur, id, avatar_rev: rev, avatar_mime: mime };
      return { ...prev, profiles: { ...prev.profiles, [id]: nextProfile }, avatarsRev: (prev.avatarsRev || 0) + 1 };
    });
    return;
  }
  if (t === "avatar_set_result") {
    const ok = Boolean(msg?.ok);
    if (!ok) {
      patch({ status: `Не удалось обновить аватар: ${String(msg?.reason ?? "ошибка")}` });
      return;
    }
    const rev = Math.max(0, Math.trunc(Number(msg?.avatar_rev ?? 0) || 0));
    patch((prev) => {
      if (!prev.selfId) return prev;
      storeAvatarRev("dm", prev.selfId, rev);
      const cur = prev.profiles[prev.selfId] ?? { id: prev.selfId };
      const nextProfile: UserProfile = { ...cur, id: prev.selfId, avatar_rev: rev };
      return { ...prev, profiles: { ...prev.profiles, [prev.selfId]: nextProfile }, avatarsRev: (prev.avatarsRev || 0) + 1, status: "Аватар обновлён" };
    });
    return;
  }
  if (t === "avatar_clear_result") {
    const ok = Boolean(msg?.ok);
    if (!ok) {
      patch({ status: `Не удалось удалить аватар: ${String(msg?.reason ?? "ошибка")}` });
      return;
    }
    const rev = Math.max(0, Math.trunc(Number(msg?.avatar_rev ?? 0) || 0));
    patch((prev) => {
      if (!prev.selfId) return prev;
      clearStoredAvatar("dm", prev.selfId);
      storeAvatarRev("dm", prev.selfId, rev);
      const cur = prev.profiles[prev.selfId] ?? { id: prev.selfId };
      const nextProfile: UserProfile = { ...cur, id: prev.selfId, avatar_rev: rev, avatar_mime: null };
      return { ...prev, profiles: { ...prev.profiles, [prev.selfId]: nextProfile }, avatarsRev: (prev.avatarsRev || 0) + 1, status: "Аватар удалён" };
    });
    return;
  }
  if (t === "message") {
    const from = String(msg?.from ?? "");
    const to = msg?.to ? String(msg.to) : undefined;
    const room = msg?.room ? String(msg.room) : undefined;
    const text = String(msg?.text ?? "");
    const ts = Number(msg?.ts ?? nowTs()) || nowTs();
    const edited = Boolean(msg?.edited);
    const editedTsRaw = (msg as any)?.edited_ts;
    const edited_ts = typeof editedTsRaw === "number" && Number.isFinite(editedTsRaw) ? editedTsRaw : undefined;
    const key = room ? roomKey(room) : dmKey(from === state.selfId ? String(to ?? "") : from);
    if (!key || key.endsWith(":")) return;
    const kind = from === state.selfId ? "out" : "in";
    const attachment = parseAttachment(msg?.attachment);
    const reply = parseMessageRef((msg as any)?.reply);
    const forward = parseMessageRef((msg as any)?.forward);
    if (kind === "in") {
      const hidden = isDocHidden();
      const viewingSame =
        Boolean(state.page === "main" && !state.modal && room && state.selected && state.selected.id === room) ||
        Boolean(state.page === "main" && !state.modal && !room && state.selected?.kind === "dm" && state.selected.id === from);
      const profile = state.profiles?.[from];
      let fromLabel = String(profile?.display_name || "").trim();
      if (!fromLabel) {
        const handle = String(profile?.handle || "").trim();
        fromLabel = handle ? (handle.startsWith("@") ? handle : `@${handle}`) : from;
      }
      let title = `Сообщение от ${fromLabel || from}`;
      let body = String(text || "").trim();
      if (!body) {
        if (attachment?.kind === "file") body = `Файл: ${attachment.name || "файл"}`;
        else body = "Новое сообщение";
      }
      if (room) {
        const group = (state.groups || []).find((g) => g.id === room);
        const board = !group ? (state.boards || []).find((b) => b.id === room) : null;
        const roomLabel = group ? String(group.name || group.id) : board ? String(board.name || board.id) : room;
        title = group ? `Чат: ${roomLabel}` : board ? `Доска: ${roomLabel}` : `Чат: ${roomLabel}`;
        if (fromLabel) body = `${fromLabel}: ${body}`;
      }
      showInAppNotification(state, title, body, room ? `yagodka:room:${room}` : `yagodka:dm:${from}`);
      maybePlaySound(state, "message", hidden || !viewingSame);
    }
    patch((prev) =>
      upsertConversation(prev, key, {
        kind,
        from,
        to,
        room,
        text,
        ts,
        id: msg?.id ?? null,
        attachment,
        ...(reply ? { reply } : {}),
        ...(forward ? { forward } : {}),
        ...(edited ? { edited: true } : {}),
        ...(edited && edited_ts ? { edited_ts } : {}),
      })
    );

    // If we're actively viewing this DM, mark as read immediately to keep unread counters consistent.
    if (!room && kind === "in" && state.page === "main" && !state.modal && state.selected?.kind === "dm" && state.selected.id === from) {
      const upToId = typeof msg?.id === "number" ? msg.id : undefined;
      gateway.send({ type: "message_read", peer: from, ...(upToId === undefined ? {} : { up_to_id: upToId }) });
    }
    return;
  }
  if (t === "message_delivered") {
    const to = msg?.to ? String(msg.to) : undefined;
    const room = msg?.room ? String(msg.room) : undefined;
    const key = room ? roomKey(room) : to ? dmKey(to) : "";
    if (!key) return;
    const rawId = msg?.id;
    const id = typeof rawId === "number" && Number.isFinite(rawId) ? rawId : null;
    patch((prev) => {
      const curOutbox = ((prev as any).outbox || {}) as any;
      const conv = prev.conversations[key];
      if (id !== null && Array.isArray(conv) && conv.length) {
        const idx = conv.findIndex((m) => m.kind === "out" && typeof m.id === "number" && m.id === id);
        if (idx >= 0) {
          const cur = conv[idx];
          const next = [...conv];
          next[idx] = { ...cur, status: "delivered" };
          const lid = typeof cur.localId === "string" && cur.localId.trim() ? cur.localId.trim() : null;
          const outbox = lid ? removeOutboxEntry(curOutbox, key, lid) : curOutbox;
          return { ...prev, conversations: { ...prev.conversations, [key]: next }, outbox };
        }
      }
      const updated = updateFirstPendingOutgoing(prev, key, (msg) => ({ ...msg, id, status: "delivered" }));
      const nextOutbox = ((updated.state as any).outbox || curOutbox) as any;
      const outbox = updated.localId ? removeOutboxEntry(nextOutbox, key, updated.localId) : nextOutbox;
      return { ...updated.state, outbox };
    });
    return;
  }
  if (t === "message_deleted") {
    const ok = msg?.ok;
    if (ok === false) {
      const reason = String(msg?.reason ?? "ошибка");
      patch({ status: `Не удалось удалить сообщение: ${reason}` });
      return;
    }
    const from = String(msg?.from ?? "");
    const to = msg?.to ? String(msg.to) : undefined;
    const room = msg?.room ? String(msg.room) : undefined;
    const rawId = msg?.id;
    const id = typeof rawId === "number" && Number.isFinite(rawId) ? rawId : null;
    if (id === null) return;
    const key = room ? roomKey(room) : dmKey(from === state.selfId ? String(to ?? "") : from);
    if (!key) return;
    patch((prev) => {
      const conv = prev.conversations[key];
      if (!Array.isArray(conv) || !conv.length) return prev;
      const nextConv = conv.filter((m) => m.id !== id);
      if (nextConv.length === conv.length) return prev;
      const pinnedIds = prev.pinnedMessages[key];
      const hadPinned = Array.isArray(pinnedIds) && pinnedIds.includes(id);
      const nextPinned = hadPinned ? { ...prev.pinnedMessages } : prev.pinnedMessages;
      const nextActive = hadPinned ? { ...prev.pinnedMessageActive } : prev.pinnedMessageActive;
      if (hadPinned) {
        const nextList = pinnedIds.filter((x) => x !== id);
        if (nextList.length) {
          nextPinned[key] = nextList;
          if (nextActive[key] === id || !nextList.includes(nextActive[key])) nextActive[key] = nextList[0];
        } else {
          delete nextPinned[key];
          delete nextActive[key];
        }
      }
      const next = {
        ...prev,
        conversations: { ...prev.conversations, [key]: nextConv },
        pinnedMessages: nextPinned,
        pinnedMessageActive: nextActive,
      };
      if (prev.editing && prev.editing.key === key && prev.editing.id === id) {
        return { ...next, editing: null, input: prev.editing.prevDraft || "" };
      }
      return next;
    });
    patch({ status: "Сообщение удалено" });
    return;
  }
  if (t === "message_edited") {
    const ok = msg?.ok;
    if (ok === false) {
      const reason = String(msg?.reason ?? "ошибка");
      patch({ status: `Не удалось изменить сообщение: ${reason}` });
      return;
    }
    const from = String(msg?.from ?? "").trim();
    const to = msg?.to ? String(msg.to).trim() : "";
    const room = msg?.room ? String(msg.room).trim() : "";
    const text = String(msg?.text ?? "");
    const editedTsRaw = (msg as any)?.edited_ts;
    const edited_ts = typeof editedTsRaw === "number" && Number.isFinite(editedTsRaw) ? editedTsRaw : undefined;
    const rawId = msg?.id;
    const id = typeof rawId === "number" && Number.isFinite(rawId) ? rawId : null;
    if (id === null) return;
    let didUpdate = false;
    patch((prev) => {
      const conversations = (prev as any).conversations || {};
      const candidates: string[] = [];
      if (room) candidates.push(roomKey(room));
      if (!room) {
        const selfId = String((prev as any).selfId ?? "").trim();
        const peer = selfId && from && from === selfId ? to : from;
        if (peer) candidates.push(dmKey(peer));
      }
      const selected = (prev as any).selected;
      const selectedKey = selected ? (selected.kind === "dm" ? dmKey(String(selected.id || "")) : roomKey(String(selected.id || ""))) : "";
      if (selectedKey && !candidates.includes(selectedKey)) candidates.push(selectedKey);

      const tryUpdate = (key: string): AppState | null => {
        const k = String(key || "").trim();
        if (!k) return null;
        const conv = conversations[k];
        if (!Array.isArray(conv) || !conv.length) return null;
        const idx = conv.findIndex((m) => typeof m?.id === "number" && m.id === id);
        if (idx < 0) return null;
        const next = [...conv];
        const cur = next[idx];
        next[idx] = { ...cur, text, edited: true, ...(edited_ts ? { edited_ts } : {}) };
        didUpdate = true;
        return { ...(prev as any), conversations: { ...conversations, [k]: next } } as AppState;
      };

      for (const k of candidates) {
        const next = tryUpdate(k);
        if (next) return next;
      }

      // Fallback: routing metadata может отсутствовать, но msg_id глобально уникален — найдём по всем чатам.
      for (const [k, conv] of Object.entries(conversations)) {
        if (!Array.isArray(conv) || !conv.length) continue;
        const idx = (conv as any[]).findIndex((m) => typeof m?.id === "number" && m.id === id);
        if (idx < 0) continue;
        const nextConv = [...(conv as any[])];
        const cur = nextConv[idx];
        nextConv[idx] = { ...cur, text, edited: true, ...(edited_ts ? { edited_ts } : {}) };
        didUpdate = true;
        return { ...(prev as any), conversations: { ...conversations, [k]: nextConv } } as AppState;
      }

      return prev;
    });
    patch({ status: didUpdate ? "Сообщение изменено" : "Сообщение изменено (обновится после синхронизации)" });
    return;
  }
  if (t === "message_queued") {
    const to = msg?.to ? String(msg.to) : undefined;
    if (!to) return;
    const id = msg?.id ?? null;
    const key = dmKey(to);
    patch((prev) => {
      const curOutbox = ((prev as any).outbox || {}) as any;
      const updated = updateFirstPendingOutgoing(prev, key, (msg) => ({ ...msg, id, status: "queued" }));
      const nextOutbox = ((updated.state as any).outbox || curOutbox) as any;
      const outbox = updated.localId ? removeOutboxEntry(nextOutbox, key, updated.localId) : nextOutbox;
      return { ...updated.state, outbox };
    });
    return;
  }
  if (t === "message_blocked") {
    const to = String(msg?.to ?? "");
    const reason = String(msg?.reason ?? "blocked");
    if (!to) return;
    patch({ status: `Сообщение не отправлено: ${reason}` });
    const key = dmKey(to);
    patch((prev) => {
      const curOutbox = ((prev as any).outbox || {}) as any;
      const updated = updateFirstPendingOutgoing(prev, key, (msg) => ({ ...msg, status: "error" }));
      const nextOutbox = ((updated.state as any).outbox || curOutbox) as any;
      const outbox = updated.localId ? removeOutboxEntry(nextOutbox, key, updated.localId) : nextOutbox;
      return { ...updated.state, outbox };
    });
    patch((prev) =>
      upsertConversation(prev, dmKey(to), { kind: "sys", from: "", to, text: `[blocked] ${reason}`, ts: nowTs(), id: null })
    );
    return;
  }
  if (t === "message_read_ack") {
    const peer = String(msg?.peer ?? "").trim();
    const rawUpTo = msg?.up_to_id;
    const upTo = typeof rawUpTo === "number" && Number.isFinite(rawUpTo) ? rawUpTo : null;
    if (!peer) return;
    patch((prev) => {
      const key = dmKey(peer);
      const conv = prev.conversations[key];
      if (!conv || conv.length === 0) return prev;
      let changed = false;
      const next = conv.map((m) => {
        if (m.kind !== "out") return m;
        if (m.id === undefined || m.id === null) return m;
        if (upTo !== null && Number(m.id) > upTo) return m;
        if (m.status === "read") return m;
        changed = true;
        return { ...m, status: "read" as const };
      });
      if (!changed) return prev;
      return { ...prev, conversations: { ...prev.conversations, [key]: next } };
    });
    return;
  }
  if (t === "reaction_update") {
    const rawId = msg?.id;
    const id = typeof rawId === "number" && Number.isFinite(rawId) ? rawId : Number(rawId);
    if (!Number.isFinite(id) || id <= 0) return;
    const room = msg?.room ? String(msg.room).trim() : "";
    const peer = msg?.peer ? String(msg.peer).trim() : "";
    const actor = String(msg?.user ?? "").trim();
    const rawEmoji = (msg as any)?.emoji;
    const emoji = typeof rawEmoji === "string" && rawEmoji.trim() ? String(rawEmoji) : null;

    const countsRaw = (msg as any)?.counts;
    if (!countsRaw || typeof countsRaw !== "object") return;
    const counts: Record<string, number> = {};
    for (const [k, v] of Object.entries(countsRaw as Record<string, unknown>)) {
      const e = String(k || "").trim();
      const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : Math.trunc(Number(v) || 0);
      if (!e || n <= 0) continue;
      counts[e] = n;
    }

    patch((prev) => {
      const conversations = (prev as any).conversations || {};
      const candidates: string[] = [];
      if (room) candidates.push(roomKey(room));
      if (peer) candidates.push(dmKey(peer));
      const selected = (prev as any).selected;
      const selectedKey = selected ? (selected.kind === "dm" ? dmKey(String(selected.id || "")) : roomKey(String(selected.id || ""))) : "";
      if (selectedKey && !candidates.includes(selectedKey)) candidates.push(selectedKey);

      const applyToKey = (key: string): AppState | null => {
        const k = String(key || "").trim();
        if (!k) return null;
        const conv = conversations[k];
        if (!Array.isArray(conv) || !conv.length) return null;
        const idx = conv.findIndex((m) => typeof m?.id === "number" && m.id === id);
        if (idx < 0) return null;
        const next = [...conv];
        const cur = next[idx] as any;
        const prevReacts = (cur as any).reactions && typeof (cur as any).reactions === "object" ? (cur as any).reactions : null;
        const prevMine = prevReacts && typeof prevReacts.mine === "string" ? String(prevReacts.mine) : null;
        const selfId = String((prev as any).selfId ?? "").trim();
        const mine = selfId && actor && actor === selfId ? emoji : prevMine;
        const nextReacts = Object.keys(counts).length || mine !== null ? ({ counts, mine } as any) : null;
        next[idx] = { ...cur, reactions: nextReacts };
        return { ...(prev as any), conversations: { ...conversations, [k]: next } } as AppState;
      };

      for (const k of candidates) {
        const next = applyToKey(k);
        if (next) return next;
      }

      // Fallback: msg_id глобально уникален — найдём по всем чатам.
      for (const [k, conv] of Object.entries(conversations)) {
        if (!Array.isArray(conv) || !conv.length) continue;
        const idx = (conv as any[]).findIndex((m) => typeof m?.id === "number" && m.id === id);
        if (idx < 0) continue;
        const nextConv = [...(conv as any[])];
        const cur = nextConv[idx];
        const prevReacts = (cur as any).reactions && typeof (cur as any).reactions === "object" ? (cur as any).reactions : null;
        const prevMine = prevReacts && typeof prevReacts.mine === "string" ? String(prevReacts.mine) : null;
        const selfId = String((prev as any).selfId ?? "").trim();
        const mine = selfId && actor && actor === selfId ? emoji : prevMine;
        const nextReacts = Object.keys(counts).length || mine !== null ? ({ counts, mine } as any) : null;
        nextConv[idx] = { ...(cur as any), reactions: nextReacts };
        return { ...(prev as any), conversations: { ...conversations, [k]: nextConv } } as AppState;
      }

      return prev;
    });
    return;
  }
  if (t === "history_result") {
    const resultRoom = msg?.room ? String(msg.room) : undefined;
    const resultPeer = msg?.peer ? String(msg.peer) : undefined;
    const key = resultRoom ? roomKey(resultRoom) : resultPeer ? dmKey(resultPeer) : "";
    if (!key) return;
    const isPreview = Boolean(msg?.preview);
    const beforeIdRaw = msg?.before_id;
    const hasBefore = beforeIdRaw !== undefined && beforeIdRaw !== null;
    const hasMore = hasBefore ? Boolean(msg?.has_more) : undefined;
    const readUpToRaw = msg?.read_up_to_id;
    const readUpToId = Number(readUpToRaw);
    const rows = Array.isArray(msg?.rows) ? msg.rows : [];
    const incoming: ChatMessage[] = [];
    for (const r of rows) {
      const from = String(r?.from ?? "");
      if (!from) continue;
      const to = r?.to ? String(r.to) : undefined;
      const room = resultRoom ? resultRoom : r?.room ? String(r.room) : undefined;
      const text = String(r?.text ?? "");
      const ts = Number(r?.ts ?? nowTs()) || nowTs();
      const id = r?.id === undefined || r?.id === null ? null : Number(r.id);
      const kind: ChatMessage["kind"] = from === state.selfId ? "out" : "in";
      const hasId = typeof id === "number" && Number.isFinite(id);
      const delivered = Boolean(r?.delivered);
      const read = Boolean(r?.read);
      const edited = Boolean(r?.edited);
      const editedTsRaw = (r as any)?.edited_ts;
      const edited_ts = typeof editedTsRaw === "number" && Number.isFinite(editedTsRaw) ? editedTsRaw : undefined;
      const status: ChatMessage["status"] | undefined =
        !room && kind === "out" && hasId ? (read ? "read" : delivered ? "delivered" : "queued") : undefined;
      const attachment = parseAttachment(r?.attachment);
      const reply = parseMessageRef((r as any)?.reply);
      const forward = parseMessageRef((r as any)?.forward);
      const reactions = parseReactions((r as any)?.reactions);
      incoming.push({
        kind,
        from,
        to,
        room,
        text,
        ts,
        id,
        attachment,
        ...(reply ? { reply } : {}),
        ...(forward ? { forward } : {}),
        ...(reactions ? { reactions } : {}),
        ...(status ? { status } : {}),
        ...(edited ? { edited: true } : {}),
        ...(edited && edited_ts ? { edited_ts } : {}),
      });
    }
    patch((prev) => {
      let baseConv = prev.conversations[key] ?? [];
      let outbox = (((prev as any).outbox || {}) as any) as any;
      let nextLastRead = prev.lastRead;
      let lastReadChanged = false;

      // Best-effort dedup for reconnect: if history already contains our message, bind it to a pending outbox entry
      // (so we don't resend and we don't show duplicates).
      const pendingRaw = outbox[key];
      const pending: OutboxEntry[] = Array.isArray(pendingRaw) ? pendingRaw : [];
      if (pending.length && incoming.length) {
        const left = [...pending];
        let conv = baseConv;
        let changed = false;
        for (const inc of incoming) {
          if (inc.kind !== "out") continue;
          const incId = typeof inc.id === "number" && Number.isFinite(inc.id) && inc.id > 0 ? inc.id : null;
          if (incId === null) continue;
          if (inc.attachment) continue;
          const text = String(inc.text || "");
          if (!text) continue;

          let bestIdx = -1;
          let bestDelta = Infinity;
          for (let i = 0; i < left.length; i += 1) {
            const e = left[i];
            if (!e) continue;
            if (e.text !== text) continue;
            if (e.to && inc.to && e.to !== inc.to) continue;
            if (e.room && inc.room && e.room !== inc.room) continue;
            const delta = Math.abs(Number(e.ts) - Number(inc.ts));
            if (!Number.isFinite(delta) || delta > 12) continue;
            if (delta < bestDelta) {
              bestDelta = delta;
              bestIdx = i;
            }
          }
          if (bestIdx < 0) continue;
          const matched = left[bestIdx];
          left.splice(bestIdx, 1);
          const lid = typeof matched.localId === "string" ? matched.localId : "";
          if (!lid) continue;

          const idx = conv.findIndex((m) => m.kind === "out" && (m.id === undefined || m.id === null) && typeof m.localId === "string" && m.localId === lid);
          if (idx >= 0) {
            const next = [...conv];
            next[idx] = { ...next[idx], id: incId, status: inc.status ?? next[idx].status, ts: inc.ts };
            conv = next;
            changed = true;
          }
          outbox = removeOutboxEntry(outbox, key, lid);
        }
        if (changed) baseConv = conv;
      }

      const nextConv = mergeMessages(baseConv, incoming);
      const delta = nextConv.length - baseConv.length;
      const cursor = oldestLoadedId(nextConv);
      const prevCursor = (prev as any).historyCursor || {};
      const prevHasMoreMap = (prev as any).historyHasMore || {};
      const prevLoadingMap = (prev as any).historyLoading || {};
      const prevVirtualStart = (prev as any).historyVirtualStart ? (prev as any).historyVirtualStart[key] : undefined;
      const shouldShiftVirtual = hasBefore && typeof prevVirtualStart === "number" && Number.isFinite(prevVirtualStart) && delta > 0;
      const nextVirtualStart = shouldShiftVirtual ? Math.max(0, prevVirtualStart + delta) : prevVirtualStart;
      if (resultRoom && Number.isFinite(readUpToId) && readUpToId > 0) {
        const prevEntry = (nextLastRead || {})[key] || {};
        if (!prevEntry.id || readUpToId > prevEntry.id) {
          const merged = { ...(nextLastRead || {}), [key]: { ...prevEntry, id: readUpToId } };
          nextLastRead = merged;
          lastReadChanged = true;
          if (prev.selfId) saveLastReadMarkers(prev.selfId, merged);
        }
      }
      if (isPreview) {
        const base = {
          ...prev,
          conversations: { ...prev.conversations, [key]: nextConv },
          outbox,
        };
        return lastReadChanged ? { ...base, lastRead: nextLastRead } : base;
      }
      const base = {
        ...prev,
        conversations: { ...prev.conversations, [key]: nextConv },
        outbox,
        historyLoaded: { ...prev.historyLoaded, [key]: true },
        historyCursor: cursor !== null ? { ...prevCursor, [key]: cursor } : prevCursor,
        historyHasMore: hasBefore ? { ...prevHasMoreMap, [key]: Boolean(hasMore) } : prevHasMoreMap,
        historyLoading: { ...prevLoadingMap, [key]: false },
        ...(shouldShiftVirtual ? { historyVirtualStart: { ...(prev as any).historyVirtualStart, [key]: nextVirtualStart } } : {}),
      };
      return lastReadChanged ? { ...base, lastRead: nextLastRead } : base;
    });
    return;
  }
  if (t === "update_required") {
    const latest = String(msg?.latest ?? "").trim();
    if (!latest) return;
    const hasSw = (() => {
      try {
        return typeof navigator !== "undefined" && "serviceWorker" in navigator;
      } catch {
        return false;
      }
    })();
    const isBuildId = /-[a-f0-9]{12}$/i.test(latest);
    if (hasSw && isBuildId) {
      if (state.updateLatest !== latest) {
        patch({ updateLatest: latest, status: "Доступно обновление веб-клиента (применится автоматически)" });
      }
      try {
        void navigator.serviceWorker.getRegistration().then((reg) => reg?.update()).catch(() => {});
      } catch {
        // ignore
      }
      return;
    }
    if (state.updateDismissedLatest && state.updateDismissedLatest === latest) return;
    const hint = isMobileLikeUi() ? "" : " (Ctrl+U — применить)";
    patch({ updateLatest: latest, status: `Доступно обновление до v${latest}${hint}`, modal: { kind: "update" } });
    return;
  }
  if (t === "error") {
    const raw = String(msg?.message ?? "error");
    const friendly = humanizeError(raw);
    patch({ status: `Ошибка: ${friendly}` });

    const sel = state.selected;
    if (state.page === "main" && !state.modal && sel) {
      const sendRelated = new Set([
        "not_in_group",
        "board_post_forbidden",
        "board_check_failed",
        "group_check_failed",
        "broadcast_disabled",
        "message_too_long",
        "bad_text",
        "bad_recipient",
        "rate_limited",
      ]);
      if (sendRelated.has(raw)) {
        const key = sel.kind === "dm" ? dmKey(sel.id) : roomKey(sel.id);
        patch((prev) => {
          const curOutbox = ((prev as any).outbox || {}) as any;
          const updated = updateFirstPendingOutgoing(prev, key, (msg) => ({ ...msg, status: "error" }));
          const nextOutbox = ((updated.state as any).outbox || curOutbox) as any;
          const outbox = updated.localId ? removeOutboxEntry(nextOutbox, key, updated.localId) : nextOutbox;
          return { ...updated.state, outbox };
        });
        patch((prev) =>
          upsertConversation(prev, key, {
            kind: "sys",
            from: "",
            ...(sel.kind === "dm" ? { to: sel.id } : { room: sel.id }),
            text: `[ошибка] ${friendly}`,
            ts: nowTs(),
            id: null,
          })
        );
      }
    }
    return;
  }

  // noop for now
  void gateway;
}
