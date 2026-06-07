import test from "node:test";
import assert from "node:assert/strict";
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
