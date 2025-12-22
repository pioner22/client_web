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

function clampIntoViewport(root: HTMLElement) {
  const rect = root.getBoundingClientRect();
  const pad = 8;
  let dx = 0;
  let dy = 0;
  if (rect.right > window.innerWidth - pad) dx = (window.innerWidth - pad) - rect.right;
  if (rect.left < pad) dx = pad - rect.left;
  if (rect.bottom > window.innerHeight - pad) dy = (window.innerHeight - pad) - rect.bottom;
  if (rect.top < pad) dy = pad - rect.top;
  if (!dx && !dy) return;
  const left = Number.parseFloat(root.style.left || "0") || 0;
  const top = Number.parseFloat(root.style.top || "0") || 0;
  root.style.left = `${Math.max(pad, left + dx)}px`;
  root.style.top = `${Math.max(pad, top + dy)}px`;
}

export function renderContextMenu(payload: ContextMenuPayload, actions: ContextMenuActions): HTMLElement {
  const sheet = shouldRenderAsSheet();
  const root = el("div", { class: sheet ? "ctx-menu ctx-menu-sheet" : "ctx-menu", role: "menu", tabindex: "-1" });
  if (!sheet) {
    root.style.left = `${payload.x}px`;
    root.style.top = `${payload.y}px`;
  }

  if (sheet) root.append(el("div", { class: "ctx-handle", "aria-hidden": "true" }));

  const title = el("div", { class: "ctx-title" }, [payload.title]);

  const items = payload.items.map((it) => {
    const cls = it.danger ? "ctx-item ctx-danger" : "ctx-item";
    const btn = el("button", { class: cls, type: "button", role: "menuitem", ...(it.disabled ? { disabled: "true" } : {}) }, [
      it.label,
    ]) as HTMLButtonElement;
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      actions.onSelect(it.id);
    });
    return btn;
  });

  root.append(title, ...items);

  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      actions.onClose();
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
    if (!sheet) clampIntoViewport(root);
    focusFirstEnabled(root);
  });

  return root;
}
