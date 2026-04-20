import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

async function loadRenderFileViewerModal() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "yagodka-web-test-"));
  const outfile = path.join(tempDir, "bundle.mjs");
  try {
    await build({
      entryPoints: [path.resolve("src/components/modals/renderFileViewerModal.ts")],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      sourcemap: false,
      logLevel: "silent",
    });
    const mod = await import(pathToFileURL(outfile).href);
    if (typeof mod.renderFileViewerModal !== "function") {
      throw new Error("renderFileViewerModal export missing");
    }
    return { renderFileViewerModal: mod.renderFileViewerModal, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
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
    window: globalThis.window,
  };

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
    toggle(name, force) {
      const part = String(name || "").trim();
      if (!part) return false;
      const has = this._owner._classSet.has(part);
      const shouldHave = force === undefined ? !has : Boolean(force);
      if (shouldHave) this._owner._classSet.add(part);
      else this._owner._classSet.delete(part);
      this._syncTo();
      return shouldHave;
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
      this.style = { setProperty() {} };
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
    addEventListener() {}
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
  globalThis.window = { location: { href: "https://yagodka.org/web/" } };

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

    if (prev.window === undefined) delete globalThis.window;
    else globalThis.window = prev.window;
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

function findAll(node, predicate, out = []) {
  if (!node) return out;
  if (predicate(node)) out.push(node);
  const kids = Array.isArray(node._children) ? node._children : [];
  for (const k of kids) {
    if (k && typeof k === "object") findAll(k, predicate, out);
  }
  return out;
}

function collectText(node) {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node.textContent === "string") return node.textContent;
  const kids = Array.isArray(node._children) ? node._children : [];
  return kids.map((k) => collectText(k)).join("");
}

test("renderFileViewerModal: renders <video> for video files", async () => {
  const helper = await loadRenderFileViewerModal();
  try {
    withDomStubs(() => {
      const node = helper.renderFileViewerModal("blob:video", "clip.mp4", 123, "video/mp4", null, null, { onClose() {} });
      const video = findFirst(node, (n) => n && n.tagName === "VIDEO");
      assert.ok(video, "video element missing");
      assert.ok(String(video.className || "").includes("viewer-video"));
      assert.ok(String(node.className || "").includes("viewer-kind-video"));
      assert.ok(!String(node.className || "").includes("viewer-video"), "modal root must not reuse the video element class");
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderFileViewerModal: treats IMG_*.MP4 as video (iOS naming)", async () => {
  const helper = await loadRenderFileViewerModal();
  try {
    withDomStubs(() => {
      const node = helper.renderFileViewerModal("blob:video", "IMG_3383.MP4", 123, "video/mp4", null, null, { onClose() {} });
      const video = findFirst(node, (n) => n && n.tagName === "VIDEO");
      assert.ok(video, "video element missing");
      assert.ok(String(video.className || "").includes("viewer-video"));
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderFileViewerModal: renders <audio> for audio files", async () => {
  const helper = await loadRenderFileViewerModal();
  try {
    withDomStubs(() => {
      const node = helper.renderFileViewerModal("blob:audio", "note.ogg", 123, "audio/ogg", null, null, { onClose() {} });
      const audio = findFirst(node, (n) => n && n.tagName === "AUDIO");
      assert.ok(audio, "audio element missing");
      assert.ok(String(audio.className || "").includes("viewer-audio"));
      assert.ok(String(node.className || "").includes("viewer-kind-audio"));
      assert.ok(!String(node.className || "").includes("viewer-audio"), "modal root must not reuse the audio element class");
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderFileViewerModal: visual viewer uses explicit footer shell with counter and rail", async () => {
  const helper = await loadRenderFileViewerModal();
  try {
    withDomStubs(() => {
      const node = helper.renderFileViewerModal(
        "blob:image",
        "photo.jpg",
        321,
        "image/jpeg",
        "Подпись к фото",
        {
          rail: [
            { msgIdx: 1, name: "one.jpg", kind: "image", thumbUrl: "blob:one" },
            { msgIdx: 2, name: "two.jpg", kind: "image", thumbUrl: "blob:two", active: true },
            { msgIdx: 3, name: "three.mp4", kind: "video", thumbUrl: "blob:three" },
          ],
        },
        { onClose() {}, onOpenAt() {} }
      );
      const stage = findFirst(node, (n) => n && String(n.className || "").includes("viewer-stage"));
      assert.ok(stage, "viewer stage missing");
      const footer = findFirst(node, (n) => n && String(n.className || "").includes("viewer-footer-shell"));
      assert.ok(footer, "viewer footer shell missing");
      const footerInsideStage = findFirst(stage, (n) => n && String(n.className || "").includes("viewer-footer-shell"));
      assert.equal(footerInsideStage, null, "viewer footer must be a sibling row, not an overlay child of the stage");
      const counter = findFirst(node, (n) => n && String(n.className || "").includes("viewer-footer-counter"));
      assert.ok(counter, "viewer footer counter missing");
      assert.match(collectText(counter), /2 из 3/);
      const railItems = findAll(node, (n) => n && String(n.className || "").includes("viewer-rail-item"));
      assert.equal(railItems.length, 3, "viewer rail items mismatch");
      const caption = findFirst(node, (n) => n && String(n.className || "").includes("viewer-caption-body"));
      assert.ok(caption, "viewer caption body missing");
      assert.match(collectText(caption), /Подпись к фото/);
    });
  } finally {
    await helper.cleanup();
  }
});

test("renderFileViewerModal: footer shell helper and CSS hooks are present", async () => {
  const [source, helperSource, mediaKindSource, css] = await Promise.all([
    readFile(path.resolve("src/components/modals/renderFileViewerModal.ts"), "utf8"),
    readFile(path.resolve("src/components/modals/viewerFooterShell.ts"), "utf8"),
    readFile(path.resolve("src/helpers/files/mediaKind.ts"), "utf8"),
    readFile(path.resolve("src/scss/modal.part02.css"), "utf8"),
  ]);
  assert.match(source, /renderViewerFooterShell/);
  assert.match(source, /isVideoLikeFile/);
  assert.match(source, /isAudioLikeFile/);
  assert.match(helperSource, /viewer-footer-shell/);
  assert.match(helperSource, /viewer-footer-counter/);
  assert.match(mediaKindSource, /resolveMediaKind/);
  assert.doesNotMatch(source, /viewer-bottom-ui-h/);
  assert.match(css, /\.viewer-footer-shell\s*\{/);
  assert.match(css, /\.viewer-footer-counter\s*\{/);
  assert.match(css, /video\.viewer-video\s*\{/);
  assert.match(css, /audio\.viewer-audio\s*\{/);
  assert.doesNotMatch(css, /viewer-bottom-ui-h/);
});

test("renderFileViewerModal: mobile overlay header keeps safe-area top padding and compact metadata", async () => {
  const css = await readFile(path.resolve("src/scss/modal.part02.css"), "utf8");
  assert.match(
    css,
    /@media\s*\(max-width:\s*600px\)\s*\{[\s\S]*?\.overlay\.overlay-viewer\s+\.viewer-header\s*\{[\s\S]*?padding-top:\s*calc\(var\(--viewer-pad\)\s*\+\s*env\(safe-area-inset-top\)\s*\+\s*8px\)\s*;/
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*600px\)\s*\{[\s\S]*?\.overlay\.overlay-viewer\s+\.viewer-header-actions\s*\{[\s\S]*?align-self:\s*flex-start\s*;/
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*600px\)\s*\{[\s\S]*?\.overlay\.overlay-viewer\s+\.viewer-title,\s*[\s\S]*?\.overlay\.overlay-viewer\s+\.viewer-sub,\s*[\s\S]*?text-overflow:\s*ellipsis\s*;/
  );
});
