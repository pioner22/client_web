import { el } from "../../helpers/dom/el";
import { splitBuildId } from "../../helpers/version/buildId";
import { isMobileLikeUi } from "../../helpers/ui/mobileLike";

export interface PwaUpdateModalActions {
  onDismiss: () => void;
  onApply: () => void;
}

export function renderPwaUpdateModal(clientVersion: string, actions: PwaUpdateModalActions): HTMLElement {
  const mobileUi = isMobileLikeUi();
  const webBuild = splitBuildId(clientVersion);
  const box = el("div", { class: "modal" });

  const btnApply = el("button", { class: "btn btn-primary", type: "button" }, ["Обновить"]);
  const btnLater = el("button", { class: "btn", type: "button" }, ["Позже"]);
  const buttons = el("div", { class: "modal-actions" }, [btnApply, btnLater]);
  btnApply.addEventListener("click", () => actions.onApply());
  btnLater.addEventListener("click", () => actions.onDismiss());

  box.append(
    el("div", { class: "modal-title" }, ["Обнаружено обновление веб-клиента"]),
    el("div", { class: "modal-line", title: webBuild.build ? `build ${webBuild.build}` : undefined }, [
      `Текущая версия: web ${webBuild.version || "—"}`,
    ]),
    ...(mobileUi
      ? []
      : [el("div", { class: "modal-line" }, ["Ctrl+U или Enter (OK) — обновить"]), el("div", { class: "modal-line" }, ["Esc или любая клавиша — позже"])]),
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
