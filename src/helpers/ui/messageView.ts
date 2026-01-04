import type { MessageViewMode } from "../../stores/types";

const STORAGE_KEY = "yagodka_msg_view";
const AUTO_PLAIN_MIN_WIDTH = 1440;

function isWideMessageViewport(): boolean {
  try {
    return window.matchMedia?.(`(min-width: ${AUTO_PLAIN_MIN_WIDTH}px)`).matches ?? false;
  } catch {
    return false;
  }
}

export function normalizeMessageView(input: unknown): MessageViewMode {
  const raw = String(input ?? "").trim().toLowerCase();
  if (raw === "plain" || raw === "compact" || raw === "bubble") return raw;
  return "bubble";
}

export function getStoredMessageView(): MessageViewMode {
  try {
    return normalizeMessageView(localStorage.getItem(STORAGE_KEY));
  } catch {
    return "bubble";
  }
}

export function storeMessageView(view: MessageViewMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, normalizeMessageView(view));
  } catch {
    // ignore
  }
}

export function applyMessageView(view: MessageViewMode): void {
  try {
    const normalized = normalizeMessageView(view);
    const wide = isWideMessageViewport();
    const effective = normalized === "bubble" && wide ? "plain" : normalized;
    document.documentElement.dataset.msgView = effective;
    if (wide) {
      document.documentElement.dataset.msgWide = "1";
    } else {
      delete document.documentElement.dataset.msgWide;
    }
    if (effective !== normalized) {
      document.documentElement.dataset.msgViewAuto = effective;
    } else {
      delete document.documentElement.dataset.msgViewAuto;
    }
  } catch {
    // ignore
  }
}
