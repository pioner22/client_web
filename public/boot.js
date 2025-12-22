(function () {
  var RECOVER_KEY = "yagodka_boot_recover_v1";
  var SOFT_RELOAD_KEY = "yagodka_boot_soft_reload_v1";
  var UPDATING_KEY = "yagodka_updating";
  var FORCE_RECOVER_KEY = "yagodka_force_recover";
  var BOOTED_EVENT = "yagodka:booted";
  var APP_SELECTOR = ".app";

  var statusEl = document.getElementById("boot-status");
  var root = document.getElementById("app");
  var booted = false;
  var requiresBootEvent = false;

  function setStatus(text) {
    try {
      if (statusEl) statusEl.textContent = text;
    } catch {}
  }

  function hasBooted() {
    if (requiresBootEvent) return booted;
    try {
      return Boolean(document.querySelector(APP_SELECTOR));
    } catch {
      return false;
    }
  }

  function clearBootFlags() {
    try {
      sessionStorage.removeItem(UPDATING_KEY);
      sessionStorage.removeItem(RECOVER_KEY);
      sessionStorage.removeItem(SOFT_RELOAD_KEY);
      sessionStorage.removeItem(FORCE_RECOVER_KEY);
    } catch {}
  }

  async function recover() {
    if (hasBooted()) return;
    var alreadyTried = false;
    try {
      alreadyTried = sessionStorage.getItem(RECOVER_KEY) === "1";
    } catch {}

    if (alreadyTried) {
      setStatus("Не удалось запустить приложение. Обновите страницу или перезапустите приложение.");
      return;
    }

    try {
      sessionStorage.setItem(RECOVER_KEY, "1");
    } catch {}

    setStatus("Восстановление обновления…");

    try {
      if ("serviceWorker" in navigator) {
        var regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(function (r) { return r.unregister(); }));
      }
    } catch {}

    try {
      if ("caches" in window) {
        var keys = await caches.keys();
        var dels = keys
          .filter(function (k) { return String(k || "").indexOf("yagodka-web-cache-") === 0; })
          .map(function (k) { return caches.delete(k); });
        await Promise.all(dels);
      }
    } catch {}

    try {
      window.location.reload();
    } catch {
      window.location.href = window.location.href;
    }
  }

  try {
    var force = sessionStorage.getItem(FORCE_RECOVER_KEY) === "1";
    var updating = sessionStorage.getItem(UPDATING_KEY) === "1";
    requiresBootEvent = force || updating;
    if (force) setStatus("Перезапуск…");
    else if (updating) setStatus("Обновление…");
  } catch {}

  window.addEventListener(
    BOOTED_EVENT,
    function () {
      booted = true;
      clearBootFlags();
    },
    { once: true }
  );

  try {
    if (sessionStorage.getItem(FORCE_RECOVER_KEY) === "1") {
      void recover();
      return;
    }
  } catch {}

  if (root && "MutationObserver" in window) {
    var mo = new MutationObserver(function () {
      if (!hasBooted()) return;
      mo.disconnect();
      clearBootFlags();
    });
    try {
      mo.observe(root, { childList: true, subtree: true });
    } catch {}
  }

  window.addEventListener(
    "error",
    function (ev) {
      var t = ev && ev.target;
      if (!t || !t.tagName) return;
      if (String(t.tagName).toUpperCase() !== "SCRIPT") return;
      void recover();
    },
    true
  );

  window.setTimeout(function () {
    if (hasBooted()) return;
    // iOS PWA иногда показывает "чёрный экран" после обновления, но ручной Ctrl+R/перезапуск помогает.
    // Поэтому при update/force сначала делаем мягкий reload один раз, и только затем — тяжёлый recover.
    if (requiresBootEvent) {
      try {
        if (sessionStorage.getItem(SOFT_RELOAD_KEY) !== "1") {
          sessionStorage.setItem(SOFT_RELOAD_KEY, "1");
          setStatus("Перезапуск…");
          window.location.reload();
          return;
        }
      } catch {}
    }
    void recover();
  }, 7000);
})();
