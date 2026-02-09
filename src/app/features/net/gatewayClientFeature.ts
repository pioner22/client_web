import { GatewayClient } from "../../../lib/net/gatewayClient";
import type { Store } from "../../../stores/store";
import type { AppState, ConnStatus } from "../../../stores/types";

export type GatewayClientFeature = {
  gateway: GatewayClient;
};

type Deps = {
  store: Store<AppState>;
  getGatewayUrl: () => string;

  handleSearchResultMessage?: (msg: any) => boolean;
  handleHistoryResultMessage?: (msg: any) => void;
  clearPendingHistoryRequests: () => void;

  handleCallsMessage?: (msg: any) => boolean;
  handleFileUploadMessage?: (msg: any) => boolean;
  handleFileMessage?: (msg: any) => boolean;

  dispatchServerMessage: (msg: any, gateway: GatewayClient) => void;
  scheduleSaveOutbox: () => void;

  onAuthed: () => void;
  onDisconnected?: () => void;
  maybeAutoAuthOnConnected?: () => void;
};

function requeueSendingOutboxOnDisconnect(prev: AppState): AppState {
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
      [k]: arr.map((e) =>
        e && typeof e === "object" && (e as any).status === "sending" ? { ...(e as any), status: "queued" as const } : e
      ),
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
}

export function createGatewayClientFeature(deps: Deps): GatewayClientFeature {
  let lastConn: ConnStatus = "connecting";

  const gateway = new GatewayClient(
    deps.getGatewayUrl(),
    (msg) => {
      const t = String(msg?.type ?? "");
      if (t === "search_result") {
        if (deps.handleSearchResultMessage?.(msg)) return;
      }
      if (t === "history_result") {
        deps.handleHistoryResultMessage?.(msg);
      }
      if (t === "error") deps.clearPendingHistoryRequests();
      if (deps.handleCallsMessage?.(msg)) return;
      if (deps.handleFileUploadMessage?.(msg)) return;
      if (deps.handleFileMessage?.(msg)) return;

      deps.dispatchServerMessage(msg, gateway);

      if (t === "message_delivered" || t === "message_queued" || t === "message_blocked" || t === "error" || t === "history_result") {
        deps.scheduleSaveOutbox();
      }

      if (t === "auth_ok" || t === "register_ok") {
        deps.onAuthed();
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
      deps.store.set((prev) => {
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
        deps.onDisconnected?.();
        deps.store.set(requeueSendingOutboxOnDisconnect);
        deps.scheduleSaveOutbox();
        return;
      }

      // New socket: even if UI thought we were authed, we must re-auth on reconnect.
      if (prevConn !== "connected") {
        deps.store.set((prev) => (prev.authed ? { ...prev, authed: false } : prev));
      }

      deps.maybeAutoAuthOnConnected?.();
    }
  );

  return { gateway };
}

