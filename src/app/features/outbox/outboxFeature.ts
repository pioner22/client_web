import { getStoredSessionToken } from "../../../helpers/auth/session";
import { requestOutboxSnapshot, syncOutboxToServiceWorker } from "../../../helpers/pwa/outboxSync";
import { updateOutboxEntry, type OutboxMap } from "../../../helpers/chat/outbox";
import type { Store } from "../../../stores/store";
import type { AppState, ChatMessage, OutboxEntry } from "../../../stores/types";
import { scheduleSaveOutbox, setOutboxSwReadyForUser } from "../persistence/localPersistenceTimers";

export const OUTBOX_SCHEDULE_GRACE_MS = 1200;

const OUTBOX_RETRY_MIN_MS = 900;
const OUTBOX_DRAIN_MAX = 12;

export interface OutboxFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => boolean;
}

export interface OutboxFeature {
  drainOutbox: (limit?: number) => void;
  syncFromServiceWorker: (userId: string) => Promise<void>;
  dispose: () => void;
}

function mergeOutboxSnapshot(prevOutbox: AppState["outbox"], snapshot: OutboxEntry[] | OutboxMap): OutboxMap {
  const rawMap: OutboxMap = Array.isArray(snapshot) ? { unknown: snapshot } : (snapshot as OutboxMap);
  const merged: OutboxMap = {};
  for (const [key, list] of Object.entries(rawMap || {})) {
    const arr = Array.isArray(list) ? list : [];
    const normalized = arr
      .map((e) => {
        const status: OutboxEntry["status"] = e?.status === "sent" ? "sent" : "queued";
        return { ...e, status };
      })
      .filter((e) => typeof e.localId === "string" && Boolean(e.localId.trim()));
    if (normalized.length) merged[key] = normalized;
  }
  for (const [key, list] of Object.entries(prevOutbox || {})) {
    const base = Array.isArray(merged[key]) ? merged[key] : [];
    const seen = new Set(base.map((e) => String(e?.localId || "").trim()).filter(Boolean));
    const extras = (Array.isArray(list) ? list : []).filter((e) => {
      const lid = typeof e?.localId === "string" ? e.localId.trim() : "";
      return Boolean(lid) && !seen.has(lid);
    });
    if (extras.length) merged[key] = [...base, ...extras].sort((a, b) => a.ts - b.ts);
  }
  return merged;
}

export function createOutboxFeature(deps: OutboxFeatureDeps): OutboxFeature {
  const { store, send } = deps;
  let disposed = false;

  let outboxSyncPendingForUser: string | null = null;
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

  async function syncFromServiceWorker(userId: string) {
    const uid = String(userId || "").trim();
    if (!uid) {
      drainOutbox();
      return;
    }
    if (outboxSyncPendingForUser === uid) return;
    outboxSyncPendingForUser = uid;
    try {
      const snapshot = await requestOutboxSnapshot(uid);
      if (disposed) return;
      if (snapshot && typeof snapshot === "object") {
        store.set((prev) => {
          if (prev.selfId !== uid) return prev;
          const mergedOutbox = mergeOutboxSnapshot(prev.outbox, snapshot as any);
          let conversations = prev.conversations;
          let convChanged = false;
          for (const [k, list] of Object.entries(mergedOutbox)) {
            const out = Array.isArray(list) ? list : [];
            if (!out.length) continue;
            const prevConv = conversations[k] ?? [];
            const has = new Set(prevConv.map((m) => (typeof m.localId === "string" ? m.localId : "")).filter(Boolean));
            const add = out
              .filter((e) => !has.has(e.localId))
              .map((e) => ({
                kind: "out" as const,
                from: prev.selfId || "",
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
            convChanged = true;
            conversations = {
              ...conversations,
              [k]: [...prevConv, ...add].sort((a, b) => {
                const sa = typeof a.id === "number" && Number.isFinite(a.id) ? a.id : a.ts;
                const sb = typeof b.id === "number" && Number.isFinite(b.id) ? b.id : b.ts;
                return sa - sb;
              }),
            };
          }
          return convChanged ? { ...prev, outbox: mergedOutbox, conversations } : { ...prev, outbox: mergedOutbox };
        });
        scheduleSaveOutbox(store);
      }
    } catch {
      // ignore
    } finally {
      setOutboxSwReadyForUser(uid);
      outboxSyncPendingForUser = null;
      try {
        void syncOutboxToServiceWorker(uid, store.get().outbox, getStoredSessionToken());
      } catch {
        // ignore
      }
      drainOutbox();
    }
  }

  function drainOutbox(limit = OUTBOX_DRAIN_MAX) {
    if (disposed) return;
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
        const status = e?.status;
        if (status === "sent") continue;
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
      const ok = send(
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

  function dispose() {
    disposed = true;
    clearOutboxScheduleTimer();
    outboxSyncPendingForUser = null;
  }

  return { drainOutbox, syncFromServiceWorker, dispose };
}

