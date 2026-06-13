import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadFeature(appVersion = "0.1.810") {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/app/features/pwa/pwaUpdateFeature.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
      define: {
        __APP_VERSION__: JSON.stringify(appVersion),
        __ANDROID_APP_VERSION_NAME__: JSON.stringify("1.0.20"),
        __ANDROID_APP_VERSION_CODE__: "21",
      },
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.createPwaUpdateFeature !== "function") throw new Error("createPwaUpdateFeature export missing");
    return { createPwaUpdateFeature: mod.createPwaUpdateFeature, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

function makeStorage() {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(String(key)) ? data.get(String(key)) : null;
    },
    setItem(key, value) {
      data.set(String(key), String(value));
    },
    removeItem(key) {
      data.delete(String(key));
    },
  };
}

function makeEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      const arr = listeners.get(type) || [];
      arr.push(fn);
      listeners.set(type, arr);
    },
    removeEventListener(type, fn) {
      const arr = listeners.get(type) || [];
      listeners.set(
        type,
        arr.filter((x) => x !== fn)
      );
    },
    dispatchEvent(event) {
      const arr = listeners.get(String(event.type)) || [];
      for (const fn of arr.slice()) fn(event);
      return true;
    },
  };
}

test("pwaUpdateFeature: update reload clears browser session carry before navigation", async () => {
  const src = await readFile(path.resolve("src/app/features/pwa/pwaUpdateFeature.ts"), "utf8");
  assert.match(src, /stashSessionTokenForReload/);
  assert.match(src, /stashSessionTokenForReload\(reason \|\| "pwa_update"\)/);
  assert.match(src, /stashSessionTokenForReload\(`pwa_reset:\$\{reason \|\| "unknown"\}`\)/);
});

test("pwaUpdateFeature: новый BUILD_ID не подменяет clientVersion до реального reload", async () => {
  const prevWindowDesc = Object.getOwnPropertyDescriptor(globalThis, "window");
  const prevDocumentDesc = Object.getOwnPropertyDescriptor(globalThis, "document");
  const prevNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const prevLocalStorageDesc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const prevSessionStorageDesc = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const prevEventDesc = Object.getOwnPropertyDescriptor(globalThis, "Event");
  const prevCustomEventDesc = Object.getOwnPropertyDescriptor(globalThis, "CustomEvent");
  const prevFetch = globalThis.fetch;
  const helper = await loadFeature();
  try {
    const windowTarget = makeEventTarget();
    const localStorage = makeStorage();
    const sessionStorage = makeStorage();
    const pendingTimers = [];
    const windowStub = {
      ...windowTarget,
      localStorage,
      sessionStorage,
      location: { href: "https://yagodka.org/web/" },
      setTimeout(fn, _ms) {
        pendingTimers.push(fn);
        return pendingTimers.length;
      },
      clearTimeout() {},
    };
    class EventStub {
      constructor(type) {
        this.type = String(type);
      }
    }
    class CustomEventStub extends EventStub {
      constructor(type, init = {}) {
        super(type);
        this.detail = init.detail;
      }
    }
    Object.defineProperty(globalThis, "window", { value: windowStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "sessionStorage", { value: sessionStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "document", {
      value: { visibilityState: "visible", activeElement: null },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: {
        serviceWorker: {
          controller: { postMessage() {} },
          getRegistration: async () => null,
          ready: Promise.resolve(null),
        },
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "Event", { value: EventStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "CustomEvent", { value: CustomEventStub, configurable: true, writable: true });
    globalThis.fetch = async () => ({ ok: true, text: async () => 'const BUILD_ID = "0.1.792-abcdef123456";' });

    const sendCalls = [];
    const store = {
      state: {
        authed: true,
        conn: "connected",
        selfId: "111",
        clientVersion: "0.1.791-27ef803b5f72",
        updateLatest: null,
        pwaUpdateAvailable: false,
        status: "",
        fileTransfers: [],
        historyLoading: {},
        modal: null,
        editing: null,
        replyDraft: null,
        forwardDraft: null,
        chatSelection: null,
      },
      get() {
        return this.state;
      },
      set(patch) {
        this.state =
          typeof patch === "function"
            ? patch(this.state)
            : {
                ...this.state,
                ...patch,
              };
      },
    };

    const feature = helper.createPwaUpdateFeature({
      store,
      send: (payload) => sendCalls.push(payload),
      flushBeforeReload: () => {},
      getLastUserInputAt: () => 0,
      hasPendingHistoryActivityForUpdate: () => false,
      hasPendingPreviewActivityForUpdate: () => false,
      hasPendingFileActivityForUpdate: () => false,
    });
    feature.installEventListeners();
    windowStub.dispatchEvent(new CustomEventStub("yagodka:pwa-build", { detail: { buildId: "0.1.792-abcdef123456" } }));

    assert.equal(store.state.clientVersion, "0.1.791-27ef803b5f72");
    assert.equal(store.state.updateLatest, "0.1.792-abcdef123456");
    assert.equal(store.state.pwaUpdateAvailable, true);
    assert.deepEqual(store.state.modal, { kind: "pwa_update" });
    assert.equal(localStorage.getItem("yagodka_active_build_id_v1"), null);
    assert.equal(sendCalls.length, 0);
  } finally {
    if (prevWindowDesc) Object.defineProperty(globalThis, "window", prevWindowDesc);
    else delete globalThis.window;
    if (prevDocumentDesc) Object.defineProperty(globalThis, "document", prevDocumentDesc);
    else delete globalThis.document;
    if (prevNavigatorDesc) Object.defineProperty(globalThis, "navigator", prevNavigatorDesc);
    else delete globalThis.navigator;
    if (prevLocalStorageDesc) Object.defineProperty(globalThis, "localStorage", prevLocalStorageDesc);
    else delete globalThis.localStorage;
    if (prevSessionStorageDesc) Object.defineProperty(globalThis, "sessionStorage", prevSessionStorageDesc);
    else delete globalThis.sessionStorage;
    if (prevEventDesc) Object.defineProperty(globalThis, "Event", prevEventDesc);
    else delete globalThis.Event;
    if (prevCustomEventDesc) Object.defineProperty(globalThis, "CustomEvent", prevCustomEventDesc);
    else delete globalThis.CustomEvent;
    globalThis.fetch = prevFetch;
    await helper.cleanup();
  }
});

test("pwaUpdateFeature: active full BUILD_ID is treated as current and does not auto-reload", async () => {
  const prevWindowDesc = Object.getOwnPropertyDescriptor(globalThis, "window");
  const prevDocumentDesc = Object.getOwnPropertyDescriptor(globalThis, "document");
  const prevNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const prevLocalStorageDesc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const prevSessionStorageDesc = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const prevEventDesc = Object.getOwnPropertyDescriptor(globalThis, "Event");
  const prevCustomEventDesc = Object.getOwnPropertyDescriptor(globalThis, "CustomEvent");
  const helper = await loadFeature();
  try {
    const windowTarget = makeEventTarget();
    const localStorage = makeStorage();
    const sessionStorage = makeStorage();
    const pendingTimers = [];
    const windowStub = {
      ...windowTarget,
      localStorage,
      sessionStorage,
      location: { href: "https://yagodka.org/web/" },
      setTimeout(fn, _ms) {
        pendingTimers.push(fn);
        return pendingTimers.length;
      },
      clearTimeout() {},
    };
    class EventStub {
      constructor(type) {
        this.type = String(type);
      }
    }
    class CustomEventStub extends EventStub {
      constructor(type, init = {}) {
        super(type);
        this.detail = init.detail;
      }
    }
    Object.defineProperty(globalThis, "window", { value: windowStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "sessionStorage", { value: sessionStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "document", {
      value: { visibilityState: "visible", activeElement: null },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: {
        serviceWorker: {
          controller: { postMessage() {} },
          getRegistration: async () => null,
          ready: Promise.resolve(null),
        },
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "Event", { value: EventStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "CustomEvent", { value: CustomEventStub, configurable: true, writable: true });

    const sendCalls = [];
    const store = {
      state: {
        authed: true,
        conn: "connected",
        selfId: "111",
        clientVersion: "0.1.810-9cefc391f20b",
        updateLatest: null,
        pwaUpdateAvailable: false,
        status: "",
        fileTransfers: [],
        historyLoading: {},
        modal: null,
        editing: null,
        replyDraft: null,
        forwardDraft: null,
        chatSelection: null,
      },
      get() {
        return this.state;
      },
      set(patch) {
        this.state =
          typeof patch === "function"
            ? patch(this.state)
            : {
                ...this.state,
                ...patch,
              };
      },
    };

    const feature = helper.createPwaUpdateFeature({
      store,
      send: (payload) => sendCalls.push(payload),
      flushBeforeReload: () => {},
      getLastUserInputAt: () => 0,
      hasPendingHistoryActivityForUpdate: () => false,
      hasPendingPreviewActivityForUpdate: () => false,
      hasPendingFileActivityForUpdate: () => false,
    });
    feature.installEventListeners();
    windowStub.dispatchEvent(new CustomEventStub("yagodka:pwa-build", { detail: { buildId: "0.1.810-9cefc391f20b" } }));

    assert.equal(store.state.updateLatest, null);
    assert.equal(store.state.pwaUpdateAvailable, false);
    assert.equal(localStorage.getItem("yagodka_active_build_id_v1"), "0.1.810-9cefc391f20b");
    assert.equal(pendingTimers.length, 0);
    assert.equal(sendCalls.length, 1);
    assert.equal(sendCalls[0].version, "0.1.810-9cefc391f20b");
  } finally {
    if (prevWindowDesc) Object.defineProperty(globalThis, "window", prevWindowDesc);
    else delete globalThis.window;
    if (prevDocumentDesc) Object.defineProperty(globalThis, "document", prevDocumentDesc);
    else delete globalThis.document;
    if (prevNavigatorDesc) Object.defineProperty(globalThis, "navigator", prevNavigatorDesc);
    else delete globalThis.navigator;
    if (prevLocalStorageDesc) Object.defineProperty(globalThis, "localStorage", prevLocalStorageDesc);
    else delete globalThis.localStorage;
    if (prevSessionStorageDesc) Object.defineProperty(globalThis, "sessionStorage", prevSessionStorageDesc);
    else delete globalThis.sessionStorage;
    if (prevEventDesc) Object.defineProperty(globalThis, "Event", prevEventDesc);
    else delete globalThis.Event;
    if (prevCustomEventDesc) Object.defineProperty(globalThis, "CustomEvent", prevCustomEventDesc);
    else delete globalThis.CustomEvent;
    await helper.cleanup();
  }
});

test("pwaUpdateFeature: standalone PWA keeps updates manual and does not auto-reload", async () => {
  const prevWindowDesc = Object.getOwnPropertyDescriptor(globalThis, "window");
  const prevDocumentDesc = Object.getOwnPropertyDescriptor(globalThis, "document");
  const prevNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const helper = await loadFeature();
  try {
    const localStorage = makeStorage();
    const sessionStorage = makeStorage();
    const pendingTimers = [];
    const windowStub = {
      localStorage,
      sessionStorage,
      location: { href: "https://yagodka.org/web/" },
      matchMedia(query) {
        return { matches: String(query).includes("display-mode: standalone") };
      },
      setTimeout(fn, _ms) {
        pendingTimers.push(fn);
        return pendingTimers.length;
      },
      clearTimeout() {},
    };
    Object.defineProperty(globalThis, "window", { value: windowStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "document", {
      value: { visibilityState: "visible", activeElement: null },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });

    const store = {
      state: {
        authed: true,
        conn: "connected",
        selfId: "111",
        clientVersion: "0.1.791-27ef803b5f72",
        updateLatest: "0.1.792-abcdef123456",
        pwaUpdateAvailable: true,
        status: "",
        fileTransfers: [],
        historyLoading: {},
        modal: null,
        editing: null,
        replyDraft: null,
        forwardDraft: null,
        chatSelection: null,
      },
      get() {
        return this.state;
      },
      set(patch) {
        this.state =
          typeof patch === "function"
            ? patch(this.state)
            : {
                ...this.state,
                ...patch,
              };
      },
    };

    const feature = helper.createPwaUpdateFeature({
      store,
      send: () => {},
      flushBeforeReload: () => {},
      getLastUserInputAt: () => 0,
      hasPendingHistoryActivityForUpdate: () => false,
      hasPendingPreviewActivityForUpdate: () => false,
      hasPendingFileActivityForUpdate: () => false,
    });

    feature.scheduleAutoApplyPwaUpdate(1);
    assert.equal(pendingTimers.length, 0);
    assert.equal(store.state.pwaUpdateAvailable, true);
    assert.match(store.state.status, /Откройте обновление вручную/);
    assert.equal(localStorage.getItem("yagodka_active_build_id_v1"), null);
  } finally {
    if (prevWindowDesc) Object.defineProperty(globalThis, "window", prevWindowDesc);
    else delete globalThis.window;
    if (prevDocumentDesc) Object.defineProperty(globalThis, "document", prevDocumentDesc);
    else delete globalThis.document;
    if (prevNavigatorDesc) Object.defineProperty(globalThis, "navigator", prevNavigatorDesc);
    else delete globalThis.navigator;
    await helper.cleanup();
  }
});

test("pwaUpdateFeature: pending build from startup gate opens manual update prompt", async () => {
  const prevWindowDesc = Object.getOwnPropertyDescriptor(globalThis, "window");
  const prevDocumentDesc = Object.getOwnPropertyDescriptor(globalThis, "document");
  const prevNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const prevSessionStorageDesc = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const prevLocalStorageDesc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const prevFetch = globalThis.fetch;
  const helper = await loadFeature();
  try {
    const windowTarget = makeEventTarget();
    const localStorage = makeStorage();
    const sessionStorage = makeStorage();
    sessionStorage.setItem("yagodka_pending_pwa_build_v1", JSON.stringify({ buildId: "0.1.792-abcdef123456", ts: Date.now() }));
    const windowStub = {
      ...windowTarget,
      localStorage,
      sessionStorage,
      location: { href: "https://yagodka.org/web/", protocol: "https:" },
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    };
    Object.defineProperty(globalThis, "window", { value: windowStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "sessionStorage", { value: sessionStorage, configurable: true, writable: true });
    Object.defineProperty(globalThis, "document", {
      value: { visibilityState: "visible", activeElement: null },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: { serviceWorker: { getRegistration: async () => null, ready: Promise.resolve(null) } },
      configurable: true,
      writable: true,
    });
    globalThis.fetch = async () => {
      throw new Error("offline");
    };

    const store = {
      state: {
        authed: true,
        conn: "connected",
        selfId: "111",
        clientVersion: "0.1.791-27ef803b5f72",
        updateLatest: null,
        pwaUpdateAvailable: false,
        status: "",
        fileTransfers: [],
        historyLoading: {},
        modal: null,
        editing: null,
        replyDraft: null,
        forwardDraft: null,
        chatSelection: null,
      },
      get() {
        return this.state;
      },
      set(patch) {
        this.state =
          typeof patch === "function"
            ? patch(this.state)
            : {
                ...this.state,
                ...patch,
              };
      },
    };

    const feature = helper.createPwaUpdateFeature({
      store,
      send: () => {},
      flushBeforeReload: () => {},
      getLastUserInputAt: () => 0,
      hasPendingHistoryActivityForUpdate: () => false,
      hasPendingPreviewActivityForUpdate: () => false,
      hasPendingFileActivityForUpdate: () => false,
    });
    feature.installEventListeners();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(store.state.updateLatest, "0.1.792-abcdef123456");
    assert.equal(store.state.pwaUpdateAvailable, true);
    assert.deepEqual(store.state.modal, { kind: "pwa_update" });
    assert.match(store.state.status, /Можно обновить сейчас или позже/);
  } finally {
    if (prevWindowDesc) Object.defineProperty(globalThis, "window", prevWindowDesc);
    else delete globalThis.window;
    if (prevDocumentDesc) Object.defineProperty(globalThis, "document", prevDocumentDesc);
    else delete globalThis.document;
    if (prevNavigatorDesc) Object.defineProperty(globalThis, "navigator", prevNavigatorDesc);
    else delete globalThis.navigator;
    if (prevSessionStorageDesc) Object.defineProperty(globalThis, "sessionStorage", prevSessionStorageDesc);
    else delete globalThis.sessionStorage;
    if (prevLocalStorageDesc) Object.defineProperty(globalThis, "localStorage", prevLocalStorageDesc);
    else delete globalThis.localStorage;
    globalThis.fetch = prevFetch;
    await helper.cleanup();
  }
});

test("pwaUpdateFeature: manual update does not blind-reload when new build is not confirmed", async () => {
  const prevWindowDesc = Object.getOwnPropertyDescriptor(globalThis, "window");
  const prevDocumentDesc = Object.getOwnPropertyDescriptor(globalThis, "document");
  const prevNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const prevLocationDesc = Object.getOwnPropertyDescriptor(globalThis, "location");
  const prevEventDesc = Object.getOwnPropertyDescriptor(globalThis, "Event");
  const prevCustomEventDesc = Object.getOwnPropertyDescriptor(globalThis, "CustomEvent");
  const prevFetch = globalThis.fetch;
  const helper = await loadFeature();
  try {
    const windowTarget = makeEventTarget();
    const localStorage = makeStorage();
    const sessionStorage = makeStorage();
    const replaceCalls = [];
    const windowStub = {
      ...windowTarget,
      localStorage,
      sessionStorage,
      location: {
        href: "https://yagodka.org/web/",
        protocol: "https:",
        replace(url) {
          replaceCalls.push(String(url));
        },
        reload() {
          replaceCalls.push("reload");
        },
      },
      setTimeout(fn) {
        fn();
        return 1;
      },
      clearTimeout() {},
    };
    class EventStub {
      constructor(type) {
        this.type = String(type);
      }
    }
    class CustomEventStub extends EventStub {
      constructor(type, init = {}) {
        super(type);
        this.detail = init.detail;
      }
    }
    const reg = {
      waiting: null,
      active: { postMessage() {} },
      installing: null,
      update: async () => new Promise(() => {}),
    };
    Object.defineProperty(globalThis, "window", { value: windowStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "document", {
      value: { visibilityState: "visible", activeElement: null },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: {
        serviceWorker: {
          controller: { postMessage() {} },
          getRegistration: async () => reg,
          ready: Promise.resolve(reg),
          addEventListener() {},
          removeEventListener() {},
        },
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "location", { value: windowStub.location, configurable: true, writable: true });
    Object.defineProperty(globalThis, "Event", { value: EventStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "CustomEvent", { value: CustomEventStub, configurable: true, writable: true });
    globalThis.fetch = async () => {
      throw new Error("offline");
    };

    const store = {
      state: {
        authed: true,
        conn: "connected",
        selfId: "111",
        clientVersion: "0.1.791-27ef803b5f72",
        updateLatest: "0.1.792-abcdef123456",
        pwaUpdateAvailable: true,
        status: "",
        fileTransfers: [],
        historyLoading: {},
        modal: { kind: "pwa_update" },
        editing: null,
        replyDraft: null,
        forwardDraft: null,
        chatSelection: null,
      },
      get() {
        return this.state;
      },
      set(patch) {
        this.state =
          typeof patch === "function"
            ? patch(this.state)
            : {
                ...this.state,
                ...patch,
              };
      },
    };

    const feature = helper.createPwaUpdateFeature({
      store,
      send: () => {},
      flushBeforeReload: () => {},
      getLastUserInputAt: () => 0,
      hasPendingHistoryActivityForUpdate: () => false,
      hasPendingPreviewActivityForUpdate: () => false,
      hasPendingFileActivityForUpdate: () => false,
    });
    await feature.applyPwaUpdateNow({ mode: "manual" });

    assert.deepEqual(replaceCalls, []);
    assert.equal(store.state.pwaUpdateAvailable, true);
    assert.deepEqual(store.state.modal, { kind: "pwa_update" });
    assert.match(store.state.status, /Не удалось проверить загрузку обновления/);
  } finally {
    if (prevWindowDesc) Object.defineProperty(globalThis, "window", prevWindowDesc);
    else delete globalThis.window;
    if (prevDocumentDesc) Object.defineProperty(globalThis, "document", prevDocumentDesc);
    else delete globalThis.document;
    if (prevNavigatorDesc) Object.defineProperty(globalThis, "navigator", prevNavigatorDesc);
    else delete globalThis.navigator;
    if (prevLocationDesc) Object.defineProperty(globalThis, "location", prevLocationDesc);
    else delete globalThis.location;
    if (prevEventDesc) Object.defineProperty(globalThis, "Event", prevEventDesc);
    else delete globalThis.Event;
    if (prevCustomEventDesc) Object.defineProperty(globalThis, "CustomEvent", prevCustomEventDesc);
    else delete globalThis.CustomEvent;
    globalThis.fetch = prevFetch;
    await helper.cleanup();
  }
});

test("pwaUpdateFeature: auto-apply waits while recent media failures keep PWA stability hold active", async () => {
  const prevWindowDesc = Object.getOwnPropertyDescriptor(globalThis, "window");
  const prevDocumentDesc = Object.getOwnPropertyDescriptor(globalThis, "document");
  const prevNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const prevEventDesc = Object.getOwnPropertyDescriptor(globalThis, "Event");
  const prevCustomEventDesc = Object.getOwnPropertyDescriptor(globalThis, "CustomEvent");
  const helper = await loadFeature();
  try {
    const windowTarget = makeEventTarget();
    const localStorage = makeStorage();
    const sessionStorage = makeStorage();
    const pendingTimers = [];
    const replaceCalls = [];
    localStorage.setItem(
      "yagodka_pwa_stability_hold_v1",
      JSON.stringify({ kind: "media_preview_failed", ts: Date.now(), until: Date.now() + 60_000 })
    );
    const windowStub = {
      ...windowTarget,
      localStorage,
      sessionStorage,
      location: {
        href: "https://yagodka.org/web/",
        replace(url) {
          replaceCalls.push(String(url));
        },
        reload() {
          replaceCalls.push("reload");
        },
      },
      setTimeout(fn, _ms) {
        pendingTimers.push(fn);
        return pendingTimers.length;
      },
      clearTimeout() {},
    };
    class EventStub {
      constructor(type) {
        this.type = String(type);
      }
    }
    class CustomEventStub extends EventStub {
      constructor(type, init = {}) {
        super(type);
        this.detail = init.detail;
      }
    }
    Object.defineProperty(globalThis, "window", { value: windowStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "document", {
      value: { visibilityState: "visible", activeElement: null },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: {
        serviceWorker: {
          controller: { postMessage() {} },
          getRegistration: async () => null,
          ready: Promise.resolve(null),
        },
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "Event", { value: EventStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "CustomEvent", { value: CustomEventStub, configurable: true, writable: true });

    const store = {
      state: {
        authed: true,
        conn: "connected",
        selfId: "111",
        clientVersion: "0.1.791-27ef803b5f72",
        updateLatest: "0.1.792-abcdef123456",
        pwaUpdateAvailable: true,
        status: "",
        fileTransfers: [],
        historyLoading: {},
        modal: null,
        editing: null,
        replyDraft: null,
        forwardDraft: null,
        chatSelection: null,
      },
      get() {
        return this.state;
      },
      set(patch) {
        this.state =
          typeof patch === "function"
            ? patch(this.state)
            : {
                ...this.state,
                ...patch,
              };
      },
    };

    const feature = helper.createPwaUpdateFeature({
      store,
      send: () => {},
      flushBeforeReload: () => {},
      getLastUserInputAt: () => 0,
      hasPendingHistoryActivityForUpdate: () => false,
      hasPendingPreviewActivityForUpdate: () => false,
      hasPendingFileActivityForUpdate: () => false,
    });

    feature.scheduleAutoApplyPwaUpdate(1);
    assert.equal(pendingTimers.length, 1);
    pendingTimers.shift()();

    assert.deepEqual(replaceCalls, []);
    assert.equal(store.state.pwaUpdateAvailable, true);
    assert.ok(pendingTimers.length >= 1);
  } finally {
    if (prevWindowDesc) Object.defineProperty(globalThis, "window", prevWindowDesc);
    else delete globalThis.window;
    if (prevDocumentDesc) Object.defineProperty(globalThis, "document", prevDocumentDesc);
    else delete globalThis.document;
    if (prevNavigatorDesc) Object.defineProperty(globalThis, "navigator", prevNavigatorDesc);
    else delete globalThis.navigator;
    if (prevEventDesc) Object.defineProperty(globalThis, "Event", prevEventDesc);
    else delete globalThis.Event;
    if (prevCustomEventDesc) Object.defineProperty(globalThis, "CustomEvent", prevCustomEventDesc);
    else delete globalThis.CustomEvent;
    await helper.cleanup();
  }
});

test("pwaUpdateFeature: auto-apply waits while history file-get activity is pending", async () => {
  const prevWindowDesc = Object.getOwnPropertyDescriptor(globalThis, "window");
  const prevDocumentDesc = Object.getOwnPropertyDescriptor(globalThis, "document");
  const prevNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const prevLocationDesc = Object.getOwnPropertyDescriptor(globalThis, "location");
  const prevEventDesc = Object.getOwnPropertyDescriptor(globalThis, "Event");
  const prevCustomEventDesc = Object.getOwnPropertyDescriptor(globalThis, "CustomEvent");
  const helper = await loadFeature();
  try {
    const windowTarget = makeEventTarget();
    const localStorage = makeStorage();
    const sessionStorage = makeStorage();
    const pendingTimers = [];
    const replaceCalls = [];
    const windowStub = {
      ...windowTarget,
      localStorage,
      sessionStorage,
      location: {
        href: "https://yagodka.org/web/",
        protocol: "https:",
        replace(url) {
          replaceCalls.push(String(url));
        },
        reload() {
          replaceCalls.push("reload");
        },
      },
      setTimeout(fn, _ms) {
        if (Number(_ms) >= 8000) {
          queueMicrotask(fn);
          return 999;
        }
        pendingTimers.push(fn);
        return pendingTimers.length;
      },
      clearTimeout() {},
    };
    class EventStub {
      constructor(type) {
        this.type = String(type);
      }
    }
    class CustomEventStub extends EventStub {
      constructor(type, init = {}) {
        super(type);
        this.detail = init.detail;
      }
    }
    const swStateListeners = [];
    const controllerChangeListeners = [];
    const waitingWorker = {
      state: "installed",
      postMessage() {
        queueMicrotask(() => {
          this.state = "activated";
          for (const fn of swStateListeners.slice()) fn();
          for (const fn of controllerChangeListeners.slice()) fn();
        });
      },
      addEventListener(type, fn) {
        if (type === "statechange") swStateListeners.push(fn);
      },
      removeEventListener(type, fn) {
        if (type !== "statechange") return;
        const idx = swStateListeners.indexOf(fn);
        if (idx >= 0) swStateListeners.splice(idx, 1);
      },
    };
    const swRegistration = { waiting: waitingWorker, active: null, installing: null };
    Object.defineProperty(globalThis, "window", { value: windowStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "document", {
      value: { visibilityState: "visible", activeElement: null },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: {
        serviceWorker: {
          controller: { postMessage() {} },
          addEventListener(type, fn) {
            if (type === "controllerchange") controllerChangeListeners.push(fn);
          },
          removeEventListener(type, fn) {
            if (type !== "controllerchange") return;
            const idx = controllerChangeListeners.indexOf(fn);
            if (idx >= 0) controllerChangeListeners.splice(idx, 1);
          },
          getRegistration: async () => swRegistration,
          ready: Promise.resolve(swRegistration),
        },
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "location", { value: windowStub.location, configurable: true, writable: true });
    Object.defineProperty(globalThis, "Event", { value: EventStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, "CustomEvent", { value: CustomEventStub, configurable: true, writable: true });

    const store = {
      state: {
        authed: true,
        conn: "connected",
        selfId: "111",
        clientVersion: "0.1.791-27ef803b5f72",
        updateLatest: "0.1.792-abcdef123456",
        pwaUpdateAvailable: true,
        status: "",
        fileTransfers: [],
        historyLoading: {},
        modal: null,
        editing: null,
        replyDraft: null,
        forwardDraft: null,
        chatSelection: null,
      },
      get() {
        return this.state;
      },
      set(patch) {
        this.state =
          typeof patch === "function"
            ? patch(this.state)
            : {
                ...this.state,
                ...patch,
              };
      },
    };

    const feature = helper.createPwaUpdateFeature({
      store,
      send: () => {},
      flushBeforeReload: () => {},
      getLastUserInputAt: () => 0,
      hasPendingHistoryActivityForUpdate: () => false,
      hasPendingPreviewActivityForUpdate: () => false,
      hasPendingFileActivityForUpdate: () => true,
    });

    feature.scheduleAutoApplyPwaUpdate(1);
    assert.equal(pendingTimers.length, 1);
    pendingTimers.shift()();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(replaceCalls, []);
    assert.equal(store.state.pwaUpdateAvailable, true);
    assert.ok(pendingTimers.length >= 1);
  } finally {
    if (prevWindowDesc) Object.defineProperty(globalThis, "window", prevWindowDesc);
    else delete globalThis.window;
    if (prevDocumentDesc) Object.defineProperty(globalThis, "document", prevDocumentDesc);
    else delete globalThis.document;
    if (prevNavigatorDesc) Object.defineProperty(globalThis, "navigator", prevNavigatorDesc);
    else delete globalThis.navigator;
    if (prevLocationDesc) Object.defineProperty(globalThis, "location", prevLocationDesc);
    else delete globalThis.location;
    if (prevEventDesc) Object.defineProperty(globalThis, "Event", prevEventDesc);
    else delete globalThis.Event;
    if (prevCustomEventDesc) Object.defineProperty(globalThis, "CustomEvent", prevCustomEventDesc);
    else delete globalThis.CustomEvent;
    await helper.cleanup();
  }
});
