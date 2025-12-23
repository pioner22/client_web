import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("mobile composer: Telegram-like бар (blur) и более плотный input", async () => {
  const css = await readFile(path.resolve("src/scss/responsive.css"), "utf8");
  assert.match(css, /@media\s*\(max-width:\s*820px\)\s+and\s+\(pointer:\s*coarse\)\s*\{/);
  assert.match(css, /--composer-input-font-weight:\s*500\s*;/);
  assert.match(css, /\.input-wrap\s*\{[\s\S]*?backdrop-filter:\s*blur\(10px\)\s*;/);
  assert.match(css, /\.composer-field\s*\.input\s*\{[\s\S]*?padding:\s*6px\s+0\s*;/);
});

