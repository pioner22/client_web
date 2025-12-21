import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadHelpers() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/files/fileTransferHistory.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    const required = ["sanitizeFileTransfers", "parseFileTransfersPayload", "serializeFileTransfersPayload"];
    for (const k of required) {
      if (typeof mod[k] !== "function") throw new Error(`fileTransferHistory export missing: ${k}`);
    }
    return {
      sanitizeFileTransfers: mod.sanitizeFileTransfers,
      parseFileTransfersPayload: mod.parseFileTransfersPayload,
      serializeFileTransfersPayload: mod.serializeFileTransfersPayload,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("fileTransferHistory: serialize/parse сохраняет только terminal (complete/uploaded/error/rejected) и выкидывает url", async () => {
  const { parseFileTransfersPayload, serializeFileTransfersPayload, cleanup } = await loadHelpers();
  try {
    const input = [
      {
        localId: "t1",
        id: "f1",
        name: "a.png",
        size: 123,
        direction: "in",
        peer: "111-222-333",
        room: null,
        status: "complete",
        progress: 100,
        url: "blob:deadbeef",
      },
      {
        localId: "t2",
        id: "f2",
        name: "b.txt",
        size: 10,
        direction: "out",
        peer: "room-1",
        room: "room-1",
        status: "uploaded",
        progress: 100,
        url: "blob:beefdead",
      },
      // Non-terminal должен исчезнуть.
      { localId: "t3", id: "f3", name: "c.bin", size: 1, direction: "in", peer: "x", status: "uploading", progress: 5 },
      // Дубликат id должен схлопнуться (берём первый).
      { localId: "t4", id: "f1", name: "dup", size: 1, direction: "in", peer: "x", status: "complete", progress: 100 },
    ];

    const payload = serializeFileTransfersPayload(input);
    const out = parseFileTransfersPayload(payload);
    assert.equal(out.length, 2);
    assert.equal(out[0].id, "f1");
    assert.equal(out[1].id, "f2");
    assert.ok(!("url" in out[0]));
    assert.ok(!("url" in out[1]));
  } finally {
    await cleanup();
  }
});

test("fileTransferHistory: parseFileTransfersPayload устойчив к мусору", async () => {
  const { parseFileTransfersPayload, cleanup } = await loadHelpers();
  try {
    assert.deepEqual(parseFileTransfersPayload(null), []);
    assert.deepEqual(parseFileTransfersPayload("not-json"), []);
    assert.deepEqual(parseFileTransfersPayload(JSON.stringify({ v: 2, transfers: [] })), []);
  } finally {
    await cleanup();
  }
});

