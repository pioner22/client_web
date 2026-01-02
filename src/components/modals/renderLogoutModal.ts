import { el } from "../../helpers/dom/el";

export interface LogoutModalActions {
  onClose: () => void;
}

export function renderLogoutModal(message: string | undefined, actions: LogoutModalActions): HTMLElement {
  const status = String(message || "").trim();
  const box = el("div", { class: "modal modal-screen modal-logout" });
  const btn = el("button", { class: "btn btn-primary", type: "button" }, ["Войти"]) as HTMLButtonElement;
  btn.addEventListener("click", () => actions.onClose());
  box.append(
    el("div", { class: "screen-brand" }, ["Ягодка"]),
    el("div", { class: "screen-title" }, ["До встречи"]),
    el("div", { class: "screen-sub" }, [status || "Вы вышли из мессенджера."]),
    el("div", { class: "modal-actions" }, [btn])
  );
  return box;
}
