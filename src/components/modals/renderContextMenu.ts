import { el } from "../../helpers/dom/el";
import type { ContextMenuPayload } from "../../stores/types";

export interface ContextMenuActions {
  onSelect: (itemId: string) => void;
  onClose: () => void;
}

function shouldRenderAsSheet() {
  try {
    return Boolean(window.matchMedia?.("(pointer: coarse)")?.matches || window.matchMedia?.("(hover: none)")?.matches);
  } catch {
    return false;
  }
}

function focusFirstEnabled(root: HTMLElement) {
  const items = Array.from(root.querySelectorAll<HTMLButtonElement>("button.ctx-item"));
  const first = items.find((b) => !b.disabled);
  if (!first) return;
  try {
    first.focus({ preventScroll: true });
  } catch {
    first.focus();
  }
}

function focusLastEnabled(root: HTMLElement) {
  const items = Array.from(root.querySelectorAll<HTMLButtonElement>("button.ctx-item"));
  const last = [...items].reverse().find((b) => !b.disabled);
  if (!last) return;
  try {
    last.focus({ preventScroll: true });
  } catch {
    last.focus();
  }
}

function moveFocus(root: HTMLElement, dir: 1 | -1) {
  const items = Array.from(root.querySelectorAll<HTMLButtonElement>("button.ctx-item")).filter((b) => !b.disabled);
  if (!items.length) return;
  const active = document.activeElement as HTMLElement | null;
  const idx = items.findIndex((b) => b === active);
  const next = idx < 0 ? items[0] : items[(idx + dir + items.length) % items.length];
  try {
    next.focus({ preventScroll: true });
  } catch {
    next.focus();
  }
}

function composerAvoidRect(): DOMRect | null {
  try {
    return (document.querySelector(".input-wrap") as HTMLElement | null)?.getBoundingClientRect() ?? null;
  } catch {
    return null;
  }
}

const ACTION_ICON_RULES: Array<[RegExp, string]> = [
  [/reply|quote/i, "reply"],
  [/view_replies|thread/i, "thread"],
  [/forward|send_now/i, "forward"],
  [/copy|copy_id/i, "copy"],
  [/select|mark_read|accept/i, "check"],
  [/pin|board_profile/i, "pin"],
  [/edit|rename|schedule/i, "edit"],
  [/download|file|files/i, "download"],
  [/search/i, "search"],
  [/reaction/i, "reaction"],
  [/translate/i, "translate"],
  [/profile|avatar|user|member/i, "profile"],
  [/archive|folder/i, "archive"],
  [/mute|sound/i, "mute"],
  [/block|decline|cancel/i, "block"],
  [/create|invite|add/i, "plus"],
  [/login|open/i, "open"],
  [/logout|leave/i, "logout"],
  [/status|info/i, "info"],
  [/clear|delete|remove|disband/i, "trash"],
];

function iconTokenForItem(itemId: string, rawIcon?: string | null): string {
  const key = String(itemId || "").trim();
  const raw = String(rawIcon || "").trim().toLowerCase();
  for (const [rule, token] of ACTION_ICON_RULES) {
    if (rule.test(key) || (raw && rule.test(raw))) return token;
  }
  if (raw === "pdf") return "download";
  if (raw === "+" || raw === "＋") return "plus";
  if (raw === "✓" || raw === "check") return "check";
  return raw ? "action" : "dot";
}

function clampIntoViewport(root: HTMLElement) {
  const rect = root.getBoundingClientRect();
  const pad = 8;
  const composerRect = composerAvoidRect();
  const bottomLimit =
    composerRect && composerRect.width > 0 && composerRect.height > 0 && composerRect.top > 0
      ? Math.min(window.innerHeight - pad, composerRect.top - pad)
      : window.innerHeight - pad;
  let dx = 0;
  let dy = 0;
  if (rect.right > window.innerWidth - pad) dx = (window.innerWidth - pad) - rect.right;
  if (rect.left < pad) dx = pad - rect.left;
  if (rect.bottom > bottomLimit) dy = bottomLimit - rect.bottom;
  if (rect.top < pad) dy = pad - rect.top;
  if (!dx && !dy) return;
  const left = Number.parseFloat(root.style.left || "0") || 0;
  const top = Number.parseFloat(root.style.top || "0") || 0;
  root.style.left = `${Math.max(pad, left + dx)}px`;
  root.style.top = `${Math.max(pad, top + dy)}px`;
}

function applyPopoverGeometry(root: HTMLElement) {
  const composerRect = composerAvoidRect();
  const pad = 8;
  const bottomLimit =
    composerRect && composerRect.width > 0 && composerRect.height > 0 && composerRect.top > 0
      ? Math.min(window.innerHeight - pad, composerRect.top - pad)
      : window.innerHeight - pad;
  const available = Math.max(160, bottomLimit - pad);
  root.style.maxHeight = `${Math.min(available, Math.round(window.innerHeight * 0.7))}px`;
  root.style.setProperty("--ctx-list-max-h", `${Math.max(120, available - 24)}px`);
}

function applySheetGeometry(root: HTMLElement) {
  const viewportH = Math.max(320, Number(window.innerHeight || 0));
  const pad = 10;
  const composerRect = composerAvoidRect();
  const composerVisible = Boolean(
    composerRect &&
      composerRect.width > 0 &&
      composerRect.height > 0 &&
      composerRect.top > 0 &&
      composerRect.top < viewportH &&
      composerRect.bottom > viewportH * 0.42
  );
  const composerOffset = composerVisible ? Math.max(0, viewportH - Math.max(0, composerRect!.top) + 8) : 0;
  const bottomOffset = Math.min(Math.round(viewportH * 0.42), Math.round(composerOffset));
  const maxHeight = Math.max(200, Math.min(480, viewportH - bottomOffset - pad * 2, Math.round(viewportH * (bottomOffset ? 0.52 : 0.56))));
  root.style.maxHeight = `${maxHeight}px`;
  root.style.setProperty("--ctx-sheet-bottom-offset", `${bottomOffset}px`);
  root.style.setProperty("--ctx-sheet-max-h", `${maxHeight}px`);
  root.style.setProperty("--ctx-list-max-h", `${Math.max(120, maxHeight - 102)}px`);
  root.setAttribute("data-composer-avoid", composerVisible ? "1" : "0");
}

export function renderContextMenu(payload: ContextMenuPayload, actions: ContextMenuActions): HTMLElement {
  const sheet = shouldRenderAsSheet();
  const targetKind = String(payload.target?.kind || "menu").replace(/[^a-z0-9_-]/gi, "");
  const titleText = String(payload.title || "").trim();
  const showTitle = Boolean(titleText && titleText !== "Меню");
  const root = el("div", {
    class: sheet ? `ctx-menu ctx-menu-sheet ctx-menu-${targetKind}` : `ctx-menu ctx-menu-${targetKind}`,
    role: "menu",
    tabindex: "-1",
    "aria-label": titleText || "Контекстное меню",
    "data-target-kind": targetKind,
    "data-menu-layout": sheet ? "modern-sheet" : "popover",
    "data-has-reactions": payload.reactionBar?.emojis?.length ? "1" : undefined,
  });
  if (!sheet) {
    root.style.left = `${payload.x}px`;
    root.style.top = `${payload.y}px`;
  }

  if (sheet) root.append(el("div", { class: "ctx-handle", "aria-hidden": "true" }));

  const title = showTitle ? el("div", { class: "ctx-title" }, [titleText]) : null;
  const closeBtn = sheet
    ? (el(
        "button",
        {
          class: "btn ctx-close",
          type: "button",
          title: "Закрыть",
          "aria-label": "Закрыть",
        },
        ["×"]
      ) as HTMLButtonElement)
    : null;
  closeBtn?.addEventListener("click", () => actions.onClose());
  const header = sheet ? el("div", { class: "ctx-header" }, [...(title ? [title] : []), ...(closeBtn ? [closeBtn] : [])]) : title;

  const reactionBar =
    payload.reactionBar && Array.isArray(payload.reactionBar.emojis) && payload.reactionBar.emojis.length
      ? (() => {
          const mine = payload.reactionBar?.active ?? null;
          const btns = payload.reactionBar.emojis.map((emoji) => {
            const active = mine === emoji;
            const btn = el(
              "button",
              {
                class: active ? "ctx-react is-active" : "ctx-react",
                type: "button",
                "aria-pressed": active ? "true" : "false",
                "aria-label": active ? `Убрать реакцию ${emoji}` : mine ? `Заменить реакцию на ${emoji}` : `Поставить реакцию ${emoji}`,
                "data-reaction": emoji,
                title: active ? `Убрать реакцию ${emoji}` : mine ? `Заменить реакцию на ${emoji}` : `Поставить реакцию ${emoji}`,
              },
              [emoji]
            ) as HTMLButtonElement;
            btn.addEventListener("click", () => actions.onSelect(`react:${emoji}`));
            return btn;
          });
          const pickerBtn = el(
            "button",
            {
              class: "ctx-react ctx-react-more",
              type: "button",
              title: mine ? "Изменить реакцию" : "Добавить реакцию",
              "aria-label": mine ? "Изменить реакцию" : "Добавить реакцию",
              "data-reaction": "more",
            },
            ["＋"]
          ) as HTMLButtonElement;
          pickerBtn.addEventListener("click", () => actions.onSelect("react_picker"));
          btns.push(pickerBtn);
          return el("div", { class: "ctx-reacts", role: "group", "aria-label": "Реакции" }, btns);
        })()
      : null;

  const nodes = payload.items.map((it) => {
    if (it.separator) {
      return el("div", { class: "ctx-sep", role: "separator", "aria-hidden": "true" });
    }
    const idSafe = String(it.id || "").replace(/[^a-z0-9:_-]/gi, "");
    const clsBase = it.danger ? "ctx-item ctx-danger" : "ctx-item";
    const cls = it.subLabel ? `${clsBase} ctx-item-multiline` : clsBase;
    const iconToken = iconTokenForItem(it.id, it.icon);
    const icon = it.icon || sheet ? el("span", { class: "ctx-icon", "aria-hidden": "true", "data-ctx-icon": iconToken }) : null;
    const main = el("span", { class: "ctx-main" }, [
      el("span", { class: "ctx-label" }, [it.label]),
      ...(it.subLabel ? [el("span", { class: "ctx-sub" }, [it.subLabel])] : []),
    ]);
    const meta = it.meta ? el("span", { class: "ctx-meta" }, [it.meta]) : null;
    const btn = el(
      "button",
      {
        class: cls,
        type: "button",
        "data-item-id": idSafe || undefined,
        ...(it.danger ? { "data-danger": "true" } : {}),
        ...(sheet ? {} : { role: "menuitem" }),
        ...(it.disabled ? { disabled: "true" } : {}),
      },
      [...(icon ? [icon] : []), main, ...(meta ? [meta] : [])]
    ) as HTMLButtonElement;
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      actions.onSelect(it.id);
    });
    return btn;
  });

  root.append(...(header ? [header] : []), ...(reactionBar ? [reactionBar] : []), el("div", { class: "ctx-list" }, nodes));

  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      actions.onClose();
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      focusFirstEnabled(root);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      focusLastEnabled(root);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveFocus(root, 1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(root, -1);
      return;
    }
  });

  queueMicrotask(() => {
    if (sheet) {
      applySheetGeometry(root);
    } else {
      applyPopoverGeometry(root);
      clampIntoViewport(root);
    }
    try {
      root.focus({ preventScroll: true });
    } catch {
      root.focus();
    }
  });

  return root;
}
