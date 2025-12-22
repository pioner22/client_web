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

function mkStorage() {
  const map = new Map();
  return {
    getItem(k) {
      const v = map.get(String(k));
      return v === undefined ? null : String(v);
    },
    setItem(k, v) {
      map.set(String(k), String(v));
    },
    removeItem(k) {
      map.delete(String(k));
    },
  };
}

function createPatchHarness(initial) {
  let state = initial;
  const patch = (p) => {
    if (typeof p === "function") state = p(state);
    else state = { ...state, ...p };
  };
  return { getState: () => state, patch };
}

test("handleServerMessage: avatar сохраняет кэш и обновляет profiles", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  const prevLs = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    const localStorage = mkStorage();
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true });

    const { getState, patch } = createPatchHarness({ profiles: {}, avatarsRev: 0 });
    const gateway = { send() {} };

    handleServerMessage({ type: "avatar", id: "222-222-222", rev: 3, mime: "image/png", data: "AA==" }, getState(), gateway, patch);

    const st = getState();
    assert.equal(st.avatarsRev, 1);
    assert.equal(st.profiles["222-222-222"].avatar_rev, 3);
    assert.equal(st.profiles["222-222-222"].avatar_mime, "image/png");
    assert.equal(localStorage.getItem("yagodka_avatar:dm:222-222-222"), "data:image/png;base64,AA==");
    assert.equal(localStorage.getItem("yagodka_avatar_rev:dm:222-222-222"), "3");
  } finally {
    if (prevLs) Object.defineProperty(globalThis, "localStorage", prevLs);
    else delete globalThis.localStorage;
    await cleanup();
  }
});

