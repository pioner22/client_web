import { el } from "../../helpers/dom/el";
import { splitBuildId } from "../../helpers/version/buildId";

export interface PwaUpdateModalActions {
  onDismiss: () => void;
  onApply: () => void;
}

export function renderPwaUpdateModal(clientVersion: string, actions: PwaUpdateModalActions): HTMLElement {
  const webBuild = splitBuildId(clientVersion);
  const box = el("div", { class: "modal" });
  box.append(
    el("div", { class: "modal-title" }, ["Обнаружено обновление веб-клиента"]),
    el("div", { class: "modal-line", title: webBuild.build ? `build ${webBuild.build}` : undefined }, [
      `Текущая версия: web ${webBuild.version || "—"}`,
    ]),
    el("div", { class: "modal-line" }, ["Ctrl+U или Enter (OK) — обновить"]),
    el("div", { class: "modal-line" }, ["Esc или любая клавиша — позже"])
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
