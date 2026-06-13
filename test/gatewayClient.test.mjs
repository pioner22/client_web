import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadGatewayClient() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-gateway-client-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/lib/net/gatewayClient.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.GatewayClient !== "function") throw new Error("GatewayClient export missing");
    return { GatewayClient: mod.GatewayClient, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

function installRuntime() {
  const prev = {
    window: Object.getOwnPropertyDescriptor(globalThis, "window"),
    document: Object.getOwnPropertyDescriptor(globalThis, "document"),
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    WebSocket: Object.getOwnPropertyDescriptor(globalThis, "WebSocket"),
  };
  const timers = new Map();
  let nextTimerId = 1;
  const window = {
    setTimeout(fn, ms) {
      const id = nextTimerId++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    setInterval(fn, ms) {
      const id = nextTimerId++;
      timers.set(id, { fn, ms, interval: true });
      return id;
    },
    clearInterval(id) {
      timers.delete(id);
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const document = {
    visibilityState: "visible",
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const navigator = { onLine: true };
  const sockets = [];
  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;

    readyState = FakeWebSocket.CONNECTING;
    onopen = null;
    onclose = null;
    onerror = null;
    onmessage = null;
    closed = false;

    constructor(url) {
      this.url = url;
      sockets.push(this);
    }

    send() {
      return undefined;
    }

    close() {
      this.closed = true;
      this.readyState = FakeWebSocket.CLOSED;
    }
  }

  Object.defineProperty(globalThis, "window", { value: window, configurable: true });
  Object.defineProperty(globalThis, "document", { value: document, configurable: true });
  Object.defineProperty(globalThis, "navigator", { value: navigator, configurable: true });
  Object.defineProperty(globalThis, "WebSocket", { value: FakeWebSocket, configurable: true });

  return {
    timers,
    sockets,
    runTimer(predicate) {
      for (const [id, timer] of timers) {
        if (!predicate || predicate(timer)) {
          timers.delete(id);
          timer.fn();
          return timer;
        }
      }
      return null;
    },
    cleanup() {
      if (prev.window) Object.defineProperty(globalThis, "window", prev.window);
      else delete globalThis.window;
      if (prev.document) Object.defineProperty(globalThis, "document", prev.document);
      else delete globalThis.document;
      if (prev.navigator) Object.defineProperty(globalThis, "navigator", prev.navigator);
      else delete globalThis.navigator;
      if (prev.WebSocket) Object.defineProperty(globalThis, "WebSocket", prev.WebSocket);
      else delete globalThis.WebSocket;
    },
  };
}

test("GatewayClient: stuck WebSocket CONNECTING is bounded by connect timeout and reconnects", async () => {
  const helper = await loadGatewayClient();
  const runtime = installRuntime();
  const statuses = [];
  try {
    const client = new helper.GatewayClient(
      "wss://yagodka.example/ws",
      () => {},
      (conn, detail) => statuses.push({ conn, detail })
    );

    client.connect();
    assert.deepEqual(statuses, [{ conn: "connecting", detail: undefined }]);
    assert.equal(runtime.sockets.length, 1);

    const timeout = runtime.runTimer((timer) => timer.ms === 12_000);
    assert.ok(timeout, "connect timeout timer should be installed");
    assert.equal(runtime.sockets[0].closed, true, "stuck socket should be closed by watchdog");
    assert.deepEqual(statuses.at(-1), { conn: "disconnected", detail: "connect_timeout" });

    const statusCount = statuses.length;
    const timerCount = runtime.timers.size;
    runtime.sockets[0].onclose?.({ code: 1006, reason: "" });
    assert.equal(statuses.length, statusCount, "late close from stale socket should be ignored");
    assert.equal(runtime.timers.size, timerCount, "late close must not schedule duplicate reconnect");

    const reconnect = runtime.runTimer((timer) => timer.ms < 30_000);
    assert.ok(reconnect, "connect timeout should schedule a bounded reconnect");
    assert.equal(runtime.sockets.length, 2);
    client.close();
  } finally {
    runtime.cleanup();
    await helper.cleanup();
  }
});
