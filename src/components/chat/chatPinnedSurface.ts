import { el } from "../../helpers/dom/el";
import type { ChatMessage } from "../../stores/types";

type RenderChatPinnedSurfaceOptions = {
  msgs: ChatMessage[];
  pinnedIds: number[];
  activeRaw: number | null;
};

function resolvePinnedPreview(msg: ChatMessage | null, activeId: number): string {
  const attachment = msg?.attachment;
  if (attachment?.kind === "file") {
    return `Файл: ${String(attachment.name || "файл")}`;
  }
  const text = String(msg?.text || "").trim();
  return text || `Сообщение #${activeId}`;
}

export function renderChatPinnedSurface(opts: RenderChatPinnedSurfaceOptions): HTMLElement | null {
  const { msgs, pinnedIds, activeRaw } = opts;
  if (!Array.isArray(pinnedIds) || !pinnedIds.length) return null;

  const activeId = typeof activeRaw === "number" && pinnedIds.includes(activeRaw) ? activeRaw : pinnedIds[0];
  const activeIdx = Math.max(0, pinnedIds.indexOf(activeId));
  const pinnedMsg = msgs.find((msg) => typeof msg.id === "number" && msg.id === activeId) || null;
  const previewRaw = resolvePinnedPreview(pinnedMsg, activeId);
  const preview = previewRaw.length > 140 ? `${previewRaw.slice(0, 137)}...` : previewRaw;

  const kickerChildren: Array<string | HTMLElement> = [el("span", { class: "chat-pinned-label" }, ["Закреплено"])];
  if (pinnedIds.length > 1) {
    kickerChildren.push(
      el("span", { class: "chat-pinned-count", "aria-label": `Закреп ${activeIdx + 1} из ${pinnedIds.length}` }, [
        `${activeIdx + 1}/${pinnedIds.length}`,
      ])
    );
  }

  const body = el(
    "button",
    { class: "chat-pinned-body", type: "button", "data-action": "chat-pinned-jump", "aria-label": "Показать закреплённое сообщение" },
    [
      el("div", { class: "chat-pinned-main" }, [
        el("div", { class: "chat-pinned-kicker" }, kickerChildren),
        el("span", { class: "chat-pinned-preview" }, [preview]),
      ]),
      el("span", { class: "chat-pinned-chevron", "aria-hidden": "true" }, [""]),
    ]
  );

  const actions: HTMLElement[] = [];
  if (pinnedIds.length > 1) {
    actions.push(
      el("button", { class: "btn chat-pinned-nav chat-pinned-prev", type: "button", "data-action": "chat-pinned-prev", "aria-label": "Предыдущее закреплённое" }, [""]),
      el("button", { class: "btn chat-pinned-nav chat-pinned-next", type: "button", "data-action": "chat-pinned-next", "aria-label": "Следующее закреплённое" }, [""])
    );
  }
  if (pinnedIds.length > 2) {
    actions.push(el("button", { class: "btn chat-pinned-nav chat-pinned-list", type: "button", "data-action": "chat-pinned-list", "aria-label": "Все закрепы" }, [""]));
  }
  actions.push(el("button", { class: "btn chat-pinned-close", type: "button", "data-action": "chat-pinned-hide", "aria-label": "Скрыть" }, [""]));

  return el("div", { class: "chat-pinned", role: "note" }, [
    el("span", { class: "chat-pinned-marker", "aria-hidden": "true" }, [""]),
    body,
    el("div", { class: "chat-pinned-actions" }, actions),
  ]);
}
