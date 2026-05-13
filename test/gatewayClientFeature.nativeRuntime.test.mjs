import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

function mkStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(String(key)) ? data.get(String(key)) : null),
    setItem: (key, value) => {
      data.set(String(key), String(value));
    },
    removeItem: (key) => {
      data.delete(String(key));
    },
    clear: () => {
      data.clear();
    },
  };
}

function makeStore(initial) {
  let state = { ...initial };
  return {
    get: () => state,
    set: (patch) => {
      state = typeof patch === "function" ? patch(state) : { ...state, ...patch };
      return state;
    },
  };
}

function stubRuntime({ native = false } = {}) {
  const prev = {
    window: Object.getOwnPropertyDescriptor(globalThis, "window"),
    document: Object.getOwnPropertyDescriptor(globalThis, "document"),
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    localStorage: Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
    sessionStorage: Object.getOwnPropertyDescriptor(globalThis, "sessionStorage"),
    BroadcastChannel: Object.getOwnPropertyDescriptor(globalThis, "BroadcastChannel"),
    Capacitor: Object.getOwnPropertyDescriptor(globalThis, "Capacitor"),
  };

  let channelConstructed = 0;
  class FakeBroadcastChannel {
    constructor() {
      channelConstructed += 1;
    }
    addEventListener() {}
    postMessage() {}
    close() {}
  }

  const localStorage = mkStorage();
  const sessionStorage = mkStorage();
  const document = {
    visibilityState: "visible",
    addEventListener: () => {},
    removeEventListener: () => {},
    hasFocus: () => true,
  };
  const window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
  };
  const navigator = {
    locks: {
      request: async (_name, arg1, arg2) => {
        const cb = typeof arg1 === "function" ? arg1 : arg2;
        if (typeof cb === "function") return await cb({});
        return undefined;
      },
    },
  };
  const Capacitor = native
    ? {
        isNativePlatform: () => true,
        getPlatform: () => "android",
      }
    : undefined;

  Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true });
  Object.defineProperty(globalThis, "sessionStorage", { value: sessionStorage, configurable: true });
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  Object.defineProperty(globalThis, "window", { value: window, configurable: true });
  Object.defineProperty(globalThis, "navigator", { value: navigator, configurable: true });
  Object.defineProperty(globalThis, "BroadcastChannel", { value: FakeBroadcastChannel, configurable: true });
  if (Capacitor) Object.defineProperty(globalThis, "Capacitor", { value: Capacitor, configurable: true });
  else delete globalThis.Capacitor;

  return {
    getChannelConstructed: () => channelConstructed,
    cleanup: () => {
      if (prev.window) Object.defineProperty(globalThis, "window", prev.window);
      else delete globalThis.window;
      if (prev.document) Object.defineProperty(globalThis, "document", prev.document);
      else delete globalThis.document;
      if (prev.navigator) Object.defineProperty(globalThis, "navigator", prev.navigator);
      else delete globalThis.navigator;
      if (prev.localStorage) Object.defineProperty(globalThis, "localStorage", prev.localStorage);
      else delete globalThis.localStorage;
      if (prev.sessionStorage) Object.defineProperty(globalThis, "sessionStorage", prev.sessionStorage);
      else delete globalThis.sessionStorage;
      if (prev.BroadcastChannel) Object.defineProperty(globalThis, "BroadcastChannel", prev.BroadcastChannel);
      else delete globalThis.BroadcastChannel;
      if (prev.Capacitor) Object.defineProperty(globalThis, "Capacitor", prev.Capacitor);
      else delete globalThis.Capacitor;
    },
  };
}

async function loadFeature() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/app/features/net/gatewayClientFeature.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.createGatewayClientFeature !== "function") {
      throw new Error("gatewayClientFeature export missing");
    }
    return {
      createGatewayClientFeature: mod.createGatewayClientFeature,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

function makeDeps(store) {
  return {
    store,
    getGatewayUrl: () => "wss://yagodka.example/ws",
    clearPendingHistoryRequests: () => {},
    handleHistoryResultMessage: () => {},
    dispatchServerMessage: () => {},
    scheduleSaveOutbox: () => {},
    onAuthed: () => {},
    maybeAutoAuthOnConnected: () => {},
  };
}

test("gatewayClientFeature: native runtime bypasses multiplex gateway even when browser locks are available", async () => {
  const helper = await loadFeature();
  const runtime = stubRuntime({ native: true });
  try {
    const store = makeStore({
      netLeader: false,
      authed: false,
      selfId: null,
      outbox: {},
      conversations: {},
      conn: "connecting",
      status: "",
      modal: null,
    });
    const { gateway } = helper.createGatewayClientFeature(makeDeps(store));
    assert.equal(runtime.getChannelConstructed(), 0, "native runtime should not open BroadcastChannel for gateway leadership");
    assert.equal(gateway.getRole?.(), "solo");
    assert.equal(store.get().netLeader, true);
    gateway.close();
  } finally {
    runtime.cleanup();
    await helper.cleanup();
  }
});

test("gatewayClientFeature: browser runtime still keeps multiplex path when locks are available", async () => {
  const helper = await loadFeature();
  const runtime = stubRuntime({ native: false });
  try {
    const store = makeStore({
      netLeader: false,
      authed: false,
      selfId: null,
      outbox: {},
      conversations: {},
      conn: "connecting",
      status: "",
      modal: null,
    });
    const { gateway } = helper.createGatewayClientFeature(makeDeps(store));
    assert.equal(runtime.getChannelConstructed(), 1, "browser runtime should still initialize BroadcastChannel multiplexing");
    assert.notEqual(gateway.getRole?.(), "solo");
    gateway.close();
  } finally {
    runtime.cleanup();
    await helper.cleanup();
  }
});
