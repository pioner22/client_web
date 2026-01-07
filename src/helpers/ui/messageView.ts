import type { MessageViewMode } from "../../stores/types";

export function normalizeMessageView(input: unknown): MessageViewMode {
  const raw = String(input ?? "").trim().toLowerCase();
  if (raw === "plain" || raw === "compact" || raw === "bubble") return raw;
  return "bubble";
}

export function getStoredMessageView(): MessageViewMode {
  return "bubble";
}

export function storeMessageView(_view: MessageViewMode): void {
  // no-op: стиль сообщений задаётся скином
}

export function applyMessageView(_view: MessageViewMode): void {
  try {
    document.documentElement.dataset.msgView = "bubble";
    delete document.documentElement.dataset.msgWide;
    delete document.documentElement.dataset.msgViewAuto;
  } catch {
    // ignore
  }
}
