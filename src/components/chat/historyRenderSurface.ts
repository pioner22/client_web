import { messageSelectionKey } from "../../helpers/chat/chatSelection";
import type { AppState, ChatMessage } from "../../stores/types";
import { el } from "../../helpers/dom/el";
import { applyHistoryGroupGeometry } from "./historyGroupGeometry";
import { buildHistoryLayoutBlocks } from "./historyLayoutModel";
import { renderDateSeparator, renderUnreadSeparator } from "./historySeparatorShell";
import { renderDeferredAlbumLine } from "./chatDeferredMediaRuntime";
import { messageLine, skeletonMsg, type AlbumItem } from "./renderChatHelpers";

export interface BuildHistoryRenderSurfaceOptions {
  state: AppState;
  msgs: ChatMessage[];
  key: string;
  mobileUi: boolean;
  boardUi: boolean;
  friendLabels?: Map<string, string>;
  selectionCount: number;
  selectionSet: Set<string> | null;
  hitSet: Set<number> | null;
  activeMsgIdx: number | null;
  historyLoaded: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadingInitial: boolean;
  virtualEnabled: boolean;
  virtualStart: number;
  virtualEnd: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  unreadInsertIdx: number;
  unreadCount: number;
  albumLayout: { maxWidth: number; minWidth: number; spacing: number };
}

export interface HistoryRenderSurfaceResult {
  lines: HTMLElement[];
  isEmptyState: boolean;
}

function resolveAlbumSelectionState(items: AlbumItem[], selectionSet: Set<string> | null) {
  let selectedCount = 0;
  let selectableCount = 0;
  for (const item of items) {
    const selKey = messageSelectionKey(item.msg);
    if (!selKey) continue;
    selectableCount += 1;
    if (selectionSet && selectionSet.has(selKey)) selectedCount += 1;
  }
  const anySelected = selectedCount > 0;
  const allSelected = selectableCount > 0 && selectedCount === selectableCount;
  const partial = anySelected && !allSelected;
  return { anySelected, allSelected, partial };
}

export function buildHistoryRenderSurface(opts: BuildHistoryRenderSurfaceOptions): HistoryRenderSurfaceResult {
  const {
    state,
    msgs,
    key,
    mobileUi,
    boardUi,
    friendLabels,
    selectionCount,
    selectionSet,
    hitSet,
    activeMsgIdx,
    historyLoaded,
    hasMore,
    loadingMore,
    loadingInitial,
    virtualEnabled,
    virtualStart,
    virtualEnd,
    topSpacerHeight,
    bottomSpacerHeight,
    unreadInsertIdx,
    unreadCount,
    albumLayout,
  } = opts;

  const lineItems: HTMLElement[] = [];
  const lines: HTMLElement[] = [];

  const historyBlocks = buildHistoryLayoutBlocks({
    msgs,
    state,
    mobileUi,
    boardUi,
    virtualStart,
    virtualEnd,
    unreadInsertIdx,
    unreadCount,
  });
  for (const block of historyBlocks) {
    if (block.kind === "date") {
      lineItems.push(renderDateSeparator(block.ts));
      continue;
    }
    if (block.kind === "unread") {
      lineItems.push(renderUnreadSeparator(block.unreadCount));
      continue;
    }
    if (block.kind === "album") {
      const groupCounts = resolveAlbumSelectionState(block.items, selectionSet);
      const line = renderDeferredAlbumLine({
        state,
        items: block.items,
        friendLabels,
        opts: {
          selectionMode: selectionCount > 0,
          selected: groupCounts.allSelected,
          partial: groupCounts.partial,
          groupStartIdx: block.startIdx,
          groupEndIdx: block.endIdx,
          albumLayout,
        },
      });
      const lastItem = block.items[block.items.length - 1];
      const groupMsgId = Number(lastItem?.msg?.id ?? NaN);
      const groupMsgKey = lastItem ? messageSelectionKey(lastItem.msg) : "";
      applyHistoryGroupGeometry(line, block.continues, block.tail);
      if (groupCounts.anySelected) line.classList.add("msg-selected");
      if (hitSet && block.items.some((item) => hitSet.has(item.idx))) line.classList.add("msg-hit");
      if (activeMsgIdx !== null && block.items.some((item) => item.idx === activeMsgIdx)) line.classList.add("msg-hit-active");
      line.setAttribute("data-msg-idx", String(block.endIdx));
      line.setAttribute("data-msg-group-start", String(block.startIdx));
      line.setAttribute("data-msg-group-end", String(block.endIdx));
      if (Number.isFinite(groupMsgId)) line.setAttribute("data-msg-id", String(groupMsgId));
      if (groupMsgKey) line.setAttribute("data-msg-key", groupMsgKey);
      lineItems.push(line);
      continue;
    }

    const msg = msgs[block.msgIdx];
    const msgKey = messageSelectionKey(msg);
    const selected = Boolean(selectionSet && msgKey && selectionSet.has(msgKey));
    const line = messageLine(state, msg, friendLabels, {
      mobileUi,
      boardUi,
      msgIdx: block.msgIdx,
      selectionMode: selectionCount > 0,
      selected,
    });
    applyHistoryGroupGeometry(line, block.continues, block.tail);
    line.setAttribute("data-msg-idx", String(block.msgIdx));
    const msgId = Number(msg.id ?? NaN);
    if (Number.isFinite(msgId)) line.setAttribute("data-msg-id", String(msgId));
    if (msgKey) line.setAttribute("data-msg-key", msgKey);
    if (selected) line.classList.add("msg-selected");
    if (hitSet?.has(block.msgIdx)) line.classList.add("msg-hit");
    if (activeMsgIdx === block.msgIdx) line.classList.add("msg-hit-active");
    lineItems.push(line);
  }

  if (key && hasMore && loadingMore) {
    const loader = el("div", { class: "chat-history-loader", role: "status", "aria-live": "polite" }, ["Загрузка…"]);
    lineItems.unshift(el("div", { class: "chat-history-more-wrap" }, [loader]));
  }

  if (key && !historyLoaded && !loadingInitial && lineItems.length) {
    const retry = el(
      "button",
      {
        class: "btn chat-history-more",
        type: "button",
        "data-action": "chat-history-retry",
        "aria-label": "Повторить загрузку истории",
      },
      ["Повторить загрузку"]
    );
    lineItems.unshift(el("div", { class: "chat-history-more-wrap" }, [retry]));
  }

  let isEmptyState = false;
  if (!lineItems.length) {
    if (!historyLoaded) {
      if (loadingInitial) {
        for (let i = 0; i < 7; i += 1) {
          lines.push(skeletonMsg(i % 2 === 0 ? "in" : "out", i));
        }
      } else {
        lines.push(
          el("div", { class: "chat-empty chat-empty-retry" }, [
            el("div", { class: "chat-empty-title" }, ["История не загружена"]),
            el("div", { class: "chat-empty-sub" }, ["Проверьте соединение и попробуйте снова"]),
            el(
              "button",
              { class: "btn chat-history-more", type: "button", "data-action": "chat-history-retry", "aria-label": "Повторить загрузку истории" },
              ["Повторить загрузку"]
            ),
          ])
        );
        isEmptyState = true;
      }
    } else {
      lines.push(el("div", { class: "chat-empty" }, [el("div", { class: "chat-empty-title" }, ["Пока нет сообщений"])]));
      isEmptyState = true;
    }
  } else {
    if (virtualEnabled && topSpacerHeight > 0) {
      const spacer = el("div", { class: "chat-virtual-spacer", "data-virtual-spacer": "top", "aria-hidden": "true" });
      spacer.style.height = `${topSpacerHeight}px`;
      lines.push(spacer);
    }
    lines.push(...lineItems);
    if (virtualEnabled && bottomSpacerHeight > 0) {
      const spacer = el("div", { class: "chat-virtual-spacer", "data-virtual-spacer": "bottom", "aria-hidden": "true" });
      spacer.style.height = `${bottomSpacerHeight}px`;
      lines.push(spacer);
    }
  }

  return { lines, isEmptyState };
}
