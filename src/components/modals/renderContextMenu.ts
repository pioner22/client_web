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
    "data-menu-layout": sheet ? "compact-sheet" : "popover",
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
              class: "ctx-react",
              type: "button",
              title: mine ? "Изменить реакцию" : "Добавить реакцию",
              "aria-label": mine ? "Изменить реакцию" : "Добавить реакцию",
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
    const icon = it.icon ? el("span", { class: "ctx-icon", "aria-hidden": "true" }, [it.icon]) : null;
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
    if (!sheet) {
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
