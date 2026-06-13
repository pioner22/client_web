import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { readCssWithImports } from "./helpers/readCssWithImports.mjs";

test("pwa update modal has a dedicated mobile-safe update overlay", async () => {
  const modalSrc = await readFile(path.resolve("src/components/modals/renderPwaUpdateModal.ts"), "utf8");
  const surfaceSrc = await readFile(path.resolve("src/app/features/navigation/modalSurface.ts"), "utf8");
  const css = await readCssWithImports("src/scss/modal.css");

  assert.match(modalSrc, /modal-pwa-update/);
  assert.match(modalSrc, /Доступно обновление/);
  assert.match(modalSrc, /подготовит обновлённые файлы/);
  assert.match(surfaceSrc, /overlay-update/);
  assert.match(css, /\.overlay\.overlay-update/);
  assert.match(css, /\.modal\.modal-pwa-update/);
  assert.match(css, /env\(safe-area-inset-top\)/);
  assert.match(css, /var\(--safe-bottom-pad\)/);
  assert.match(css, /\.modal-pwa-update \.pwa-update-actions \.btn/);
});

test("system messages use a separate compact translucent layer", async () => {
  const css = await readCssWithImports("src/scss/components.css");

  assert.match(css, /\.chat:not\(\.chat-board\) \.msg-sys:not\(\[data-msg-attach="action"\]\) \.msg-body/);
  assert.match(css, /backdrop-filter:\s*blur\(10px\) saturate\(130%\);/);
  assert.match(css, /\.chat:not\(\.chat-board\) \.msg-sys:not\(\[data-msg-attach="action"\]\) \.msg-text/);
});
