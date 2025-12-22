import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadRenderAuthModal() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/components/modals/renderAuthModal.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.renderAuthModal !== "function") throw new Error("renderAuthModal export missing");
    return { renderAuthModal: mod.renderAuthModal, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

function withDomStubs(run) {
  const prev = {
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
    HTMLInputElement: globalThis.HTMLInputElement,
    HTMLTextAreaElement: globalThis.HTMLTextAreaElement,
  };

  class StyleStub {
    constructor() {
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
      this._listeners = new Map();
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
      const k = String(name);
      const v = String(value);
      this._attrs.set(k, v);
    }
    hasAttribute(name) {
      return this._attrs.has(String(name));
    }
    getAttribute(name) {
      const v = this._attrs.get(String(name));
      return v === undefined ? null : v;
    }
    append(...nodes) {
      for (const n of nodes) this._children.push(n);
    }
    replaceChildren(...nodes) {
      this._children = [...nodes];
    }
    addEventListener(type, handler) {
      const key = String(type);
      const list = this._listeners.get(key) || [];
      list.push(handler);
      this._listeners.set(key, list);
    }
    dispatchEvent(event) {
      const ev = event || {};
      const key = String(ev.type || "");
      const list = this._listeners.get(key) || [];
      for (const h of list) h(ev);
      return true;
    }
    focus() {}
    select() {}
  }

  class HTMLInputElementStub extends HTMLElementStub {
    constructor() {
      super("input");
      this.type = "text";
      this.value = "";
    }
    setAttribute(name, value) {
      super.setAttribute(name, value);
      if (String(name).toLowerCase() === "type") this.type = String(value);
      if (String(name).toLowerCase() === "value") this.value = String(value);
    }
  }

  class HTMLTextAreaElementStub extends HTMLElementStub {
    constructor() {
      super("textarea");
      this.value = "";
    }
    setAttribute(name, value) {
      super.setAttribute(name, value);
      if (String(name).toLowerCase() === "value") this.value = String(value);
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

  try {
    return run();
  } finally {
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

function findFirst(node, predicate) {
  if (!node) return null;
  if (predicate(node)) return node;
  const kids = Array.isArray(node._children) ? node._children : [];
  for (const k of kids) {
    if (k && typeof k === "object") {
      const hit = findFirst(k, predicate);
      if (hit) return hit;
    }
  }
  return null;
}

test("renderAuthModal: rememberedId блокирует поле ID и показывает кнопку «Сменить ID»", async () => {
  const helper = await loadRenderAuthModal();
  try {
    withDomStubs(() => {
      const modal = helper.renderAuthModal(
        "login",
        "854-432-319",
        undefined,
        [
          { id: "showcase", title: "Showcase" },
          { id: "telegram-web", title: "Telegram Web" },
        ],
        "showcase",
        {
          onLogin: () => {},
          onRegister: () => {},
          onModeChange: () => {},
          onSkinChange: () => {},
          onClose: () => {},
        }
      );

      const idInput = findFirst(modal, (n) => typeof n?.getAttribute === "function" && n.getAttribute("id") === "auth-id");
      assert.ok(idInput, "auth-id input not found");
      assert.equal(idInput.getAttribute("readonly"), "true");

      const editBtn = findFirst(
        modal,
        (n) => typeof n?.className === "string" && String(n.className).split(/\s+/).includes("field-action-edit")
      );
      assert.ok(editBtn, "field-action-edit button not found");

      const lockWrap = findFirst(
        modal,
        (n) => typeof n?.className === "string" && String(n.className).split(/\s+/).includes("auth-id-lock")
      );
      assert.ok(lockWrap, "auth-id-lock wrapper not found");
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderAuthModal: без rememberedId поле ID остаётся редактируемым", async () => {
  const helper = await loadRenderAuthModal();
  try {
    withDomStubs(() => {
      const modal = helper.renderAuthModal(
        "login",
        null,
        undefined,
        [{ id: "showcase", title: "Showcase" }],
        "showcase",
        {
          onLogin: () => {},
          onRegister: () => {},
          onModeChange: () => {},
          onSkinChange: () => {},
          onClose: () => {},
        }
      );

      const idInput = findFirst(modal, (n) => typeof n?.getAttribute === "function" && n.getAttribute("id") === "auth-id");
      assert.ok(idInput, "auth-id input not found");
      assert.equal(idInput.hasAttribute("readonly"), false);

      const lockWrap = findFirst(
        modal,
        (n) => typeof n?.className === "string" && String(n.className).split(/\s+/).includes("auth-id-lock")
      );
      assert.equal(lockWrap, null, "auth-id-lock wrapper must not be rendered without rememberedId");
    });
  } finally {
    await helper.cleanup();
  }
});

