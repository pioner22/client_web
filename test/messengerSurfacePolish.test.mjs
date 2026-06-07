import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readCssWithImports } from "./helpers/readCssWithImports.mjs";

test("messenger surface polish: history, dialogs and profile share W-0975 layer", async () => {
  const css = await readCssWithImports("src/scss/style.css");

  assert.match(css, /W-0975:\s*messenger surface polish/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s*\{[\s\S]*?--msg-in-radius:\s*18px/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.msg-context-active\s+\.msg-body/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.msg-unread\s+\.msg-sep-pill/);
  assert.match(css, /\.sidebar\s+\.row-tail-top,\s*[\s\S]*?\.sidebar\s+\.row-tail-bottom/);
  assert.match(css, /\.page\.page-profile,\s*[\s\S]*?\.page\.page-user,\s*[\s\S]*?\.page\.page-room/);
  assert.match(css, /\.profile-session-card,\s*[\s\S]*?\.member-row/);
});

test("messenger surface polish: media cards keep explicit mobile constraints", async () => {
  const css = await readCssWithImports("src/scss/style.css");

  assert.match(css, /W-0975:\s*richer, readable media cards/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.msg-attach\[data-msg-file="image"\]\s+\.chat-file-preview/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.chat-media-overlay-controls/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.msg-attach\[data-msg-footer="overlay"\]\s+\.msg-meta/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.file-progress-candy/);
  assert.match(css, /@media\s*\(max-width:\s*600px\)\s*\{[\s\S]*?--chat-media-frame-width:\s*min\(82%,\s*var\(--chat-media-frame-max\),\s*var\(--msg-body-max-width\)\)/);
});

test("messenger surface polish: W-0976 keeps media stable on mobile", async () => {
  const css = await readCssWithImports("src/scss/style.css");

  assert.match(css, /W-0976:\s*media stability repair/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.chat-media-progress\s*\{[\s\S]*?inset:\s*50%\s*auto\s*auto\s*50%;[\s\S]*?transform:\s*translate\(-50%,\s*-50%\)/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.chat-file-preview\s+\.chat-media-state-active\s*\{[\s\S]*?display:\s*none/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.chat-file-preview\.chat-file-preview-video-note\s*\{[\s\S]*?border-radius:\s*999px;[\s\S]*?clip-path:\s*none/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.msg-attach\s+\.file-row-chat\.file-row-audio[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none/);
  assert.match(css, /W-0976:\s*visual stability repair/);
  assert.match(css, /\.chat:not\(\.chat-board\)\s+\.msg:not\(\.msg-sys\)\s+\.msg-body\s*\{[\s\S]*?background-color\s+120ms\s+ease/);
});

test("messenger surface polish: W-0977 shrink-wraps desktop captioned media", async () => {
  const css = await readCssWithImports("src/scss/style.css");
  const previewShared = await readFile(new URL("../src/components/chat/chatVisualPreviewShared.ts", import.meta.url), "utf8");

  assert.match(css, /W-0977:\s*desktop\/Web captioned media must shrink-wrap the preview/);
  assert.match(
    css,
    /\.chat:not\(\.chat-board\)\s+\.msg-attach\[data-msg-footer="stacked"\]:not\(\[data-msg-album="1"\]\)\[data-msg-file="image"\]\s+\.msg-body,[\s\S]*?\.msg-attach\[data-msg-footer="stacked"\]:not\(\[data-msg-album="1"\]\)\[data-msg-file="video"\]\s+\.msg-body\s*\{[\s\S]*?width:\s*fit-content;[\s\S]*?align-items:\s*stretch/
  );
  assert.match(css, /@media\s*\(min-width:\s*901px\)\s*\{[\s\S]*?min-width:\s*min\(260px,\s*var\(--chat-media-frame-width\)\)/);
  assert.match(previewShared, /export const CHAT_MEDIA_PREVIEW_SCALE = 0\.5;/);
  assert.match(previewShared, /const w = info\.mediaW \|\| info\.thumbW \|\| CHAT_MEDIA_PREVIEW_FALLBACK_BASE_PX;/);
});
