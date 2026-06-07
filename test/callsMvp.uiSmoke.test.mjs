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
  assert.match(src, /createLazyCallModalRuntime/);
  assert.match(src, /state\.modal\?\.kind\s*===\s*["']call["']/);
});

test("calls: CSS contains modal-call layout", async () => {
  const css = await readCssWithImports("src/scss/modal.css");
  assert.match(css, /\.modal\.modal-call/);
  assert.match(css, /\.call-frame/);
  assert.match(css, /\.call-permission/);
  assert.match(css, /\.call-device/);
});

test("calls: outgoing ringing shows Jitsi surface without waiting active", async () => {
  const src = await readFile(path.resolve("src/components/modals/call/createCallModal.ts"), "utf8");
  assert.match(src, /const shouldShowMeeting = Boolean\(joinUrl\) && \(phase === "active" \|\| \(!incoming && phase === "ringing"\)\);/);
});

test("calls: call_invite is not blocked by toast dedupe", async () => {
  const src = await readFile(path.resolve("src/app/features/calls/callsFeature.ts"), "utf8");
  assert.ok(!/if \(!showToastHere\) return true;/.test(src));
});

test("calls: media permission gate asks from the call modal", async () => {
  const src = await readFile(path.resolve("src/app/features/calls/callsFeature.ts"), "utf8");
  const modalSrc = await readFile(path.resolve("src/components/modals/call/createCallModal.ts"), "utf8");
  const renderSrc = await readFile(path.resolve("src/app/renderApp.ts"), "utf8");
  assert.doesNotMatch(src, /placement:\s*"center"/);
  assert.match(src, /phase:\s*"permission"/);
  assert.match(src, /permissionToken/);
  assert.match(src, /requestMediaAccess/);
  assert.match(src, /navigator\.mediaDevices\.getUserMedia\(buildCallMediaConstraints\(mode\)\)/);
  assert.match(src, /requestDesktopCapturePermissions/);
  assert.match(src, /разрешение закреплено за Safari\/Chrome/);
  assert.match(src, /Инструкция iPhone/);
  assert.match(src, /настройки сайта или браузера/);
  assert.match(src, /queryCapturePermissionState/);
  assert.match(modalSrc, /call-permission/);
  assert.match(modalSrc, /settingsLabel/);
  assert.match(modalSrc, /onRequestMediaAccess/);
  assert.match(modalSrc, /onOpenMediaSettings/);
  assert.match(renderSrc, /onCallRequestMediaAccess/);
  assert.match(renderSrc, /onCallOpenMediaSettings/);
});

test("calls: client sends call_invite_ack and dedupes same call invite", async () => {
  const src = await readFile(path.resolve("src/app/features/calls/callsFeature.ts"), "utf8");
  assert.match(src, /call_invite_ack/);
  assert.match(src, /currentCallId === callId/);
});

test("calls: popup-blocked mobile accept does not report false success", async () => {
  const src = await readFile(path.resolve("src/app/features/calls/callsFeature.ts"), "utf8");
  assert.match(src, /const opened = window\.open\(u, "_blank", "noopener,noreferrer"\);/);
  assert.match(src, /return Boolean\(opened\);/);
  assert.match(src, /Браузер заблокировал новую вкладку/);
});

test("calls: jitsi external API uses configured meet host", async () => {
  const src = await readFile(path.resolve("src/helpers/calls/jitsiExternalApi.ts"), "utf8");
  assert.ok(!/meet\.jit\.si/.test(src));
  assert.match(src, /return host;/);
});

test("calls: modal wires Jitsi quality telemetry", async () => {
  const modalSrc = await readFile(path.resolve("src/components/modals/call/createCallModal.ts"), "utf8");
  const telemetrySrc = await readFile(path.resolve("src/helpers/calls/callQualityTelemetry.ts"), "utf8");
  const css = await readCssWithImports("src/scss/modal.css");
  assert.match(modalSrc, /watchJitsiQuality/);
  assert.match(modalSrc, /call-quality/);
  assert.match(telemetrySrc, /videoQualityChanged/);
  assert.match(telemetrySrc, /p2pStatusChanged/);
  assert.match(telemetrySrc, /peerConnectionFailure/);
  assert.match(telemetrySrc, /getRoomsInfo/);
  assert.match(css, /\.call-quality/);
});

test("calls: modal wires Jitsi media policy", async () => {
  const modalSrc = await readFile(path.resolve("src/components/modals/call/createCallModal.ts"), "utf8");
  const policySrc = await readFile(path.resolve("src/helpers/calls/jitsiMediaPolicy.ts"), "utf8");
  assert.match(modalSrc, /buildJitsiMediaPolicy\(mode\)/);
  assert.match(policySrc, /maxBitratesVideo/);
  assert.match(policySrc, /enableLayerSuspension/);
  assert.match(policySrc, /saveData/);
});
