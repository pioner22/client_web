import { conversationKey } from "../../../helpers/chat/conversationKey";
import { fileBadge } from "../../../helpers/files/fileBadge";
import type { AppState, ChatMessage, SearchResultEntry, TargetRef } from "../../../stores/types";

export interface SearchHistoryShareItem {
  target: TargetRef;
  idx: number;
}

export function formatSearchServerShareLine(st: AppState, entry: SearchResultEntry): string {
  const id = String(entry?.id || "").trim();
  if (!id) return "";
  if (entry.board) {
    const board = st.boards.find((b) => b.id === id);
    const name = String(board?.name || "").trim();
    return name ? `${name} (#${id})` : `#${id}`;
  }
  if (entry.group) {
    const group = st.groups.find((g) => g.id === id);
    const name = String(group?.name || "").trim();
    return name ? `${name} (#${id})` : `#${id}`;
  }
  const profile = st.profiles?.[id];
  const displayName = String(profile?.display_name || "").trim();
  return displayName ? `${displayName} (ID: ${id})` : `ID: ${id}`;
}

export function formatSearchServerShareText(st: AppState, items: SearchResultEntry[]): string {
  return items
    .map((entry) => formatSearchServerShareLine(st, entry))
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function formatSearchHistoryTargetLabel(st: AppState, target: TargetRef): string {
  const id = String(target?.id || "").trim();
  if (!id) return "";
  if (target.kind === "dm") {
    const friend = st.friends.find((f) => f.id === id);
    const profile = st.profiles?.[id];
    const displayName = String(friend?.display_name || profile?.display_name || "").trim();
    const handleRaw = String(friend?.handle || profile?.handle || "").trim();
    const handle = handleRaw ? (handleRaw.startsWith("@") ? handleRaw : `@${handleRaw}`) : "";
    if (displayName) return displayName;
    if (handle) return handle;
    return `ID: ${id}`;
  }
  const entry = target.kind === "group" ? st.groups.find((g) => g.id === id) : st.boards.find((b) => b.id === id);
  const name = String(entry?.name || "").trim();
  return name ? `${name} (#${id})` : `#${id}`;
}

export function formatSearchHistorySenderLabel(st: AppState, senderId: string): string {
  const id = String(senderId || "").trim();
  if (!id) return "";
  if (String(st.selfId || "") === id) return "Я";
  const friend = st.friends.find((f) => f.id === id);
  const profile = st.profiles?.[id];
  const displayName = String(friend?.display_name || profile?.display_name || "").trim();
  const handleRaw = String(friend?.handle || profile?.handle || "").trim();
  const handle = handleRaw ? (handleRaw.startsWith("@") ? handleRaw : `@${handleRaw}`) : "";
  if (displayName) return displayName;
  if (handle) return handle;
  return id;
}

export function formatSearchHistoryAttachmentLabel(attachment: ChatMessage["attachment"]): string {
  if (!attachment) return "";
  if (attachment.kind === "action") return "Действие";
  if (attachment.kind !== "file") return "";
  const name = String(attachment.name || "").trim();
  const badge = fileBadge(attachment.name, attachment.mime);
  let kindLabel = "Файл";
  if (badge.kind === "image") kindLabel = "Фото";
  else if (badge.kind === "video") kindLabel = "Видео";
  else if (badge.kind === "audio") kindLabel = "Аудио";
  else if (badge.kind === "archive") kindLabel = "Архив";
  else if (badge.kind === "doc") kindLabel = "Документ";
  else if (badge.kind === "pdf") kindLabel = "PDF";
  return name ? `${kindLabel}: ${name}` : kindLabel;
}

export function formatSearchHistoryBody(msg: ChatMessage): string {
  const text = String(msg?.text || "").trim();
  if (text) return text;
  return formatSearchHistoryAttachmentLabel(msg?.attachment);
}

export function formatSearchHistoryShareLine(st: AppState, item: SearchHistoryShareItem): string {
  const key = conversationKey(item.target);
  if (!key) return "";
  const conv = st.conversations[key];
  if (!Array.isArray(conv)) return "";
  const msg = conv[item.idx];
  if (!msg) return "";
  const body = formatSearchHistoryBody(msg);
  const targetLabel = formatSearchHistoryTargetLabel(st, item.target);
  const senderLabel = formatSearchHistorySenderLabel(st, String(msg.from || ""));
  const header = [targetLabel, senderLabel].filter(Boolean).join(" — ");
  if (!body) return header;
  return header ? `${header}: ${body}` : body;
}

export function formatSearchHistoryShareText(st: AppState, items: SearchHistoryShareItem[]): string {
  const list = Array.isArray(items) ? items : [];
  return list
    .map((item) => formatSearchHistoryShareLine(st, item))
    .filter(Boolean)
    .join("\n")
    .trim();
}
