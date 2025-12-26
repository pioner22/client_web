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

test("handleServerMessage: roster очищает аватар при avatar_mime=null (rev может быть >0)", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  const prevLs = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    const localStorage = mkStorage();
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true });
    localStorage.setItem("yagodka_avatar:dm:222-222-222", "data:image/png;base64,AA==");
    localStorage.setItem("yagodka_avatar_rev:dm:222-222-222", "4");

    const sent = [];
    const gateway = { send: (m) => sent.push(m) };
    const { getState, patch } = createPatchHarness({
      selfId: "111-111-111",
      friends: [],
      pendingIn: [],
      pendingOut: [],
      profiles: {},
      avatarsRev: 0,
    });

    handleServerMessage(
      {
        type: "roster",
        friends: [{ id: "222-222-222", avatar_rev: 5, avatar_mime: null }],
        online: [],
        pending_in: [],
        pending_out: [],
      },
      getState(),
      gateway,
      patch
    );

    const st = getState();
    assert.equal(st.avatarsRev, 1);
    assert.equal(localStorage.getItem("yagodka_avatar:dm:222-222-222"), null);
    assert.equal(localStorage.getItem("yagodka_avatar_rev:dm:222-222-222"), "5");
    assert.deepEqual(sent, []);
  } finally {
    if (prevLs) Object.defineProperty(globalThis, "localStorage", prevLs);
    else delete globalThis.localStorage;
    await cleanup();
  }
});

test("handleServerMessage: profile_updated очищает аватар при avatar_mime=null без avatar_get", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  const prevLs = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    const localStorage = mkStorage();
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true });
    localStorage.setItem("yagodka_avatar:dm:222-222-222", "data:image/png;base64,AA==");
    localStorage.setItem("yagodka_avatar_rev:dm:222-222-222", "10");

    const sent = [];
    const gateway = { send: (m) => sent.push(m) };
    const { getState, patch } = createPatchHarness({
      selfId: "111-111-111",
      friends: [{ id: "222-222-222", online: false, unread: 0, last_seen_at: null }],
      profiles: { "222-222-222": { id: "222-222-222", avatar_rev: 10, avatar_mime: "image/png" } },
      avatarsRev: 0,
    });

    handleServerMessage(
      { type: "profile_updated", id: "222-222-222", avatar_rev: 11, avatar_mime: null },
      getState(),
      gateway,
      patch
    );

    const st = getState();
    assert.equal(st.avatarsRev, 1);
    assert.equal(localStorage.getItem("yagodka_avatar:dm:222-222-222"), null);
    assert.equal(localStorage.getItem("yagodka_avatar_rev:dm:222-222-222"), "11");
    assert.deepEqual(sent, []);
  } finally {
    if (prevLs) Object.defineProperty(globalThis, "localStorage", prevLs);
    else delete globalThis.localStorage;
    await cleanup();
  }
});

test("handleServerMessage: roster запрашивает avatar_get если avatar_mime есть, а кэша нет", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  const prevLs = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  try {
    const localStorage = mkStorage();
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true });

    const sent = [];
    const gateway = { send: (m) => sent.push(m) };
    const { getState, patch } = createPatchHarness({
      selfId: "111-111-111",
      friends: [],
      pendingIn: [],
      pendingOut: [],
      profiles: {},
      avatarsRev: 0,
    });

    handleServerMessage(
      {
        type: "roster",
        friends: [{ id: "333-333-333", avatar_rev: 7, avatar_mime: "image/png" }],
        online: [],
        pending_in: [],
        pending_out: [],
      },
      getState(),
      gateway,
      patch
    );

    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0], { type: "avatar_get", id: "333-333-333" });
  } finally {
    if (prevLs) Object.defineProperty(globalThis, "localStorage", prevLs);
    else delete globalThis.localStorage;
    await cleanup();
  }
});
