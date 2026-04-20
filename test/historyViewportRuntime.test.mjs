import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadHelper() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/chat/historyViewportRuntime.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.getChatHistoryViewportRuntime !== "function") throw new Error("getChatHistoryViewportRuntime export missing");
    if (typeof mod.captureAndStoreChatShiftAnchor !== "function") throw new Error("captureAndStoreChatShiftAnchor export missing");
    if (typeof mod.resetChatHistoryViewportRuntime !== "function") throw new Error("resetChatHistoryViewportRuntime export missing");
    return {
      getChatHistoryViewportRuntime: mod.getChatHistoryViewportRuntime,
      captureAndStoreChatShiftAnchor: mod.captureAndStoreChatShiftAnchor,
      resetChatHistoryViewportRuntime: mod.resetChatHistoryViewportRuntime,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

function createMsgNode(id, top, bottom) {
  return {
    classList: { contains: (name) => name === "msg" },
    getBoundingClientRect: () => ({ top, bottom }),
    getAttribute(name) {
      if (name === "data-msg-key") return `msg:${id}`;
      if (name === "data-msg-id") return String(id);
      return null;
    },
  };
}

test("historyViewportRuntime: keeps one shared runtime per host and stores captured shift anchor", async () => {
  const { getChatHistoryViewportRuntime, captureAndStoreChatShiftAnchor, cleanup } = await loadHelper();
  try {
    const first = createMsgNode(101, 24, 84);
    const second = createMsgNode(102, 92, 152);
    const host = {
      scrollTop: 320,
      firstElementChild: { children: [first, second] },
      getBoundingClientRect: () => ({ top: 0, bottom: 200 }),
    };

    const runtime = getChatHistoryViewportRuntime(host);
    runtime.virtualAvgHeights.set("dm:123", 88);
    runtime.unreadClearArmed.add("dm:123");

    const anchor = captureAndStoreChatShiftAnchor(host, "dm:123");
    const runtimeAgain = getChatHistoryViewportRuntime(host);

    assert.equal(runtimeAgain, runtime);
    assert.equal(runtimeAgain.virtualAvgHeights.get("dm:123"), 88);
    assert.equal(runtimeAgain.unreadClearArmed.has("dm:123"), true);
    assert.deepEqual(anchor, {
      key: "dm:123",
      msgKey: "msg:101",
      msgId: 101,
      rectTop: 24,
      scrollTop: 320,
    });
    assert.equal(runtimeAgain.shiftAnchor, anchor);
  } finally {
    await cleanup();
  }
});

test("historyViewportRuntime: reset clears sticky/anchor state and disconnects observer", async () => {
  const { getChatHistoryViewportRuntime, resetChatHistoryViewportRuntime, cleanup } = await loadHelper();
  try {
    const host = { scrollTop: 0, firstElementChild: null };
    const runtime = getChatHistoryViewportRuntime(host);
    let disconnectCount = 0;
    runtime.stickyBottom = { key: "dm:123", active: true, at: 1000, scrollTop: 480 };
    runtime.shiftAnchor = { key: "dm:123", msgKey: "msg:101", msgId: 101, rectTop: 40, scrollTop: 480 };
    runtime.compensatedAt = 123456;
    runtime.virtualAvgHeights.set("dm:123", 92);
    runtime.unreadAnchors.set("dm:123", { msgKey: "msg:101", msgId: 101 });
    runtime.unreadClearArmed.add("dm:123");
    runtime.linesObserved = { tagName: "DIV" };
    runtime.linesObserver = {
      disconnect() {
        disconnectCount += 1;
      },
    };

    resetChatHistoryViewportRuntime(host);

    assert.equal(disconnectCount, 1);
    assert.equal(runtime.stickyBottom, null);
    assert.equal(runtime.shiftAnchor, null);
    assert.equal(runtime.compensatedAt, 0);
    assert.equal(runtime.virtualAvgHeights.size, 0);
    assert.equal(runtime.unreadAnchors.size, 0);
    assert.equal(runtime.unreadClearArmed.size, 0);
    assert.equal(runtime.linesObserver, null);
    assert.equal(runtime.linesObserved, null);
    assert.equal(runtime.linesObserverRaf, null);
  } finally {
    await cleanup();
  }
});
