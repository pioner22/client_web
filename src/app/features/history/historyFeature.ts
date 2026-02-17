import type { Store } from "../../../stores/store";
import type { AppState, ChatMessage, TargetRef } from "../../../stores/types";
import { conversationKey, dmKey, roomKey } from "../../../helpers/chat/conversationKey";
import { newestServerMessageId } from "../../../helpers/chat/historySync";

type DeviceCapsLike = {
  constrained: boolean;
  prefetchAllowed: boolean;
  historyPrefetchLimit: number;
  historyWarmupLimit: number;
  historyWarmupConcurrency: number;
  historyWarmupQueueMax: number;
  historyWarmupDelayMs: number;
  historyRequestTimeoutMs: number;
};

type HistoryRequestMode = "before" | "delta";

export interface HistoryFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => void;
  deviceCaps: DeviceCapsLike;
  chatHost: HTMLElement;
  scrollToBottom: (key: string) => void;
}

export interface HistoryFeature {
  requestHistory: (t: TargetRef, opts?: { force?: boolean; deltaLimit?: number; prefetchBefore?: boolean }) => void;
  requestMoreHistory: () => void;
  enqueueHistoryPreview: (t: TargetRef) => void;
  scheduleWarmup: () => void;
  maybeAutoLoadMoreOnScroll: (opts: { scrollTop: number; scrollingUp: boolean; lastUserScrollAt: number }) => void;
  maybeFillViewport: () => void;
  maybeAutoRetrySelected: () => void;
  forceRetrySelected: (t: TargetRef) => void;
  clearPendingRequests: () => void;
  handleHistoryResultMessage: (msg: any) => void;
  onDisconnect: () => void;
  onLogout: () => void;
  markChatAutoScroll: (key: string, waitForHistory?: boolean) => void;
  applyPrependAnchorAfterRender: (st: AppState) => void;
  applyPendingAutoScrollAfterRender: (st: AppState) => void;
  maybeBootstrapPrefetch: (st: AppState) => void;
  hasPendingActivityForUpdate: () => boolean;
}

function oldestServerMessageId(msgs: ChatMessage[]): number | null {
  let min: number | null = null;
  for (const m of msgs) {
    const id = m?.id;
    if (typeof id !== "number" || !Number.isFinite(id) || id <= 0) continue;
    min = min === null ? id : Math.min(min, id);
  }
  return min;
}

type HistoryPrependAnchor = {
  key: string;
  msgKey?: string;
  msgId?: number;
  rectBottom?: number;
  scrollHeight: number;
  scrollTop: number;
};

export function createHistoryFeature(deps: HistoryFeatureDeps): HistoryFeature {
  const { store, send, deviceCaps, chatHost, scrollToBottom } = deps;

  const historyRequested = new Set<string>();
  const historyDeltaRequested = new Set<string>();
  const historyDeltaRequestedAt = new Map<string, number>();
  const historyPreviewRequested = new Set<string>();
  const historyPreviewLastAt = new Map<string, number>();
  const historyPreviewQueue: TargetRef[] = [];
  let historyPreviewTimer: number | null = null;
  const historyPrefetchRequested = new Set<string>();
  const historyPrefetchTimers = new Map<string, number>();
  const historyPrefetchBootstrap = new Set<string>();
  const HISTORY_REQUEST_TIMEOUT_MS = deviceCaps.historyRequestTimeoutMs;
  const HISTORY_REQUEST_RETRY_LIMIT = 2;
  const HISTORY_AUTO_RETRY_MS = 30_000;
  const HISTORY_PREFETCH_TIMEOUT_MS = 10_000;
  const HISTORY_HAS_MORE_BYPASS_MS = 8_000;
  const HISTORY_HAS_MORE_BYPASS_MAX = 2;
  const HISTORY_PREFETCH_LIMIT = deviceCaps.historyPrefetchLimit;
  const HISTORY_WARMUP_LIMIT = deviceCaps.historyWarmupLimit;
  const HISTORY_WARMUP_CONCURRENCY = deviceCaps.historyWarmupConcurrency;
  const HISTORY_WARMUP_TIMEOUT_MS = 12_000;
  const HISTORY_WARMUP_QUEUE_MAX = deviceCaps.historyWarmupQueueMax;
  const HISTORY_WARMUP_DELAY_MS = deviceCaps.historyWarmupDelayMs;
  const historyHasMoreBypassUntil = new Map<string, number>();
  const historyHasMoreBypassCount = new Map<string, number>();
  const historyRequestTimers = new Map<string, number>();
  const historyRequestAttempts = new Map<string, number>();
  const historyAutoRetryAt = new Map<string, number>();
  const historyWarmupQueue: TargetRef[] = [];
  const historyWarmupQueued = new Set<string>();
  const historyWarmupRequested = new Set<string>();
  const historyWarmupInFlight = new Set<string>();
  const historyWarmupTimers = new Map<string, number>();
  let historyWarmupTimer: number | null = null;

  let historyAutoBlockUntil = 0;
  let lastHistoryAutoAt = 0;
  let lastHistoryAutoKey = "";
  let lastHistoryFillAt = 0;
  let lastHistoryFillKey = "";
  let pendingChatAutoScroll: { key: string; waitForHistory: boolean } | null = null;

  let historyPrependAnchor: HistoryPrependAnchor | null = null;
  const debugHook = (kind: string, data?: any) => {
    try {
      const dbg = (globalThis as any).__yagodka_debug_monitor;
      if (!dbg || typeof dbg.push !== "function") return;
      dbg.push(String(kind || "history").trim() || "history", data);
    } catch {
      // ignore
    }
  };

  const historyRequestTimerKey = (key: string, mode: HistoryRequestMode) => `${key}:${mode}`;

  const clearHistoryRequestTimer = (key: string, mode: HistoryRequestMode, opts?: { resetAttempts?: boolean }) => {
    const timerKey = historyRequestTimerKey(key, mode);
    const timer = historyRequestTimers.get(timerKey);
    if (timer !== undefined) {
      historyRequestTimers.delete(timerKey);
      try {
        window.clearTimeout(timer);
      } catch {
        // ignore
      }
    }
    if (opts?.resetAttempts) historyRequestAttempts.delete(timerKey);
  };

  const clearHistoryRequestTimers = (key: string, opts?: { resetAttempts?: boolean }) => {
    clearHistoryRequestTimer(key, "before", opts);
    clearHistoryRequestTimer(key, "delta", opts);
  };

  const clearHistoryPrefetchTimer = (key: string) => {
    const timer = historyPrefetchTimers.get(key);
    if (timer !== undefined) {
      historyPrefetchTimers.delete(key);
      try {
        window.clearTimeout(timer);
      } catch {
        // ignore
      }
    }
  };

  const consumeHistoryHasMoreBypass = (key: string): boolean => {
    const until = historyHasMoreBypassUntil.get(key);
    if (!until) return false;
    if (until < Date.now()) {
      historyHasMoreBypassUntil.delete(key);
      return false;
    }
    historyHasMoreBypassUntil.delete(key);
    return true;
  };

  const markHistoryHasMoreBypass = (key: string) => {
    const attempts = (historyHasMoreBypassCount.get(key) || 0) + 1;
    if (attempts > HISTORY_HAS_MORE_BYPASS_MAX) return;
    historyHasMoreBypassCount.set(key, attempts);
    historyHasMoreBypassUntil.set(key, Date.now() + HISTORY_HAS_MORE_BYPASS_MS);
    debugHook("history.has_more_bypass", {
      key,
      attempts,
      reason: "historyHasMore=false_after_before_page",
    });
  };

  const clearHistoryHasMoreBypass = (key: string) => {
    historyHasMoreBypassUntil.delete(key);
    historyHasMoreBypassCount.delete(key);
  };

  const clearAllHistoryHasMoreBypass = () => {
    historyHasMoreBypassUntil.clear();
    historyHasMoreBypassCount.clear();
  };

  const canLoadOlderHistory = (st: AppState, key: string, mode: string): boolean => {
    if (st.historyHasMore?.[key] !== false) return true;
    const consumed = consumeHistoryHasMoreBypass(key);
    if (!consumed) return false;
    debugHook("history.has_more_bypass", {
      key,
      mode,
      reason: "consume",
      detail: "historyHasMore=false_after_before_page",
    });
    return true;
  };

  const armHistoryPrefetchTimeout = (key: string) => {
    clearHistoryPrefetchTimer(key);
    const timer = window.setTimeout(() => {
      historyPrefetchTimers.delete(key);
      historyPrefetchRequested.delete(key);
    }, HISTORY_PREFETCH_TIMEOUT_MS);
    historyPrefetchTimers.set(key, timer);
  };

  const requestHistory: HistoryFeature["requestHistory"] = (t, opts) => {
    const st = store.get();
    if (!st.authed) return;
    if (st.conn !== "connected") return;
    const key = conversationKey(t);
    if (!key) return;
    const force = Boolean(opts?.force);

    const cachedList = st.conversations?.[key] || [];
    const cachedCursor = st.historyCursor?.[key];
    const cachedCursorValue = typeof cachedCursor === "number" && Number.isFinite(cachedCursor) && cachedCursor > 0 ? Math.floor(cachedCursor) : null;
    const cachedHasServer =
      cachedList.some((m) => typeof m?.id === "number" && Number.isFinite(m.id) && m.id > 0) ||
      cachedCursorValue !== null;
    const hasServerHistoryState = cachedHasServer;
    const hasStaleLoaded = Boolean(st.historyLoaded?.[key]) && !hasServerHistoryState;
    const effectiveLoaded = !force && Boolean(st.historyLoaded?.[key]) && hasServerHistoryState;

    if (hasStaleLoaded) {
      debugHook("history.request.stale_loaded", {
        key,
        hasCursor: cachedCursorValue !== null,
        cachedLen: cachedList.length,
        force,
      });
      store.set((prev) => {
        const prevLoaded = prev.historyLoaded || {};
        if (!prevLoaded[key]) return prev;
        const nextLoaded = { ...prevLoaded };
        delete nextLoaded[key];
        return { ...prev, historyLoaded: nextLoaded };
      });
    }

    if (!force && !effectiveLoaded && hasServerHistoryState) {
      const derivedCursor =
        typeof cachedCursor === "number" && Number.isFinite(cachedCursor) && cachedCursor > 0
          ? Math.floor(cachedCursor)
          : oldestServerMessageId(cachedList);
      store.set((prev) => ({
        ...prev,
        historyLoaded: { ...prev.historyLoaded, [key]: true },
        ...(prev.historyLoading?.[key] ? { historyLoading: { ...prev.historyLoading, [key]: false } } : {}),
        ...(derivedCursor ? { historyCursor: { ...prev.historyCursor, [key]: derivedCursor } } : {}),
      }));
    }

    // 1) Первый заход в чат: забираем "хвост" (последние сообщения), чтобы быстро заполнить экран.
    if (!effectiveLoaded && !cachedHasServer) {
      if (historyRequested.has(key)) return;
      const cached = cachedList.length > 0;
      const baseTarget = t.kind === "dm" ? { type: "history", peer: t.id } : { type: "history", room: t.id };
      debugHook("history.request", {
        key,
        kind: t.kind,
        mode: "tail",
        force: Boolean(opts?.force),
        prefetchBefore: Boolean(opts?.prefetchBefore),
        hasServer: Boolean(cachedHasServer),
        cachedLen: cachedList.length,
      });
      // UX: ждём историю, если в кеше пусто, чтобы не дергать скролл на слабых устройствах.
      markChatAutoScroll(key, !cached);
      historyRequested.add(key);
      armHistoryRequestTimeout(key, "before");
      store.set((prev) => ({ ...prev, historyLoading: { ...prev.historyLoading, [key]: true } }));
      send({ ...baseTarget, before_id: 0, limit: 200 });
      return;
    }

    // 2) Уже загружено: тихо синхронизируем "дельту" после reconnect/долгой паузы.
    if (historyDeltaRequested.has(key)) return;
    const since = newestServerMessageId(st.conversations[key] ?? []);
    const now = Date.now();
    const last = historyDeltaRequestedAt.get(key) ?? 0;
    if (!opts?.force && now - last < 1500) return;
    historyDeltaRequestedAt.set(key, now);
    historyDeltaRequested.add(key);
    armHistoryRequestTimeout(key, "delta");

    // Если в локальном кэше нет ни одного серверного id (чат был пуст), "дельта" не применима —
    // забираем хвост ещё раз (это и поймает новые сообщения).
    if (!since) {
      const baseTarget = t.kind === "dm" ? { type: "history", peer: t.id, since_id: since } : { type: "history", room: t.id, since_id: since };
      debugHook("history.request", {
        key,
        kind: t.kind,
        mode: "tail_reset",
        force: Boolean(opts?.force),
        prefetchBefore: Boolean(opts?.prefetchBefore),
        since,
      });
      send({ ...baseTarget, before_id: 0, limit: 200 });
      return;
    }

    const rawLimit = Number(opts?.deltaLimit ?? 200);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(2000, Math.floor(rawLimit))) : 200;
    const deltaTarget = t.kind === "dm" ? { type: "history", peer: t.id, since_id: since } : { type: "history", room: t.id, since_id: since };
    debugHook("history.request", {
      key,
      kind: t.kind,
      mode: "delta",
      since,
      limit,
      force: Boolean(opts?.force),
      prefetchBefore: Boolean(opts?.prefetchBefore),
    });
    send({ ...deltaTarget, limit });

    if (!opts?.prefetchBefore) return;
    if (!deviceCaps.prefetchAllowed || document.visibilityState === "hidden") return;
    if (!opts?.force && !canLoadOlderHistory(st, key, "prefetch")) {
      debugHook("history.blocked", { key, mode: "prefetch", reason: "hasMore=false", limit: HISTORY_PREFETCH_LIMIT });
      return;
    }
    if (historyPrefetchRequested.has(key)) return;
    if (historyRequested.has(key)) return;
    if (st.historyLoading?.[key]) return;
    const before = st.historyCursor[key];
    if (!before || !Number.isFinite(before) || before <= 0) return;
    historyPrefetchRequested.add(key);
    armHistoryPrefetchTimeout(key);
    debugHook("history.request", {
      key,
      kind: t.kind,
      mode: "prefetch",
      before,
      limit: HISTORY_PREFETCH_LIMIT,
      force: Boolean(opts?.force),
    });
    if (t.kind === "dm") {
      send({ type: "history", peer: t.id, before_id: before, limit: HISTORY_PREFETCH_LIMIT });
    } else {
      send({ type: "history", room: t.id, before_id: before, limit: HISTORY_PREFETCH_LIMIT });
    }
  };

  const armHistoryRequestTimeout = (key: string, mode: HistoryRequestMode) => {
    clearHistoryRequestTimer(key, mode);
    const timerKey = historyRequestTimerKey(key, mode);
    const timer = window.setTimeout(() => {
      historyRequestTimers.delete(timerKey);
      const attempts = (historyRequestAttempts.get(timerKey) ?? 0) + 1;
      historyRequestAttempts.set(timerKey, attempts);
      const canRetry = attempts <= HISTORY_REQUEST_RETRY_LIMIT;
      if (mode === "before") {
        if (!historyRequested.has(key)) return;
        historyRequested.delete(key);
        historyPreviewRequested.delete(key);
        store.set((prev) => {
          if (!prev.historyLoading?.[key]) return prev;
          if (canRetry) {
            const status = "История не отвечает, повторяем…";
            return prev.status === status ? prev : { ...prev, status };
          }
          return {
            ...prev,
            historyLoading: { ...prev.historyLoading, [key]: false },
            status: "История не отвечает. Повторите позже.",
          };
        });
      } else {
        if (!historyDeltaRequested.has(key)) return;
        historyDeltaRequested.delete(key);
      }
      if (!canRetry) return;
      const st = store.get();
      if (!st.authed || st.conn !== "connected") return;
      if (!st.selected || conversationKey(st.selected) !== key) return;
      debugHook("history.timeout.retry", {
        key,
        mode,
        attempts,
        canRetry,
      });
      if (mode === "before") {
        if (st.historyLoaded?.[key]) {
          requestMoreHistory();
        } else {
          requestHistory(st.selected, { force: true, deltaLimit: 2000 });
        }
        return;
      }
      requestHistory(st.selected, { force: true, deltaLimit: 2000 });
    }, HISTORY_REQUEST_TIMEOUT_MS);
    historyRequestTimers.set(timerKey, timer);
  };

  const clearHistoryWarmupTimer = (key: string) => {
    const timer = historyWarmupTimers.get(key);
    if (timer === undefined) return;
    historyWarmupTimers.delete(key);
    try {
      window.clearTimeout(timer);
    } catch {
      // ignore
    }
  };

  const armHistoryWarmupTimer = (key: string) => {
    clearHistoryWarmupTimer(key);
    const timer = window.setTimeout(() => {
      historyWarmupTimers.delete(key);
      historyWarmupInFlight.delete(key);
      scheduleWarmup();
    }, HISTORY_WARMUP_TIMEOUT_MS);
    historyWarmupTimers.set(key, timer);
  };

  const shouldWarmupHistoryTarget = (st: AppState, key: string): boolean => {
    if (!key) return false;
    if (st.selected && conversationKey(st.selected) === key) return false;
    if (st.historyLoaded?.[key]) return false;
    if (st.historyLoading?.[key]) return false;
    if (historyRequested.has(key) || historyDeltaRequested.has(key) || historyPrefetchRequested.has(key)) return false;
    if (historyWarmupRequested.has(key) || historyWarmupQueued.has(key) || historyWarmupInFlight.has(key)) return false;
    if ((st.conversations[key] || []).length) return false;
    return true;
  };

  const collectHistoryWarmupTargets = (st: AppState): TargetRef[] => {
    const targets: TargetRef[] = [];
    const seen = new Set<string>();
    const add = (kind: TargetRef["kind"], idRaw: unknown) => {
      const id = String(idRaw || "").trim();
      if (!id) return;
      const target: TargetRef = { kind, id };
      const key = conversationKey(target);
      if (!key || seen.has(key)) return;
      seen.add(key);
      targets.push(target);
    };
    const topPeers = Array.isArray(st.topPeers) ? st.topPeers : [];
    if (topPeers.length) {
      for (const entry of topPeers) add("dm", entry?.id);
    } else {
      for (const friend of st.friends || []) add("dm", friend?.id);
    }
    for (const group of st.groups || []) add("group", group?.id);
    for (const board of st.boards || []) add("board", board?.id);
    return targets;
  };

  const fillHistoryWarmupQueue = (st: AppState) => {
    if (historyWarmupQueue.length >= HISTORY_WARMUP_QUEUE_MAX) return;
    const targets = collectHistoryWarmupTargets(st);
    for (const target of targets) {
      if (historyWarmupQueue.length >= HISTORY_WARMUP_QUEUE_MAX) break;
      const key = conversationKey(target);
      if (!key) continue;
      if (!shouldWarmupHistoryTarget(st, key)) continue;
      historyWarmupQueue.push(target);
      historyWarmupQueued.add(key);
    }
  };

  const drainHistoryWarmupQueue = () => {
    historyWarmupTimer = null;
    const st = store.get();
    if (!st.authed || st.conn !== "connected") {
      historyWarmupQueue.length = 0;
      historyWarmupQueued.clear();
      historyWarmupInFlight.clear();
      return;
    }
    if (st.page !== "main") return;
    if (st.modal && st.modal.kind !== "context_menu") return;
    const selectedKey = st.selected ? conversationKey(st.selected) : "";
    if (selectedKey && (!st.historyLoaded?.[selectedKey] || st.historyLoading?.[selectedKey])) return;
    if (!deviceCaps.prefetchAllowed || document.visibilityState === "hidden") {
      if (historyWarmupQueue.length) {
        historyWarmupTimer = window.setTimeout(drainHistoryWarmupQueue, HISTORY_WARMUP_DELAY_MS);
      }
      return;
    }
    if (!historyWarmupQueue.length) fillHistoryWarmupQueue(st);
    let slots = Math.max(0, HISTORY_WARMUP_CONCURRENCY - historyWarmupInFlight.size);
    while (historyWarmupQueue.length && slots > 0) {
      const target = historyWarmupQueue.shift();
      if (!target) continue;
      const key = conversationKey(target);
      if (!key) continue;
      historyWarmupQueued.delete(key);
      if (!shouldWarmupHistoryTarget(st, key)) continue;
      historyWarmupInFlight.add(key);
      historyWarmupRequested.add(key);
      armHistoryWarmupTimer(key);
      if (target.kind === "dm") {
        send({ type: "history", peer: target.id, before_id: 0, limit: HISTORY_WARMUP_LIMIT });
      } else {
        send({ type: "history", room: target.id, before_id: 0, limit: HISTORY_WARMUP_LIMIT });
      }
      slots -= 1;
    }
    if (historyWarmupQueue.length) {
      historyWarmupTimer = window.setTimeout(drainHistoryWarmupQueue, HISTORY_WARMUP_DELAY_MS);
    }
  };

  const scheduleWarmup: HistoryFeature["scheduleWarmup"] = () => {
    if (historyWarmupTimer !== null) return;
    historyWarmupTimer = window.setTimeout(drainHistoryWarmupQueue, 200);
  };

  const requestHistoryPreview = (t: TargetRef) => {
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
      send({ type: "history", peer: t.id, before_id: 0, limit: 1, preview: true });
    } else {
      send({ type: "history", room: t.id, before_id: 0, limit: 1, preview: true });
    }
  };

  const drainHistoryPreviewQueue = () => {
    historyPreviewTimer = null;
    const st = store.get();
    if (!st.authed || st.conn !== "connected") {
      historyPreviewQueue.length = 0;
      return;
    }
    let sent = 0;
    while (historyPreviewQueue.length && sent < 20) {
      const t = historyPreviewQueue.shift();
      if (!t) continue;
      requestHistoryPreview(t);
      sent += 1;
    }
    if (historyPreviewQueue.length) {
      historyPreviewTimer = window.setTimeout(drainHistoryPreviewQueue, 120);
    }
  };

  const enqueueHistoryPreview: HistoryFeature["enqueueHistoryPreview"] = (t) => {
    historyPreviewQueue.push(t);
    if (historyPreviewTimer !== null) return;
    historyPreviewTimer = window.setTimeout(drainHistoryPreviewQueue, 120);
  };

  const findHistoryAnchorElement = (): { element: HTMLElement; rect: DOMRect } | null => {
    const lines = chatHost.firstElementChild as HTMLElement | null;
    if (!lines) return null;
    const hostRect = chatHost.getBoundingClientRect();
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
  };

  const makeHistoryPrependAnchor = (key: string): HistoryPrependAnchor => {
    const base: HistoryPrependAnchor = { key, scrollHeight: chatHost.scrollHeight, scrollTop: chatHost.scrollTop };
    const anchor = findHistoryAnchorElement();
    if (!anchor) return base;
    const msgKey = String(anchor.element.getAttribute("data-msg-key") || "").trim();
    const rawMsgId = anchor.element.getAttribute("data-msg-id");
    const msgId = rawMsgId ? Number(rawMsgId) : NaN;
    const next: HistoryPrependAnchor = { ...base, rectBottom: anchor.rect.bottom };
    if (msgKey) return { ...next, msgKey };
    if (Number.isFinite(msgId)) return { ...next, msgId };
    return base;
  };

  const findHistoryAnchorByKey = (anchor: HistoryPrependAnchor): HTMLElement | null => {
    const lines = chatHost.firstElementChild as HTMLElement | null;
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
  };

  const requestMoreHistory: HistoryFeature["requestMoreHistory"] = () => {
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
    if (!canLoadOlderHistory(st, key, "more")) {
      debugHook("history.blocked", { key, mode: "more", reason: "hasMore=false" });
      return;
    }
    const before = st.historyCursor[key];
    if (!before || !Number.isFinite(before) || before <= 0) return;

    historyPrependAnchor = makeHistoryPrependAnchor(key);
    historyRequested.add(key);
    armHistoryRequestTimeout(key, "before");
    store.set((prev) => ({ ...prev, historyLoading: { ...prev.historyLoading, [key]: true } }));
    debugHook("history.request", { key, mode: "more", before, kind: st.selected?.kind, force: false, prefetchBefore: false });
    if (st.selected.kind === "dm") {
      send({ type: "history", peer: st.selected.id, before_id: before, limit: 200 });
    } else {
      send({ type: "history", room: st.selected.id, before_id: before, limit: 200 });
    }
  };

  const markChatAutoScroll: HistoryFeature["markChatAutoScroll"] = (key: string, waitForHistory = false) => {
    const k = String(key || "").trim();
    if (!k) return;
    pendingChatAutoScroll = { key: k, waitForHistory };
  };

  const applyPrependAnchorAfterRender: HistoryFeature["applyPrependAnchorAfterRender"] = (st) => {
    if (!historyPrependAnchor) return;
    const selectedKey = st.selected ? conversationKey(st.selected) : "";
    const anchorKey = historyPrependAnchor.key;
    if (st.page !== "main" || !selectedKey || selectedKey !== anchorKey) {
      historyPrependAnchor = null;
      return;
    }
    if (st.historyLoading[anchorKey]) return;
    let applied = false;
    if ((historyPrependAnchor.msgKey || historyPrependAnchor.msgId !== undefined) && historyPrependAnchor.rectBottom !== undefined) {
      const anchor = findHistoryAnchorByKey(historyPrependAnchor);
      if (anchor) {
        const rect = anchor.getBoundingClientRect();
        const delta = rect.bottom - historyPrependAnchor.rectBottom;
        if (Number.isFinite(delta) && delta !== 0) {
          // Не даём автозагрузчику истории сработать сразу после "компенсации" скролла.
          historyAutoBlockUntil = Date.now() + 350;
          chatHost.scrollTop += delta;
        }
        applied = true;
      }
    }
    if (!applied) {
      const delta = chatHost.scrollHeight - historyPrependAnchor.scrollHeight;
      if (Number.isFinite(delta) && delta !== 0) {
        // Не даём автозагрузчику истории сработать сразу после "компенсации" скролла.
        historyAutoBlockUntil = Date.now() + 350;
        chatHost.scrollTop = historyPrependAnchor.scrollTop + delta;
      }
    }
    historyPrependAnchor = null;
  };

  const applyPendingAutoScrollAfterRender: HistoryFeature["applyPendingAutoScrollAfterRender"] = (st) => {
    const autoScrollKey = st.selected ? conversationKey(st.selected) : "";
    if (pendingChatAutoScroll && pendingChatAutoScroll.key !== autoScrollKey) {
      pendingChatAutoScroll = null;
    }
    if (pendingChatAutoScroll && autoScrollKey && st.page === "main" && (!st.modal || st.modal.kind === "context_menu")) {
      const waitForHistory = pendingChatAutoScroll.waitForHistory;
      const loaded = Boolean(st.historyLoaded && st.historyLoaded[autoScrollKey]);
      if (!waitForHistory || loaded) {
        scrollToBottom(autoScrollKey);
        pendingChatAutoScroll = null;
      }
    }
  };

  const maybeAutoLoadMoreOnScroll: HistoryFeature["maybeAutoLoadMoreOnScroll"] = ({ scrollTop, scrollingUp, lastUserScrollAt }) => {
    const now = Date.now();
    if (now < historyAutoBlockUntil) return;
    const userScrollRecent = now - lastUserScrollAt < 2500;
    if (!userScrollRecent) return;

    const st = store.get();
    if (!st.authed || st.conn !== "connected") return;
    if (st.page !== "main") return;
    if (st.modal && st.modal.kind !== "context_menu") return;
    if (!st.selected) return;

    const key = conversationKey(st.selected);
    if (!key) return;
    if (!st.historyLoaded[key]) return;
    if (!canLoadOlderHistory(st, key, "scroll")) return;
    if (st.historyLoading[key]) return;
    if (historyRequested.has(key)) return;
    const cursor = st.historyCursor[key];
    if (!cursor || !Number.isFinite(cursor) || cursor <= 0) return;

    // Telegram-like: если пользователь доскроллил до верха — подтянуть более ранние сообщения.
    const nearTopThreshold = Math.max(96, Math.min(220, Math.round(chatHost.clientHeight * 0.25)));
    const nearTop = scrollTop <= nearTopThreshold;
    if (!nearTop) return;
    // Чтобы не "заливать" историю при каждом маленьком скролле — требуем только явный upward-скролл
    // или действительно верхнюю границу (когда scrollTop ≈ 0).
    if (!scrollingUp && scrollTop > 4) return;

    if (key === lastHistoryAutoKey && now - lastHistoryAutoAt < 900) return;
    lastHistoryAutoKey = key;
    lastHistoryAutoAt = now;
    historyAutoBlockUntil = now + 200;
    requestMoreHistory();
  };

  const maybeFillViewport: HistoryFeature["maybeFillViewport"] = () => {
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
    if (!canLoadOlderHistory(st, key, "fill")) return;
    if (st.historyLoading[key]) return;
    if (historyRequested.has(key)) return;
    const cursor = st.historyCursor[key];
    if (!cursor || !Number.isFinite(cursor) || cursor <= 0) return;

    if (chatHost.scrollHeight > chatHost.clientHeight + 32) return;
    if (key === lastHistoryFillKey && now - lastHistoryFillAt < 900) return;
    lastHistoryFillKey = key;
    lastHistoryFillAt = now;
    historyAutoBlockUntil = now + 200;
    requestMoreHistory();
  };

  const maybeAutoRetrySelected: HistoryFeature["maybeAutoRetrySelected"] = () => {
    const st = store.get();
    if (!st.authed || st.conn !== "connected") return;
    if (st.page !== "main") return;
    if (st.modal && st.modal.kind !== "context_menu") return;
    if (!st.selected) return;

    const key = conversationKey(st.selected);
    if (!key) return;
    if (st.historyLoaded[key]) return;
    if (st.historyLoading[key]) return;
    if (historyRequested.has(key)) return;

    const now = Date.now();
    const last = historyAutoRetryAt.get(key) || 0;
    if (now - last < HISTORY_AUTO_RETRY_MS) return;
    historyAutoRetryAt.set(key, now);
    clearHistoryRequestTimers(key, { resetAttempts: true });
    requestHistory(st.selected, { force: true, deltaLimit: 2000 });
  };

  const forceRetrySelected: HistoryFeature["forceRetrySelected"] = (t) => {
    const key = conversationKey(t);
    if (key) {
      historyRequested.delete(key);
      historyDeltaRequested.delete(key);
      historyPreviewRequested.delete(key);
      clearHistoryRequestTimers(key, { resetAttempts: true });
    }
    requestHistory(t, { force: true, deltaLimit: 2000 });
  };

  const clearPendingRequests: HistoryFeature["clearPendingRequests"] = () => {
    if (
      !historyRequested.size &&
      !historyDeltaRequested.size &&
      !historyPreviewRequested.size &&
      !historyPrefetchRequested.size &&
      !historyWarmupQueue.length &&
      !historyWarmupInFlight.size &&
      !historyWarmupRequested.size &&
      !historyWarmupQueued.size
    ) {
      return;
    }
    const pendingBefore = new Set<string>(historyRequested);
    const pendingAll = new Set<string>([
      ...historyRequested,
      ...historyDeltaRequested,
      ...historyPreviewRequested,
      ...historyPrefetchRequested,
    ]);
    historyRequested.clear();
    historyDeltaRequested.clear();
    historyPreviewRequested.clear();
    historyPrefetchRequested.clear();
    historyPrefetchBootstrap.clear();
    historyWarmupQueue.length = 0;
    historyWarmupQueued.clear();
    historyWarmupRequested.clear();
    historyWarmupInFlight.clear();
    historyPreviewQueue.length = 0;
    if (historyPreviewTimer !== null) {
      try {
        window.clearTimeout(historyPreviewTimer);
      } catch {
        // ignore
      }
      historyPreviewTimer = null;
    }
    if (historyWarmupTimer !== null) {
      try {
        window.clearTimeout(historyWarmupTimer);
      } catch {
        // ignore
      }
      historyWarmupTimer = null;
    }
    for (const key of pendingAll) {
      clearHistoryRequestTimers(key);
      clearHistoryPrefetchTimer(key);
    }
    for (const timer of historyWarmupTimers.values()) {
      try {
        window.clearTimeout(timer);
      } catch {
        // ignore
      }
    }
    historyWarmupTimers.clear();
    store.set((prev) => {
      if (!pendingBefore.size) return prev;
      let nextLoading = prev.historyLoading;
      let changed = false;
      for (const key of pendingBefore) {
        if (!prev.historyLoading?.[key]) continue;
        if (!changed) {
          nextLoading = { ...prev.historyLoading };
          changed = true;
        }
        nextLoading[key] = false;
      }
      return changed ? { ...prev, historyLoading: nextLoading } : prev;
    });
  };

  const handleHistoryResultMessage: HistoryFeature["handleHistoryResultMessage"] = (msg) => {
    const key = msg?.room ? roomKey(String(msg.room)) : msg?.peer ? dmKey(String(msg.peer)) : "";
    const rawHasMore = (msg as any).has_more;
    const rows = Array.isArray(msg?.rows) ? msg.rows : [];
    const before = msg?.before_id;
    const preview = Boolean(msg?.preview);
    const st = store.get();
    debugHook("history.result", {
      key,
      rows: Array.isArray(rows) ? rows.length : 0,
      before: before ?? null,
      preview,
      hasMore: rawHasMore !== undefined ? Boolean(rawHasMore) : undefined,
      readUpToId: msg?.read_up_to_id ?? null,
      hasHistoryLoading: Boolean(key && st.historyLoading?.[key]),
    });
    if (!key) return;
    const isPreview = Boolean(msg?.preview);
    const isBefore = msg?.before_id !== undefined && msg?.before_id !== null;
    const priorHasMore = st.historyHasMore?.[key];
    if (!preview && priorHasMore === false && isBefore) {
      if (rows.length > 0) {
        if (rawHasMore === false) {
          markHistoryHasMoreBypass(key);
        } else {
          clearHistoryHasMoreBypass(key);
        }
      } else {
        clearHistoryHasMoreBypass(key);
      }
    } else if (rawHasMore === true) {
      clearHistoryHasMoreBypass(key);
    }
    if (isPreview) {
      historyPreviewRequested.delete(key);
    } else {
      if (isBefore) {
        if (historyRequested.has(key)) {
          historyRequested.delete(key);
          clearHistoryRequestTimer(key, "before", { resetAttempts: true });
        } else if (historyPrefetchRequested.has(key)) {
          historyPrefetchRequested.delete(key);
          clearHistoryPrefetchTimer(key);
        } else {
          clearHistoryRequestTimer(key, "before", { resetAttempts: true });
        }
      } else {
        historyDeltaRequested.delete(key);
        clearHistoryRequestTimer(key, "delta", { resetAttempts: true });
      }
      historyPreviewRequested.delete(key);
    }
    if (historyWarmupInFlight.has(key)) {
      historyWarmupInFlight.delete(key);
      clearHistoryWarmupTimer(key);
      scheduleWarmup();
    }
  };

  const maybeBootstrapPrefetch: HistoryFeature["maybeBootstrapPrefetch"] = (st) => {
    if (!st.authed || !st.selfId || !st.selected) return;
    const key = conversationKey(st.selected);
    const cursor = key ? st.historyCursor?.[key] : null;
    if (
      key &&
      st.historyLoaded?.[key] &&
      canLoadOlderHistory(st, key, "bootstrap") &&
      typeof cursor === "number" &&
      Number.isFinite(cursor) &&
      cursor > 0 &&
      !historyPrefetchBootstrap.has(key) &&
      !historyPrefetchRequested.has(key) &&
      !historyRequested.has(key) &&
      !historyDeltaRequested.has(key) &&
      !st.historyLoading?.[key]
    ) {
      historyPrefetchBootstrap.add(key);
      requestHistory(st.selected, { prefetchBefore: true });
    }
  };

  const hasPendingActivityForUpdate: HistoryFeature["hasPendingActivityForUpdate"] = () =>
    Boolean(
      historyRequested.size ||
        historyDeltaRequested.size ||
        historyPrefetchRequested.size ||
        historyWarmupInFlight.size ||
        historyWarmupQueue.length
    );

  const onDisconnect: HistoryFeature["onDisconnect"] = () => {
    clearPendingRequests();
    historyDeltaRequestedAt.clear();
    clearAllHistoryHasMoreBypass();
  };

  const onLogout: HistoryFeature["onLogout"] = () => {
    clearPendingRequests();
    historyDeltaRequestedAt.clear();
    historyPreviewLastAt.clear();
    clearAllHistoryHasMoreBypass();
  };

  return {
    requestHistory,
    requestMoreHistory,
    enqueueHistoryPreview,
    scheduleWarmup,
    maybeAutoLoadMoreOnScroll,
    maybeFillViewport,
    maybeAutoRetrySelected,
    forceRetrySelected,
    clearPendingRequests,
    handleHistoryResultMessage,
    onDisconnect,
    onLogout,
    markChatAutoScroll,
    applyPrependAnchorAfterRender,
    applyPendingAutoScrollAfterRender,
    maybeBootstrapPrefetch,
    hasPendingActivityForUpdate,
  };
}
