import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadModule(entry) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve(entry)],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    return { mod, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("avatarMonogram: понятные подписи для разных типов", async () => {
  const { mod, cleanup } = await loadModule("src/helpers/avatar/avatarStore.ts");
  try {
    const { avatarMonogram } = mod;
    assert.equal(avatarMonogram("group", "grp-123"), "G");
    assert.equal(avatarMonogram("board", "b-123"), "B");
    assert.equal(avatarMonogram("dm", "111-222-333"), "33");
    assert.equal(avatarMonogram("dm", "u-deadbeef"), "U-");
  } finally {
    await cleanup();
  }
});

test("avatarHue: стабильный диапазон 0..359", async () => {
  const { mod, cleanup } = await loadModule("src/helpers/avatar/avatarStore.ts");
  try {
    const { avatarHue } = mod;
    const h1 = avatarHue("dm:111-222-333");
    const h2 = avatarHue("dm:111-222-333");
    const h3 = avatarHue("dm:999-000-111");
    assert.ok(Number.isInteger(h1));
    assert.ok(h1 >= 0 && h1 < 360);
    assert.equal(h1, h2);
    assert.notEqual(h1, h3);
  } finally {
    await cleanup();
  }
});

