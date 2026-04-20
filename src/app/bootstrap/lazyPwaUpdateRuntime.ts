import type { Store } from "../../stores/store";
import type { AppState } from "../../stores/types";
import { scheduleDeferredTask } from "./scheduleDeferredTask";
import { recoverFromLazyImportError } from "./lazyImportRecovery";

type BufferedUpdateEvent = {
  type: "yagodka:pwa-build" | "yagodka:pwa-sw-error" | "yagodka:pwa-update";
  detail?: unknown;
};

type LazyPwaUpdateRuntimeDeps = {
  store: Store<AppState>;
  send: (payload: any) => void;
  flushBeforeReload: () => void;
  getLastUserInputAt: () => number;
  hasPendingHistoryActivityForUpdate: () => boolean;
  hasPendingPreviewActivityForUpdate: () => boolean;
};

export function createLazyPwaUpdateRuntime(deps: LazyPwaUpdateRuntimeDeps): {
  startDeferredBoot: () => void;
  applyPwaUpdateNow: (opts?: { mode?: "auto" | "manual"; buildId?: string }) => Promise<void>;
  forceUpdateReload: (reason?: string) => void;
  forcePwaUpdate: () => Promise<void>;
  scheduleAutoApplyPwaUpdate: (delayMs?: number) => void;
} {
  const bufferedEvents: BufferedUpdateEvent[] = [];
  let buffersInstalled = false;
  let runtimeLoaded = false;
  let runtimePromise: Promise<any> | null = null;

  const bufferEvent =
    (type: BufferedUpdateEvent["type"]) =>
    (ev: Event): void => {
      if (runtimeLoaded) return;
      const detail = ev instanceof CustomEvent ? ev.detail : undefined;
      bufferedEvents.push({ type, detail });
    };

  const onBuild = bufferEvent("yagodka:pwa-build");
  const onSwError = bufferEvent("yagodka:pwa-sw-error");
  const onUpdate = bufferEvent("yagodka:pwa-update");

  function installBuffers(): void {
    if (buffersInstalled) return;
    buffersInstalled = true;
    window.addEventListener("yagodka:pwa-build", onBuild);
    window.addEventListener("yagodka:pwa-sw-error", onSwError);
    window.addEventListener("yagodka:pwa-update", onUpdate);
  }

  function removeBuffers(): void {
    if (!buffersInstalled) return;
    buffersInstalled = false;
    window.removeEventListener("yagodka:pwa-build", onBuild);
    window.removeEventListener("yagodka:pwa-sw-error", onSwError);
    window.removeEventListener("yagodka:pwa-update", onUpdate);
  }

  function replayBufferedEvents(): void {
    const queued = bufferedEvents.splice(0, bufferedEvents.length);
    for (const event of queued) {
      if (event.type === "yagodka:pwa-update") {
        window.dispatchEvent(new Event(event.type));
        continue;
      }
      window.dispatchEvent(new CustomEvent(event.type, { detail: event.detail }));
    }
  }

  function ensureRuntimeLoaded(): Promise<any> {
    if (runtimeLoaded && runtimePromise) return runtimePromise;
    if (!runtimePromise) {
      runtimePromise = import("../features/pwa/pwaUpdateFeature")
        .then(({ createPwaUpdateFeature }) => {
          const feature = createPwaUpdateFeature({
            store: deps.store,
            send: deps.send,
            flushBeforeReload: deps.flushBeforeReload,
            getLastUserInputAt: deps.getLastUserInputAt,
            hasPendingHistoryActivityForUpdate: deps.hasPendingHistoryActivityForUpdate,
            hasPendingPreviewActivityForUpdate: deps.hasPendingPreviewActivityForUpdate,
          });
          feature.installEventListeners();
          runtimeLoaded = true;
          removeBuffers();
          replayBufferedEvents();
          return feature;
        })
        .catch((err) => {
          recoverFromLazyImportError(err, "pwa_update_runtime");
          runtimePromise = null;
          throw err;
        });
    }
    return runtimePromise;
  }

  function startDeferredBoot(): void {
    scheduleDeferredTask(() => {
      void ensureRuntimeLoaded().catch(() => {});
    });
  }

  async function applyPwaUpdateNow(opts?: { mode?: "auto" | "manual"; buildId?: string }): Promise<void> {
    const feature = await ensureRuntimeLoaded();
    await feature.applyPwaUpdateNow(opts);
  }

  function forceUpdateReload(reason?: string): void {
    void ensureRuntimeLoaded()
      .then((feature) => {
        feature.forceUpdateReload(reason);
      })
      .catch(() => {});
  }

  async function forcePwaUpdate(): Promise<void> {
    const feature = await ensureRuntimeLoaded();
    await feature.forcePwaUpdate();
  }

  function scheduleAutoApplyPwaUpdate(delayMs?: number): void {
    void ensureRuntimeLoaded()
      .then((feature) => {
        feature.scheduleAutoApplyPwaUpdate(delayMs);
      })
      .catch(() => {});
  }

  installBuffers();

  return {
    startDeferredBoot,
    applyPwaUpdateNow,
    forceUpdateReload,
    forcePwaUpdate,
    scheduleAutoApplyPwaUpdate,
  };
}
