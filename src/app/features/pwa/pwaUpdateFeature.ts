import { APP_VERSION } from "../../../config/app";
import { stashSessionTokenForReload } from "../../../helpers/auth/session";
import { buildClientInfoTags } from "../../../helpers/device/clientTags";
import { storeActiveBuildId } from "../../../helpers/pwa/buildIdStore";
import { getPwaStabilityHoldRemainingMs, readPwaStabilityHold } from "../../../helpers/pwa/stabilityHold";
import { hasPwaReloadBlockers } from "../../../helpers/pwa/reloadSafety";
import { activatePwaUpdate, checkForPwaUpdate, hasPwaUpdate } from "../../../helpers/pwa/registerServiceWorker";
import { isServiceWorkerRuntimeAvailable } from "../../../helpers/pwa/serviceWorkerRuntime";
import { shouldReloadForBuild } from "../../../helpers/pwa/shouldReloadForBuild";
import { clearPendingPwaBuild, readPendingPwaBuild } from "../../../helpers/pwa/pendingUpdate";
import { hasActiveFileTransferEntries } from "../../../helpers/runtime/deliveryCoordinator";
import { isIOS, isStandaloneDisplayMode } from "../../../helpers/ui/iosInputAssistant";
import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";

export type PwaUpdateMode = "auto" | "manual";

export interface PwaUpdateFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => void;
  flushBeforeReload: () => void;
  getLastUserInputAt: () => number;
  hasPendingHistoryActivityForUpdate: () => boolean;
  hasPendingPreviewActivityForUpdate: () => boolean;
  hasPendingFileActivityForUpdate: () => boolean;
}

export interface PwaUpdateFeature {
  installEventListeners: () => void;
  dispose: () => void;
  applyPwaUpdateNow: (opts?: { mode?: PwaUpdateMode; buildId?: string }) => Promise<void>;
  forceUpdateReload: (reason?: string) => void;
  forcePwaUpdate: () => Promise<void>;
  scheduleAutoApplyPwaUpdate: (delayMs?: number) => void;
}

type PwaAutoApplyGuard = { buildId: string; tries: number; ts: number };

export function createPwaUpdateFeature(deps: PwaUpdateFeatureDeps): PwaUpdateFeature {
  const {
    store,
    send,
    flushBeforeReload,
    getLastUserInputAt,
    hasPendingHistoryActivityForUpdate,
    hasPendingPreviewActivityForUpdate,
    hasPendingFileActivityForUpdate,
  } = deps;

  let listenersInstalled = false;
  let pwaAutoApplyTimer: number | null = null;
  let pwaForceInFlight = false;
  const PWA_AUTO_APPLY_GUARD_KEY = "yagodka_pwa_auto_apply_guard_v1";
  const PWA_AUTO_APPLY_LOG_KEY = "yagodka_pwa_update_log_v1";
  const PWA_AUTO_APPLY_GUARD_RESET_MS = 10 * 60 * 1000;
  const PWA_AUTO_APPLY_MAX_TRIES = 3;
  const PWA_AUTO_APPLY_RETRY_MS = 20 * 1000;
  const PWA_AUTO_APPLY_LOG_LIMIT = 24;
  const PWA_AUTO_APPLY_STATUS = "Получено обновление веб-клиента. Откройте обновление вручную, когда приложение не используется.";
  const PWA_MANUAL_CHECK_TIMEOUT_MS = 3500;
  let pwaPendingBuildId = "";
  let pwaAutoApplySuppressed = false;
  let pwaBootReconcileStarted = false;

  const getStorage = (kind: "session" | "local"): Storage | null => {
    try {
      if (typeof window === "undefined") return null;
      return kind === "session" ? window.sessionStorage : window.localStorage;
    } catch {
      return null;
    }
  };

  const readGuardFrom = (storage: Storage | null): PwaAutoApplyGuard | null => {
    if (!storage) return null;
    try {
      const raw = storage.getItem(PWA_AUTO_APPLY_GUARD_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      const buildId = typeof (parsed as any).buildId === "string" ? String((parsed as any).buildId).trim() : "";
      const tries = Number.isFinite((parsed as any).tries) ? Math.max(0, Math.trunc((parsed as any).tries)) : 0;
      const ts = Number.isFinite((parsed as any).ts) ? Math.max(0, Math.trunc((parsed as any).ts)) : 0;
      if (!buildId || !ts) return null;
      return { buildId, tries, ts };
    } catch {
      return null;
    }
  };

  const readPwaAutoApplyGuard = (): PwaAutoApplyGuard | null => {
    const session = readGuardFrom(getStorage("session"));
    const local = readGuardFrom(getStorage("local"));
    if (session && local) return session.ts >= local.ts ? session : local;
    return session || local;
  };

  const writePwaAutoApplyGuard = (guard: PwaAutoApplyGuard | null) => {
    const session = getStorage("session");
    const local = getStorage("local");
    try {
      if (!guard) {
        session?.removeItem(PWA_AUTO_APPLY_GUARD_KEY);
        local?.removeItem(PWA_AUTO_APPLY_GUARD_KEY);
        return;
      }
      const payload = JSON.stringify(guard);
      session?.setItem(PWA_AUTO_APPLY_GUARD_KEY, payload);
      local?.setItem(PWA_AUTO_APPLY_GUARD_KEY, payload);
    } catch {
      // ignore
    }
  };

  const clearPwaAutoApplyGuard = () => {
    writePwaAutoApplyGuard(null);
    pwaAutoApplySuppressed = false;
  };

  const shouldOpenPwaUpdatePrompt = (st: AppState): boolean => !st.modal || st.modal.kind === "pwa_update";

  const setPendingPwaBuild = (buildId: string, status?: string) => {
    const id = String(buildId || "").trim();
    if (!id) return;
    if (pwaPendingBuildId !== id) {
      pwaPendingBuildId = id;
      pwaAutoApplySuppressed = false;
    }
    store.set((prev) => ({
      ...prev,
      updateLatest: id,
      pwaUpdateAvailable: true,
      status: status || "Доступно обновление веб-клиента. Можно обновить сейчас или позже.",
      ...(shouldOpenPwaUpdatePrompt(prev) ? { modal: { kind: "pwa_update" } } : {}),
    }));
  };

  const adoptActiveBuild = (buildId: string) => {
    const id = String(buildId || "").trim();
    if (!id) return;
    clearPendingPwaBuild(id);
    storeActiveBuildId(id);
    if (store.get().clientVersion !== id) {
      store.set({ clientVersion: id });
    }
    const st = store.get();
    if (st.conn === "connected" && st.authed) {
      send({ type: "client_info", client: "web", version: id, ...buildClientInfoTags() });
    }
  };

  const currentClientBuildId = (): string => String(store.get().clientVersion || APP_VERSION || "").trim();

  const logPwaUpdate = (event: string, detail?: string) => {
    const storage = getStorage("local");
    if (!storage) return;
    try {
      const now = new Date().toISOString();
      const line = detail ? `${now} ${event} ${detail}` : `${now} ${event}`;
      const raw = storage.getItem(PWA_AUTO_APPLY_LOG_KEY);
      const list = raw ? (JSON.parse(raw) as string[]) : [];
      const next = Array.isArray(list) ? [...list, line] : [line];
      if (next.length > PWA_AUTO_APPLY_LOG_LIMIT) next.splice(0, next.length - PWA_AUTO_APPLY_LOG_LIMIT);
      storage.setItem(PWA_AUTO_APPLY_LOG_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const markPwaAutoApplyAttempt = (buildId: string) => {
    const id = String(buildId || "").trim();
    if (!id) return;
    const now = Date.now();
    const prev = readPwaAutoApplyGuard();
    if (prev && prev.buildId === id && now - prev.ts < PWA_AUTO_APPLY_GUARD_RESET_MS) {
      writePwaAutoApplyGuard({ buildId: id, tries: Math.min(prev.tries + 1, 9), ts: now });
      logPwaUpdate("auto_try", `${id}#${Math.min(prev.tries + 1, 9)}`);
      return;
    }
    writePwaAutoApplyGuard({ buildId: id, tries: 1, ts: now });
    logPwaUpdate("auto_try", `${id}#1`);
  };

  const shouldBlockPwaAutoApply = (buildId: string): boolean => {
    const id = String(buildId || "").trim();
    if (!id) return false;
    const guard = readPwaAutoApplyGuard();
    if (!guard) return false;
    if (guard.buildId !== id) return false;
    if (Date.now() - guard.ts > PWA_AUTO_APPLY_GUARD_RESET_MS) return false;
    return guard.tries >= PWA_AUTO_APPLY_MAX_TRIES;
  };

  function buildUpdateReloadUrl(): string {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("__yg_update", String(Date.now()));
      return url.toString();
    } catch {
      return window.location.href;
    }
  }

  function navigateForUpdateReload(reason?: string) {
    stashSessionTokenForReload(reason || "pwa_update");
    try {
      sessionStorage.setItem("yagodka_updating", "1");
    } catch {
      // ignore
    }
    if (reason) logPwaUpdate("force_reload", reason);
    try {
      window.location.replace(buildUpdateReloadUrl());
      return;
    } catch {
      // ignore
    }
    window.location.reload();
  }

  function forceUpdateReload(reason?: string) {
    navigateForUpdateReload(reason || "force");
  }

  async function requestPwaBuildId(reg: ServiceWorkerRegistration | null, timeoutMs = 1200): Promise<string> {
    if (!reg || !("serviceWorker" in navigator)) return "";
    const target = navigator.serviceWorker.controller || reg.active || reg.waiting || reg.installing || null;
    if (!target) return "";
    return await new Promise((resolve) => {
      let done = false;
      let timer: number | null = null;
      const finish = (id: string) => {
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
        window.removeEventListener("yagodka:pwa-build", onBuild);
        resolve(id);
      };
      const onBuild = (ev: Event) => {
        const detail = (ev as CustomEvent<any>).detail;
        const buildId = String(detail?.buildId ?? "").trim();
        if (!buildId) return;
        finish(buildId);
      };
      window.addEventListener("yagodka:pwa-build", onBuild);
      timer = window.setTimeout(() => finish(""), timeoutMs);
      try {
        target.postMessage({ type: "GET_BUILD_ID" });
      } catch {
        finish("");
      }
    });
  }

  async function waitForServiceWorkerReady(timeoutMs = 1200): Promise<ServiceWorkerRegistration | null> {
    if (!("serviceWorker" in navigator)) return null;
    try {
      const ready = navigator.serviceWorker.ready;
      if (!ready) return null;
      return await new Promise((resolve) => {
        let done = false;
        let timer: number | null = null;
        const finish = (reg: ServiceWorkerRegistration | null) => {
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
          resolve(reg);
        };
        timer = window.setTimeout(() => finish(null), timeoutMs);
        ready
          .then((reg) => finish(reg))
          .catch(() => finish(null));
      });
    } catch {
      return null;
    }
  }

  async function fetchSwBuildId(timeoutMs = 1500): Promise<string> {
    if (typeof fetch !== "function") return "";
    const url = `./sw.js?ts=${Date.now()}`;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    let timer: number | null = null;
    if (controller) {
      timer = window.setTimeout(() => controller.abort(), timeoutMs);
    }
    try {
      const res = await fetch(url, { cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      if (!res.ok) return "";
      const text = await res.text();
      const m = text.match(/\bBUILD_ID\s*=\s*["']([^"']+)["']/);
      return m ? m[1].trim() : "";
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

  async function resetPwaCachesAndServiceWorkers(reason: string): Promise<void> {
    logPwaUpdate("manual_pwa_reset", reason || "unknown");
    stashSessionTokenForReload(`pwa_reset:${reason || "unknown"}`);
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        regs.map(async (r) => {
          try {
            await r.unregister();
          } catch {
            // ignore
          }
        })
      );
    } catch {
      // ignore
    }
    try {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("yagodka-web-cache-") || k.startsWith("yagodka-web-cache-fallback-"))
          .map(async (k) => {
            try {
              await caches.delete(k);
            } catch {
              // ignore
            }
          })
      );
    } catch {
      // ignore
    }
    try {
      localStorage.removeItem("yagodka_active_build_id_v1");
    } catch {
      // ignore
    }
    try {
      sessionStorage.setItem("yagodka_updating", "1");
      const u = new URL(window.location.href);
      u.searchParams.set("__pwa_reset", String(Date.now()));
      window.location.replace(u.toString());
      return;
    } catch {
      // ignore
    }
    forceUpdateReload("manual_pwa_reset");
  }

  async function applyPwaUpdateNow(opts?: { mode?: PwaUpdateMode; buildId?: string }) {
    const mode: PwaUpdateMode = opts?.mode === "manual" ? "manual" : "auto";
    const updateLatest = String(store.get().updateLatest ?? "").trim();
    const currentBuildId = currentClientBuildId();
    let buildId = String(opts?.buildId ?? pwaPendingBuildId ?? updateLatest ?? store.get().clientVersion ?? "").trim();
    let buildIdSource = opts?.buildId ? "opts" : pwaPendingBuildId ? "pending" : updateLatest ? "latest" : "client";
    if (updateLatest && buildIdSource !== "opts" && shouldReloadForBuild(currentBuildId, updateLatest) && !shouldReloadForBuild(currentBuildId, buildId)) {
      buildId = updateLatest;
      buildIdSource = "latest";
    }
    let hasNewBuild = shouldReloadForBuild(currentBuildId, buildId);
    const latestNeedsReload = updateLatest && shouldReloadForBuild(currentBuildId, updateLatest);
    if (!hasNewBuild && latestNeedsReload && mode === "manual") {
      buildId = updateLatest;
      buildIdSource = "latest";
      hasNewBuild = true;
    }
    if (mode === "manual") {
      store.set({ status: "Проверяем и подготавливаем обновление веб-клиента…", pwaUpdateAvailable: true });
      try {
        await checkForPwaUpdate({ timeoutMs: PWA_MANUAL_CHECK_TIMEOUT_MS });
      } catch {
        // keep the manual prompt open; network/service-worker checks have their own fallback below
      }
    }
    try {
      flushBeforeReload();
    } catch {
      // ignore
    }
    store.set({ status: mode === "manual" ? "Применяем обновление веб-клиента…" : "Автообновление веб-клиента…" });
    let activated = false;
    try {
      activated = await activatePwaUpdate();
    } catch {
      // ignore
    }
    logPwaUpdate(mode === "manual" ? "manual_activate" : "auto_activate", `${buildId || "unknown"}#${activated ? "ok" : "no"}`);
    if (!activated) {
      const hasController = typeof navigator !== "undefined" && Boolean(navigator.serviceWorker?.controller);
      const hasWaiting = hasPwaUpdate();
      let reg: ServiceWorkerRegistration | null = null;
      if (mode === "manual" && typeof navigator !== "undefined" && navigator.serviceWorker) {
        try {
          reg = (await navigator.serviceWorker.getRegistration()) ?? null;
        } catch {
          reg = null;
        }
      }
      const swBuildId = mode === "manual" ? await requestPwaBuildId(reg, 1200) : "";
      const netBuildId = mode === "manual" ? await fetchSwBuildId(PWA_MANUAL_CHECK_TIMEOUT_MS) : "";
      const confirmedBuildId = String(netBuildId || swBuildId || buildId || "").trim();
      const confirmedNeedsReload = confirmedBuildId ? shouldReloadForBuild(currentBuildId, confirmedBuildId) : false;
      const swConfirmsBuild = Boolean(swBuildId && confirmedBuildId && swBuildId === confirmedBuildId);
      const canReloadWithoutWaiting = hasNewBuild && !hasWaiting;
      const shouldForceLatestReload =
        mode === "manual" && !hasWaiting && !canReloadWithoutWaiting && hasController && buildIdSource === "latest" && updateLatest;
      if (shouldForceLatestReload) {
        logPwaUpdate("manual_force_latest", updateLatest);
        storeActiveBuildId(updateLatest);
        forceUpdateReload("manual_latest_force");
        return;
      }
      if (mode === "manual" && !hasWaiting && confirmedNeedsReload && netBuildId && !swConfirmsBuild) {
        logPwaUpdate("manual_reset_stale_sw", `${swBuildId || "none"}->${netBuildId}`);
        store.set({ status: "Новая версия найдена, но старый PWA кэш не отдаёт её. Сбрасываем кэш и перезапускаем…" });
        await resetPwaCachesAndServiceWorkers(`manual_stale_sw:${swBuildId || "none"}->${netBuildId}`);
        return;
      }
      if (mode === "manual" && !hasWaiting && confirmedNeedsReload && swConfirmsBuild) {
        const targetBuildId = confirmedBuildId || buildId;
        logPwaUpdate("manual_reload_confirmed_sw", targetBuildId);
        storeActiveBuildId(targetBuildId);
        navigateForUpdateReload("manual_confirmed_sw");
        return;
      }
      if (mode === "manual" && !hasWaiting && hasNewBuild && !netBuildId && !swConfirmsBuild) {
        store.set({
          status: "Не удалось проверить загрузку обновления. Оставьте приложение открытым и повторите попытку через несколько секунд.",
          pwaUpdateAvailable: true,
          modal: { kind: "pwa_update" },
        });
        logPwaUpdate("manual_unconfirmed_update", buildId || "unknown");
        return;
      }
      if (mode === "manual" && !hasWaiting && !canReloadWithoutWaiting) {
        const msg = hasController
          ? "Обновление ещё не загружено. Оставьте приложение открытым и повторите попытку через несколько секунд."
          : "PWA обновление ещё не готово: Service Worker запускается. Повторите обновление через несколько секунд.";
        store.set({ status: msg, pwaUpdateAvailable: Boolean(updateLatest || pwaPendingBuildId), modal: { kind: "pwa_update" } });
        logPwaUpdate("manual_no_update", buildId || "unknown");
        return;
      }
      if (canReloadWithoutWaiting) {
        logPwaUpdate(mode === "manual" ? "manual_reload_active" : "auto_reload_active", buildId || "unknown");
        if (mode === "manual" && netBuildId && !swConfirmsBuild) {
          logPwaUpdate("manual_reload_active_reset", `${swBuildId || "none"}->${netBuildId}`);
          store.set({ status: "Обновление требует очистки старого PWA кэша. Перезапускаем безопасно…" });
          await resetPwaCachesAndServiceWorkers(`manual_reload_active_reset:${swBuildId || "none"}->${netBuildId}`);
          return;
        }
        storeActiveBuildId(buildId);
        if (mode === "manual" && (buildIdSource === "latest" || buildIdSource === "opts")) {
          forceUpdateReload(buildIdSource === "latest" ? "manual_latest" : "manual_opts");
          return;
        }
        try {
          navigateForUpdateReload(mode === "manual" ? "manual_active" : "auto_active");
          return;
        } catch {
          // ignore
        }
        forceUpdateReload(mode === "manual" ? "manual_active_fallback" : "auto_active_fallback");
        return;
      }
      const msg =
        mode === "manual"
          ? "Не удалось применить обновление. Закройте другие вкладки и попробуйте ещё раз."
          : "Обновление ожидает применения. Повторим попытку автоматически.";
      store.set({ status: msg, pwaUpdateAvailable: true });
      logPwaUpdate(mode === "manual" ? "manual_wait" : "auto_wait", buildId || "unknown");
      if (mode === "auto") {
        scheduleAutoApplyPwaUpdate(PWA_AUTO_APPLY_RETRY_MS);
      }
      return;
    }
    storeActiveBuildId(buildId);
    // iOS/WebKit may occasionally produce a blank screen on `reload()` after a SW update.
    // Cache-busted location.replace() behaves more like a fresh navigation and is generally more reliable.
    logPwaUpdate(mode === "manual" ? "manual_reload" : "auto_reload", buildId || "unknown");
    navigateForUpdateReload(mode === "manual" ? "manual" : "auto");
  }

  async function forcePwaUpdate() {
    if (pwaForceInFlight) return;
    if (!isServiceWorkerRuntimeAvailable()) {
      store.set({ status: "PWA обновление недоступно в этом браузере" });
      return;
    }
    pwaForceInFlight = true;
    store.set({ status: "Принудительное обновление PWA…" });
    try {
      let reg: ServiceWorkerRegistration | null = null;
      try {
        reg = (await navigator.serviceWorker.getRegistration()) ?? null;
      } catch {
        reg = null;
      }
      if (!reg) {
        reg = await waitForServiceWorkerReady(1200);
      }
      if (!reg) {
        try {
          reg = await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
        } catch {
          store.set({ status: "Service Worker не зарегистрирован. Перезапустите приложение." });
          return;
        }
      }
      try {
        await checkForPwaUpdate({ timeoutMs: PWA_MANUAL_CHECK_TIMEOUT_MS });
      } catch {
        // ignore
      }
      const swBuildId = await requestPwaBuildId(reg);
      const netBuildId = await fetchSwBuildId();
      let buildId = swBuildId || netBuildId;
      const latest = String(store.get().updateLatest ?? "").trim();
      const currentBuildId = currentClientBuildId();
      const latestNeedsReload = latest ? shouldReloadForBuild(currentBuildId, latest) : false;
      const netNeedsReload = netBuildId ? shouldReloadForBuild(currentBuildId, netBuildId) : false;
      if ((latestNeedsReload || netNeedsReload) && netBuildId && (!swBuildId || shouldReloadForBuild(swBuildId, netBuildId))) {
        store.set({ status: "Найдена новая сборка, но Service Worker не обновляется. Сбрасываем кэш PWA…" });
        await resetPwaCachesAndServiceWorkers(`stuck:${swBuildId || "none"}->${netBuildId}`);
        return;
      }
      let buildNeedsReload = buildId ? shouldReloadForBuild(currentBuildId, buildId) : false;
      if (latestNeedsReload && !buildNeedsReload) {
        buildId = latest;
        buildNeedsReload = true;
      }
      await applyPwaUpdateNow({ mode: "manual", ...(buildId ? { buildId } : {}) });
      if (!buildNeedsReload && !latestNeedsReload) {
        logPwaUpdate("manual_force_reload", buildId || latest || "unknown");
        store.set({ status: "Принудительная перезагрузка для обновления…" });
        forceUpdateReload("manual_force");
      }
    } finally {
      pwaForceInFlight = false;
    }
  }

  async function reconcilePwaBootState(): Promise<void> {
    if (pwaBootReconcileStarted) return;
    pwaBootReconcileStarted = true;
    if (!isServiceWorkerRuntimeAvailable()) return;
    let reg: ServiceWorkerRegistration | null = null;
    try {
      reg = (await navigator.serviceWorker.getRegistration()) ?? null;
    } catch {
      reg = null;
    }
    if (!reg) {
      reg = await waitForServiceWorkerReady(1200);
    }
    const currentBuildId = currentClientBuildId();
    const pendingBuildId = readPendingPwaBuild(currentBuildId);
    const swBuildId = await requestPwaBuildId(reg, 1200);
    const netBuildId = await fetchSwBuildId();
    const liveBuildId = String(netBuildId || swBuildId || pendingBuildId || "").trim();
    if (!liveBuildId) return;
    const startupPendingOnly = Boolean(pendingBuildId && pendingBuildId === liveBuildId && !netBuildId && !swBuildId);
    const liveNeedsReload = shouldReloadForBuild(currentBuildId, liveBuildId);
    if (!liveNeedsReload) {
      adoptActiveBuild(liveBuildId);
      store.set((prev) => (prev.pwaUpdateAvailable ? { ...prev, pwaUpdateAvailable: false } : prev));
      clearPwaAutoApplyGuard();
      clearPendingPwaBuild(liveBuildId);
      return;
    }
    setPendingPwaBuild(liveBuildId, "Получено обновление веб-клиента. Можно обновить сейчас или позже.");
    if (!swBuildId || swBuildId !== liveBuildId) {
      logPwaUpdate("bootstrap_reconcile_stale", `${swBuildId || "none"}->${liveBuildId}`);
      if (startupPendingOnly) {
        logPwaUpdate("bootstrap_pending_prompt", liveBuildId);
        return;
      }
      if (shouldDisableAutoApplyUpdate()) {
        scheduleAutoApplyPwaUpdate(PWA_AUTO_APPLY_RETRY_MS);
        return;
      }
      void forcePwaUpdate();
      return;
    }
    logPwaUpdate("bootstrap_reconcile_pending", liveBuildId);
    scheduleAutoApplyPwaUpdate(1200);
  }

  function isSafeToAutoApplyUpdate(st: AppState): boolean {
    if (typeof document === "undefined") return false;
    if (getPwaStabilityHoldRemainingMs() > 0) return false;
    const hasActiveTransfer = hasActiveFileTransferEntries(st.fileTransfers || []);
    if (hasActiveTransfer) return false;
    if (hasPwaReloadBlockers()) return false;
    if (hasPendingFileActivityForUpdate()) return false;
    if (Object.values(st.historyLoading || {}).some(Boolean)) return false;
    if (hasPendingHistoryActivityForUpdate()) return false;
    if (hasPendingPreviewActivityForUpdate()) return false;
    if (st.modal) return false;
    const now = Date.now();
    const idleFor = Math.max(0, now - (getLastUserInputAt() || 0));
    // Не перезапускаем приложение, пока пользователь находится в поле ввода (особенно на iOS).
    // Исключение: пустой композер без активного редактирования/ответа.
    const ae = document.activeElement as HTMLElement | null;
    if (ae && (ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement || ae.isContentEditable)) {
      const isComposer = ae.getAttribute("data-ios-assistant") === "composer";
      if (!isComposer) return false;
      if (st.editing || st.replyDraft || st.forwardDraft || st.chatSelection) return false;
      const value = ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement ? ae.value : String(ae.textContent || "");
      if (value.trim()) {
        // Desktop PWA: черновики сохраняем перед перезапуском, поэтому можно применить обновление после паузы.
        if (isIOS() || !isStandaloneDisplayMode()) return false;
        if (idleFor < 12_000) return false;
      }
    }
    // Не дёргаем PWA/веб обновление, когда вкладка неактивна: на мобилках это часто даёт "чёрный экран" при возврате.
    if (document.visibilityState !== "visible") return false;
    // Даем пользователю чуть "тишины", чтобы не перезагружать в момент активного ввода/кликов.
    if (idleFor < 3_000) return false;
    return true;
  }

  function shouldDisableAutoApplyUpdate(): boolean {
    return isIOS() || isStandaloneDisplayMode();
  }

  function scheduleAutoApplyPwaUpdate(delayMs = 800) {
    if (shouldDisableAutoApplyUpdate()) {
      const buildId = pwaPendingBuildId || String(store.get().updateLatest || "").trim();
      logPwaUpdate("auto_disabled", buildId || "unknown");
      if (pwaAutoApplyTimer !== null) {
        try {
          window.clearTimeout(pwaAutoApplyTimer);
        } catch {
          // ignore
        }
        pwaAutoApplyTimer = null;
      }
      store.set((prev) => (prev.pwaUpdateAvailable ? { ...prev, status: PWA_AUTO_APPLY_STATUS } : prev));
      return;
    }
    if (pwaAutoApplyTimer !== null) return;
    pwaAutoApplyTimer = window.setTimeout(() => {
      pwaAutoApplyTimer = null;
      const st = store.get();
      if (!st.pwaUpdateAvailable) return;
      if (pwaAutoApplySuppressed) return;
      if (!isSafeToAutoApplyUpdate(st)) {
        const remainingHoldMs = getPwaStabilityHoldRemainingMs();
        if (remainingHoldMs > 0) {
          const hold = readPwaStabilityHold();
          logPwaUpdate("auto_hold", `${hold?.kind || "unknown"}:${remainingHoldMs}`);
          scheduleAutoApplyPwaUpdate(Math.min(Math.max(remainingHoldMs + 1200, 4_000), 60_000));
          return;
        }
        scheduleAutoApplyPwaUpdate();
        return;
      }
      const buildId = pwaPendingBuildId || st.clientVersion || "";
      if (shouldBlockPwaAutoApply(buildId)) {
        logPwaUpdate("auto_backoff", buildId || "unknown");
        clearPwaAutoApplyGuard();
        store.set({ status: "Обновление ожидает применения. Повторим попытку автоматически.", pwaUpdateAvailable: true });
        scheduleAutoApplyPwaUpdate(PWA_AUTO_APPLY_RETRY_MS);
        return;
      }
      markPwaAutoApplyAttempt(buildId);
      void applyPwaUpdateNow({ mode: "auto", buildId });
    }, delayMs);
  }

  const onPwaBuild = (ev: Event) => {
    const detail = (ev as CustomEvent<any>).detail;
    const buildId = String(detail?.buildId ?? "").trim();
    if (!buildId) return;
    const hasController = typeof navigator !== "undefined" && Boolean(navigator.serviceWorker?.controller);
    const hasWaiting = hasPwaUpdate();
    const needReload = shouldReloadForBuild(currentClientBuildId(), buildId);
    logPwaUpdate("build", `${buildId}${needReload ? "" : " ok"}`);
    if (needReload) {
      setPendingPwaBuild(buildId);
      scheduleAutoApplyPwaUpdate();
      return;
    }
    clearPwaAutoApplyGuard();
    if (hasController && !hasWaiting) {
      adoptActiveBuild(buildId);
      store.set((prev) => (prev.pwaUpdateAvailable ? { ...prev, pwaUpdateAvailable: false } : prev));
      return;
    }
    adoptActiveBuild(buildId);
  };

  const onPwaSwError = (ev: Event) => {
    const detail = (ev as CustomEvent<any>).detail;
    const err = String(detail?.error ?? "").trim();
    if (!err) return;
    const msg = `Service Worker: ${err}`;
    store.set({ pwaPushStatus: msg, status: msg });
  };

  const onPwaUpdate = () => {
    logPwaUpdate("sw_update");
    store.set((prev) => ({
      ...prev,
      pwaUpdateAvailable: true,
      status: "Получено обновление веб-клиента. Нажмите «Обновить», когда будет удобно.",
      ...(shouldOpenPwaUpdatePrompt(prev) ? { modal: { kind: "pwa_update" } } : {}),
    }));
    scheduleAutoApplyPwaUpdate();
  };

  const onPwaStabilityHold = () => {
    const remaining = getPwaStabilityHoldRemainingMs();
    if (remaining <= 0) return;
    if (!store.get().pwaUpdateAvailable) return;
    scheduleAutoApplyPwaUpdate(Math.min(Math.max(remaining + 1200, 4_000), 60_000));
  };

  function installEventListeners() {
    if (listenersInstalled) return;
    listenersInstalled = true;
    window.addEventListener("yagodka:pwa-build", onPwaBuild);
    window.addEventListener("yagodka:pwa-sw-error", onPwaSwError);
    window.addEventListener("yagodka:pwa-update", onPwaUpdate);
    window.addEventListener("yagodka:pwa-stability-hold", onPwaStabilityHold);
    void reconcilePwaBootState().catch(() => {});
  }

  function dispose() {
    if (!listenersInstalled) return;
    listenersInstalled = false;
    try {
      window.removeEventListener("yagodka:pwa-build", onPwaBuild);
      window.removeEventListener("yagodka:pwa-sw-error", onPwaSwError);
      window.removeEventListener("yagodka:pwa-update", onPwaUpdate);
      window.removeEventListener("yagodka:pwa-stability-hold", onPwaStabilityHold);
    } catch {
      // ignore
    }
    if (pwaAutoApplyTimer !== null) {
      try {
        window.clearTimeout(pwaAutoApplyTimer);
      } catch {
        // ignore
      }
      pwaAutoApplyTimer = null;
    }
  }

  return {
    installEventListeners,
    dispose,
    applyPwaUpdateNow,
    forceUpdateReload,
    forcePwaUpdate,
    scheduleAutoApplyPwaUpdate,
  };
}
