let updateRegistration: ServiceWorkerRegistration | null = null;
let updateNotified = false;
let updatePollTimer: number | null = null;
let lastBuildId = "";
let shareReadySent = false;
let registerStarted = false;

function emitSwError(err: unknown) {
  try {
    const name = typeof (err as any)?.name === "string" ? String((err as any).name) : "";
    const message = typeof (err as any)?.message === "string" ? String((err as any).message).trim() : "";
    const detail = message ? (name ? `${name}: ${message}` : message) : name || "unknown_error";
    window.dispatchEvent(new CustomEvent("yagodka:pwa-sw-error", { detail: { error: detail } }));
  } catch {
    // ignore
  }
}

// Test-only hook (used by node --test) to inject a fake SW registration.
export function __setUpdateRegistrationForTest(reg: ServiceWorkerRegistration | null) {
  updateRegistration = reg;
}

export function hasPwaUpdate(): boolean {
  return Boolean(updateRegistration?.waiting);
}

export async function activatePwaUpdate(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  const reg = updateRegistration;
  const waiting = reg?.waiting;
  if (!reg || !waiting) return false;

  // Wait until the new SW becomes the controller, then caller can reload.
  // On some platforms (notably iOS/WebKit) `controllerchange` may be flaky/late even though
  // the waiting worker transitions to "activated". We treat that transition as "good enough"
  // to proceed with reload and let boot.js recover if something goes wrong.
  const changed = await new Promise<boolean>((resolve) => {
    let done = false;
    let didChange = false;
    let didActivate = false;
    let timer: number | null = null;
    const finish = () => {
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
      navigator.serviceWorker.removeEventListener("controllerchange", onChange);
      try {
        waiting.removeEventListener("statechange", onState);
      } catch {
        // ignore
      }
      resolve(didChange || didActivate);
    };
    const onChange = () => {
      didChange = true;
      finish();
    };
    const onState = () => {
      if (waiting.state === "activated") {
        didActivate = true;
        finish();
      }
    };
    navigator.serviceWorker.addEventListener("controllerchange", onChange);
    try {
      waiting.addEventListener("statechange", onState);
    } catch {
      // ignore
    }

    try {
      waiting.postMessage({ type: "SKIP_WAITING" });
    } catch {
      // ignore
    }

    // Do not hang too long: even if the update doesn't apply immediately, we can reload and let the
    // polling logic try again later. boot.js will also auto-recover if the app doesn't boot.
    timer = window.setTimeout(() => finish(), 8_000);
  });

  return changed;
}

function notifyUpdate(reg: ServiceWorkerRegistration) {
  updateRegistration = reg;
  if (updateNotified) return;
  updateNotified = true;
  window.dispatchEvent(new Event("yagodka:pwa-update"));
}

function notifyBuildId(buildId: unknown) {
  const id = String(buildId ?? "").trim();
  if (!id) return;
  if (id === lastBuildId) return;
  lastBuildId = id;
  window.dispatchEvent(new CustomEvent("yagodka:pwa-build", { detail: { buildId: id } }));
}

function notifySharePayload(payload: unknown) {
  window.dispatchEvent(new CustomEvent("yagodka:pwa-share", { detail: payload }));
}

function notifyStreamReady(payload: unknown) {
  window.dispatchEvent(new CustomEvent("yagodka:pwa-stream-ready", { detail: payload }));
}

function notifyNotificationClick(payload: unknown) {
  window.dispatchEvent(new CustomEvent("yagodka:pwa-notification-click", { detail: payload }));
}

function requestBuildId(reg?: ServiceWorkerRegistration) {
  try {
    const msg = { type: "GET_BUILD_ID" };
    const controller = navigator.serviceWorker.controller;
    if (controller) {
      controller.postMessage(msg);
      return;
    }
    const fallback = reg?.active || reg?.waiting || reg?.installing || null;
    fallback?.postMessage?.(msg);
  } catch {
    // ignore
  }
}

function requestSharePayload(reg?: ServiceWorkerRegistration) {
  try {
    const msg = { type: "PWA_SHARE_READY" };
    const controller = navigator.serviceWorker.controller;
    if (controller) {
      controller.postMessage(msg);
      shareReadySent = true;
      return;
    }
    const fallback = reg?.active || reg?.waiting || reg?.installing || null;
    fallback?.postMessage?.(msg);
    shareReadySent = true;
  } catch {
    // ignore
  }
}

function startUpdatePolling(reg: ServiceWorkerRegistration) {
  updateRegistration = reg;
  if (updatePollTimer !== null) return;

  const run = () => {
    // Some tabs may miss "updatefound" if another tab already downloaded the new SW.
    // Polling must also surface an already-waiting worker.
    if (reg.waiting && navigator.serviceWorker.controller) notifyUpdate(reg);
    reg
      .update()
      .catch(() => {})
      .finally(() => {
        if (reg.waiting && navigator.serviceWorker.controller) notifyUpdate(reg);
        requestBuildId(reg);
      });
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") run();
  };
  document.addEventListener("visibilitychange", onVisible);
  // PWA/mobile: also re-check when network comes back or app regains focus.
  window.addEventListener("online", run);
  window.addEventListener("focus", run);

  // Periodically check for SW updates so PWA can pick up new builds without a full restart.
  updatePollTimer = window.setInterval(run, 5 * 60 * 1000);
  // Also kick a check shortly after startup.
  window.setTimeout(run, 3_000);
  requestBuildId(reg);
  if (!shareReadySent) requestSharePayload(reg);
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  // Service workers often break Vite HMR and cause "weird UI" during development due to aggressive caching.
  // In dev mode, ensure SW is not controlling the page.
  if (import.meta.env.DEV) {
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .then(() => {
        if (!hadController) return;
        if (sessionStorage.getItem("yagodka_sw_unregistered") === "1") return;
        sessionStorage.setItem("yagodka_sw_unregistered", "1");
        window.location.reload();
      })
      .catch(() => {});
    return;
  }

  navigator.serviceWorker.addEventListener("message", (event) => {
    const data = (event && (event as MessageEvent).data) || null;
    if (!data || typeof data !== "object") return;
    const type = (data as any).type;
    if (type === "BUILD_ID") notifyBuildId((data as any).buildId);
    if (type === "PWA_SHARE") notifySharePayload((data as any).payload);
    if (type === "PWA_STREAM_READY") notifyStreamReady(data);
    if (type === "PWA_NOTIFICATION_CLICK") notifyNotificationClick((data as any).payload ?? data);
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    requestBuildId();
    requestSharePayload();
  });

  const registerNow = () => {
    if (registerStarted) return;
    registerStarted = true;
    (async () => {
      let reg: ServiceWorkerRegistration | null = null;
      try {
        reg = await navigator.serviceWorker.getRegistration();
      } catch {
        reg = null;
      }
      if (!reg) {
        reg = await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
      }
      startUpdatePolling(reg);

      // If there's already a waiting worker, surface it.
      if (reg.waiting && navigator.serviceWorker.controller) {
        notifyUpdate(reg);
      }

      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          // Only notify when updating an existing installation.
          if (nw.state === "installed" && reg.waiting && navigator.serviceWorker.controller) {
            notifyUpdate(reg);
          }
        });
      });

      requestBuildId(reg);
      requestSharePayload(reg);
      navigator.serviceWorker.ready
        .then(() => {
          requestBuildId(reg);
          requestSharePayload(reg);
        })
        .catch(() => {});
    })().catch((err) => emitSwError(err));
  };

  if (document.readyState === "complete" || document.readyState === "interactive") {
    registerNow();
  } else {
    window.addEventListener("load", registerNow, { once: true });
    window.setTimeout(() => {
      if (!registerStarted && document.readyState !== "loading") registerNow();
    }, 3_000);
  }
}
