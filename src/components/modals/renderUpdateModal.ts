import { el } from "../../helpers/dom/el";
import { splitBuildId } from "../../helpers/version/buildId";

export interface UpdateModalActions {
  onDismiss: () => void;
  onReload: () => void;
}

export function renderUpdateModal(clientVersion: string, latest: string, actions: UpdateModalActions): HTMLElement {
  const webBuild = splitBuildId(clientVersion);
  const box = el("div", { class: "modal" });
  box.append(
    el("div", { class: "modal-title" }, ["Обнаружено обновление клиента"]),
    el("div", { class: "modal-line", title: webBuild.build ? `build ${webBuild.build}` : undefined }, [
      `web ${webBuild.version || "—"} → ${latest || "—"}`,
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
      actions.onReload();
    }
  });
  return box;
}
