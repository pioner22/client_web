import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadRenderContextMenu() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/components/modals/renderContextMenu.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.renderContextMenu !== "function") {
      throw new Error("renderContextMenu export missing");
    }
    return { renderContextMenu: mod.renderContextMenu, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

function withStubs(opts, run) {
  const prev = {
    document: globalThis.document,
    window: globalThis.window,
    HTMLElement: globalThis.HTMLElement,
    HTMLInputElement: globalThis.HTMLInputElement,
    HTMLTextAreaElement: globalThis.HTMLTextAreaElement,
    queueMicrotask: globalThis.queueMicrotask,
  };

  class StyleStub {
    constructor() {
      this.left = "";
      this.top = "";
      this._props = new Map();
    }
    setProperty(name, value) {
      this._props.set(String(name), String(value));
    }
  }

  class ClassListStub {
    constructor(owner) {
      this._owner = owner;
    }
    _syncFrom(value) {
      const parts = String(value || "")
        .split(/\s+/)
        .map((x) => x.trim())
        .filter(Boolean);
      this._owner._classSet = new Set(parts);
    }
    _syncTo() {
      this._owner._className = [...this._owner._classSet].join(" ");
    }
    add(...names) {
      for (const n of names) {
        for (const part of String(n || "")
          .split(/\s+/)
          .map((x) => x.trim())
          .filter(Boolean)) {
          this._owner._classSet.add(part);
        }
      }
      this._syncTo();
    }
    remove(...names) {
      for (const n of names) {
        for (const part of String(n || "")
          .split(/\s+/)
          .map((x) => x.trim())
          .filter(Boolean)) {
          this._owner._classSet.delete(part);
        }
      }
      this._syncTo();
    }
    toggle(name, force) {
      const n = String(name || "").trim();
      if (!n) return false;
      const shouldAdd = force === undefined ? !this._owner._classSet.has(n) : Boolean(force);
      if (shouldAdd) this._owner._classSet.add(n);
      else this._owner._classSet.delete(n);
      this._syncTo();
      return shouldAdd;
    }
    contains(name) {
      return this._owner._classSet.has(String(name || "").trim());
    }
  }

  class HTMLElementStub {
    constructor(tagName = "div") {
      this.tagName = String(tagName).toUpperCase();
      this._attrs = new Map();
      this._children = [];
      this._className = "";
      this._classSet = new Set();
      this.classList = new ClassListStub(this);
      this.style = new StyleStub();
    }
    get className() {
      return this._className;
    }
    set className(value) {
      const v = String(value || "");
      this._className = v;
      this.classList._syncFrom(v);
      this.classList._syncTo();
    }
    setAttribute(name, value) {
      this._attrs.set(String(name), String(value));
    }
    hasAttribute(name) {
      return this._attrs.has(String(name));
    }
    append(...nodes) {
      for (const n of nodes) this._children.push(n);
    }
    addEventListener() {}
    focus() {}
  }

  class HTMLInputElementStub extends HTMLElementStub {
    constructor() {
      super("input");
      this.type = "text";
    }
    setAttribute(name, value) {
      super.setAttribute(name, value);
      if (String(name).toLowerCase() === "type") this.type = String(value);
    }
  }

  class HTMLTextAreaElementStub extends HTMLElementStub {
    constructor() {
      super("textarea");
    }
  }

  globalThis.HTMLElement = HTMLElementStub;
  globalThis.HTMLInputElement = HTMLInputElementStub;
  globalThis.HTMLTextAreaElement = HTMLTextAreaElementStub;
  globalThis.document = {
    createElement(tag) {
      const t = String(tag).toLowerCase();
      if (t === "input") return new HTMLInputElementStub();
      if (t === "textarea") return new HTMLTextAreaElementStub();
      return new HTMLElementStub(t);
    },
    createTextNode(text) {
      return { nodeType: 3, textContent: String(text) };
    },
  };

  const coarse = Boolean(opts?.coarse);
  globalThis.window = {
    innerWidth: 390,
    innerHeight: 844,
    matchMedia(query) {
      const q = String(query || "");
      const matches = coarse && (q.includes("pointer: coarse") || q.includes("hover: none"));
      return { matches };
    },
  };

  // Нам не важно поведение focus/clamp внутри microtask, только режим рендера.
  globalThis.queueMicrotask = () => {};

  try {
    return run();
  } finally {
    if (prev.queueMicrotask === undefined) delete globalThis.queueMicrotask;
    else globalThis.queueMicrotask = prev.queueMicrotask;

    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;

    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;

    if (prev.HTMLElement === undefined) delete globalThis.HTMLElement;
    else globalThis.HTMLElement = prev.HTMLElement;

    if (prev.HTMLInputElement === undefined) delete globalThis.HTMLInputElement;
    else globalThis.HTMLInputElement = prev.HTMLInputElement;

    if (prev.HTMLTextAreaElement === undefined) delete globalThis.HTMLTextAreaElement;
    else globalThis.HTMLTextAreaElement = prev.HTMLTextAreaElement;
  }
}

test("renderContextMenu: на coarse pointer рендерится как bottom-sheet", async () => {
  const helper = await loadRenderContextMenu();
  try {
    withStubs({ coarse: true }, () => {
      const node = helper.renderContextMenu(
        { x: 10, y: 20, title: "Меню", target: { kind: "peer", id: "123-456-789" }, items: [{ id: "x", label: "Действие" }] },
        { onSelect() {}, onClose() {} }
      );
      assert.ok(node.className.includes("ctx-menu-sheet"));
      assert.equal(node.style.left, "");
      assert.equal(node.style.top, "");
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderContextMenu: на fine pointer позиционируется по x/y", async () => {
  const helper = await loadRenderContextMenu();
  try {
    withStubs({ coarse: false }, () => {
      const node = helper.renderContextMenu(
        { x: 123, y: 456, title: "Меню", target: { kind: "peer", id: "123-456-789" }, items: [{ id: "x", label: "Действие" }] },
        { onSelect() {}, onClose() {} }
      );
      assert.ok(!node.className.includes("ctx-menu-sheet"));
      assert.equal(node.style.left, "123px");
      assert.equal(node.style.top, "456px");
    });
  } finally {
    await helper.cleanup();
  }
});

