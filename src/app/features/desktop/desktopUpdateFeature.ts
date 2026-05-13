import type { Store } from "../../../stores/store";
import type { AppState, ToastKind } from "../../../stores/types";
import type { ShowToastOptions } from "../ui/toastFeature";

type DesktopUpdateState =
  | "idle"
  | "disabled"
  | "checking"
  | "available"
  | "not_available"
  | "downloading"
  | "ready"
  | "installing"
  | "failed";

interface DesktopUpdateInfo {
  version?: string;
  releaseDate?: string;
}

interface DesktopUpdateProgress {
  percent?: number;
  transferred?: number;
  total?: number;
}

interface DesktopUpdateStatus {
  state: DesktopUpdateState;
  supported: boolean;
  reason: string;
  appVersion: string;
  feedUrl: string;
  autoCheck: boolean;
  updateInfo: DesktopUpdateInfo | null;
  progress: DesktopUpdateProgress | null;
  error: string;
}

interface DesktopUpdateBridge {
  getStatus?: () => Promise<unknown>;
  check?: () => Promise<unknown>;
  download?: () => Promise<unknown>;
  install?: () => Promise<unknown>;
  onStatus?: (callback: (status: unknown) => void) => (() => void) | void;
}

export interface DesktopUpdateFeatureDeps {
  store: Store<AppState>;
  showToast: (message: string, opts?: ShowToastOptions) => void;
  flushBeforeInstall: () => void;
}

function desktopUpdatesBridge(): DesktopUpdateBridge | null {
  try {
    const bridge = (globalThis as typeof globalThis & { yagodkaDesktop?: YagodkaDesktopBridge }).yagodkaDesktop;
    return bridge?.updates && typeof bridge.updates === "object" ? bridge.updates : null;
  } catch {
    return null;
  }
}

function readString(value: unknown): string {
  return String(value ?? "").trim();
}

function readNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeStatus(raw: unknown): DesktopUpdateStatus {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawState = readString(obj.state) as DesktopUpdateState;
  const state: DesktopUpdateState =
    rawState === "idle" ||
    rawState === "disabled" ||
    rawState === "checking" ||
    rawState === "available" ||
    rawState === "not_available" ||
    rawState === "downloading" ||
    rawState === "ready" ||
    rawState === "installing" ||
    rawState === "failed"
      ? rawState
      : "idle";
  const info = obj.updateInfo && typeof obj.updateInfo === "object" ? (obj.updateInfo as Record<string, unknown>) : null;
  const progress = obj.progress && typeof obj.progress === "object" ? (obj.progress as Record<string, unknown>) : null;
  return {
    state,
    supported: Boolean(obj.supported),
    reason: readString(obj.reason),
    appVersion: readString(obj.appVersion),
    feedUrl: readString(obj.feedUrl),
    autoCheck: Boolean(obj.autoCheck),
    updateInfo: info
      ? {
          version: readString(info.version),
          releaseDate: readString(info.releaseDate),
        }
      : null,
    progress: progress
      ? {
          percent: readNumber(progress.percent),
          transferred: readNumber(progress.transferred),
          total: readNumber(progress.total),
        }
      : null,
    error: readString(obj.error),
  };
}

function updateVersion(status: DesktopUpdateStatus): string {
  return status.updateInfo?.version || "";
}

function reasonLabel(reason: string): string {
  if (reason === "not_packaged") return "доступно только в собранном приложении";
  if (reason === "macos_only") return "доступно только на macOS";
  if (reason === "feed_disabled") return "release feed выключен";
  if (reason === "electron_updater_missing") return "модуль обновлений не установлен";
  if (reason === "untrusted_sender") return "недоверенный источник";
  return reason || "недоступно";
}

function statusMessage(status: DesktopUpdateStatus): string {
  const version = updateVersion(status);
  if (status.state === "disabled") return `Desktop обновления: ${reasonLabel(status.reason)}`;
  if (status.state === "checking") return "Проверяем desktop обновления…";
  if (status.state === "available") return version ? `Доступно desktop обновление v${version}` : "Доступно desktop обновление";
  if (status.state === "not_available") return "Desktop обновлений нет";
  if (status.state === "downloading") {
    const pct = Math.max(0, Math.min(100, Math.round(status.progress?.percent || 0)));
    return pct ? `Скачиваем desktop обновление ${pct}%` : "Скачиваем desktop обновление…";
  }
  if (status.state === "ready") return version ? `Desktop обновление v${version} готово` : "Desktop обновление готово";
  if (status.state === "installing") return "Перезапускаем для desktop обновления…";
  if (status.state === "failed") return `Desktop обновление не выполнено: ${status.error || "ошибка"}`;
  return "Desktop обновления готовы";
}

function statusKind(status: DesktopUpdateStatus): ToastKind {
  if (status.state === "failed" || status.state === "disabled") return "warn";
  if (status.state === "available" || status.state === "ready" || status.state === "not_available") return "success";
  return "info";
}

export function createDesktopUpdateFeature(deps: DesktopUpdateFeatureDeps) {
  const { store, showToast, flushBeforeInstall } = deps;
  let unlistenStatus: (() => void) | null = null;
  let bound = false;

  const showStatus = (status: DesktopUpdateStatus, forceToast = false) => {
    const message = statusMessage(status);
    if (!message) return;
    if (status.state === "downloading") {
      store.set({ status: message });
      return;
    }
    const actions: ShowToastOptions["actions"] = [];
    if (status.state === "available") {
      actions.push({ id: "desktop-update-download", label: "Скачать", primary: true, onClick: () => void download() });
    } else if (status.state === "ready") {
      actions.push({ id: "desktop-update-install", label: "Перезапустить", primary: true, onClick: () => void install() });
    } else if (status.state === "failed" || status.state === "not_available" || status.state === "disabled") {
      actions.push({ id: "desktop-update-check", label: "Проверить", onClick: () => void check() });
    }
    if (!forceToast && (status.state === "idle" || status.state === "disabled")) return;
    showToast(message, {
      kind: statusKind(status),
      timeoutMs: actions.length ? 12000 : 5200,
      actions,
    });
  };

  const request = async (action: "getStatus" | "check" | "download" | "install", forceToast = true) => {
    const updates = desktopUpdatesBridge();
    const fn = updates?.[action];
    if (typeof fn !== "function") {
      showStatus(
        normalizeStatus({ state: "disabled", supported: false, reason: "electron_updater_missing" }),
        forceToast
      );
      return;
    }
    try {
      const raw = await fn.call(updates);
      showStatus(normalizeStatus(raw), forceToast);
    } catch (error) {
      showStatus(
        normalizeStatus({ state: "failed", supported: false, error: error instanceof Error ? error.message : String(error) }),
        true
      );
    }
  };

  const check = () => request("check", true);
  const download = () => request("download", true);
  const install = async () => {
    try {
      flushBeforeInstall();
    } catch {
      // ignore
    }
    await request("install", true);
  };

  const bind = () => {
    if (bound) return;
    bound = true;
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target as HTMLElement | null;
        const button = target?.closest(
          "button[data-action='desktop-update-check'],button[data-action='desktop-update-download'],button[data-action='desktop-update-install']"
        ) as HTMLButtonElement | null;
        if (!button) return;
        event.preventDefault();
        const action = String(button.getAttribute("data-action") || "");
        if (action === "desktop-update-check") void check();
        else if (action === "desktop-update-download") void download();
        else if (action === "desktop-update-install") void install();
      },
      true
    );
  };

  const start = () => {
    const updates = desktopUpdatesBridge();
    if (!updates) return;
    if (typeof updates.onStatus === "function") {
      const off = updates.onStatus((status) => showStatus(normalizeStatus(status), true));
      if (typeof off === "function") unlistenStatus = off;
    }
    void request("getStatus", false);
  };

  const stop = () => {
    try {
      unlistenStatus?.();
    } catch {
      // ignore
    }
    unlistenStatus = null;
  };

  return { bind, start, stop, check, download, install };
}
