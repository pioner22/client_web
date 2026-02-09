import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { readCssWithImports } from "./helpers/readCssWithImports.mjs";

test("calls: header buttons have call actions", async () => {
  const src = await readFile(path.resolve("src/components/header/renderHeader.ts"), "utf8");
  assert.match(src, /call-start-audio/);
  assert.match(src, /call-start-video/);
});

test("calls: modal renderer supports kind=call", async () => {
  const src = await readFile(path.resolve("src/app/renderApp.ts"), "utf8");
  assert.match(src, /createCallModal/);
  assert.match(src, /state\.modal\?\.kind\s*===\s*["']call["']/);
});

test("calls: CSS contains modal-call layout", async () => {
  const css = await readCssWithImports("src/scss/modal.css");
  assert.match(css, /\.modal\.modal-call/);
  assert.match(css, /\.call-frame/);
});
