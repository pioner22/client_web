import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

test("android capacitor package scripts and dependencies are wired", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.match(pkg.dependencies["@capacitor/core"], /^\^8\./);
  assert.match(pkg.dependencies["@capacitor/android"], /^\^8\./);
  assert.match(pkg.devDependencies["@capacitor/cli"], /^\^8\./);
  assert.equal(pkg.scripts["android:sync"], "npm run build && cap sync android");
  assert.equal(pkg.scripts["android:open"], "npm run android:sync && cap open android");
  assert.equal(pkg.scripts["android:build:debug"], "npm run android:sync && cd android && ./gradlew assembleDebug");
});

test("android capacitor config targets local web build with secure scheme", () => {
  const config = read("capacitor.config.ts");
  assert.match(config, /appId:\s*"org\.yagodka\.app"/);
  assert.match(config, /appName:\s*"Yagodka"/);
  assert.match(config, /webDir:\s*"dist"/);
  assert.match(config, /androidScheme:\s*"https"/);
  assert.match(config, /cleartext:\s*false/);
});

test("android native project has required app files and permissions", () => {
  for (const rel of [
    "android/gradlew",
    "android/settings.gradle",
    "android/build.gradle",
    "android/app/build.gradle",
    "android/app/src/main/java/org/yagodka/app/MainActivity.java",
  ]) {
    assert.ok(fs.existsSync(path.join(root, rel)), `${rel} should exist`);
  }

  const manifest = read("android/app/src/main/AndroidManifest.xml");
  const launcherBackground = read("android/app/src/main/res/values/ic_launcher_background.xml");
  const mainActivity = read("android/app/src/main/java/org/yagodka/app/MainActivity.java");
  const styles = read("android/app/src/main/res/values/styles.xml");
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(manifest, /android:windowSoftInputMode="adjustResize"/);
  assert.match(manifest, /android\.permission\.INTERNET/);
  assert.match(manifest, /android\.permission\.CAMERA/);
  assert.match(manifest, /android\.permission\.RECORD_AUDIO/);
  assert.match(manifest, /android\.permission\.MODIFY_AUDIO_SETTINGS/);
  assert.match(launcherBackground, /#090D13/);
  assert.match(mainActivity, /setDownloadListener/);
  assert.match(mainActivity, /Intent\.ACTION_VIEW/);
  assert.match(mainActivity, /url\.startsWith\("blob:"\)/);
  assert.match(mainActivity, /url\.startsWith\("data:"\)/);
  assert.match(mainActivity, /setStatusBarColor/);
  assert.match(mainActivity, /setNavigationBarColor/);
  assert.match(styles, /android:statusBarColor">#090D13/);
  assert.match(styles, /android:navigationBarColor">#0C121A/);
});

test("android runtime config uses production endpoints and disables PWA service worker", () => {
  const env = read("src/config/env.ts");
  const runtime = read("src/helpers/runtime/nativeRuntime.ts");
  const swRuntime = read("src/helpers/pwa/serviceWorkerRuntime.ts");
  const clientTags = read("src/helpers/device/clientTags.ts");
  const viteConfig = read("vite.config.ts");

  assert.match(env, /DEFAULT_NATIVE_GATEWAY_URL\s*=\s*"wss:\/\/yagodka\.org\/ws"/);
  assert.match(env, /DEFAULT_NATIVE_PUBLIC_BASE_URL\s*=\s*"https:\/\/yagodka\.org\/"/);
  assert.match(env, /DEFAULT_NATIVE_MEET_BASE_URL\s*=\s*"https:\/\/meet\.yagodka\.org"/);
  assert.match(runtime, /isCapacitorNativeRuntime/);
  assert.match(swRuntime, /isCapacitorNativeRuntime\(\)\) return false/);
  assert.match(clientTags, /client_surface/);
  assert.match(clientTags, /native_platform/);
  assert.match(viteConfig, /src\/helpers\/runtime\/nativeRuntime\.ts/);
  assert.match(viteConfig, /return "boot-config"/);
});

test("android update prompt opens current APK download instead of reloading bundled assets", () => {
  const modal = read("src/components/modals/renderUpdateModal.ts");
  const actions = read("src/app/features/auth/authUiActionsFeature.ts");
  const appConfig = read("src/config/app.ts");
  const gradle = read("android/app/build.gradle");
  const viteConfig = read("vite.config.ts");

  assert.match(modal, /getCapacitorPlatform/);
  assert.match(modal, /getCurrentAndroidAppVersionInfo/);
  assert.match(modal, /Обновить приложение/);
  assert.match(modal, /Вышло новое обновление, и приложение нужно обновить/);
  assert.match(modal, /Автоустановка без подтверждения пользователя недоступна для sideload APK/);
  assert.match(actions, /downloads\/android\/yagodka-android-debug\.apk/);
  assert.match(actions, /window\.open\(url,\s*"_system"/);
  assert.match(actions, /forceUpdateReload\("update_required"\)/);
  assert.match(appConfig, /ANDROID_APP_VERSION_NAME/);
  assert.match(appConfig, /ANDROID_APP_VERSION_CODE/);
  assert.match(viteConfig, /loadAndroidAppVersionMeta/);
  assert.match(viteConfig, /__ANDROID_APP_VERSION_NAME__/);
  assert.match(viteConfig, /__ANDROID_APP_VERSION_CODE__/);
  const versionCodeMatch = gradle.match(/versionCode\s+(\d+)/);
  const versionNameMatch = gradle.match(/versionName\s+"(\d+\.\d+\.\d+)"/);
  assert.ok(versionCodeMatch, "android versionCode should be declared");
  assert.ok(versionNameMatch, "android versionName should be declared");
  assert.ok(Number(versionCodeMatch[1]) > 0, "android versionCode should be positive");
  assert.equal(Number(versionCodeMatch[1]), Number(versionNameMatch[1].split(".").at(-1)) + 1);
});
