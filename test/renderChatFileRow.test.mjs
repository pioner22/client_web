import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadRenderChat() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/components/chat/renderChat.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.renderChat !== "function") {
      throw new Error("renderChat export missing");
    }
    return { renderChat: mod.renderChat, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
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
      this.scrollTop = 0;
      this.scrollHeight = 0;
      this.clientHeight = 0;
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
  for (const k of kids) {
    if (k && typeof k === "object") {
      const hit = findFirst(k, predicate);
      if (hit) return hit;
    }
  }
  return null;
}

function hasClass(node, name) {
  return node && typeof node.className === "string" && node.className.split(/\s+/).includes(name);
}

test("renderChat: file-attachment рендерит preview первым, иконку и action-кнопку", async () => {
  const helper = await loadRenderChat();
  try {
    withDomStubs(() => {
      const chat = document.createElement("div");
      const chatTop = document.createElement("div");
      const chatHost = document.createElement("div");
      const chatJump = document.createElement("button");
      chat.className = "chat";
      chatTop.className = "chat-top";
      chatHost.className = "chat-host";
      chatJump.className = "btn chat-jump hidden";
      chatHost.clientHeight = 120;
      chatHost.scrollHeight = 2000;

      const layout = { chat, chatTop, chatHost, chatJump };
      const state = {
        selected: { kind: "dm", id: "123-456-789" },
        conversations: {
          "dm:123-456-789": [
            {
              kind: "in",
              from: "123-456-789",
              to: "854-432-319",
              room: null,
              text: "",
              ts: 1700000000,
              id: 1,
              attachment: { kind: "file", name: "photo.png", size: 123, mime: "image/png", fileId: "42" },
            },
          ],
        },
        historyHasMore: {},
        historyLoading: {},
        chatSearchOpen: false,
        chatSearchQuery: "",
        chatSearchHits: [],
        chatSearchPos: 0,
        pinnedMessages: {},
        pinnedMessageActive: {},
        fileTransfers: [],
        fileOffersIn: [],
        groups: [],
        boards: [],
      };

      helper.renderChat(layout, state);

      const fileRow = findFirst(chatHost, (n) => hasClass(n, "file-row-chat"));
      assert.ok(fileRow, "должен быть file-row-chat");
      assert.ok(Array.isArray(fileRow._children) && fileRow._children.length >= 1);
      assert.ok(hasClass(fileRow._children[0], "chat-file-preview"), "превью должно быть первым элементом в file-row");

      const icon = findFirst(fileRow, (n) => hasClass(n, "file-icon"));
      assert.ok(icon, "должна быть file-icon");
      assert.ok(icon.style?._props?.has("--file-h"), "file-icon должна выставлять --file-h");

      const download = findFirst(fileRow, (n) => hasClass(n, "file-action-download"));
      assert.ok(download, "должна быть кнопка file-action-download");
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderChat: sys action message рендерит кнопки действий", async () => {
  const helper = await loadRenderChat();
  try {
    withDomStubs(() => {
      const chat = document.createElement("div");
      const chatTop = document.createElement("div");
      const chatHost = document.createElement("div");
      const chatJump = document.createElement("button");
      chat.className = "chat";
      chatTop.className = "chat-top";
      chatHost.className = "chat-host";
      chatJump.className = "btn chat-jump hidden";
      chatHost.clientHeight = 120;
      chatHost.scrollHeight = 2000;

      const layout = { chat, chatTop, chatHost, chatJump };
      const state = {
        selected: { kind: "dm", id: "111-111-111" },
        conversations: {
          "dm:111-111-111": [
            {
              kind: "sys",
              from: "111-111-111",
              text: "Приглашение в чат: Чат",
              ts: 1700000000,
              id: null,
              localId: "action:group_invite:grp-0001:111-111-111",
              attachment: { kind: "action", payload: { kind: "group_invite", groupId: "grp-0001", from: "111-111-111", name: "Чат" } },
            },
          ],
        },
        historyHasMore: {},
        historyLoading: {},
        chatSearchOpen: false,
        chatSearchQuery: "",
        chatSearchHits: [],
        chatSearchPos: 0,
        pinnedMessages: {},
        pinnedMessageActive: {},
        fileTransfers: [],
        fileOffersIn: [],
        groups: [],
        boards: [],
        profiles: {},
      };

      helper.renderChat(layout, state);

      const accept = findFirst(chatHost, (n) => n?.getAttribute?.("data-action") === "group-invite-accept");
      const decline = findFirst(chatHost, (n) => n?.getAttribute?.("data-action") === "group-invite-decline");
      assert.ok(accept, "должна быть кнопка group-invite-accept");
      assert.ok(decline, "должна быть кнопка group-invite-decline");
    });
  } finally {
    await helper.cleanup();
  }
});
