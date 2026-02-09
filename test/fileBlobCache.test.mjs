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
      entryPoints: [path.resolve("src/helpers/files/fileBlobCache.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    const required = ["putCachedFileBlob", "getCachedFileBlob", "isImageLikeFile"];
    for (const k of required) {
      if (typeof mod[k] !== "function") throw new Error(`fileBlobCache export missing: ${k}`);
    }
    return {
      putCachedFileBlob: mod.putCachedFileBlob,
      getCachedFileBlob: mod.getCachedFileBlob,
      isImageLikeFile: mod.isImageLikeFile,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

function installCachesMock() {
  const stores = new Map();
  const api = {
    async open(name) {
      if (!stores.has(name)) {
        const map = new Map();
        stores.set(name, {
          async match(key) {
            return map.get(key) ?? undefined;
          },
          async put(key, value) {
            map.set(key, value);
          },
          async delete(key) {
            return map.delete(key);
          },
        });
      }
      return stores.get(name);
    },
  };
  globalThis.caches = api;
  return () => {
    delete globalThis.caches;
  };
}

test("fileBlobCache: put/get сохраняет blob в CacheStorage (best-effort)", async () => {
  const { putCachedFileBlob, getCachedFileBlob, cleanup } = await loadHelpers();
  const uninstall = installCachesMock();
  try {
    const blob = new Blob(["hello"], { type: "text/plain" });
    await putCachedFileBlob("u1", "f1", blob, { mime: "text/plain", size: 5 });
    const out = await getCachedFileBlob("u1", "f1");
    assert.ok(out);
    assert.equal(out.mime, "text/plain");
    assert.equal(out.size, 5);
    assert.equal(await out.blob.text(), "hello");
  } finally {
    uninstall();
    await cleanup();
  }
});

test("fileBlobCache: isImageLikeFile распознаёт extension/mime", async () => {
  const { isImageLikeFile, cleanup } = await loadHelpers();
  try {
    assert.equal(isImageLikeFile("a.png", null), true);
    assert.equal(isImageLikeFile("a.bin", "image/jpeg"), true);
    assert.equal(isImageLikeFile("a.bin", null), false);
    assert.equal(isImageLikeFile("IMG_3383.MP4", "video/mp4"), false, "IMG_*.MP4 — это видео, даже если имя похоже на фото");
    assert.equal(isImageLikeFile("IMG_3383.MP4", null), false, "IMG_*.MP4 по extension — видео (без mime)");
  } finally {
    await cleanup();
  }
});
