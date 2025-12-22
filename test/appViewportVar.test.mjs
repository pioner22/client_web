import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadInstall() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/helpers/ui/appViewport.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.installAppViewportHeightVar !== "function") throw new Error("export missing");
    return { fn: mod.installAppViewportHeightVar, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

test("css viewport: #app поддерживает JS override через --app-vh", async () => {
  const css = await readFile(path.resolve("src/scss/base.css"), "utf8");
  assert.match(css, /height:\s*var\(--app-vh\)\s*;/);
  assert.match(css, /min-height:\s*var\(--app-vh\)\s*;/);
});

test("viewport var: installAppViewportHeightVar пишет --app-vh по visualViewport.height", async () => {
  const helper = await loadInstall();
  const prev = {
    window: globalThis.window,
    document: globalThis.document,
  };
  try {
    const style = {
      _props: new Map(),
      setProperty(k, v) {
        this._props.set(String(k), String(v));
      },
      removeProperty(k) {
        this._props.delete(String(k));
      },
    };
    const root = { style };
    let rafCb = null;

    const vvListeners = new Map();
    const windowListeners = new Map();

    globalThis.window = {
      innerHeight: 700,
      visualViewport: {
        height: 642.2,
        addEventListener(type, cb) {
          const list = vvListeners.get(type) || [];
          list.push(cb);
          vvListeners.set(type, list);
        },
        removeEventListener(type, cb) {
          const list = vvListeners.get(type) || [];
          vvListeners.set(
            type,
            list.filter((x) => x !== cb)
          );
        },
      },
      requestAnimationFrame(cb) {
        rafCb = cb;
        cb();
        return 1;
      },
      cancelAnimationFrame() {},
      addEventListener(type, cb) {
        const list = windowListeners.get(type) || [];
        list.push(cb);
        windowListeners.set(type, list);
      },
      removeEventListener(type, cb) {
        const list = windowListeners.get(type) || [];
        windowListeners.set(
          type,
          list.filter((x) => x !== cb)
        );
      },
    };

    // Ensure it doesn't crash without document.
    globalThis.document = undefined;

    const cleanup = helper.fn(root);
    assert.equal(style._props.get("--app-vh"), "642px");

    cleanup();
    assert.equal(style._props.has("--app-vh"), false);
    assert.equal(rafCb !== null, true);
  } finally {
    await helper.cleanup();
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;
  }
});

