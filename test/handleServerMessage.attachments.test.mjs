import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadHandleServerMessage() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/app/handleServerMessage.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.handleServerMessage !== "function") {
      throw new Error("handleServerMessage не экспортирован из бандла");
    }
    return { handleServerMessage: mod.handleServerMessage, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

function createPatchHarness(initial) {
  let state = initial;
  const patch = (p) => {
    if (typeof p === "function") {
      state = p(state);
    } else {
      state = { ...state, ...p };
    }
  };
  return { getState: () => state, patch };
}

test("handleServerMessage: message парсит file attachment", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const selfId = "111-111-111";
    const peer = "222-222-222";
    const key = `dm:${peer}`;
    const { getState, patch } = createPatchHarness({
      selfId,
      conversations: {},
    });

    handleServerMessage(
      {
        type: "message",
        from: peer,
        to: selfId,
        text: "[file] a.png (123 bytes)",
        ts: 1,
        id: 10,
        attachment: { kind: "file", file_id: "f-1", name: "a.png", size: 123 },
      },
      getState(),
      { send() {} },
      patch
    );

    const st = getState();
    assert.equal(st.conversations[key].length, 1);
    assert.deepEqual(st.conversations[key][0].attachment, { kind: "file", fileId: "f-1", name: "a.png", size: 123, mime: null });
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: history_result прокидывает room из верхнего уровня и парсит attachment", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const selfId = "111-111-111";
    const room = "grp-001";
    const key = `room:${room}`;
    const { getState, patch } = createPatchHarness({
      selfId,
      conversations: {},
      historyLoaded: {},
    });

    handleServerMessage(
      {
        type: "history_result",
        room,
        since_id: 0,
        rows: [{ id: 5, from: "222-222-222", text: "[file] doc.pdf (2 bytes)", ts: 1, attachment: { kind: "file", file_id: "f-2", name: "doc.pdf", size: 2 } }],
      },
      getState(),
      { send() {} },
      patch
    );

    const st = getState();
    assert.equal(st.historyLoaded[key], true);
    assert.equal(st.conversations[key].length, 1);
    assert.equal(st.conversations[key][0].room, room);
    assert.deepEqual(st.conversations[key][0].attachment, { kind: "file", fileId: "f-2", name: "doc.pdf", size: 2, mime: null });
  } finally {
    await cleanup();
  }
});

