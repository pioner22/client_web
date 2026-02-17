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

test("calls: outgoing ringing shows Jitsi surface without waiting active", async () => {
  const src = await readFile(path.resolve("src/components/modals/call/createCallModal.ts"), "utf8");
  assert.match(src, /const shouldShowMeeting = Boolean\(joinUrl\) && \(phase === "active" \|\| \(!incoming && phase === "ringing"\)\);/);
});

test("calls: call_invite is not blocked by toast dedupe", async () => {
  const src = await readFile(path.resolve("src/app/features/calls/callsFeature.ts"), "utf8");
  assert.ok(!/if \(!showToastHere\) return true;/.test(src));
});

test("calls: client sends call_invite_ack and dedupes same call invite", async () => {
  const src = await readFile(path.resolve("src/app/features/calls/callsFeature.ts"), "utf8");
  assert.match(src, /call_invite_ack/);
  assert.match(src, /currentCallId === callId/);
});

test("calls: jitsi external API uses configured meet host", async () => {
  const src = await readFile(path.resolve("src/helpers/calls/jitsiExternalApi.ts"), "utf8");
  assert.ok(!/meet\.jit\.si/.test(src));
  assert.match(src, /return host;/);
});
