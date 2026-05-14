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
      entryPoints: [path.resolve("src/app/features/files/previewAutoFetchFeature.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    for (const key of ["resolveVisiblePreviewFetchPlan", "isTerminalPreviewTransferError"]) {
      if (typeof mod[key] !== "function") throw new Error(`${key} export missing`);
    }
    return {
      resolveVisiblePreviewFetchPlan: mod.resolveVisiblePreviewFetchPlan,
      hasTrustedRuntimeUrl: mod.hasTrustedRuntimeUrl,
      isTerminalPreviewTransferError: mod.isTerminalPreviewTransferError,
      cleanup: () => rm(tempDir, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

test("previewAutoFetchFeature: visible media uses high-priority hydration even when background prefetch is blocked", async () => {
  const helper = await loadFeature();
  try {
    assert.deepEqual(
      helper.resolveVisiblePreviewFetchPlan({
        fileKind: "image",
        devicePrefetchAllowed: false,
        shouldBackgroundPrefetch: false,
      }),
      { prefetch: false, priority: "high" }
    );
    assert.deepEqual(
      helper.resolveVisiblePreviewFetchPlan({
        fileKind: "video",
        devicePrefetchAllowed: true,
        shouldBackgroundPrefetch: true,
      }),
      { prefetch: true, priority: "high" }
    );
    assert.deepEqual(
      helper.resolveVisiblePreviewFetchPlan({
        fileKind: "audio",
        devicePrefetchAllowed: true,
        shouldBackgroundPrefetch: true,
      }),
      { prefetch: false, priority: "high" }
    );
    assert.equal(helper.hasTrustedRuntimeUrl("https://yagodka.org/files/fid", false), true);
    assert.equal(helper.hasTrustedRuntimeUrl("blob:test", false), true);
    assert.equal(helper.hasTrustedRuntimeUrl("https://yagodka.org/files/fid", true), false);
    assert.equal(helper.hasTrustedRuntimeUrl("blob:test", true), true);
    assert.equal(helper.isTerminalPreviewTransferError({ status: "error" }), true);
    assert.equal(helper.isTerminalPreviewTransferError({ status: "downloading" }), false);
    assert.equal(helper.isTerminalPreviewTransferError(null), false);
  } finally {
    await helper.cleanup();
  }
});
