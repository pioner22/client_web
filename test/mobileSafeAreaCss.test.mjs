import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("mobile safe-area: mobile fullscreen overrides win against skins", async () => {
  const css = await readFile(path.resolve("src/scss/responsive.css"), "utf8");
  assert.match(css, /@media\s*\(max-width:\s*820px\)\s*\{/);
  assert.match(css, /#app\s*\{[\s\S]*?--app-outer-pad:\s*0px;/);
  assert.match(css, /#app\s*\{[\s\S]*?position:\s*fixed;/);
  assert.match(css, /#app\s*\{[\s\S]*?top:\s*var\(--app-vv-top,\s*0px\)\s*;/);
  assert.match(css, /#app\s*\{[\s\S]*?height:\s*var\(--app-vh\)\s*;/);
  assert.match(css, /#app\s*>\s*\.app\s*\{[\s\S]*?--app-row-footer:\s*0px;/);
});

test("mobile safe-area: composer bottom padding avoids extra gap", async () => {
  const css = await readFile(path.resolve("src/scss/layout.css"), "utf8");
  assert.match(css, /\.input-wrap\s*\{[\s\S]*?padding-bottom:\s*max\b/);
});
