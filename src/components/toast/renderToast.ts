import { el } from "../../helpers/dom/el";
import type { ToastAction, ToastState } from "../../stores/types";

function toastButton(action: ToastAction): HTMLButtonElement {
  const cls = action.primary ? "btn btn-primary toast-btn" : "btn toast-btn";
  const btn = el("button", { class: cls, type: "button", "data-action": "toast-action", "data-toast-id": action.id }, [
    action.label,
  ]) as HTMLButtonElement;
  return btn;
}

export function renderToast(host: HTMLElement, toast: ToastState | null): void {
  if (!toast) {
    host.classList.add("hidden");
    host.replaceChildren();
    return;
  }
  host.classList.remove("hidden");
  const kind = toast.kind || "info";
  const actions = Array.isArray(toast.actions) ? toast.actions : [];

  const box = el("div", { class: `toast toast-${kind}`, role: "status" }, [
    el("div", { class: "toast-msg" }, [toast.message]),
    ...(actions.length ? [el("div", { class: "toast-actions" }, actions.map((a) => toastButton(a)))] : []),
  ]);

  host.replaceChildren(box);
}

