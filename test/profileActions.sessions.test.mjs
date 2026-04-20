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
      entryPoints: [path.resolve("src/app/features/profile/profileActionsFeature.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.createProfileActionsFeature !== "function") {
      throw new Error("createProfileActionsFeature export missing");
    }
    return { createProfileActionsFeature: mod.createProfileActionsFeature, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("profileActionsFeature: refresh профиля запрашивает только profile snapshot", async () => {
  const { createProfileActionsFeature, cleanup } = await loadFeature();
  try {
    const sent = [];
    const feature = createProfileActionsFeature({
      store: {
        get() {
          return { conn: "connected", authed: true };
        },
        set() {},
      },
      send: (payload) => sent.push(payload),
      markUserInput() {},
      buildSearchServerShareText() {
        return "";
      },
      tryAppendShareTextToSelected() {
        return false;
      },
      copyText() {},
      getAvatarFeature() {
        return null;
      },
    });

    feature.onProfileRefresh();

    assert.deepEqual(sent, [{ type: "profile_get" }]);
  } finally {
    await cleanup();
  }
});

test("profileActionsFeature: logout other devices отправляет команду и выставляет status", async () => {
  const { createProfileActionsFeature, cleanup } = await loadFeature();
  try {
    const sent = [];
    const patches = [];
    const feature = createProfileActionsFeature({
      store: {
        get() {
          return { conn: "connected", authed: true };
        },
        set(patch) {
          patches.push(patch);
        },
      },
      send: (payload) => sent.push(payload),
      markUserInput() {},
      buildSearchServerShareText() {
        return "";
      },
      tryAppendShareTextToSelected() {
        return false;
      },
      copyText() {},
      getAvatarFeature() {
        return null;
      },
    });

    feature.onSessionsLogoutOthers();

    assert.deepEqual(sent, [{ type: "sessions_logout_others" }]);
    assert.equal(patches.length, 1);
    assert.match(String(patches[0].status || ""), /другие устройства/i);
    assert.match(String(patches[0].sessionDevicesStatus || ""), /другие устройства/i);
  } finally {
    await cleanup();
  }
});
