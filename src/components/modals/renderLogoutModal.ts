import { el } from "../../helpers/dom/el";

export interface LogoutModalActions {
  onClose: () => void;
}

export function renderLogoutModal(message: string | undefined, actions: LogoutModalActions): HTMLElement {
  const status = String(message || "").trim();
  const box = el("div", { class: "modal modal-screen modal-logout" });
  const btn = el("button", { class: "btn btn-primary", type: "button" }, ["Войти снова"]) as HTMLButtonElement;
  btn.addEventListener("click", () => actions.onClose());
  box.append(
    el("img", { class: "screen-logo", src: "./icons/icon.svg", alt: "" }, []),
    el("div", { class: "screen-brand" }, ["Ягодка"]),
    el("div", { class: "screen-title" }, ["До встречи"]),
    el("div", { class: "screen-sub" }, [status || "Сессия завершена. Можно войти снова или зарегистрироваться."]),
    el("div", { class: "modal-actions" }, [btn])
  );
  return box;
}
