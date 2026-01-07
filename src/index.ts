import "./scss/style.css";
import { registerServiceWorker } from "./helpers/pwa/registerServiceWorker";
import { applySkin, getStoredSkinId } from "./helpers/skin/skin";
import { applyTheme, resolveInitialTheme } from "./helpers/theme/theme";
import { installAppViewportHeightVar } from "./helpers/ui/appViewport";
import { installFancyCaret } from "./helpers/ui/fancyCaret";
import { installEnvironmentAgent } from "./helpers/ui/environmentAgent";

const root = document.getElementById("app");
if (!root) {
  throw new Error("Missing #app");
}

const storedSkin = getStoredSkinId();
applyTheme(resolveInitialTheme(storedSkin));
applySkin(storedSkin);
installAppViewportHeightVar(root);
installFancyCaret();
installEnvironmentAgent(root);
void import("./app/mountApp").then(({ mountApp }) => {
  mountApp(root);
  registerServiceWorker();
});
