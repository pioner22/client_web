import type { GatewayClient } from "../../lib/net/gatewayClient";
import type { AppState, ChatMessage, OutboxEntry } from "../../stores/types";
import { dmKey, roomKey } from "../../helpers/chat/conversationKey";
import { mergeMessages } from "../../helpers/chat/mergeMessages";
import { removeOutboxEntry } from "../../helpers/chat/outbox";
import { nowTs } from "../../helpers/time";
import { saveLastReadMarkers } from "../../helpers/ui/lastReadMarkers";
import { oldestLoadedId, parseAttachment, parseMessageRef, parseReactions } from "./common";

function debugHook(kind: string, data?: any) {
  try {
    const dbg = (globalThis as any).__yagodka_debug_monitor;
    if (!dbg || typeof dbg.push !== "function") return;
    dbg.push(String(kind || "history").trim() || "history", data);
  } catch {
    // ignore
  }
}

export function handleHistoryServerMessage(
  t: string,
  msg: any,
  state: AppState,
  _gateway: GatewayClient,
  patch: (p: Partial<AppState> | ((prev: AppState) => AppState)) => void
): boolean {
  if (t !== "history_result") return false;

  const resultRoom = msg?.room ? String(msg.room) : undefined;
  const resultPeer = msg?.peer ? String(msg.peer) : undefined;
  const key = resultRoom ? roomKey(resultRoom) : resultPeer ? dmKey(resultPeer) : "";
  if (!key) return true;

  const isPreview = Boolean(msg?.preview);
  const beforeIdRaw = msg?.before_id;
  const hasBefore = beforeIdRaw !== undefined && beforeIdRaw !== null;
  const beforeIdValue = hasBefore ? Number(beforeIdRaw) : NaN;
  const readUpToRaw = msg?.read_up_to_id;
  const readUpToId = Number(readUpToRaw);
  const rows = Array.isArray(msg?.rows) ? msg.rows : [];
  const rawHasMore = msg?.has_more;
  const shouldSetHasMore = hasBefore || rawHasMore !== undefined;

  // For history since_id server often doesn't send has_more: don't overwrite the flag to avoid blocking prefetch.
  const hasMore = rawHasMore !== undefined && rawHasMore !== null ? Boolean(rawHasMore) : hasBefore ? rows.length > 0 : false;

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
    const status: ChatMessage["status"] | undefined = !room && kind === "out" && hasId ? (read ? "read" : delivered ? "sent" : "queued") : undefined;
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

        const idx = conv.findIndex(
          (m) => m.kind === "out" && (m.id === undefined || m.id === null) && typeof m.localId === "string" && m.localId === lid
        );
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

    const prevCursorValue = prevCursor ? Number(prevCursor[key]) : NaN;
    const isStaleBeforeResponse =
      hasBefore &&
      Number.isFinite(beforeIdValue) &&
      beforeIdValue > 0 &&
      Number.isFinite(prevCursorValue) &&
      prevCursorValue > 0 &&
      beforeIdValue > prevCursorValue;

    const cursorStalled =
      hasBefore &&
      !isStaleBeforeResponse &&
      delta <= 0 &&
      cursor !== null &&
      Number.isFinite(prevCursorValue) &&
      prevCursorValue > 0 &&
      cursor === prevCursorValue;

    const shouldShiftVirtual = hasBefore && !isStaleBeforeResponse && typeof prevVirtualStart === "number" && Number.isFinite(prevVirtualStart) && delta > 0;
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

    try {
      debugHook("history.apply", {
        key,
        rows: rows.length,
        before_id: hasBefore ? (Number.isFinite(beforeIdValue) ? beforeIdValue : String(beforeIdRaw)) : null,
        stale_before: isStaleBeforeResponse,
        delta,
        cursor,
        prev_cursor: Number.isFinite(prevCursorValue) ? prevCursorValue : null,
        cursor_stalled: cursorStalled,
        has_more_in: rawHasMore !== undefined ? Boolean(rawHasMore) : null,
        has_more_effective: cursorStalled ? false : hasMore,
      });
    } catch {
      // ignore
    }

    if (isPreview) {
      const base = {
        ...prev,
        conversations: { ...prev.conversations, [key]: nextConv },
        outbox,
      };
      return lastReadChanged ? { ...base, lastRead: nextLastRead } : base;
    }

    const resolvedHasMore = cursorStalled ? false : hasMore;
    const shouldUpdateHasMore = shouldSetHasMore && !isStaleBeforeResponse;

    const base = {
      ...prev,
      conversations: { ...prev.conversations, [key]: nextConv },
      outbox,
      historyLoaded: { ...prev.historyLoaded, [key]: true },
      historyCursor: cursor !== null ? { ...prevCursor, [key]: cursor } : prevCursor,
      historyHasMore: shouldUpdateHasMore ? { ...prevHasMoreMap, [key]: Boolean(resolvedHasMore) } : prevHasMoreMap,
      historyLoading: { ...prevLoadingMap, [key]: false },
      ...(shouldShiftVirtual ? { historyVirtualStart: { ...(prev as any).historyVirtualStart, [key]: nextVirtualStart } } : {}),
    };
    return lastReadChanged ? { ...base, lastRead: nextLastRead } : base;
  });
  return true;
}

