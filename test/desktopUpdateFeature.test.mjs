import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(".");

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

test("desktop updater is wired into renderer status/actions and preserves state before install", () => {
  const feature = read("src/app/features/desktop/desktopUpdateFeature.ts");
  const lateWiring = read("src/app/bootstrap/installLateWiring.ts");
  const helpPage = read("src/pages/help/createHelpPage.ts");
  const envTypes = read("src/env.d.ts");

  assert.match(feature, /desktopUpdatesBridge/);
  assert.match(feature, /desktop-update-check/);
  assert.match(feature, /desktop-update-download/);
  assert.match(feature, /desktop-update-install/);
  assert.match(feature, /flushBeforeInstall/);
  assert.match(feature, /Desktop обновление v/);
  assert.match(feature, /Скачиваем desktop обновление/);

  assert.match(lateWiring, /createDesktopUpdateFeature/);
  assert.match(lateWiring, /flushRuntimeDelivery\(store\)/);
  assert.match(lateWiring, /restartStateFeature\.save\(store\.get\(\)\)/);
  assert.match(lateWiring, /desktopUpdateFeature\.bind\(\)/);
  assert.match(lateWiring, /desktopUpdateFeature\.start\(\)/);

  assert.match(helpPage, /hasDesktopUpdateBridge/);
  assert.match(helpPage, /data-action": "desktop-update-check"/);
  assert.match(helpPage, /Проверить обновления/);

  assert.match(envTypes, /updates\?:/);
  assert.match(envTypes, /onStatus\?:/);
});
