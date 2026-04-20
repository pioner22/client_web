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
      entryPoints: [path.resolve("src/helpers/files/fileHttpAuth.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    return {
      liftFileHttpTokenToBearer: mod.liftFileHttpTokenToBearer,
      rememberFileHttpBearer: mod.rememberFileHttpBearer,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (err) {
    await rm(tempDir, { recursive: true, force: true });
    throw err;
  }
}

test("fileHttpAuth: вычищает legacy t= из query и не поднимает его в Authorization header", async () => {
  const { liftFileHttpTokenToBearer, cleanup } = await loadHelper();
  try {
    const out = liftFileHttpTokenToBearer("/files/f123?t=abc123&x=1", { base: "https://yagodka.org/app" });
    assert.equal(out.url, "https://yagodka.org/files/f123?x=1");
    assert.deepEqual(out.headers, {});
  } finally {
    await cleanup();
  }
});

test("fileHttpAuth: оставляет URL без изменений если signed token отсутствует", async () => {
  const { liftFileHttpTokenToBearer, cleanup } = await loadHelper();
  try {
    const out = liftFileHttpTokenToBearer("https://yagodka.org/files/f123?x=1");
    assert.equal(out.url, "https://yagodka.org/files/f123?x=1");
    assert.deepEqual(out.headers, {});
  } finally {
    await cleanup();
  }
});

test("fileHttpAuth: подхватывает bearer из runtime-хранилища для чистого URL", async () => {
  const { liftFileHttpTokenToBearer, rememberFileHttpBearer, cleanup } = await loadHelper();
  try {
    const normalized = rememberFileHttpBearer("/files/f777", "mem-secret", { base: "https://yagodka.org/app" });
    assert.equal(normalized, "https://yagodka.org/files/f777");
    const out = liftFileHttpTokenToBearer("/files/f777", { base: "https://yagodka.org/app" });
    assert.equal(out.url, "https://yagodka.org/files/f777");
    assert.deepEqual(out.headers, { Authorization: "Bearer mem-secret" });
  } finally {
    await cleanup();
  }
});
