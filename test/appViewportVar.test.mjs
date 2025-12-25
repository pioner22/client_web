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

test("viewport var: installAppViewportHeightVar использует innerHeight по умолчанию (без document)", async () => {
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
      screen: { height: 0 },
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

    globalThis.document = { activeElement: null, documentElement: { clientHeight: 700 } };

    const cleanup = helper.fn(root);
    assert.equal(style._props.get("--app-vh"), "700px");
    assert.equal(style._props.get("--vh"), "7px");
    assert.equal(style._props.has("--safe-bottom-pad"), false);
    assert.equal(style._props.has("--safe-bottom-raw"), false);

    cleanup();
    assert.equal(style._props.has("--app-vh"), false);
    assert.equal(style._props.has("--vh"), false);
    assert.equal(rafCb !== null, true);
  } finally {
    await helper.cleanup();
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;
  }
});

test("viewport var: installAppViewportHeightVar предпочитает innerHeight (visual viewport) над clientHeight", async () => {
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

    globalThis.document = { documentElement: { clientHeight: 740 } };
    globalThis.window = {
      innerHeight: 700,
      screen: { height: 0 },
      visualViewport: { height: 690.2, addEventListener() {}, removeEventListener() {} },
      requestAnimationFrame(cb) {
        cb();
        return 1;
      },
      cancelAnimationFrame() {},
      addEventListener() {},
      removeEventListener() {},
    };

    const cleanup = helper.fn(root);
    assert.equal(style._props.get("--app-vh"), "700px");
    assert.equal(style._props.get("--vh"), "7px");
    assert.equal(style._props.has("--safe-bottom-pad"), false);
    assert.equal(style._props.has("--safe-bottom-raw"), false);

    cleanup();
    assert.equal(style._props.has("--app-vh"), false);
    assert.equal(style._props.has("--vh"), false);
    assert.equal(style._props.has("--safe-bottom-pad"), false);
    assert.equal(style._props.has("--safe-bottom-raw"), false);
  } finally {
    await helper.cleanup();
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;
  }
});

test("viewport var: iOS PWA: учитывает разницу screen.height и base через --app-gap-bottom", async () => {
  const helper = await loadInstall();
  const prev = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
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

    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: "iPhone", maxTouchPoints: 0, standalone: true },
      configurable: true,
      writable: true,
    });
    globalThis.document = { documentElement: { clientHeight: 810 } };
    globalThis.window = {
      innerHeight: 810,
      screen: { height: 844 },
      visualViewport: { height: 808.2, addEventListener() {}, removeEventListener() {} },
      requestAnimationFrame(cb) {
        cb();
        return 1;
      },
      cancelAnimationFrame() {},
      addEventListener() {},
      removeEventListener() {},
    };

    const cleanup = helper.fn(root);
    assert.equal(style._props.get("--app-vh"), "844px");
    assert.equal(style._props.get("--vh"), "8.44px");
    assert.equal(style._props.get("--app-gap-bottom"), "34px");
    assert.equal(style._props.has("--safe-bottom-pad"), false);
    assert.equal(style._props.has("--safe-bottom-raw"), false);

    cleanup();
    assert.equal(style._props.has("--app-vh"), false);
    assert.equal(style._props.has("--vh"), false);
    assert.equal(style._props.has("--app-gap-bottom"), false);
  } finally {
    await helper.cleanup();
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;
    if (prev.navigator) Object.defineProperty(globalThis, "navigator", prev.navigator);
    else delete globalThis.navigator;
  }
});

test("viewport var: iOS PWA: fallback на safe-area inset при отсутствии screen gap", async () => {
  const helper = await loadInstall();
  const prev = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
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

    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: "iPhone", maxTouchPoints: 0, standalone: true },
      configurable: true,
      writable: true,
    });
    globalThis.document = { documentElement: { clientHeight: 810 } };
    globalThis.window = {
      innerHeight: 810,
      screen: { height: 0 },
      visualViewport: { height: 808.2, addEventListener() {}, removeEventListener() {} },
      getComputedStyle() {
        return { getPropertyValue: () => "34px" };
      },
      requestAnimationFrame(cb) {
        cb();
        return 1;
      },
      cancelAnimationFrame() {},
      addEventListener() {},
      removeEventListener() {},
    };

    const cleanup = helper.fn(root);
    assert.equal(style._props.get("--app-vh"), "844px");
    assert.equal(style._props.get("--vh"), "8.44px");
    assert.equal(style._props.get("--app-gap-bottom"), "34px");

    cleanup();
    assert.equal(style._props.has("--app-vh"), false);
    assert.equal(style._props.has("--vh"), false);
    assert.equal(style._props.has("--app-gap-bottom"), false);
  } finally {
    await helper.cleanup();
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;
    if (prev.navigator) Object.defineProperty(globalThis, "navigator", prev.navigator);
    else delete globalThis.navigator;
  }
});

test("viewport var: installAppViewportHeightVar игнорирует screen.height на не-iOS", async () => {
  const helper = await loadInstall();
  const prev = {
    window: globalThis.window,
    document: globalThis.document,
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
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

    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: "", maxTouchPoints: 0 },
      configurable: true,
      writable: true,
    });
    globalThis.document = { documentElement: { clientHeight: 700 } };
    globalThis.window = {
      innerHeight: 700,
      screen: { height: 780 },
      visualViewport: { height: 690.2, addEventListener() {}, removeEventListener() {} },
      requestAnimationFrame(cb) {
        cb();
        return 1;
      },
      cancelAnimationFrame() {},
      addEventListener() {},
      removeEventListener() {},
    };

    const cleanup = helper.fn(root);
    assert.equal(style._props.get("--app-vh"), "700px");
    assert.equal(style._props.get("--vh"), "7px");

    cleanup();
    assert.equal(style._props.has("--app-vh"), false);
    assert.equal(style._props.has("--vh"), false);
  } finally {
    await helper.cleanup();
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;
    if (prev.navigator) Object.defineProperty(globalThis, "navigator", prev.navigator);
    else delete globalThis.navigator;
  }
});

test("viewport var: installAppViewportHeightVar переключается на visualViewport при большой разнице (клавиатура)", async () => {
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
      screen: { height: 0 },
      visualViewport: {
        height: 390.2,
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
    const active = { tagName: "TEXTAREA", isContentEditable: false };
    globalThis.document = { activeElement: active, documentElement: { clientHeight: 700 } };

    const cleanup = helper.fn(root);
    assert.equal(style._props.get("--app-vh"), "390px");
    assert.equal(style._props.get("--vh"), "3.9px");
    assert.equal(style._props.get("--safe-bottom-pad"), "0px");
    assert.equal(style._props.get("--safe-bottom-raw"), "0px");
    assert.equal(style._props.get("--app-vv-bottom"), "310px");

    cleanup();
    assert.equal(style._props.has("--app-vh"), false);
    assert.equal(style._props.has("--vh"), false);
    assert.equal(style._props.has("--safe-bottom-pad"), false);
    assert.equal(style._props.has("--safe-bottom-raw"), false);
    assert.equal(style._props.has("--app-vv-bottom"), false);
    assert.equal(rafCb !== null, true);
  } finally {
    await helper.cleanup();
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;
  }
});

test("viewport var: при фокусе на input/textarea переключается на visualViewport при меньшей разнице", async () => {
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

    const active = { tagName: "TEXTAREA", isContentEditable: false };
    globalThis.document = { activeElement: active, documentElement: { clientHeight: 700 } };
    globalThis.window = {
      innerHeight: 700,
      screen: { height: 0 },
      visualViewport: { height: 642.2, addEventListener() {}, removeEventListener() {} },
      requestAnimationFrame(cb) {
        cb();
        return 1;
      },
      cancelAnimationFrame() {},
      addEventListener() {},
      removeEventListener() {},
    };

    const cleanup = helper.fn(root);
    assert.equal(style._props.get("--app-vh"), "642px");
    assert.equal(style._props.get("--vh"), "6.42px");
    assert.equal(style._props.get("--safe-bottom-pad"), "0px");
    assert.equal(style._props.get("--safe-bottom-raw"), "0px");
    assert.equal(style._props.get("--app-vv-bottom"), "58px");
    cleanup();
  } finally {
    await helper.cleanup();
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;
  }
});

test("viewport var: учитывает visualViewport.offsetTop, чтобы не было чёрной полосы/прыжка композера", async () => {
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

    const vvListeners = new Map();
    globalThis.window = {
      innerHeight: 844,
      screen: { height: 0 },
      visualViewport: {
        height: 520.2,
        offsetTop: 120.1,
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
        cb();
        return 1;
      },
      cancelAnimationFrame() {},
      addEventListener() {},
      removeEventListener() {},
    };

    const active = { tagName: "TEXTAREA", isContentEditable: false };
    globalThis.document = { activeElement: active, documentElement: { clientHeight: 844 } };

    const cleanup = helper.fn(root);
    assert.equal(style._props.get("--app-vh"), "520px");
    assert.equal(style._props.get("--vh"), "5.2px");
    assert.equal(style._props.get("--safe-bottom-pad"), "0px");
    assert.equal(style._props.get("--safe-bottom-raw"), "0px");
    assert.equal(style._props.get("--app-vv-top"), "120px");
    assert.equal(style._props.get("--app-vv-bottom"), "204px");

    cleanup();
    assert.equal(style._props.has("--app-vh"), false);
    assert.equal(style._props.has("--vh"), false);
    assert.equal(style._props.has("--safe-bottom-pad"), false);
    assert.equal(style._props.has("--safe-bottom-raw"), false);
    assert.equal(style._props.has("--app-vv-top"), false);
    assert.equal(style._props.has("--app-vv-bottom"), false);
  } finally {
    await helper.cleanup();
    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;
  }
});
