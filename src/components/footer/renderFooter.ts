import { el } from "../../helpers/dom/el";
import { isMobileLikeUi } from "../../helpers/ui/mobileLike";
import type { AppState } from "../../stores/types";

export function renderFooter(target: HTMLElement, state: AppState) {
  const mobileUi = isMobileLikeUi();
  target.classList.toggle("hidden", mobileUi);
  if (mobileUi) {
    target.replaceChildren();
    return;
  }
  const tabMain = el(
    "button",
    {
      class: state.page === "main" ? "footer-tab footer-tab-active" : "footer-tab",
      type: "button",
      role: "tab",
      "aria-selected": String(state.page === "main"),
      "data-action": "nav-main",
    },
    ["Сообщения"]
  );
  const tabProfile = el(
    "button",
    {
      class: state.page === "profile" ? "footer-tab footer-tab-active" : "footer-tab",
      type: "button",
      role: "tab",
      "aria-selected": String(state.page === "profile"),
      "data-action": "nav-profile",
    },
    ["Профиль"]
  );
  const tabFiles = el(
    "button",
    {
      class: state.page === "files" ? "footer-tab footer-tab-active" : "footer-tab",
      type: "button",
      role: "tab",
      "aria-selected": String(state.page === "files"),
      "data-action": "nav-files",
    },
    ["Файлы"]
  );

  target.replaceChildren(
    el("div", { class: "footer-nav", role: "tablist" }, [tabMain, tabProfile, tabFiles])
  );
}
