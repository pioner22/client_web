import { APP_VERSION } from "../../config/app";
import { storeActiveBuildId } from "../../helpers/pwa/buildIdStore";
import { splitBuildId } from "../../helpers/version/buildId";

export interface RequiredUpdateGateResult {
  blocked: boolean;
  liveBuildId: string;
  reason: "current" | "no_live_build" | "fetch_failed" | "update_required" | "reload_failed";
}

interface UpdateGateGuard {
  buildId: string;
  tries: number;
  ts: number;
}

const UPDATE_GATE_GUARD_KEY = "yagodka_required_update_gate_v1";
const UPDATE_GATE_RELOADING_KEY = "yagodka_required_update_gate_reloading_v1";
const UPDATE_GATE_MAX_DIRECT_RELOADS = 2;
const UPDATE_GATE_GUARD_TTL_MS = 10 * 60 * 1000;
const UPDATE_GATE_FETCH_TIMEOUT_MS = 2500;
const UPDATE_GATE_SW_TIMEOUT_MS = 3500;

export function parseBuildIdFromServiceWorker(text: unknown): string {
  const raw = String(text ?? "");
  const match = raw.match(/\bBUILD_ID\s*=\s*["']([^"']+)["']/);
  return String(match?.[1] ?? "").trim();
}

export function isRequiredUpdateNeeded(currentBuildId: unknown, liveBuildId: unknown): boolean {
  const current = splitBuildId(currentBuildId);
  const live = splitBuildId(liveBuildId);
  if (!current.version || !live.version) return false;
  if (current.version !== live.version) return true;
  if (current.build && live.build && current.build !== live.build) return true;
  return false;
}

function storage(kind: "session" | "local"): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return kind === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

function readGuard(): UpdateGateGuard | null {
  const raw = (() => {
    try {
      return storage("session")?.getItem(UPDATE_GATE_GUARD_KEY) || storage("local")?.getItem(UPDATE_GATE_GUARD_KEY) || "";
    } catch {
      return "";
    }
  })();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const buildId = String((parsed as any).buildId || "").trim();
    const tries = Number((parsed as any).tries || 0);
    const ts = Number((parsed as any).ts || 0);
    if (!buildId || !Number.isFinite(tries) || !Number.isFinite(ts) || ts <= 0) return null;
    if (Date.now() - ts > UPDATE_GATE_GUARD_TTL_MS) return null;
    return { buildId, tries: Math.max(0, Math.trunc(tries)), ts: Math.trunc(ts) };
  } catch {
    return null;
  }
}

function writeGuard(guard: UpdateGateGuard | null): void {
  const raw = guard ? JSON.stringify(guard) : "";
  for (const target of [storage("session"), storage("local")]) {
    try {
      if (!target) continue;
      if (raw) target.setItem(UPDATE_GATE_GUARD_KEY, raw);
      else target.removeItem(UPDATE_GATE_GUARD_KEY);
    } catch {
      // ignore
    }
  }
}

function markAttempt(buildId: string): UpdateGateGuard {
  const now = Date.now();
  const prev = readGuard();
  const guard =
    prev && prev.buildId === buildId
      ? { buildId, tries: Math.min(prev.tries + 1, 9), ts: now }
      : { buildId, tries: 1, ts: now };
  writeGuard(guard);
  return guard;
}

function clearGuard(): void {
  writeGuard(null);
  try {
    storage("session")?.removeItem(UPDATE_GATE_RELOADING_KEY);
  } catch {
    // ignore
  }
}

function cleanupUpdateQueryParams(): void {
  try {
    const url = new URL(window.location.href);
    const before = url.toString();
    url.searchParams.delete("__yg_update");
    url.searchParams.delete("__pwa_reset");
    if (url.toString() === before) return;
    window.history?.replaceState?.(window.history.state, document.title, url.toString());
  } catch {
    // ignore
  }
}

function activeBuildIdForGate(): string {
  try {
    const raw = String(window.localStorage.getItem("yagodka_active_build_id_v1") || "").trim();
    const stored = splitBuildId(raw);
    const current = splitBuildId(APP_VERSION);
    if (stored.version && current.version && stored.version === current.version) return raw;
  } catch {
    // ignore
  }
  return APP_VERSION;
}

function setGateStatus(root: HTMLElement, title: string, detail: string, retry?: () => void): void {
  try {
    root.replaceChildren();
    const shell = document.createElement("main");
    shell.className = "required-update-gate";
    shell.setAttribute("role", "status");
    shell.setAttribute("aria-live", "polite");

    const spinner = document.createElement("div");
    spinner.className = "required-update-gate__spinner";
    spinner.setAttribute("aria-hidden", "true");

    const h = document.createElement("h1");
    h.className = "required-update-gate__title";
    h.textContent = title;

    const p = document.createElement("p");
    p.className = "required-update-gate__text";
    p.textContent = detail;

    shell.append(spinner, h, p);
    if (retry) {
      const button = document.createElement("button");
      button.className = "btn primary required-update-gate__btn";
      button.type = "button";
      button.textContent = "Повторить";
      button.addEventListener("click", retry);
      shell.append(button);
    }
    root.append(shell);
  } catch {
    try {
      root.textContent = `${title}. ${detail}`;
    } catch {
      // ignore
    }
  }
}

async function fetchLiveBuildId(timeoutMs = UPDATE_GATE_FETCH_TIMEOUT_MS): Promise<string> {
  if (typeof fetch !== "function") return "";
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  let timer: number | null = null;
  if (controller) timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`./sw.js?update_gate=${Date.now()}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!response || !response.ok) return "";
    return parseBuildIdFromServiceWorker(await response.text());
  } catch {
    return "";
  } finally {
    if (timer !== null) {
      try {
        window.clearTimeout(timer);
      } catch {
        // ignore
      }
    }
  }
}

function waitForControllerChange(timeoutMs = UPDATE_GATE_SW_TIMEOUT_MS): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return Promise.resolve(false);
  return new Promise((resolve) => {
    let done = false;
    let timer: number | null = null;
    const finish = (changed: boolean) => {
      if (done) return;
      done = true;
      if (timer !== null) {
        try {
          window.clearTimeout(timer);
        } catch {
          // ignore
        }
        timer = null;
      }
      try {
        navigator.serviceWorker.removeEventListener("controllerchange", onChange);
      } catch {
        // ignore
      }
      resolve(changed);
    };
    const onChange = () => finish(true);
    navigator.serviceWorker.addEventListener("controllerchange", onChange);
    timer = window.setTimeout(() => finish(false), timeoutMs);
  });
}

async function applyServiceWorkerUpdate(): Promise<void> {
  if (import.meta.env.DEV) return;
  if (!("serviceWorker" in navigator)) return;
  let reg: ServiceWorkerRegistration | null = null;
  try {
    reg = (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    reg = null;
  }
  try {
    reg = reg || (await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }));
  } catch {
    return;
  }
  try {
    await reg.update();
  } catch {
    // ignore
  }
  try {
    reg.waiting?.postMessage?.({ type: "SKIP_WAITING" });
  } catch {
    // ignore
  }
  await waitForControllerChange();
}

async function resetServiceWorkerCaches(): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister().catch(() => false)));
    }
  } catch {
    // ignore
  }
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith("yagodka-web-cache-") || key.startsWith("yagodka-web-cache-fallback-"))
        .map((key) => caches.delete(key).catch(() => false))
    );
  } catch {
    // ignore
  }
}

function markReloading(liveBuildId: string): void {
  try {
    storage("session")?.setItem(UPDATE_GATE_RELOADING_KEY, liveBuildId);
    storage("session")?.setItem("yagodka_updating", "1");
  } catch {
    // ignore
  }
}

function reloadForRequiredUpdate(liveBuildId: string): boolean {
  try {
    storeActiveBuildId(liveBuildId);
  } catch {
    // ignore
  }
  markReloading(liveBuildId);
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("__yg_update", String(Date.now()));
    window.location.replace(url.toString());
    return true;
  } catch {
    // ignore
  }
  try {
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}

export async function runRequiredUpdateGate(root: HTMLElement): Promise<RequiredUpdateGateResult> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { blocked: false, liveBuildId: "", reason: "no_live_build" };
  }

  const liveBuildId = await fetchLiveBuildId();
  if (!liveBuildId) {
    return { blocked: false, liveBuildId: "", reason: typeof fetch === "function" ? "fetch_failed" : "no_live_build" };
  }

  const currentBuildId = activeBuildIdForGate();
  if (!isRequiredUpdateNeeded(currentBuildId, liveBuildId)) {
    try {
      storeActiveBuildId(liveBuildId);
    } catch {
      // ignore
    }
    clearGuard();
    cleanupUpdateQueryParams();
    return { blocked: false, liveBuildId, reason: "current" };
  }

  setGateStatus(root, "Обновляем приложение", "Найдена новая версия. Вход продолжится после обновления.");
  const guard = markAttempt(liveBuildId);
  if (guard.tries > UPDATE_GATE_MAX_DIRECT_RELOADS) {
    setGateStatus(root, "Обновляем приложение", "Сбрасываем старый кэш приложения перед запуском новой версии.");
    await resetServiceWorkerCaches();
  } else {
    await applyServiceWorkerUpdate();
  }

  if (reloadForRequiredUpdate(liveBuildId)) {
    return { blocked: true, liveBuildId, reason: "update_required" };
  }

  setGateStatus(
    root,
    "Не удалось обновить приложение",
    "Проверьте подключение и повторите обновление перед входом.",
    () => void runRequiredUpdateGate(root)
  );
  return { blocked: true, liveBuildId, reason: "reload_failed" };
}
