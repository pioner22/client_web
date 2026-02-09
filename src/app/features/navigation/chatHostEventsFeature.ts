import { conversationKey } from "../../../helpers/chat/conversationKey";
import { clampMediaAspectRatio, setCachedMediaAspectRatio } from "../../../helpers/chat/mediaAspectCache";
import type { Layout } from "../../../components/layout/types";
import type { Store } from "../../../stores/store";
import type { AppState, ChatMessage } from "../../../stores/types";

export interface ChatHostEventsFeatureDeps {
  store: Store<AppState>;
  layout: Pick<Layout, "chat" | "chatHost" | "inputWrap">;
  getMaxScrollTop: (host: HTMLElement) => number;
  scheduleChatJumpVisibility: () => void;
  maybeRecordLastRead: (key: string) => void;
  maybeAutoLoadMoreHistory: (payload: { scrollTop: number; scrollingUp: boolean; lastUserScrollAt: number }) => void;
  maybeUpdateVirtualWindow: (scrollTop: number) => void;
  maybeAutoFillHistoryViewport: () => void;
  scheduleAutoFetchVisiblePreviews: () => void;
  recordRoomLastReadEntry: (key: string, msg: ChatMessage) => void;
  maybeSendMessageRead: (peerId: string, msgId: number) => void;
}

export interface ChatHostEventsFeature {
  ensureVideoMutedDefault: (video: HTMLVideoElement) => void;
  install: () => void;
}

export function createChatHostEventsFeature(deps: ChatHostEventsFeatureDeps): ChatHostEventsFeature {
  const {
    store,
    layout,
    getMaxScrollTop,
    scheduleChatJumpVisibility,
    maybeRecordLastRead,
    maybeAutoLoadMoreHistory,
    maybeUpdateVirtualWindow,
    maybeAutoFillHistoryViewport,
    scheduleAutoFetchVisiblePreviews,
    recordRoomLastReadEntry,
    maybeSendMessageRead,
  } = deps;

  let lastChatScrollTop = 0;
  let lastChatUserScrollAt = 0;
  let viewportReadRaf: number | null = null;
  let lastViewportReadAt = 0;
  let chatStickyResizeRaf: number | null = null;
  let chatTouchStartX = 0;
  let chatTouchStartY = 0;
  let chatTouchTracking = false;

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

  const applyMediaAspectRatio = (el: HTMLElement, ratio: number, meta?: { duration?: number | null }) => {
    const button = el.closest("button.chat-file-preview") as HTMLButtonElement | null;
    if (!button) return;
    if (button.getAttribute("data-media-fixed") === "1") return;
    const clamped = clampMediaAspectRatio(ratio);
    button.style.aspectRatio = String(clamped);
    const fileId = String(button.getAttribute("data-file-id") || "").trim();
    if (fileId) setCachedMediaAspectRatio(fileId, clamped);

    const msg = button.closest("div.msg") as HTMLElement | null;
    if (!msg) return;
    if (msg.getAttribute("data-msg-album") === "1" || msg.classList.contains("msg-album")) return;

    const name = String(button.getAttribute("data-name") || "").trim().toLowerCase();
    const mime = String(button.getAttribute("data-mime") || "").trim().toLowerCase();
    const size = Number(button.getAttribute("data-size") || 0) || 0;
    const fileKind = String(button.getAttribute("data-file-kind") || "").trim();
    const isSquare = clamped >= 0.85 && clamped <= 1.18;
    const setFlag = (attr: string, ok: boolean) => {
      if (ok) msg.setAttribute(attr, "1");
      else msg.removeAttribute(attr);
    };

    const caption = String(button.getAttribute("data-caption") || "").trim();
    if (caption) {
      setFlag("data-msg-sticker", false);
      setFlag("data-msg-round-video", false);
      return;
    }

    const isSticker = fileKind === "image" && isSquare && size > 0 && size <= 600_000 && (mime === "image/webp" || name.endsWith(".webp"));
    const duration = typeof meta?.duration === "number" && Number.isFinite(meta.duration) ? meta.duration : null;
    const isRoundVideo = fileKind === "video" && isSquare && size > 0 && size <= 25_000_000 && (duration === null || duration <= 75);

    setFlag("data-msg-sticker", isSticker);
    setFlag("data-msg-round-video", isRoundVideo);
  };

  const setInlineVideoState = (video: HTMLVideoElement, state: "playing" | "paused") => {
    const preview = video.closest("button.chat-file-preview") as HTMLButtonElement | null;
    if (!preview || !preview.classList.contains("chat-file-preview-video")) return;
    preview.dataset.videoState = state;
  };

  const shouldForceVideoMute = (video: HTMLVideoElement): boolean => {
    if (video.dataset.allowAudio === "1") return false;
    if (video.dataset.userUnmuted === "1") return false;
    return true;
  };

  const ensureVideoMutedDefault = (video: HTMLVideoElement) => {
    if (!shouldForceVideoMute(video)) return;
    if (!video.muted) video.muted = true;
    if (!video.defaultMuted) video.defaultMuted = true;
    if (!video.hasAttribute("muted")) video.setAttribute("muted", "");
  };

  const markVideoUserUnmuted = (video: HTMLVideoElement) => {
    if (video.dataset.userUnmuted === "1") return;
    if (!video.muted && video.volume > 0) {
      video.dataset.userUnmuted = "1";
    }
  };

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

  const resetChatTouch = () => {
    chatTouchTracking = false;
  };

  const install = () => {
    layout.chatHost.addEventListener(
      "scroll",
      () => {
        const scrollTop = layout.chatHost.scrollTop;
        const scrollingUp = scrollTop < lastChatScrollTop;
        lastChatScrollTop = scrollTop;
        const hostState = layout.chatHost as any;
        const key = String(layout.chatHost.getAttribute("data-chat-key") || "");
        const now = Date.now();
        const userScrollRecent = now - lastChatUserScrollAt < 2000;
        const atBottom = scrollTop >= getMaxScrollTop(layout.chatHost) - 24;
        if (key) {
          const unreadMap: Map<string, unknown> | undefined = hostState.__chatUnreadAnchors;
          const unreadClearArmed: Set<string> = hostState.__chatUnreadClearArmed || new Set();
          hostState.__chatUnreadClearArmed = unreadClearArmed;
          if (unreadMap && unreadMap.has(key)) {
            if (!atBottom && userScrollRecent) unreadClearArmed.add(key);
            if (atBottom && unreadClearArmed.has(key)) {
              unreadMap.delete(key);
              unreadClearArmed.delete(key);
            }
          } else {
            unreadClearArmed.delete(key);
          }
          const stick = hostState.__stickBottom;
          if (!stick || stick.key !== key) {
            hostState.__stickBottom = { key, active: atBottom, at: now };
          } else if (atBottom) {
            stick.active = true;
            stick.at = now;
          } else if (userScrollRecent) {
            stick.active = false;
            stick.at = now;
          }
        }
        scheduleChatJumpVisibility();
        maybeAutoLoadMoreHistory({ scrollTop, scrollingUp, lastUserScrollAt: lastChatUserScrollAt });
        maybeUpdateVirtualWindow(scrollTop);
        scheduleViewportReadUpdate();
        scheduleAutoFetchVisiblePreviews();
        if (atBottom) maybeRecordLastRead(key);
      },
      { passive: true }
    );

    layout.chatHost.addEventListener("yagodka:chat-rendered", () => {
      scheduleAutoFetchVisiblePreviews();
      maybeAutoFillHistoryViewport();
    });

    layout.chatHost.addEventListener(
      "load",
      (event) => {
        const target = event.target;
        if (!(target instanceof HTMLImageElement)) return;
        if (!target.classList.contains("chat-file-img")) return;
        const ratio = (target.naturalWidth || 0) / Math.max(1, target.naturalHeight || 0);
        applyMediaAspectRatio(target, ratio);
      },
      true
    );

    layout.chatHost.addEventListener(
      "loadedmetadata",
      (event) => {
        const target = event.target;
        if (!(target instanceof HTMLVideoElement)) return;
        if (!target.classList.contains("chat-file-video")) return;
        const ratio = (target.videoWidth || 0) / Math.max(1, target.videoHeight || 0);
        applyMediaAspectRatio(target, ratio, { duration: target.duration });
      },
      true
    );

    if (typeof document !== "undefined") {
      const handleVideoAutoMute = (event: Event) => {
        const target = event.target;
        if (target instanceof HTMLVideoElement) ensureVideoMutedDefault(target);
      };
      const handleVideoVolumeChange = (event: Event) => {
        const target = event.target;
        if (target instanceof HTMLVideoElement) markVideoUserUnmuted(target);
      };
      const handleExclusiveMediaPlay = (event: Event) => {
        const target = event.target;
        if (!(target instanceof HTMLAudioElement || target instanceof HTMLVideoElement)) return;
        const nodes = document.querySelectorAll("audio, video");
        for (const node of Array.from(nodes)) {
          if (!(node instanceof HTMLAudioElement || node instanceof HTMLVideoElement)) continue;
          if (node === target) continue;
          if (node.paused) continue;
          try {
            node.pause();
          } catch {
            // ignore
          }
        }
      };
      document.addEventListener("play", handleVideoAutoMute, true);
      document.addEventListener("loadedmetadata", handleVideoAutoMute, true);
      document.addEventListener("volumechange", handleVideoVolumeChange, true);
      document.addEventListener("play", handleExclusiveMediaPlay, true);
    }

    layout.chatHost.addEventListener(
      "play",
      (event) => {
        const target = event.target;
        if (!(target instanceof HTMLVideoElement)) return;
        if (!target.classList.contains("chat-file-video")) return;
        setInlineVideoState(target, "playing");
      },
      true
    );

    layout.chatHost.addEventListener(
      "pause",
      (event) => {
        const target = event.target;
        if (!(target instanceof HTMLVideoElement)) return;
        if (!target.classList.contains("chat-file-video")) return;
        setInlineVideoState(target, "paused");
      },
      true
    );

    const markUserChatScroll = () => {
      lastChatUserScrollAt = Date.now();
    };
    layout.chatHost.addEventListener("wheel", markUserChatScroll, { passive: true });
    layout.chatHost.addEventListener("touchstart", markUserChatScroll, { passive: true });
    layout.chatHost.addEventListener("touchmove", markUserChatScroll, { passive: true });
    layout.chatHost.addEventListener("pointerdown", markUserChatScroll, { passive: true });

    window.addEventListener("keydown", (event) => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key;
      if (key !== "ArrowUp" && key !== "ArrowDown" && key !== "PageUp" && key !== "PageDown" && key !== "Home" && key !== "End" && key !== " " && key !== "Spacebar") {
        return;
      }
      const target = event.target;
      if (target instanceof HTMLElement) {
        if (target.closest("input, textarea, [contenteditable='true']")) return;
      }
      const st = store.get();
      if (st.page !== "main") return;
      if (!st.selected) return;
      lastChatUserScrollAt = Date.now();
    });

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

    layout.chatHost.addEventListener(
      "load",
      (event) => {
        const target = event.target as unknown;
        if (!(target instanceof HTMLImageElement)) return;
        scheduleChatStickyResize();
      },
      true
    );

    layout.chatHost.addEventListener(
      "loadedmetadata",
      (event) => {
        const target = event.target as unknown;
        if (!(target instanceof HTMLVideoElement || target instanceof HTMLAudioElement)) return;
        scheduleChatStickyResize();
      },
      true
    );

    layout.chatHost.addEventListener(
      "touchstart",
      (event) => {
        const ev = event as TouchEvent;
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
      (event) => {
        if (!chatTouchTracking) return;
        const ev = event as TouchEvent;
        if (ev.touches.length !== 1) return;
        const dx = ev.touches[0].clientX - chatTouchStartX;
        const dy = ev.touches[0].clientY - chatTouchStartY;
        if (Math.abs(dx) > Math.abs(dy) + 6) {
          event.preventDefault();
          return;
        }
        const host = layout.chatHost;
        const top = host.scrollTop <= 0;
        const bottom = host.scrollTop >= getMaxScrollTop(host) - 1;
        if ((dy > 0 && top) || (dy < 0 && bottom)) {
          event.preventDefault();
        }
      },
      { passive: false }
    );

    layout.chatHost.addEventListener("touchend", resetChatTouch, { passive: true });
    layout.chatHost.addEventListener("touchcancel", resetChatTouch, { passive: true });
  };

  return {
    ensureVideoMutedDefault,
    install,
  };
}
