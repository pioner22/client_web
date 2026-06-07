import { el } from "../../helpers/dom/el";
import { splitBuildId } from "../../helpers/version/buildId";
import { isMobileLikeUi } from "../../helpers/ui/mobileLike";

export interface PwaUpdateModalActions {
  onDismiss: () => void;
  onApply: () => void;
}

export function renderPwaUpdateModal(clientVersion: string, latest: string, actions: PwaUpdateModalActions): HTMLElement {
  const mobileUi = isMobileLikeUi();
  const webBuild = splitBuildId(clientVersion);
  const latestBuild = splitBuildId(latest);
  const latestLabel = latestBuild.version || latest || "новая сборка";
  const box = el("div", { class: "modal modal-pwa-update", role: "dialog", "aria-modal": "true", "aria-labelledby": "pwa-update-title" });

  const btnApply = el("button", { class: "btn btn-primary pwa-update-apply", type: "button" }, ["Обновить"]);
  const btnLater = el("button", { class: "btn pwa-update-later", type: "button" }, ["Позже"]);
  const buttons = el("div", { class: "modal-actions pwa-update-actions" }, [btnApply, btnLater]);
  btnApply.addEventListener("click", () => actions.onApply());
  btnLater.addEventListener("click", () => actions.onDismiss());

  box.append(
    el("div", { class: "pwa-update-mark", "aria-hidden": "true" }, [""]),
    el("div", { class: "modal-title pwa-update-title", id: "pwa-update-title" }, ["Обновление готово"]),
    el("div", { class: "modal-line pwa-update-version", title: webBuild.build ? `build ${webBuild.build}` : undefined }, [
      el("span", { class: "pwa-update-version-label" }, ["web"]),
      el("span", { class: "pwa-update-version-now" }, [webBuild.version || "—"]),
      el("span", { class: "pwa-update-version-arrow", "aria-hidden": "true" }, ["→"]),
      el("span", { class: "pwa-update-version-next" }, [latestLabel]),
    ]),
    el("div", { class: "modal-line pwa-update-copy" }, ["Новая версия уже загружена. Обновление займёт несколько секунд."]),
    ...(mobileUi
      ? []
      : [
          el("div", { class: "modal-line pwa-update-hint" }, ["Enter — обновить"]),
          el("div", { class: "modal-line pwa-update-hint" }, ["Esc — позже"]),
        ]),
    buttons
  );
  box.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      actions.onDismiss();
    }
    if (e.key === "Enter") {
      e.preventDefault();
      actions.onApply();
    }
  });
  return box;
}
