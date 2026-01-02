import { el } from "../../helpers/dom/el";

export function renderWelcomeModal(message?: string): HTMLElement {
  const status = String(message || "").trim();
  const box = el("div", { class: "modal modal-screen modal-welcome" });
  box.append(
    el("div", { class: "screen-brand" }, ["Ягодка"]),
    el("div", { class: "screen-title" }, ["Добро пожаловать"]),
    el("div", { class: "screen-sub" }, [status || "Подключение…"]),
    el("div", { class: "screen-bar", "aria-hidden": "true" }, [""])
  );
  return box;
}
