import { captureChatShiftAnchor, type ChatShiftAnchor, type UnreadDividerAnchor } from "./historyViewportAnchors";
import type { ChatStickyBottomState } from "./stickyBottom";

export interface ChatHistoryViewportRuntimeState {
  stickyBottom: ChatStickyBottomState | null;
  shiftAnchor: ChatShiftAnchor | null;
  compensatedAt: number;
  virtualAvgHeights: Map<string, number>;
  unreadAnchors: Map<string, UnreadDividerAnchor>;
  unreadClearArmed: Set<string>;
  linesObserver: ResizeObserver | null;
  linesObserverRaf: number | null;
  linesObserved: HTMLElement | null;
}

type ChatHistoryViewportHost = HTMLElement & {
  __chatHistoryViewportRuntime?: ChatHistoryViewportRuntimeState | null;
};

function createRuntimeState(): ChatHistoryViewportRuntimeState {
  return {
    stickyBottom: null,
    shiftAnchor: null,
    compensatedAt: 0,
    virtualAvgHeights: new Map(),
    unreadAnchors: new Map(),
    unreadClearArmed: new Set(),
    linesObserver: null,
    linesObserverRaf: null,
    linesObserved: null,
  };
}

export function getChatHistoryViewportRuntime(host: HTMLElement): ChatHistoryViewportRuntimeState {
  const runtimeHost = host as ChatHistoryViewportHost;
  if (!runtimeHost.__chatHistoryViewportRuntime) runtimeHost.__chatHistoryViewportRuntime = createRuntimeState();
  return runtimeHost.__chatHistoryViewportRuntime;
}

export function captureAndStoreChatShiftAnchor(host: HTMLElement, key: string): ChatShiftAnchor | null {
  const anchor = captureChatShiftAnchor(host, key);
  getChatHistoryViewportRuntime(host).shiftAnchor = anchor;
  return anchor;
}

export function disconnectChatHistoryViewportObserver(host: HTMLElement): void {
  const runtime = getChatHistoryViewportRuntime(host);
  const observer = runtime.linesObserver;
  if (observer && typeof observer.disconnect === "function") {
    try {
      observer.disconnect();
    } catch {
      // ignore
    }
  }
  runtime.linesObserved = null;
}

export function resetChatHistoryViewportRuntime(host: HTMLElement): void {
  const runtime = getChatHistoryViewportRuntime(host);
  disconnectChatHistoryViewportObserver(host);
  runtime.stickyBottom = null;
  runtime.shiftAnchor = null;
  runtime.compensatedAt = 0;
  runtime.virtualAvgHeights.clear();
  runtime.unreadAnchors.clear();
  runtime.unreadClearArmed.clear();
  runtime.linesObserver = null;
  runtime.linesObserverRaf = null;
}
