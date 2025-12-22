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

test("handleServerMessage: group_invite парсится из payload.group", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const { getState, patch } = createPatchHarness({
      pendingGroupInvites: [],
      pendingBoardInvites: [],
      pendingGroupJoinRequests: [],
      conversations: {},
      modal: null,
      status: "",
    });

    handleServerMessage(
      {
        type: "group_invite",
        group: { id: "grp-0001", name: "Чат", owner_id: "111-111-111", handle: "@chat" },
        from: "111-111-111",
      },
      getState(),
      { send() {} },
      patch
    );

    const st = getState();
    assert.equal(st.pendingGroupInvites.length, 1);
    assert.equal(st.pendingGroupInvites[0].groupId, "grp-0001");
    assert.equal(st.pendingGroupInvites[0].from, "111-111-111");
    assert.equal(st.pendingGroupInvites[0].name, "Чат");
    assert.equal(st.pendingGroupInvites[0].handle, "@chat");
    assert.equal(st.modal, null);
    const conv = st.conversations?.["dm:111-111-111"] || [];
    const msg = Array.isArray(conv) ? conv.find((m) => m && m.localId === "action:group_invite:grp-0001:111-111-111") : null;
    assert.ok(msg, "должно быть системное сообщение с action:group_invite");
    assert.equal(msg.kind, "sys");
    assert.equal(msg.attachment?.kind, "action");
    assert.equal(msg.attachment?.payload?.kind, "group_invite");
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: board_invite парсится из payload.board", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const { getState, patch } = createPatchHarness({
      pendingGroupInvites: [],
      pendingBoardInvites: [],
      pendingGroupJoinRequests: [],
      conversations: {},
      modal: null,
      status: "",
    });

    handleServerMessage(
      {
        type: "board_invite",
        board: { id: "b-abcdef12", name: "Новости", owner_id: "111-111-111", handle: "@news" },
        from: "111-111-111",
      },
      getState(),
      { send() {} },
      patch
    );

    const st = getState();
    assert.equal(st.pendingBoardInvites.length, 1);
    assert.equal(st.pendingBoardInvites[0].boardId, "b-abcdef12");
    assert.equal(st.pendingBoardInvites[0].from, "111-111-111");
    assert.equal(st.pendingBoardInvites[0].name, "Новости");
    assert.equal(st.pendingBoardInvites[0].handle, "@news");
    assert.equal(st.modal, null);
    const conv = st.conversations?.["dm:111-111-111"] || [];
    const msg = Array.isArray(conv) ? conv.find((m) => m && m.localId === "action:board_invite:b-abcdef12:111-111-111") : null;
    assert.ok(msg, "должно быть системное сообщение с action:board_invite");
    assert.equal(msg.kind, "sys");
    assert.equal(msg.attachment?.kind, "action");
    assert.equal(msg.attachment?.payload?.kind, "board_invite");
  } finally {
    await cleanup();
  }
});

test("handleServerMessage: update_required не открывает модалку сам", async () => {
  const { handleServerMessage, cleanup } = await loadHandleServerMessage();
  try {
    const { getState, patch } = createPatchHarness({
      updateLatest: null,
      updateDismissedLatest: null,
      modal: null,
      status: "",
    });

    handleServerMessage({ type: "update_required", latest: "0.9.9" }, getState(), { send() {} }, patch);

    const st = getState();
    assert.equal(st.updateLatest, "0.9.9");
    assert.equal(st.modal, null);
    assert.ok(String(st.status || "").includes("Ctrl+U"));
  } finally {
    await cleanup();
  }
});
