import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadHistorySync() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/chat/historySync.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.newestServerMessageId !== "function") {
      throw new Error("newestServerMessageId export missing");
    }
    return {
      newestServerMessageId: mod.newestServerMessageId,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("historySync: newestServerMessageId игнорирует локальные/пустые id и берёт максимум", async () => {
  const { newestServerMessageId, cleanup } = await loadHistorySync();
  try {
    assert.equal(newestServerMessageId([]), null);
    assert.equal(
      newestServerMessageId([
        { kind: "out", from: "me", text: "x", ts: 1, id: -1 },
        { kind: "in", from: "a", text: "y", ts: 2, id: null },
        { kind: "in", from: "a", text: "z", ts: 3, id: 10 },
        { kind: "in", from: "a", text: "q", ts: 4, id: 7 },
      ]),
      10
    );
  } finally {
    await cleanup();
  }
});

