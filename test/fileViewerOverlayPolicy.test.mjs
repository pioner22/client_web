import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("file viewer: использует overlay fullscreen (а не inline modal)", async () => {
  const src = await readFile(path.resolve("src/app/renderApp.ts"), "utf8");
  assert.match(src, /state\.modal\?\.kind\s*===\s*["']file_viewer["']/);
  assert.match(src, /overlay-viewer/);
  assert.match(src, /inlineModal[\s\S]*?kind\s*!==\s*["']file_viewer["']/);
});

test("file viewer: есть CSS для overlay-viewer + fullscreen layout", async () => {
  const css = await readFile(path.resolve("src/scss/modal.css"), "utf8");
  assert.match(css, /\.overlay\.overlay-viewer\s*\{/);
  assert.match(css, /\.overlay\.overlay-viewer\s+\.modal\.modal-viewer\s*\{/);
});

