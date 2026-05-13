import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("service worker runtime is disabled for Electron/native/file builds", () => {
  const runtime = fs.readFileSync(path.join(root, "src/helpers/pwa/serviceWorkerRuntime.ts"), "utf8");
  const register = fs.readFileSync(path.join(root, "src/helpers/pwa/registerServiceWorker.ts"), "utf8");
  assert.match(runtime, /yagodkaDesktop/);
  assert.match(runtime, /isCapacitorNativeRuntime/);
  assert.ok(runtime.includes('protocol === "http:" || protocol === "https:"'));
  assert.ok(runtime.includes("navigator.serviceWorker.getRegistrations()"));
  assert.ok(register.includes("unregisterServiceWorkersForUnsupportedRuntime"));
});
