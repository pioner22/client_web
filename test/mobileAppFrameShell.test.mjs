import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("mobile app frame: boot/auth/main share one root frame state", async () => {
  const html = await readFile(path.resolve("index.html"), "utf8");
  const createLayout = await readFile(path.resolve("src/components/layout/createLayout.ts"), "utf8");
  const renderApp = await readFile(path.resolve("src/app/renderApp.ts"), "utf8");
  const lateWiring = await readFile(path.resolve("src/app/bootstrap/installLateWiring.ts"), "utf8");
  const baseCss = await readFile(path.resolve("src/scss/base.css"), "utf8");

  assert.match(html, /<html lang="ru" class="app-frame-booting">/);
  assert.match(html, /id="app" class="app-frame app-frame-booting"/);
  assert.match(createLayout, /root\.classList\.add\("app-frame"\)/);
  assert.match(createLayout, /root,/);
  assert.match(renderApp, /layout\.root\?\.classList\.toggle\("app-frame-auth",\s*fullScreenActive\)/);
  assert.match(renderApp, /layout\.root\?\.classList\.toggle\("app-frame-main",\s*!fullScreenActive\)/);
  assert.match(lateWiring, /root\.classList\.remove\("app-frame-booting"\)/);
  assert.match(lateWiring, /document\.documentElement\.classList\.remove\("app-frame-booting"\)/);
  assert.doesNotMatch(baseCss, /#app\.app-frame\s*>\s*\.boot\s*{[^}]*position:\s*relative;/s);
  assert.match(baseCss, /#app\.app-frame\s*>\s*\.boot\s*{[^}]*z-index:\s*3;/s);
});

test("mobile app frame: auth stays inside fixed shell instead of owning viewport", async () => {
  const css = await readFile(path.resolve("src/scss/modal.part01-auth.css"), "utf8");

  assert.doesNotMatch(css, /html\.is-ios\.has-auth-pages\s*{[^}]*position:\s*static;/s);
  assert.doesNotMatch(css, /html\.has-auth-pages\s+#app\s*{[^}]*height:\s*auto;[^}]*overflow:\s*visible;/s);
  assert.doesNotMatch(css, /\.overlay\.overlay-auth\s*{[^}]*position:\s*fixed;/s);
  assert.match(css, /html\.is-ios\.has-auth-pages\s*{[^}]*position:\s*fixed;[^}]*inset:\s*0;/s);
  assert.match(css, /html\.has-auth-pages\s+#app\s*{[^}]*height:\s*var\(--auth-viewport-min\);[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.overlay\.overlay-auth\s*{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*overflow:\s*hidden;/s);
  assert.match(css, /#auth-pages\.auth-entry-page\s+>\s+\.auth-entry-scroll\s*{[^}]*height:\s*100%;[^}]*overflow-y:\s*hidden;/s);
});

test("mobile app frame: contact list owns the full mobile frame without a footer row slide", async () => {
  const css = await readFile(path.resolve("src/scss/responsive.css"), "utf8");

  assert.match(css, /html\s+#app\s*>\s*\.app\s*\{[\s\S]*?--app-row-footer:\s*0px;/);
  assert.match(css, /:root\[data-skin\]\s*\{[\s\S]*?--app-row-footer:\s*0px;/);
  assert.match(
    css,
    /html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\)\s+#app\s*\{[\s\S]*?height:\s*var\(--app-logged-frame-vh\);/
  );
  assert.match(
    css,
    /html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\)\s+#app\s*>\s*\.app\s*\{[\s\S]*?height:\s*var\(--app-logged-frame-vh\);/
  );
  assert.match(css, /--app-logged-frame-vh:\s*max\([^}]*100dvh[^}]*calc\(var\(--app-vh\)\s*\+\s*var\(--app-physical-bottom-pad\)\)/);
  assert.match(css, /html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\):has\(\.sidebar\.sidebar-mobile-open\)/);
  assert.match(
    css,
    /\.sidebar\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-rows:\s*auto minmax\(0,\s*1fr\);[\s\S]*?width:\s*100vw;[\s\S]*?transform:\s*none;[\s\S]*?visibility:\s*hidden;/
  );
  assert.match(
    css,
    /\.sidebar\.sidebar-mobile-open\s*\{[\s\S]*?transform:\s*none;[\s\S]*?visibility:\s*visible;[\s\S]*?pointer-events:\s*auto;/
  );
  assert.match(css, /\.sidebar-body\s*\{[\s\S]*?height:\s*100%;[\s\S]*?overscroll-behavior:\s*contain;/);
  assert.match(
    css,
    /html\.is-ios:not\(\.kbd-open\):not\(\.has-auth-pages\)\s+\.sidebar-body\s*\{[\s\S]*?padding-bottom:\s*max\(var\(--sp-4\),\s*var\(--app-bottom-live-pad\)\);/
  );
  assert.match(css, /\.footer\s*\{[\s\S]*?display:\s*none\s*!important;[\s\S]*?min-height:\s*0;/);
});
