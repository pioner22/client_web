import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadHelper() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-android-app-version-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/runtime/androidAppVersion.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
      define: {
        __APP_VERSION__: '"0.1.794"',
        __ANDROID_APP_VERSION_NAME__: '"1.0.12"',
        __ANDROID_APP_VERSION_CODE__: "13",
      },
    });
    const mod = await import(pathToFileURL(outfile).href);
    return {
      getCurrentAndroidAppVersionInfo: mod.getCurrentAndroidAppVersionInfo,
      parseAndroidAppVersionCode: mod.parseAndroidAppVersionCode,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (err) {
    await rm(tempDir, { recursive: true, force: true });
    throw err;
  }
}

test("androidAppVersion: returns compiled APK version metadata for native update checks", async () => {
  const helper = await loadHelper();
  try {
    assert.deepEqual(helper.getCurrentAndroidAppVersionInfo(), {
      versionName: "1.0.12",
      versionCode: 13,
    });
    assert.equal(helper.parseAndroidAppVersionCode("8"), 8);
    assert.equal(helper.parseAndroidAppVersionCode(0), null);
    assert.equal(helper.parseAndroidAppVersionCode("bad"), null);
  } finally {
    await helper.cleanup();
  }
});
