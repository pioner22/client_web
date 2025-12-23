import "./scss/style.css";
import { registerServiceWorker } from "./helpers/pwa/registerServiceWorker";
import { applySkin, getStoredSkinId } from "./helpers/skin/skin";
import { installAppViewportHeightVar } from "./helpers/ui/appViewport";
import { isIOS, isStandaloneDisplayMode } from "./helpers/ui/iosInputAssistant";
import { installFancyCaret } from "./helpers/ui/fancyCaret";
import { mountApp } from "./app/mountApp";

const root = document.getElementById("app");
if (!root) {
  throw new Error("Missing #app");
}

applySkin(getStoredSkinId());
try {
  const html = document.documentElement;
  if (isIOS()) html.classList.add("is-ios");
  if (isStandaloneDisplayMode()) html.classList.add("is-standalone");
} catch {
  // ignore
}
installAppViewportHeightVar(root);
installFancyCaret();
mountApp(root);
registerServiceWorker();
