import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadFeature() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/app/features/files/fileViewerFeature.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.createFileViewerFeature !== "function") {
      throw new Error("createFileViewerFeature export missing");
    }
    return {
      createFileViewerFeature: mod.createFileViewerFeature,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

test("fileViewerFeature: iOS standalone media opens via inline stream instead of blob download", async () => {
  const prevWindow = globalThis.window;
  const prevNavigator = globalThis.navigator;
  const helper = await loadFeature();
  try {
    const patches = [];
    const enqueued = [];
    const pending = [];
    Object.defineProperty(globalThis, "window", {
      value: {
        matchMedia(query) {
          return { matches: query === "(display-mode: standalone)" };
        },
        setTimeout() {
          return 1;
        },
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: {
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
        standalone: true,
        maxTouchPoints: 5,
      },
      configurable: true,
      writable: true,
    });

    const storeState = {
      conn: "connected",
      authed: true,
      selfId: "111",
      selected: { kind: "dm", id: "222" },
      conversations: {
        "dm:222": [
          {
            kind: "in",
            from: "222",
            ts: 1,
            text: "[file]",
            attachment: {
              kind: "file",
              fileId: "f-1",
              name: "photo.jpg",
              size: 123,
              mime: "image/jpeg",
            },
          },
        ],
      },
      fileTransfers: [],
      fileThumbs: {},
      modal: null,
    };

    const feature = helper.createFileViewerFeature({
      store: {
        get() {
          return storeState;
        },
        set(patch) {
          patches.push(patch);
          if (patch && typeof patch === "object") Object.assign(storeState, patch);
        },
      },
      closeModal() {},
      jumpToChatMsgIdx() {},
      async tryOpenFileViewerFromCache() {
        return false;
      },
      enqueueFileGet(fileId) {
        enqueued.push(String(fileId));
      },
      beginViewerStream(fileId) {
        return `/__yagodka_stream__/files/${fileId}?sid=stream-1&inline=1`;
      },
      setPendingFileViewer(state) {
        pending.push(state);
      },
    });

    const opened = await feature.openFromMessageIndex("dm:222", 0);

    assert.equal(opened, true);
    assert.deepEqual(enqueued, []);
    assert.deepEqual(pending, []);
    assert.equal(storeState.modal?.kind, "file_viewer");
    assert.equal(storeState.modal?.url, "/__yagodka_stream__/files/f-1?sid=stream-1&inline=1");
    assert.ok(
      patches.some((patch) => patch && typeof patch === "object" && String(patch.status || "").includes("Загрузка: photo.jpg"))
    );
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else Object.defineProperty(globalThis, "window", { value: prevWindow, configurable: true, writable: true });
    if (prevNavigator === undefined) delete globalThis.navigator;
    else Object.defineProperty(globalThis, "navigator", { value: prevNavigator, configurable: true, writable: true });
    await helper.cleanup();
  }
});
