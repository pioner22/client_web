import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("desktop messenger UX: base chat jump uses runtime bottom inset with desktop fallback", async () => {
  const css = await readFile(path.resolve("src/scss/components.part02.css"), "utf8");
  assert.match(
    css,
    /\.chat-jump\s*\{[\s\S]*?bottom:\s*calc\(var\(--chat-bottom-inset,\s*var\(--chat-input-size\)\)\s*\+\s*var\(--mobile-composer-bottom-offset,\s*0px\)\s*\+\s*var\(--chat-history-bottom-gap,\s*0px\)\s*\+\s*var\(--safe-bottom-layout-pad\)\s*\+\s*10px\)\s*;/
  );
});

test("desktop messenger UX: no-chat state has a composed desktop surface", async () => {
  const renderChatSrc = await readFile(path.resolve("src/components/chat/renderChat.ts"), "utf8");
  const css = await readFile(path.resolve("src/scss/components.part02.css"), "utf8");
  assert.match(renderChatSrc, /class:\s*"chat-empty-state"/);
  assert.match(renderChatSrc, /aria-label":\s*"Чат не выбран"/);
  assert.match(renderChatSrc, /Выберите диалог слева\. Здесь появится переписка\./);
  assert.match(css, /\.chat-empty-state\s*\{[\s\S]*?border-radius:\s*8px\s*;/);
});
