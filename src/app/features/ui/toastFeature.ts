import { defaultToastTimeoutMs } from "../../../helpers/ui/toast";
import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";

export interface ToastFeatureDeps {
  store: Store<AppState>;
  toastHost: HTMLElement;
}

export interface ToastFeatureActionInput {
  id: string;
  label: string;
  primary?: boolean;
  onClick: () => void;
}

export interface ShowToastOptions {
  kind?: "info" | "success" | "warn" | "error";
  undo?: () => void;
  actions?: ToastFeatureActionInput[];
  timeoutMs?: number;
  placement?: "bottom" | "center";
}

export interface ToastFeature {
  clearToast: () => void;
  showToast: (message: string, opts?: ShowToastOptions) => void;
  installEventListeners: () => void;
}

export function createToastFeature(deps: ToastFeatureDeps): ToastFeature {
  const { store, toastHost } = deps;
  let toastTimer: number | null = null;
  let listenersInstalled = false;
  const toastActionHandlers = new Map<string, () => void>();

  const clearToast = () => {
    if (toastTimer !== null) {
      window.clearTimeout(toastTimer);
      toastTimer = null;
    }
    toastActionHandlers.clear();
    store.set({ toast: null });
  };

  const showToast = (message: string, opts?: ShowToastOptions) => {
    const msg = String(message || "").trim();
    if (!msg) return;
    if (toastTimer !== null) {
      window.clearTimeout(toastTimer);
      toastTimer = null;
    }
    toastActionHandlers.clear();

    const actions: Array<{ id: string; label: string; primary?: boolean }> = [];
    if (opts?.actions) {
      for (const a of opts.actions) {
        const id = String(a?.id || "").trim();
        const label = String(a?.label || "").trim();
        if (!id || !label) continue;
        if (toastActionHandlers.has(id)) continue;
        actions.push({ id, label, primary: Boolean(a.primary) });
        toastActionHandlers.set(id, () => a.onClick());
      }
    }
    if (opts?.undo) {
      actions.push({ id: "undo", label: "Отмена" });
      toastActionHandlers.set("undo", opts.undo);
    }
    actions.push({ id: "dismiss", label: "×" });
    toastActionHandlers.set("dismiss", () => {});

    const toast = { message: msg, kind: opts?.kind || "info", actions, placement: opts?.placement };
    store.set({ toast });

    const ms = Number(opts?.timeoutMs) > 0 ? Number(opts?.timeoutMs) : defaultToastTimeoutMs(toast);
    toastTimer = window.setTimeout(() => {
      toastTimer = null;
      toastActionHandlers.clear();
      store.set({ toast: null });
    }, ms);
  };

  const onToastClick = (e: Event) => {
    const btn = (e.target as HTMLElement | null)?.closest(
      "button[data-action='toast-action'][data-toast-id]"
    ) as HTMLButtonElement | null;
    if (!btn) return;
    e.preventDefault();
    const id = String(btn.getAttribute("data-toast-id") || "");
    const handler = toastActionHandlers.get(id);
    clearToast();
    try {
      handler?.();
    } catch {
      // ignore
    }
  };

  const installEventListeners = () => {
    if (listenersInstalled) return;
    listenersInstalled = true;
    toastHost.addEventListener("click", onToastClick);
  };

  return {
    clearToast,
    showToast,
    installEventListeners,
  };
}
