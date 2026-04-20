import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("mobile history/composer runtime: bottom breathing room keeps the last messages off the overlay composer", async () => {
  const css = await readFile(path.resolve("src/scss/responsive.css"), "utf8");
  assert.match(css, /\.chat-col\s*\{[\s\S]*?--chat-history-bottom-gap:\s*max\(8px,\s*var\(--sp-2\)\)\s*;/);
  assert.match(
    css,
    /\.chat-host\s*\{[\s\S]*?padding-bottom:\s*calc\(var\(--chat-bottom-inset,\s*0px\)\s*\+\s*var\(--chat-history-bottom-gap,\s*0px\)\)\s*;/
  );
  assert.match(
    css,
    /\.chat-host\s*\{[\s\S]*?scroll-padding-bottom:\s*calc\(var\(--chat-bottom-inset,\s*0px\)\s*\+\s*var\(--chat-history-bottom-gap,\s*0px\)\)\s*;/
  );
});

test("mobile history/composer runtime: jump button and keyboard state reuse the same bottom gap contract", async () => {
  const css = await readFile(path.resolve("src/scss/responsive.css"), "utf8");
  assert.match(
    css,
    /\.chat-jump\s*\{[\s\S]*?bottom:\s*calc\(var\(--chat-bottom-inset,\s*0px\)\s*\+\s*var\(--chat-history-bottom-gap,\s*0px\)\s*\+\s*10px\)\s*;/
  );
  assert.match(css, /\.kbd-open\s+\.chat-col\s*\{[\s\S]*?--chat-history-bottom-gap:\s*6px\s*;/);
});
