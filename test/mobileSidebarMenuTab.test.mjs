import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadRenderSidebar() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/components/sidebar/renderSidebar.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.renderSidebar !== "function") {
      throw new Error("renderSidebar export missing");
    }
    return { renderSidebar: mod.renderSidebar, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
}

function withDomStubs(run, opts = {}) {
  const prev = {
    document: globalThis.document,
    window: globalThis.window,
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

  class HTMLElementStub {
    constructor(tagName = "div") {
      this.tagName = String(tagName).toUpperCase();
      this.className = "";
      this._attrs = new Map();
      this._children = [];
      this._listeners = new Map();
      this.style = new StyleStub();
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
  const isMobile = Boolean(opts.isMobile);
  globalThis.window = {
    matchMedia: () => ({ matches: isMobile }),
  };

  try {
    return run();
  } finally {
    if (prev.document === undefined) delete globalThis.document;
    else globalThis.document = prev.document;

    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;

    if (prev.HTMLElement === undefined) delete globalThis.HTMLElement;
    else globalThis.HTMLElement = prev.HTMLElement;

    if (prev.HTMLInputElement === undefined) delete globalThis.HTMLInputElement;
    else globalThis.HTMLInputElement = prev.HTMLInputElement;

    if (prev.HTMLTextAreaElement === undefined) delete globalThis.HTMLTextAreaElement;
    else globalThis.HTMLTextAreaElement = prev.HTMLTextAreaElement;
  }
}

function collectText(node) {
  if (!node) return "";
  if (node.nodeType === 3) return String(node.textContent || "");
  const kids = Array.isArray(node._children) ? node._children : [];
  return kids.map(collectText).join("");
}

function findAll(node, predicate, out = []) {
  if (!node) return out;
  if (predicate(node)) out.push(node);
  const kids = Array.isArray(node._children) ? node._children : [];
  for (const k of kids) {
    if (k && typeof k === "object") findAll(k, predicate, out);
  }
  return out;
}

function hasText(root, needle) {
  const txt = collectText(root);
  return txt.includes(String(needle));
}

function mkState(tab) {
  return {
    friends: [{ id: "123-456-789", online: true, friend: true, unread: 0 }],
    groups: [],
    boards: [],
    pinned: [],
    pendingIn: [],
    pendingOut: [],
    pendingGroupInvites: [],
    pendingGroupJoinRequests: [],
    pendingBoardInvites: [],
    fileOffersIn: [],
    selected: null,
    page: "main",
    mobileSidebarTab: tab,
    sidebarQuery: "",
    conversations: { "dm:123-456-789": [] },
    drafts: {},
  };
}

test("mobile sidebar: 4 вкладки (Контакты/Доски/Чаты/Меню)", async () => {
  const helper = await loadRenderSidebar();
  try {
    withDomStubs(
      () => {
        const target = document.createElement("div");
        helper.renderSidebar(target, mkState("chats"), () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
        const tabs = findAll(target, (n) => n.tagName === "BUTTON" && String(n.className || "").includes("sidebar-tab"));
        const labels = tabs.map((b) => collectText(b).trim());
        assert.deepEqual(labels, ["Контакты", "Доски", "Чаты", "Меню"]);
      },
      { isMobile: true }
    );
  } finally {
    await helper.cleanup();
  }
});

test("mobile sidebar: Контакты не содержат пункты меню (они в отдельной вкладке)", async () => {
  const helper = await loadRenderSidebar();
  try {
    withDomStubs(
      () => {
        const target = document.createElement("div");
        helper.renderSidebar(target, mkState("contacts"), () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
        assert.equal(hasText(target, "Поиск"), false);
        assert.equal(hasText(target, "Создать чат"), false);
        assert.equal(hasText(target, "Онлайн"), false);
      },
      { isMobile: true }
    );
  } finally {
    await helper.cleanup();
  }
});

test("mobile sidebar: Меню содержит навигацию/создание и подсказки", async () => {
  const helper = await loadRenderSidebar();
  try {
    withDomStubs(
      () => {
        const target = document.createElement("div");
        helper.renderSidebar(target, mkState("menu"), () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
        assert.equal(hasText(target, "Навигация"), true);
        assert.equal(hasText(target, "Поиск"), false);
        assert.equal(hasText(target, "Создать чат"), true);
        assert.equal(hasText(target, "Подсказки"), true);
        assert.equal(hasText(target, "Онлайн"), false);
      },
      { isMobile: true }
    );
  } finally {
    await helper.cleanup();
  }
});

test("mobile sidebar: поиск фильтрует список и вызывает onSetSidebarQuery", async () => {
  const helper = await loadRenderSidebar();
  try {
    withDomStubs(
      () => {
        const calls = [];
        const target = document.createElement("div");
        const state = {
          friends: [
            { id: "111-111-111", online: true, unread: 0 },
            { id: "222-222-222", online: false, unread: 0 },
          ],
          profiles: { "111-111-111": { id: "111-111-111", display_name: "Алиса" } },
          groups: [],
          boards: [],
          pinned: [],
          pendingIn: [],
          pendingOut: [],
          pendingGroupInvites: [],
          pendingGroupJoinRequests: [],
          pendingBoardInvites: [],
          fileOffersIn: [],
          selected: null,
          page: "main",
          mobileSidebarTab: "contacts",
          sidebarQuery: "али",
          conversations: {
            "dm:111-111-111": [{ ts: 1, from: "111-111-111", text: "привет", kind: "in" }],
            "dm:222-222-222": [{ ts: 2, from: "222-222-222", text: "йо", kind: "in" }],
          },
          drafts: {},
        };

        helper.renderSidebar(
          target,
          state,
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          () => {},
          (q) => calls.push(String(q))
        );

        assert.equal(hasText(target, "Алиса"), true);
        assert.equal(hasText(target, "222-222-222"), false);

        const inputs = findAll(target, (n) => n.tagName === "INPUT" && String(n.className || "").includes("sidebar-search-input"));
        assert.equal(inputs.length > 0, true);
        const input = inputs[0];
        input.value = "test";
        input.dispatchEvent({ type: "input" });
        assert.deepEqual(calls, ["test"]);
      },
      { isMobile: true }
    );
  } finally {
    await helper.cleanup();
  }
});

test("mobile sidebar: Чаты = активные ЛС + группы (не весь список контактов)", async () => {
  const helper = await loadRenderSidebar();
  try {
    withDomStubs(
      () => {
        const target = document.createElement("div");
        const state = {
          friends: [
            { id: "111-111-111", online: true, unread: 0 },
            { id: "222-222-222", online: false, unread: 0 },
          ],
          groups: [{ id: "g-1", name: "Группа 1" }],
          boards: [],
          pinned: [],
          pendingIn: [],
          pendingOut: [],
          pendingGroupInvites: [],
          pendingGroupJoinRequests: [],
          pendingBoardInvites: [],
          fileOffersIn: [],
          selected: null,
          page: "main",
          mobileSidebarTab: "chats",
          sidebarQuery: "",
          conversations: {
            "dm:111-111-111": [{ ts: 10, from: "111-111-111", text: "hi", kind: "in" }],
            "dm:222-222-222": [],
            "room:g-1": [],
          },
          drafts: {},
        };

        helper.renderSidebar(target, state, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});

        assert.equal(hasText(target, "111-111-111"), true);
        assert.equal(hasText(target, "Группа 1"), true);
        assert.equal(hasText(target, "222-222-222"), false);
      },
      { isMobile: true }
    );
  } finally {
    await helper.cleanup();
  }
});

test("mobile sidebar: Контакты показывают всех пользователей (не только активные ЛС)", async () => {
  const helper = await loadRenderSidebar();
  try {
    withDomStubs(
      () => {
        const target = document.createElement("div");
        const state = {
          friends: [
            { id: "111-111-111", online: true, unread: 0 },
            { id: "222-222-222", online: false, unread: 0 },
          ],
          groups: [],
          boards: [],
          pinned: [],
          pendingIn: [],
          pendingOut: [],
          pendingGroupInvites: [],
          pendingGroupJoinRequests: [],
          pendingBoardInvites: [],
          fileOffersIn: [],
          selected: null,
          page: "main",
          mobileSidebarTab: "contacts",
          sidebarQuery: "",
          conversations: {
            "dm:111-111-111": [{ ts: 10, from: "111-111-111", text: "hi", kind: "in" }],
            "dm:222-222-222": [],
          },
          drafts: {},
        };

        helper.renderSidebar(target, state, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});

        assert.equal(hasText(target, "111-111-111"), true);
        assert.equal(hasText(target, "222-222-222"), true);
      },
      { isMobile: true }
    );
  } finally {
    await helper.cleanup();
  }
});
