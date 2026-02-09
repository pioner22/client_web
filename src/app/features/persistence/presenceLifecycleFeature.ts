import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";

const PRESENCE_UI_TICK_MS = 30_000;

export interface PresenceLifecycleFeatureDeps {
  store: Store<AppState>;
  flushHistoryCache: () => void;
  flushFileTransfers: () => void;
  flushOutbox: () => void;
}

export function installPresenceLifecycleFeature(deps: PresenceLifecycleFeatureDeps): void {
  const { store, flushHistoryCache, flushFileTransfers, flushOutbox } = deps;

  let presenceUiTimer: number | null = null;

  const tickPresenceUi = () => {
    if (document.visibilityState === "hidden") return;
    const st = store.get();
    if (!st.authed) return;
    store.set((prev) => ({ ...prev, presenceTick: (prev.presenceTick || 0) + 1 }));
  };

  const flushCachesOnHide = () => {
    if (document.visibilityState !== "hidden") return;
    flushHistoryCache();
    flushFileTransfers();
    flushOutbox();
  };

  presenceUiTimer = window.setInterval(tickPresenceUi, PRESENCE_UI_TICK_MS);
  document.addEventListener("visibilitychange", flushCachesOnHide);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") tickPresenceUi();
  });
  window.addEventListener("pagehide", () => {
    if (presenceUiTimer !== null) {
      try {
        window.clearInterval(presenceUiTimer);
      } catch {
        // ignore
      }
      presenceUiTimer = null;
    }
    flushHistoryCache();
    flushFileTransfers();
    flushOutbox();
  });
}
