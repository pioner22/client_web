import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("mobile safe-area: mobile fullscreen overrides win against skins", async () => {
  const css = await readFile(path.resolve("src/scss/responsive.css"), "utf8");
  assert.match(css, /@media\s*\(max-width:\s*600px\)\s*\{/);
  assert.match(css, /#app\s*\{[\s\S]*?--app-outer-pad:\s*0px;/);
  assert.match(css, /#app\s*\{[\s\S]*?position:\s*fixed;/);
  assert.match(css, /#app\s*\{[\s\S]*?inset:\s*0\s*;/);
  assert.match(css, /#app\s*\{[\s\S]*?height:\s*var\(--app-vh\)\s*;/);
  assert.match(css, /#app\s*\{[\s\S]*?overflow:\s*hidden\s*;/);
  assert.match(css, /app-vv-offset\s+#app\s*\{[\s\S]*?top:\s*var\(--app-vv-top,\s*0px\)\s*;/);
  assert.match(css, /app-vv-offset\s+#app\s*\{[\s\S]*?bottom:\s*var\(--app-vv-bottom,\s*0px\)\s*;/);
  assert.match(css, /app-vv-offset\s+#app\s*\{[\s\S]*?height:\s*auto\s*;/);
  assert.match(css, /#app\s*>\s*\.app\s*\{[\s\S]*?--app-row-footer:\s*auto;/);
});

test("mobile safe-area: composer bottom padding avoids extra gap", async () => {
  const css = await readFile(path.resolve("src/scss/layout.css"), "utf8");
  assert.match(css, /\.input-wrap\s*\{[\s\S]*?padding-bottom:\s*max\b/);
  assert.match(css, /padding-bottom:\s*max\([^;]*--app-bottom-live-pad/);
  assert.doesNotMatch(css, /\.input-wrap\s*\{[\s\S]*?padding-bottom:\s*max\([^;]*--app-bottom-inset/);
});

test("mobile safe-area: one bottom inset owns safe-area and PWA gap", async () => {
  const css = await readFile(path.resolve("src/scss/base.css"), "utf8");
  const responsiveCss = await readFile(path.resolve("src/scss/responsive.css"), "utf8");
  assert.match(css, /--safe-bottom-pad:\s*clamp\(\s*0px\s*,\s*env\(safe-area-inset-bottom\)\s*,\s*44px\s*\)\s*;/);
  assert.match(css, /--app-layout-gap-bottom:\s*var\(--app-gap-bottom\)\s*;/);
  assert.match(css, /--app-shell-bottom-spill:\s*0px\s*;/);
  assert.match(css, /--app-bottom-inset:\s*max\(var\(--safe-bottom-pad\),\s*var\(--app-layout-gap-bottom,\s*var\(--app-gap-bottom,\s*0px\)\)\)\s*;/);
  assert.match(css, /--app-bottom-live-pad:\s*clamp\(8px,\s*calc\(var\(--app-bottom-inset\)\s*-\s*22px\),\s*16px\)\s*;/);
  assert.match(css, /--app-frame-bottom-inset:\s*0px\s*;/);
  assert.match(css, /--safe-bottom-layout-pad:\s*var\(--app-bottom-live-pad\)\s*;/);
  assert.match(css, /--app-frame-bg:\s*var\(--app-bg\)\s*;/);
  assert.match(css, /--app-host-canvas-bg:\s*var\(--safe-area-bg,\s*var\(--app-frame-bg,\s*var\(--app-bg\)\)\)\s*;/);
  assert.match(css, /background-color:\s*var\(--app-host-canvas-bg,\s*var\(--safe-area-bg,\s*var\(--app-frame-bg,\s*#eaf5f0\)\)\)\s*;/);
  assert.match(css, /html\.app-frame-booting,\s*html\.app-frame-booting body\s*\{[\s\S]*?--app-host-canvas-bg:\s*#eaf5f0;/);
  assert.match(css, /#app\.app-frame::after\s*\{[\s\S]*?background:\s*var\(--app-frame-safe-bg,/);
  assert.match(css, /#app\.app-frame::after\s*\{[\s\S]*?height:\s*var\(--app-frame-bottom-inset\)/);
  assert.match(responsiveCss, /html,\s*body\s*\{[\s\S]*?--safe-area-bg:\s*var\(--composer-bg\);[\s\S]*?--app-host-canvas-bg:\s*var\(--safe-area-bg\);/);
  assert.match(responsiveCss, /html\.sidebar-mobile-open,\s*html\.sidebar-mobile-open body\s*\{[\s\S]*?--safe-area-bg:\s*var\(--sidebar-bg\);/);
  assert.doesNotMatch(css, /--safe-bottom-layout-pad:\s*max\(0px,\s*calc\(var\(--safe-bottom-pad\)\s*-\s*var\(--app-gap-bottom/);
});

test("mobile safe-area: diagnostic markers are debug-gated and expose every bottom layer", async () => {
  const baseCss = await readFile(path.resolve("src/scss/base.css"), "utf8");
  const responsiveCss = await readFile(path.resolve("src/scss/responsive.css"), "utf8");
  const authCss = await readFile(path.resolve("src/scss/modal.part01-auth.css"), "utf8");
  assert.match(baseCss, /data-viewport-diagnostic="1"/);
  assert.match(authCss, /body\[data-viewport-diagnostic="1"\][\s\S]*AUTH-SCROLL-END/);
  assert.match(responsiveCss, /body\[data-viewport-diagnostic="1"\]\s+\.sidebar-body::after[\s\S]*SIDEBAR-SCROLL-END/);
  assert.match(responsiveCss, /body\[data-viewport-diagnostic="1"\]\s+\.input-wrap::after[\s\S]*CHAT-COMPOSER-BOTTOM/);
  assert.match(baseCss, /PHYSICAL-BOTTOM/);
  assert.match(baseCss, /APP-FRAME-BOTTOM/);
  assert.match(authCss, /AUTH-SCROLL-END/);
  assert.match(responsiveCss, /SIDEBAR-SCROLL-END/);
  assert.match(responsiveCss, /CHAT-COMPOSER-BOTTOM/);
});

test("mobile safe-area: pages have bottom padding for home indicator", async () => {
  const css = await readFile(path.resolve("src/scss/responsive.css"), "utf8");
  assert.match(css, /\.page\s*\{[\s\S]*?padding-bottom:\s*calc\(\s*var\(--sp-4\)\s*\+\s*var\(--safe-bottom-layout-pad\)\s*\)\s*;/);
});

test("mobile safe-area: iOS standalone physical bottom stays inside fixed app frame", async () => {
  const css = await readFile(path.resolve("src/scss/responsive.css"), "utf8");
  assert.match(css, /html\.app-shell-physical-bottom:not\(\.kbd-open\):not\(\.has-auth-pages\)\s+#app\s*\{[\s\S]*?bottom:\s*auto;/);
  assert.match(
    css,
    /html\.app-shell-physical-bottom:not\(\.kbd-open\):not\(\.has-auth-pages\)\s+#app\s*\{[\s\S]*?height:\s*var\(--app-frame-vh,\s*var\(--app-vh\)\);/
  );
  assert.match(
    css,
    /html\.app-shell-physical-bottom:not\(\.kbd-open\):not\(\.has-auth-pages\)\s+#app\s*\{[\s\S]*?max-height:\s*var\(--app-frame-vh,\s*var\(--app-vh\)\);/
  );
  assert.doesNotMatch(css, /bottom:\s*calc\(-1 \* var\(--app-shell-bottom-spill/);
});

test("mobile safe-area: default skin preserves the shared iOS composer inset", async () => {
  const skinCss = await readFile(path.resolve("public/skins/yagodka-modern.css"), "utf8");
  assert.match(
    skinCss,
    /html\.is-ios\[data-skin="yagodka-modern"\]\s+\.input-wrap\s*\{[\s\S]*?padding-bottom:\s*var\(--composer-bottom-edge-pad,\s*max\(var\(--composer-pad-y\),\s*var\(--app-bottom-live-pad,\s*var\(--app-bottom-inset\)\)\)\)\s*;/
  );
  assert.doesNotMatch(skinCss, /html\.is-ios\[data-skin="yagodka-modern"\]\s+\.input-wrap\s*\{[\s\S]*env\(safe-area-inset-bottom\)/);
});
