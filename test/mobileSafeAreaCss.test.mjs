import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("mobile safe-area: mobile fullscreen overrides win against skins", async () => {
  const css = await readFile(path.resolve("src/scss/responsive.css"), "utf8");
  assert.match(css, /@media\s*\(max-width:\s*820px\)\s*\{/);
  assert.match(css, /#app\s*\{[\s\S]*?--app-outer-pad:\s*0px;/);
  assert.match(css, /#app\s*\{[\s\S]*?position:\s*fixed;/);
  assert.match(css, /#app\s*\{[\s\S]*?inset:\s*0\s*;/);
  assert.match(css, /app-vv-offset\s+#app\s*\{[\s\S]*?top:\s*var\(--app-vv-top,\s*0px\)\s*;/);
  assert.match(css, /app-vv-offset\s+#app\s*\{[\s\S]*?bottom:\s*var\(--app-vv-bottom,\s*0px\)\s*;/);
  assert.match(css, /#app\s*>\s*\.app\s*\{[\s\S]*?--app-row-footer:\s*0px;/);
});

test("mobile safe-area: composer bottom padding avoids extra gap", async () => {
  const css = await readFile(path.resolve("src/scss/layout.css"), "utf8");
  assert.match(css, /\.input-wrap\s*\{[\s\S]*?padding-bottom:\s*max\b/);
  assert.match(css, /padding-bottom:\s*max\([^;]*--safe-bottom-layout-pad/);
});

test("mobile safe-area: safe-bottom-pad clamp covers iPhone inset", async () => {
  const css = await readFile(path.resolve("src/scss/base.css"), "utf8");
  assert.match(css, /--safe-bottom-pad:\s*clamp\(\s*0px\s*,\s*env\(safe-area-inset-bottom\)\s*,\s*44px\s*\)\s*;/);
});

test("mobile safe-area: pages have bottom padding for home indicator", async () => {
  const css = await readFile(path.resolve("src/scss/responsive.css"), "utf8");
  assert.match(css, /\.page\s*\{[\s\S]*?padding-bottom:\s*calc\(\s*var\(--sp-4\)\s*\+\s*var\(--safe-bottom-layout-pad\)\s*\)\s*;/);
});
