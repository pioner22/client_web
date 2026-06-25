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
      assert.equal(node.getAttribute("data-viewer-fit"), "stage");
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
      const bottomActions = findFirst(
        node,
        (n) => n && String(n.className || "").includes("modal-actions") && String(n.className || "").includes("viewer-actions")
      );
      assert.equal(bottomActions, null, "visual viewer must not render hidden bottom actions");
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
  assert.match(source, /resetImageViewport/);
  assert.match(source, /data-viewer-fit/);
  assert.match(source, /data-viewer-load/);
  assert.match(source, /preloaderStallTimer/);
  assert.match(source, /fallbackUrl/);
  assert.match(source, /tryFallbackImage/);
  assert.match(source, /Показываем превью/);
  assert.match(source, /"Вписано"/);
  assert.match(helperSource, /viewer-footer-shell/);
  assert.match(helperSource, /viewer-footer-counter/);
  assert.match(mediaKindSource, /resolveMediaKind/);
  assert.doesNotMatch(source, /viewer-bottom-ui-h/);
  assert.match(css, /\.viewer-footer-shell\s*\{/);
  assert.match(css, /\.viewer-footer-counter\s*\{/);
  assert.match(css, /--viewer-frame-bottom-pad:\s*var\(--app-physical-bottom-pad,\s*var\(--safe-bottom-pad\)\)\s*;/);
  assert.match(css, /\.viewer-stage\s*\{[\s\S]*?flex:\s*1 1 0;[\s\S]*?max-height:\s*100%;/);
  assert.match(css, /\.viewer-img-scroll\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?max-height:\s*100%;/);
  assert.match(css, /\.viewer-footer-shell:not\(\.viewer-footer-shell-has-rail\)\s+\.viewer-footer-main\s*\{[\s\S]*?var\(--viewer-frame-bottom-pad\)/);
  assert.match(css, /\.viewer-rail\s*\{[\s\S]*?var\(--viewer-frame-bottom-pad,\s*var\(--safe-bottom-pad\)\)/);
  assert.match(css, /W-1010:\s*final visual viewer fit/);
  assert.match(css, /\.modal\.modal-viewer\.viewer-visual\[data-viewer-fit="stage"\][\s\S]*?height:\s*100dvh;[\s\S]*?overflow:\s*hidden;/);
  assert.match(css, /\.modal\.modal-viewer\.viewer-visual\[data-viewer-fit="stage"\][\s\S]*?\.viewer-stage,[\s\S]*?max-height:\s*none;/);
  assert.match(css, /\.modal\.modal-viewer\.viewer-visual\[data-viewer-fit="stage"\]:not\(\.viewer-zoomed\)[\s\S]*?\.viewer-media \.viewer-img,[\s\S]*?max-height:\s*100%\s*!important;/);
  const oldCalcIndex = css.indexOf("max-height: calc(100dvh - 132px)");
  const finalFitIndex = css.indexOf("W-1010: final visual viewer fit");
  assert.ok(oldCalcIndex >= 0 && finalFitIndex > oldCalcIndex, "final stage-fit rules must come after old viewport calc rules");
  assert.doesNotMatch(css, /max-height:\s*min\(calc\(var\(--app-vh,\s*100vh\)\s*\*\s*0\.8\),\s*100%\)/);
  assert.match(css, /video\.viewer-video\s*\{/);
  assert.match(css, /audio\.viewer-audio\s*\{/);
  assert.doesNotMatch(css, /viewer-bottom-ui-h/);
});

test("renderFileViewerModal: mobile visual viewer uses compact non-overlapping chrome", async () => {
  const css = await readFile(path.resolve("src/scss/modal.part02.css"), "utf8");
  assert.match(
    css,
    /@media\s*\(max-width:\s*600px\)\s*\{[\s\S]*?\.overlay\.overlay-viewer\s+\.modal\.modal-viewer\s*\{[\s\S]*?--viewer-frame-bottom-pad:\s*0px\s*;/
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*600px\)\s*\{[\s\S]*?\.overlay\.overlay-viewer\s+\.viewer-header\s*\{[\s\S]*?padding:\s*max\(10px,\s*env\(safe-area-inset-top\)\)\s+10px\s+8px\s*;[\s\S]*?justify-content:\s*flex-end\s*;[\s\S]*?pointer-events:\s*none\s*;/
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*600px\)\s*\{[\s\S]*?\.overlay\.overlay-viewer\s+\.viewer-header-info\s*\{[\s\S]*?display:\s*none\s*;/
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*600px\)\s*\{[\s\S]*?\.overlay\.overlay-viewer\s+\.viewer-header-actions\s*\{[\s\S]*?align-self:\s*flex-start\s*;[\s\S]*?gap:\s*8px\s*;[\s\S]*?pointer-events:\s*auto\s*;/
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*600px\)\s*\{[\s\S]*?\.overlay\.overlay-viewer\s+\.viewer-header-actions\s+\.btn\s*\{[\s\S]*?width:\s*44px\s*;[\s\S]*?min-width:\s*44px\s*;[\s\S]*?height:\s*44px\s*;[\s\S]*?background:\s*rgba\(0,\s*0,\s*0,\s*0\.58\)\s*;[\s\S]*?opacity:\s*1\s*;/
  );
  assert.match(
    css,
    /\.modal\.modal-viewer\.viewer-visual\s+\.viewer-zoom-btn,\s*[\s\S]*?\.modal\.modal-viewer\.viewer-visual\s+\.viewer-jump-btn,\s*[\s\S]*?\.modal\.modal-viewer\.viewer-visual\s+\.viewer-forward-btn,\s*[\s\S]*?\.modal\.modal-viewer\.viewer-visual\s+\.viewer-delete-btn,\s*[\s\S]*?\.modal\.modal-viewer\.viewer-visual\s+\.viewer-share-btn\s*\{[\s\S]*?display:\s*none\s*;/
  );
  assert.match(
    css,
    /\.modal\.modal-viewer\.viewer-visual\s+\.viewer-download-btn,\s*[\s\S]*?\.modal\.modal-viewer\.viewer-visual\s+\.auth-close\s*\{[\s\S]*?display:\s*grid\s*;[\s\S]*?place-items:\s*center\s*;/
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*600px\)\s*\{[\s\S]*?\.overlay\.overlay-viewer\s+\.modal\.modal-viewer\.viewer-visual\s+\.viewer-footer-shell\s*\{[\s\S]*?opacity:\s*1\s*;[\s\S]*?background:\s*#000\s*;/
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*600px\)\s*\{[\s\S]*?\.overlay\.overlay-viewer\s+\.modal\.modal-viewer\.viewer-visual\s+\.viewer-rail\s*\{[\s\S]*?padding:\s*8px\s+12px\s+max\(10px,\s*env\(safe-area-inset-bottom\)\)\s*;[\s\S]*?gap:\s*8px\s*;/
  );
  assert.match(css, /\.overlay\.overlay-viewer\s+\.modal\.modal-viewer\.viewer-visual\s+\.viewer-rail-item\s*\{[\s\S]*?width:\s*48px\s*;[\s\S]*?height:\s*48px\s*;/);

  const baseRailIndex = css.indexOf(".viewer-rail {");
  const mobileRailIndex = css.indexOf(".overlay.overlay-viewer .modal.modal-viewer.viewer-visual .viewer-rail {");
  assert.ok(baseRailIndex >= 0 && mobileRailIndex > baseRailIndex, "mobile rail override must come after the base rail rule");
});

test("renderFileViewerModal: W-1013 stage fit keeps media paintable after mobile polish", async () => {
  const css = await readFile(path.resolve("src/scss/polish.css"), "utf8");

  assert.match(css, /W-1012:\s*screenshot repair for PWA viewer\/history geometry/);
  assert.match(css, /W-1013:\s*crash screenshot repair for blank visual viewer and mobile host paint/);
  assert.match(css, /\.modal\.modal-viewer\.viewer-visual\[data-viewer-fit="stage"\]\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto;/);
  assert.match(css, /\.modal\.modal-viewer\.viewer-visual\[data-viewer-fit="stage"\]\s+\.viewer-stage,[\s\S]*?\.viewer-has-rail \.viewer-stage\s*\{[\s\S]*?contain:\s*layout paint;/);
  assert.match(css, /\.modal\.modal-viewer\.viewer-visual\[data-viewer-fit="stage"\]\s+\.viewer-footer-shell\s*\{[\s\S]*?max-height:\s*min\(30dvh,\s*220px\);[\s\S]*?background:\s*#000;/);
  assert.match(css, /data-viewer-load="ready"[\s\S]*?\.viewer-preloader[\s\S]*?display:\s*none\s*!important;/);
  assert.match(css, /data-viewer-load="error"[\s\S]*?\.viewer-preloader[\s\S]*?display:\s*grid;/);
  assert.doesNotMatch(css, /contain:\s*size layout paint;/);
});

test("renderFileViewerModal: W-1014 viewer polish is imported after legacy polish and clamps mobile media", async () => {
  const [styleCss, css] = await Promise.all([
    readFile(path.resolve("src/scss/style.css"), "utf8"),
    readFile(path.resolve("src/scss/w1014-media-viewer.css"), "utf8"),
  ]);

  const polishIndex = styleCss.indexOf('@import "./polish.css";');
  const w1014Index = styleCss.indexOf('@import "./w1014-media-viewer.css";');
  assert.ok(polishIndex >= 0 && w1014Index > polishIndex, "W-1014 viewer layer must load after polish.css");
  assert.match(css, /W-1014:\s*hard viewer\/media geometry/);
  assert.match(css, /grid-template-rows:\s*minmax\(0,\s*1fr\)\s*!important;/);
  assert.match(css, /\.viewer-header\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?pointer-events:\s*none;/);
  assert.match(css, /@media\s*\(max-width:\s*600px\)\s*\{[\s\S]*?\.viewer-header-info\s*\{[\s\S]*?display:\s*none;/);
  assert.match(css, /@media\s*\(max-width:\s*600px\)\s*\{[\s\S]*?\.viewer-header-actions\s*\{[\s\S]*?max-width:\s*calc\(100dvw - max\(20px,\s*env\(safe-area-inset-left\)\) - max\(20px,\s*env\(safe-area-inset-right\)\)\);/);
  assert.match(css, /\.modal\.modal-viewer:not\(\.viewer-visual\)\s*\{[\s\S]*?width:\s*100dvw;[\s\S]*?overflow:\s*hidden;/);
  assert.match(css, /\.modal\.modal-viewer:not\(\.viewer-visual\)\s+\.viewer-action-btn\s*\{[\s\S]*?flex:\s*0 0 38px;[\s\S]*?width:\s*38px;/);
  assert.match(css, /\.viewer-stage,[\s\S]*?\.viewer-has-rail \.viewer-stage\s*\{[\s\S]*?padding:\s*var\(--viewer-w1014-top\)\s+0\s+var\(--viewer-w1014-bottom\);/);
  assert.match(css, /\.viewer-footer-shell\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?bottom:\s*0;/);
  assert.match(css, /\.viewer-img[\s\S]*?max-height:\s*calc\(var\(--app-vh,\s*100dvh\)\s*-\s*var\(--viewer-w1014-top\)\s*-\s*var\(--viewer-w1014-bottom\)\s*-\s*10px\)\s*!important;/);
  assert.match(css, /data-viewer-load="loading"[\s\S]*?\.viewer-preloader\s*\{[\s\S]*?display:\s*grid;/);
  assert.match(css, /--history-mobile-media-gutter:\s*42px;/);
  assert.match(css, /\.msg-attach\[data-msg-file="image"\][\s\S]*?\.msg-body\s*\{[\s\S]*?max-width:\s*calc\(100dvw - var\(--history-mobile-media-gutter\)\)\s*!important;/);
  assert.match(css, /\.chat-file-preview > \.chat-file-img,[\s\S]*?\.chat-file-preview > \.chat-file-video\s*\{[\s\S]*?object-fit:\s*cover;/);
});

test("renderFileViewerModal: W-1019 final viewer layer separates single-photo and rail bottom reserve", async () => {
  const css = await readFile(path.resolve("src/scss/w1014-media-viewer.css"), "utf8");

  assert.match(css, /W-1019:\s*final mobile viewer allocation/);
  assert.match(css, /--viewer-w1019-bottom-pad:\s*0px;/);
  assert.match(css, /\.viewer-has-caption\s*\{[\s\S]*?--viewer-w1019-bottom-pad:\s*clamp\(74px,\s*14dvh,\s*112px\);/);
  assert.match(css, /\.viewer-has-rail\s*\{[\s\S]*?--viewer-w1019-bottom-pad:\s*clamp\(118px,\s*20dvh,\s*156px\);/);
  assert.match(css, /padding:\s*var\(--viewer-w1019-top-pad\)\s+0\s+var\(--viewer-w1019-bottom-pad\)\s*!important;/);
  assert.match(css, /max-height:\s*calc\(var\(--app-vh,\s*100dvh\)\s*-\s*var\(--viewer-w1019-top-pad\)\s*-\s*var\(--viewer-w1019-bottom-pad\)\s*-\s*8px\)\s*!important;/);
});

test("renderFileViewerModal: W-1033 mobile rail is lifted above the bottom safe area", async () => {
  const css = await readFile(path.resolve("src/scss/w1014-media-viewer.css"), "utf8");

  assert.match(css, /W-1033:\s*lift mobile album rail above bottom chrome/);
  assert.match(css, /--viewer-w1033-rail-lift:\s*max\(18px,\s*env\(safe-area-inset-bottom\)\);/);
  assert.match(css, /\.viewer-has-rail\s*\{[\s\S]*?--viewer-w1019-bottom-pad:\s*clamp\(136px,\s*22dvh,\s*176px\);/);
  assert.match(css, /\.viewer-footer-shell\s*\{[\s\S]*?padding-bottom:\s*var\(--viewer-w1033-rail-lift\);/);
  assert.match(css, /\.viewer-rail\s*\{[\s\S]*?padding:\s*7px\s+12px\s+0;[\s\S]*?min-height:\s*63px;[\s\S]*?max-height:\s*calc\(var\(--viewer-w1019-bottom-pad\)\s*-\s*var\(--viewer-w1033-rail-lift\)\s*-\s*30px\);/);

  const w1019Index = css.indexOf("W-1019: final mobile viewer allocation");
  const w1033Index = css.indexOf("W-1033: lift mobile album rail above bottom chrome");
  assert.ok(w1019Index >= 0 && w1033Index > w1019Index, "W-1033 rail lift must override the older W-1019 allocation");
});
