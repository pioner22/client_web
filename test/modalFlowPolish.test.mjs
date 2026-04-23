import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";
import { readCssWithImports } from "./helpers/readCssWithImports.mjs";

async function bundleEntry(entryPath, exportName) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve(entryPath)],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod[exportName] !== "function") {
      throw new Error(`${exportName} export missing`);
    }
    return { fn: mod[exportName], cleanup: () => rm(tempDir, { recursive: true, force: true }) };
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

  class ClassListStub {
    constructor(owner) {
      this._owner = owner;
    }
    _syncFrom(value) {
      const parts = String(value || "").split(/\s+/).map((x) => x.trim()).filter(Boolean);
      this._owner._classSet = new Set(parts);
    }
    _syncTo() {
      this._owner._className = [...this._owner._classSet].join(" ");
    }
    add(...names) {
      for (const n of names) {
        for (const part of String(n || "").split(/\s+/).map((x) => x.trim()).filter(Boolean)) {
          this._owner._classSet.add(part);
        }
      }
      this._syncTo();
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
    getAttribute(name) {
      const v = this._attrs.get(String(name));
      return v === undefined ? null : v;
    }
    hasAttribute(name) {
      return this._attrs.has(String(name));
    }
    append(...nodes) {
      for (const n of nodes) this._children.push(n);
    }
    addEventListener(type, handler) {
      const key = String(type);
      const arr = this._listeners.get(key) || [];
      arr.push(handler);
      this._listeners.set(key, arr);
    }
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
  for (const kid of kids) {
    if (kid && typeof kid === "object") {
      const hit = findFirst(kid, predicate);
      if (hit) return hit;
    }
  }
  return null;
}

function collectText(node) {
  if (!node) return "";
  if (typeof node.textContent === "string") return node.textContent;
  const kids = Array.isArray(node._children) ? node._children : [];
  let out = "";
  for (const kid of kids) {
    if (kid && typeof kid === "object") out += collectText(kid);
    else if (typeof kid === "string") out += kid;
  }
  return out;
}

test("renderSendScheduleModal: dedicated shell + Escape cancel + Enter schedule", async () => {
  const helper = await bundleEntry("src/components/modals/renderSendScheduleModal.ts", "renderSendScheduleModal");
  try {
    withDomStubs(() => {
      let scheduled = 0;
      let cancelled = 0;
      const node = helper.fn("Текст", Date.now() + 60_000, "Ошибка", "Отложить", "Запланировать", {
        onSchedule() {
          scheduled += 1;
        },
        onCancel() {
          cancelled += 1;
        },
      });
      assert.ok(node.className.includes("modal-send-schedule"));
      assert.equal(node.getAttribute("role"), "dialog");
      assert.equal(node.getAttribute("aria-modal"), "true");
      const keydown = node._listeners.get("keydown") || [];
      assert.equal(keydown.length, 1);
      keydown[0]({ key: "Escape", shiftKey: false, preventDefault() {} });
      keydown[0]({ key: "Enter", shiftKey: false, preventDefault() {} });
      assert.equal(cancelled, 1);
      assert.equal(scheduled, 1);
    });
  } finally {
    await helper.cleanup();
  }
});

test("welcome/logout shells: status semantics + dialog Escape close", async () => {
  const welcome = await bundleEntry("src/components/modals/renderWelcomeModal.ts", "renderWelcomeModal");
  const logout = await bundleEntry("src/components/modals/renderLogoutModal.ts", "renderLogoutModal");
  try {
    withDomStubs(() => {
      const welcomeNode = welcome.fn("Подключение…");
      assert.equal(welcomeNode.getAttribute("role"), "status");
      assert.equal(welcomeNode.getAttribute("aria-live"), "polite");
      assert.equal(welcomeNode.getAttribute("aria-busy"), "true");

      let closed = 0;
      let relogin = 0;
      let switched = 0;
      const logoutNode = logout.fn("Сессия завершена", "854-432-319", {
        onClose() {
          closed += 1;
        },
        onRelogin() {
          relogin += 1;
        },
        onUseDifferentAccount() {
          switched += 1;
        },
      });
      assert.equal(logoutNode.getAttribute("role"), "dialog");
      assert.equal(logoutNode.getAttribute("aria-modal"), "true");
      const chip = findFirst(
        logoutNode,
        (n) => typeof n?.className === "string" && String(n.className).split(/\s+/).includes("screen-chip")
      );
      assert.ok(chip, "screen-chip not found");
      const account = findFirst(
        logoutNode,
        (n) => typeof n?.className === "string" && String(n.className).split(/\s+/).includes("screen-note-value")
      );
      assert.ok(account, "screen-note-value not found");
      assert.match(collectText(account), /854-432-319/);
      const reloginBtn = findFirst(
        logoutNode,
        (n) => typeof n?.tagName === "string" && n.tagName === "BUTTON" && /Войти снова/.test(collectText(n))
      );
      assert.ok(reloginBtn, "relogin button not found");
      const switchBtn = findFirst(
        logoutNode,
        (n) => typeof n?.tagName === "string" && n.tagName === "BUTTON" && /Другой аккаунт/.test(collectText(n))
      );
      assert.ok(switchBtn, "switch account button not found");
      (reloginBtn._listeners.get("click") || [])[0]({ type: "click" });
      (switchBtn._listeners.get("click") || [])[0]({ type: "click" });
      assert.equal(relogin, 1);
      assert.equal(switched, 1);
      const keydown = logoutNode._listeners.get("keydown") || [];
      assert.equal(keydown.length, 1);
      keydown[0]({ key: "Escape", preventDefault() {} });
      assert.equal(closed, 1);

      const recoveredNode = logout.fn("Нет соединения: code=1005", "854-432-319", {
        onClose() {},
        onRelogin() {},
        onUseDifferentAccount() {},
      });
      assert.doesNotMatch(collectText(recoveredNode), /code=1005/);
      assert.match(collectText(recoveredNode), /Сессия завершена на этом устройстве/i);
    });
  } finally {
    await welcome.cleanup();
    await logout.cleanup();
  }
});

test("modal flow polish: CSS and source guards present", async () => {
  const css = await readCssWithImports("src/scss/modal.css");
  assert.match(css, /\.modal-send-schedule\b/);
  assert.match(css, /\.modal-actions\.modal-actions-compose\b/);
  assert.match(css, /\.modal-screen-status\s+\.screen-sub\b/);
  assert.match(css, /\.auth-session-card\b/);
  assert.match(css, /\.auth-entry-layout\b/);
  assert.match(css, /\.auth-entry-hero\b/);
  assert.match(css, /\.auth-entry-panel\b/);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*\.auth-entry-hero\s*{[^}]*display:\s*none;/);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*\.auth-entry-panel\s+\.auth-chip-row\s*{[^}]*display:\s*none;/);
  assert.match(css, /@media\s*\(max-width:\s*860px\)\s*{[\s\S]*\.auth-entry-panel\s+\.auth-progress-list\s*{[^}]*display:\s*none;/);
  assert.match(css, /\.modal-screen\s+\.screen-chip\b/);
  assert.match(css, /#auth-pages > \.scrollable\s*{[^}]*padding:/s);
  assert.match(css, /#auth-pages \.tabs-tab \.container\s*{[^}]*min-height:\s*0;[^}]*flex:\s*0 0 auto;/s);

  const forwardSrc = await readFile(path.resolve("src/components/modals/renderForwardModal.ts"), "utf8");
  assert.match(forwardSrc, /class:\s*"btn btn-secondary"/);
  assert.match(forwardSrc, /role:\s*"dialog"/);
  assert.match(forwardSrc, /"aria-modal":\s*"true"/);

  const renderAppSrc = await readFile(path.resolve("src/app/renderApp.ts"), "utf8");
  assert.match(renderAppSrc, /prevSendScheduleAt/);
  assert.match(renderAppSrc, /hadSendScheduleModal/);
  assert.match(renderAppSrc, /state\.modal\?\.kind === "send_schedule"/);
});
