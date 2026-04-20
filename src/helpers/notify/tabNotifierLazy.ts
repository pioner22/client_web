type TabNotifierModule = typeof import("./tabNotifier");
type RealTabNotifier = import("./tabNotifier").TabNotifier;

export type TabNotifierLike = Pick<
  RealTabNotifier,
  "install" | "getSnapshot" | "shouldShowToast" | "shouldPlaySound" | "shouldShowSystemNotification"
>;

let singleton: TabNotifierLike | null = null;
let loadedNotifier: RealTabNotifier | null = null;
let loadPromise: Promise<RealTabNotifier | null> | null = null;
let installRequested = false;
let resolveInstanceId: (() => string) | null = null;

function docHidden(): boolean {
  try {
    return typeof document !== "undefined" && document.visibilityState !== "visible";
  } catch {
    return false;
  }
}

function docFocused(): boolean {
  try {
    if (typeof document === "undefined" || typeof document.hasFocus !== "function") return false;
    return Boolean(document.hasFocus());
  } catch {
    return false;
  }
}

function fallbackSnapshot(): ReturnType<TabNotifierLike["getSnapshot"]> {
  return {
    anyVisible: !docHidden(),
    anyFocused: docFocused(),
    leader: false,
  };
}

function primeNotifier(): void {
  void ensureNotifier().catch(() => {});
}

async function ensureNotifier(): Promise<RealTabNotifier | null> {
  if (loadedNotifier) return loadedNotifier;
  if (loadPromise) return loadPromise;
  const getInstanceId = resolveInstanceId;
  if (!getInstanceId) return null;
  loadPromise = import("./tabNotifier")
    .then((mod: TabNotifierModule) => {
      const notifier = mod.getTabNotifier(getInstanceId);
      loadedNotifier = notifier;
      if (installRequested) notifier.install();
      return notifier;
    })
    .catch(() => null)
    .finally(() => {
      if (!loadedNotifier) loadPromise = null;
    });
  return loadPromise;
}

export function getTabNotifier(getInstanceId: () => string): TabNotifierLike {
  if (singleton) return singleton;
  resolveInstanceId = getInstanceId;
  singleton = {
    install() {
      installRequested = true;
      if (loadedNotifier) {
        loadedNotifier.install();
        return;
      }
      primeNotifier();
    },
    getSnapshot() {
      if (loadedNotifier) return loadedNotifier.getSnapshot();
      primeNotifier();
      return fallbackSnapshot();
    },
    shouldShowToast(notifKey, ttlMs) {
      if (loadedNotifier) return loadedNotifier.shouldShowToast(notifKey, ttlMs);
      primeNotifier();
      return Boolean(String(notifKey || "").trim()) && !docHidden() && docFocused();
    },
    shouldPlaySound(notifKey, ttlMs) {
      if (loadedNotifier) return loadedNotifier.shouldPlaySound(notifKey, ttlMs);
      primeNotifier();
      return Boolean(String(notifKey || "").trim()) && docFocused();
    },
    shouldShowSystemNotification(notifKey, ttlMs) {
      if (loadedNotifier) return loadedNotifier.shouldShowSystemNotification(notifKey, ttlMs);
      primeNotifier();
      void notifKey;
      void ttlMs;
      return false;
    },
  };
  return singleton;
}
