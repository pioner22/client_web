import type { MessageViewMode } from "../../stores/types";

const STORAGE_KEY = "yagodka_msg_view";

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
    document.documentElement.dataset.msgView = normalizeMessageView(view);
  } catch {
    // ignore
  }
}
