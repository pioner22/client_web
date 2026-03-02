import { el } from "../../helpers/dom/el";
import type { ToastAction, ToastState } from "../../stores/types";

function toastButton(action: ToastAction): HTMLButtonElement {
  const cls = action.primary ? "btn btn-primary toast-btn" : "btn toast-btn";
  const btn = el("button", { class: cls, type: "button", "data-action": "toast-action", "data-toast-id": action.id }, [
    action.label,
  ]) as HTMLButtonElement;
  return btn;
}

function toastIconLabel(kind: string): string {
  const k = String(kind || "").trim();
  if (k === "success") return "✓";
  if (k === "warn") return "!";
  if (k === "error") return "×";
  return "i";
}

export function renderToast(host: HTMLElement, toast: ToastState | null): void {
  if (!toast) {
    host.classList.add("hidden");
    host.removeAttribute("data-toast-placement");
    host.replaceChildren();
    return;
  }
  host.classList.remove("hidden");
  const placement = toast.placement === "center" ? "center" : "bottom";
  host.setAttribute("data-toast-placement", placement);
  const kind = toast.kind || "info";
  const actionsAll = Array.isArray(toast.actions) ? toast.actions : [];
  const actions = actionsAll.filter((a) => String(a?.id || "").trim() !== "dismiss");
  const hasDismiss = actionsAll.some((a) => String(a?.id || "").trim() === "dismiss");
  const icon = toastIconLabel(kind);

  const dismissBtn = hasDismiss
    ? (el(
        "button",
        {
          class: "btn toast-dismiss",
          type: "button",
          title: "Закрыть",
          "aria-label": "Закрыть",
          "data-action": "toast-action",
          "data-toast-id": "dismiss",
        },
        ["×"]
      ) as HTMLButtonElement)
    : null;
  const box = el("div", { class: `toast toast-${kind}`, role: "status" }, [
    el("div", { class: "toast-icon", "aria-hidden": "true" }, [icon]),
    el("div", { class: "toast-msg" }, [toast.message]),
    ...(actions.length ? [el("div", { class: "toast-actions" }, actions.map((a) => toastButton(a)))] : []),
    ...(dismissBtn ? [dismissBtn] : []),
  ]);

  host.replaceChildren(box);
}
