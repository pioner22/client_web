import { getMeetBaseUrl } from "../../../config/env";
import type { AppState, TargetRef } from "../../../stores/types";
import type { Store } from "../../../stores/store";
import { buildMeetJoinUrl, type CallMode } from "../../../helpers/calls/meetUrl";
import { isMobileLikeUi } from "../../../helpers/ui/mobileLike";
import type { TabNotifier } from "../../../helpers/notify/tabNotifier";

export type ToastFn = (
  message: string,
  opts?: {
    kind?: "info" | "success" | "warn" | "error";
    undo?: () => void;
    actions?: Array<{ id: string; label: string; primary?: boolean; onClick: () => void }>;
    timeoutMs?: number;
    placement?: "bottom" | "center";
  }
) => void;

export interface CallsFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => void;
  showToast: ToastFn;
  tabNotifier: TabNotifier;
  formatTargetLabel: (st: AppState, target: TargetRef) => string;
  formatSenderLabel: (st: AppState, senderId: string) => string;
}

export type CallModalState = Extract<AppState["modal"], { kind: "call" }>;

export interface CallsFeature {
  startCall: (mode: CallMode) => void;
  acceptCall: (callId: string) => void;
  declineCall: (callId: string) => void;
  handleMessage: (msg: any) => boolean;
  closeCallModal: () => void;
}

function formatCallCreateError(reasonRaw: string, limit?: number): string {
  const reason = String(reasonRaw || "").trim();
  const map: Record<string, string> = {
    rate_limited: "Слишком часто. Попробуйте позже",
    bad_mode: "Некорректный режим звонка",
    bad_target: "Некорректный получатель",
    caller_busy: "Вы уже звоните",
    bad_peer: "Некорректный ID получателя",
    not_authorized: "Можно звонить только друзьям",
    blocked_by_recipient: "Пользователь вас заблокировал",
    blocked_by_sender: "Вы заблокировали пользователя",
    server_error: "Ошибка сервера",
    peer_offline: "Пользователь оффлайн",
    peer_busy: "Пользователь занят",
    not_supported: "Звонки тут не поддерживаются",
    not_in_group: "Вы не участник этого чата",
    group_check_failed: "Не удалось проверить доступ к чату",
    no_online_peers: "Никого нет онлайн",
  };
  if (reason === "too_many_participants") {
    const lim = Number(limit ?? 0);
    return lim > 0 ? `Слишком много участников (лимит ${lim})` : "Слишком много участников";
  }
  return map[reason] ?? (reason || "ошибка");
}

function tryOpenExternal(url: string): boolean {
  const u = String(url || "").trim();
  if (!u) return false;
  try {
    window.open(u, "_blank", "noopener,noreferrer");
    return true;
  } catch {
    return false;
  }
}

function callTitleForTarget(
  st: AppState,
  target: TargetRef,
  mode: CallMode,
  incoming: boolean,
  formatTargetLabel: (st: AppState, target: TargetRef) => string
): string {
  const base = formatTargetLabel(st, target);
  const dir = incoming ? "Входящий" : "Звонок";
  const kind = mode === "audio" ? "аудио" : "видео";
  return base ? `${dir}: ${base} (${kind})` : `${dir} (${kind})`;
}

function callTitleForIncoming(
  st: AppState,
  fromId: string,
  mode: CallMode,
  roomId: string | null | undefined,
  formatTargetLabel: (st: AppState, target: TargetRef) => string,
  formatSenderLabel: (st: AppState, senderId: string) => string
): string {
  const fromLabel = formatSenderLabel(st, fromId);
  if (roomId) {
    const base = formatTargetLabel(st, { kind: "group", id: roomId });
    const kind = mode === "audio" ? "аудио" : "видео";
    return base ? `Вызов в чате: ${base} (${kind})` : `Вызов (${kind})`;
  }
  const kind = mode === "audio" ? "аудио" : "видео";
  return fromLabel ? `Входящий: ${fromLabel} (${kind})` : `Входящий (${kind})`;
}

export function createCallsFeature(deps: CallsFeatureDeps): CallsFeature {
  const { store, send, showToast, tabNotifier, formatTargetLabel, formatSenderLabel } = deps;
  let callCreateLocalId: string | null = null;
  let callCreateTimeoutTimer: number | null = null;
  const abortedLocalIds = new Map<string, number>();

  function pruneAbortedLocalIds(now: number) {
    // Keep this bounded; local_id is only used for the "create -> result" handshake.
    if (abortedLocalIds.size <= 12) return;
    for (const [id, ts] of abortedLocalIds) {
      if (now - ts > 2 * 60 * 1000) abortedLocalIds.delete(id);
    }
    if (abortedLocalIds.size <= 12) return;
    const entries = Array.from(abortedLocalIds.entries()).sort((a, b) => a[1] - b[1]);
    for (const [id] of entries.slice(0, Math.max(0, entries.length - 12))) {
      abortedLocalIds.delete(id);
    }
  }

  function clearCallCreateTimeout() {
    if (callCreateTimeoutTimer === null) return;
    window.clearTimeout(callCreateTimeoutTimer);
    callCreateTimeoutTimer = null;
  }

  function markAbortedLocalId(localId: string) {
    const id = String(localId || "").trim();
    if (!id) return;
    const now = Date.now();
    abortedLocalIds.set(id, now);
    pruneAbortedLocalIds(now);
  }

  function startCallCreateTimeout(localId: string) {
    const id = String(localId || "").trim();
    if (!id) return;
    clearCallCreateTimeout();
    callCreateTimeoutTimer = window.setTimeout(() => {
      if (callCreateLocalId !== id) return;
      markAbortedLocalId(id);
      callCreateLocalId = null;
      callCreateTimeoutTimer = null;
      const stNow = store.get();
      if (stNow.modal?.kind === "call" && stNow.modal.phase === "creating" && !String(stNow.modal.callId || "").trim()) {
        store.set({ modal: null });
      }
      showToast("Не удалось начать звонок (нет ответа). Попробуйте ещё раз", { kind: "warn", timeoutMs: 8000, placement: "center" });
    }, 9000);
  }

  function acceptCall(callIdRaw: string) {
    const callId = String(callIdRaw || "").trim();
    if (!callId) return;
    const stNow = store.get();
    const modal = stNow.modal;
    if (!modal || modal.kind !== "call" || String(modal.callId || "").trim() !== callId) return;
    const roomName = String(modal.roomName || "").trim();
    const mode: CallMode = String(modal.mode || "").trim() === "audio" ? "audio" : "video";
    const joinUrl = roomName ? buildMeetJoinUrl(roomName, mode) : null;
    if (!joinUrl) {
      showToast("Звонки не настроены (нет meet URL)", { kind: "warn", timeoutMs: 7000 });
      if (stNow.conn === "connected" && stNow.authed) {
        try {
          send({ type: "call_reject", call_id: callId });
        } catch {
          // ignore
        }
      }
      store.set({ modal: null });
      return;
    }

    if (stNow.conn === "connected" && stNow.authed) {
      try {
        send({ type: "call_accept", call_id: callId });
      } catch {
        // ignore
      }
    }

    if (isMobileLikeUi()) {
      if (tryOpenExternal(joinUrl)) {
        store.set({ modal: null, status: "Звонок открыт в новой вкладке" });
        showToast("Звонок открыт в новой вкладке", { kind: "success", timeoutMs: 6000 });
        return;
      }
    }

    store.set((prev) => {
      if (prev.modal?.kind !== "call" || String(prev.modal.callId || "").trim() !== callId) return prev;
      return { ...prev, modal: { ...prev.modal, phase: "active", phaseAt: Date.now() }, status: "Звонок…" };
    });
  }

  function declineCall(callIdRaw: string) {
    const callId = String(callIdRaw || "").trim();
    if (!callId) return;
    const stNow = store.get();
    const modal = stNow.modal;
    if (!modal || modal.kind !== "call" || String(modal.callId || "").trim() !== callId) return;
    if (stNow.conn === "connected" && stNow.authed) {
      try {
        send({ type: "call_reject", call_id: callId });
      } catch {
        // ignore
      }
    }
    store.set({ modal: null, status: "Звонок отклонен" });
    showToast("Звонок отклонен", { kind: "info", timeoutMs: 5000 });
  }

  function startCall(mode: CallMode) {
    const st = store.get();
    if (st.modal) return;
    if (!st.authed || st.conn !== "connected") {
      showToast("Нет соединения", { kind: "warn", timeoutMs: 5000 });
      return;
    }
    if (!getMeetBaseUrl()) {
      showToast("Звонки не настроены (нет meet URL)", { kind: "warn", timeoutMs: 7000 });
      return;
    }
    const sel = st.selected;
    if (!sel || st.page !== "main") {
      store.set({ status: "Выберите контакт или чат" });
      return;
    }
    if (sel.kind === "board") {
      showToast("Звонки на досках пока недоступны", { kind: "warn", timeoutMs: 6000 });
      return;
    }
    if (callCreateLocalId) {
      showToast("Звонок уже создаётся…", { kind: "info", timeoutMs: 4000 });
      return;
    }
    callCreateLocalId = `call-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const target: TargetRef = sel.kind === "dm" ? { kind: "dm", id: sel.id } : { kind: "group", id: sel.id };
    const title = callTitleForTarget(st, target, mode, false, formatTargetLabel);
    store.set({
      modal: {
        kind: "call",
        callId: "",
        roomName: "",
        mode,
        from: st.selfId || "",
        ...(target.kind === "dm" ? { to: target.id } : { room: target.id }),
        title,
        phase: "creating",
        phaseAt: Date.now(),
      },
      status: mode === "audio" ? "Аудиозвонок…" : "Видеозвонок…",
    });
    startCallCreateTimeout(callCreateLocalId);
    try {
      send({
        type: "call_create",
        mode,
        ...(sel.kind === "dm" ? { peer: sel.id } : { room: sel.id }),
        local_id: callCreateLocalId,
      });
    } catch {
      clearCallCreateTimeout();
      callCreateLocalId = null;
      store.set({ modal: null });
      showToast("Не удалось начать звонок (ошибка соединения)", { kind: "warn", timeoutMs: 8000, placement: "center" });
    }
  }

  function closeCallModal() {
    const st = store.get();
    const modal = st.modal;
    if (!modal || modal.kind !== "call") return;
    const callId = String(modal.callId || "").trim();
    const incoming = Boolean(modal.incoming);
    const phase = modal.phase ?? (callId && modal.roomName ? "active" : modal.roomName ? "ringing" : "creating");
    if (callId && st.conn === "connected" && st.authed) {
      try {
        if (incoming && phase !== "active") {
          send({ type: "call_reject", call_id: callId });
        } else {
          send({ type: "call_end", call_id: callId });
        }
      } catch {
        // ignore
      }
    }
    if (!callId && callCreateLocalId) {
      markAbortedLocalId(callCreateLocalId);
      callCreateLocalId = null;
      clearCallCreateTimeout();
    }
    store.set({ modal: null, status: callId ? (incoming && phase !== "active" ? "Звонок отклонен" : "Звонок завершен") : "Звонок отменен" });
  }

  function handleMessage(msg: any): boolean {
    const t = String(msg?.type ?? "");

    if (t === "call_create_result") {
      const ok = Boolean(msg?.ok);
      const localId = String(msg?.local_id ?? "").trim();
      if (!localId) return true;
      if (abortedLocalIds.has(localId)) {
        abortedLocalIds.delete(localId);
        clearCallCreateTimeout();
        if (callCreateLocalId === localId) callCreateLocalId = null;
        if (ok) {
          const callId = String(msg?.call_id ?? "").trim();
          const stNow = store.get();
          if (callId && stNow.conn === "connected" && stNow.authed) {
            try {
              send({ type: "call_end", call_id: callId });
            } catch {
              // ignore
            }
          }
        }
        return true;
      }
      if (!callCreateLocalId || localId !== callCreateLocalId) return true;
      clearCallCreateTimeout();
      callCreateLocalId = null;

      if (!ok) {
        const stNow = store.get();
        if (stNow.modal?.kind === "call" && stNow.modal.phase === "creating") {
          store.set({ modal: null });
        }
        const reason = String(msg?.reason ?? "ошибка");
        const limit = typeof msg?.limit === "number" && Number.isFinite(msg.limit) ? Math.trunc(msg.limit) : undefined;
        showToast(formatCallCreateError(reason, limit), { kind: "warn", timeoutMs: 8000, placement: "center" });
        return true;
      }

      const callId = String(msg?.call_id ?? "").trim();
      const roomName = String(msg?.room_name ?? "").trim();
      const mode: CallMode = String(msg?.mode ?? "").trim() === "audio" ? "audio" : "video";
      const roomId = typeof msg?.room === "string" ? String(msg.room).trim() : "";
      const toId = typeof msg?.to === "string" ? String(msg.to).trim() : "";
      if (!callId || !roomName) return true;

      const st = store.get();
      const joinUrl = buildMeetJoinUrl(roomName, mode);
      if (!joinUrl) {
        showToast("Звонки не настроены (нет meet URL)", { kind: "warn", timeoutMs: 7000 });
        if (st.conn === "connected" && st.authed) {
          try {
            send({ type: "call_end", call_id: callId });
          } catch {
            // ignore
          }
        }
        if (st.modal?.kind === "call" && st.modal.phase === "creating") {
          store.set({ modal: null });
        }
        return true;
      }
      const target: TargetRef | null = roomId ? { kind: "group", id: roomId } : toId ? { kind: "dm", id: toId } : null;
      const title = target ? callTitleForTarget(st, target, mode, false, formatTargetLabel) : `Звонок (${mode === "audio" ? "аудио" : "видео"})`;
      store.set({
        modal: {
          kind: "call",
          callId,
          roomName,
          mode,
          from: st.selfId || "",
          ...(roomId ? { room: roomId } : { to: toId }),
          title,
          phase: "ringing",
          phaseAt: Date.now(),
        },
        status: "Звонок…",
      });
      return true;
    }

    if (t === "call_invite") {
      const callId = String(msg?.call_id ?? "").trim();
      const roomName = String(msg?.room_name ?? "").trim();
      const fromId = String(msg?.from ?? "").trim();
      const mode: CallMode = String(msg?.mode ?? "").trim() === "audio" ? "audio" : "video";
      const roomId = typeof msg?.room === "string" ? String(msg.room).trim() : "";
      if (!callId || !roomName || !fromId) return true;

      const stNow = store.get();
      if (stNow.modal?.kind === "call") {
        if (stNow.conn === "connected" && stNow.authed) {
          try {
            send({ type: "call_reject", call_id: callId });
          } catch {
            // ignore
          }
        }
        return true;
      }

      const notifKey = roomId ? `call_invite:room:${roomId}:${callId}` : `call_invite:dm:${fromId}:${callId}`;
      try {
        const permission = Notification?.permission ?? "default";
        if (permission === "granted" && tabNotifier.shouldShowSystemNotification(notifKey)) {
          const title = "Ягодка: звонок";
          const body = roomId ? `Чат: ${formatTargetLabel(stNow, { kind: "group", id: roomId })}` : `От: ${formatSenderLabel(stNow, fromId)}`;
          const tag = roomId ? `yagodka:room:${roomId}` : `yagodka:dm:${fromId}`;
          new Notification(title, { body, tag, silent: true });
        }
      } catch {
        // ignore
      }

      const showToastHere = tabNotifier.shouldShowToast(notifKey);
      if (!showToastHere) return true;

      const title = callTitleForIncoming(stNow, fromId, mode, roomId || null, formatTargetLabel, formatSenderLabel);
      const joinUrl = buildMeetJoinUrl(roomName, mode);
      if (!joinUrl) {
        showToast("Звонки не настроены (нет meet URL)", { kind: "warn", timeoutMs: 7000 });
        if (stNow.conn === "connected" && stNow.authed) {
          try {
            send({ type: "call_reject", call_id: callId });
          } catch {
            // ignore
          }
        }
        return true;
      }

      store.set({
        modal: {
          kind: "call",
          callId,
          roomName,
          mode,
          from: fromId,
          ...(roomId ? { room: roomId } : { to: String(msg?.to ?? "").trim() || null }),
          title,
          incoming: true,
          phase: "ringing",
          phaseAt: Date.now(),
        },
        status: title,
      });

      return true;
    }

    if (t === "call_state") {
      const callId = String(msg?.call_id ?? "").trim();
      const state = String(msg?.state ?? "").trim();
      const reason = String(msg?.reason ?? "").trim();
      if (!callId || !state) return true;
      const stNow = store.get();

      if (stNow.modal?.kind === "call" && stNow.modal.callId === callId) {
        if (state === "ended") {
          store.set({ modal: null });
        } else if (state === "active") {
          store.set((prev) => {
            if (prev.modal?.kind !== "call" || prev.modal.callId !== callId) return prev;
            return { ...prev, modal: { ...prev.modal, phase: "active", phaseAt: Date.now() }, status: "В звонке" };
          });
        } else if (state === "ringing") {
          store.set((prev) => {
            if (prev.modal?.kind !== "call" || prev.modal.callId !== callId) return prev;
            return { ...prev, modal: { ...prev.modal, phase: "ringing", phaseAt: Date.now() } };
          });
        }
      }

      if (state === "ended") {
        const me = String(stNow.selfId || "").trim();
        const fromId = String(msg?.from ?? "").trim();
        const endedBy = String(msg?.ended_by ?? "").trim();
        const isCaller = Boolean(me && fromId && me === fromId);
        const bySelf = Boolean(me && endedBy && me === endedBy);
        const label =
          reason === "timeout"
            ? "Нет ответа"
            : reason === "rejected"
              ? "Звонок отклонен"
              : reason === "ended"
                ? bySelf
                  ? "Звонок завершен"
                  : "Звонок завершен"
                : isCaller
                  ? "Звонок завершен"
                  : "Звонок завершен";
        if (tabNotifier.shouldShowToast(`call_end:${callId}`)) {
          showToast(label, { kind: reason === "timeout" ? "warn" : "info", timeoutMs: 7000 });
        }
      }
      return true;
    }

    return false;
  }

  return { startCall, acceptCall, declineCall, handleMessage, closeCallModal };
}
