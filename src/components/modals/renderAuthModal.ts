import { el } from "../../helpers/dom/el";
import { applyLegacyIdMask } from "../../helpers/id/legacyIdMask";
import type { AuthMode, SkinInfo } from "../../stores/types";

export interface AuthModalActions {
  onLogin: () => void;
  onRegister: () => void;
  onModeChange: (mode: "register" | "login") => void;
  onSkinChange: (skinId: string) => void;
  onClose: () => void;
}

export function renderAuthModal(
  mode: AuthMode,
  rememberedId: string | null,
  message: string | undefined,
  skins: SkinInfo[],
  currentSkin: string,
  actions: AuthModalActions
): HTMLElement {
  const box = el("div", { class: "modal modal-auth" });
  const tabRegister = el("button", { class: "btn auth-tab", type: "button" }, ["Регистрация"]);
  const tabLogin = el("button", { class: "btn auth-tab", type: "button" }, ["Войти по ID"]);
  const btnClose = el("button", { class: "btn auth-close", type: "button", title: "Закрыть", "aria-label": "Закрыть" }, [
    "×",
  ]);
  const formId = "auth-form";
  const btnOkLabel = mode === "register" ? "Зарегистрироваться" : "Войти";
  const btnOk =
    mode === "auto"
      ? null
      : el("button", { class: "btn btn-primary", type: "submit", form: formId }, [btnOkLabel]);
  const header = el("div", { class: "auth-header" }, [
    el("div", { class: "auth-header-top" }, [el("div", { class: "auth-brand" }, ["Ягодка"]), btnClose]),
    el("div", { class: "auth-subtitle" }, ["Вход и синхронизация"]),
    el("div", { class: "auth-note" }, ["Сессия сохранится на этом устройстве. Пароль мы не сохраняем."]),
  ]);

  const skinLabel = el("label", { class: "modal-label", for: "auth-skin" }, ["Скин (тема):"]);
  const skinSelect = el("select", { class: "modal-input", id: "auth-skin" }, []) as HTMLSelectElement;
  skinSelect.replaceChildren(
    ...(skins || []).map((s) => {
      const opt = el("option", { value: s.id }, [s.title]);
      (opt as HTMLOptionElement).selected = s.id === currentSkin;
      return opt;
    })
  );

  const tabs = el("div", { class: "modal-tabs" }, [tabRegister, tabLogin]);
  tabRegister.classList.toggle("btn-active", mode === "register");
  tabLogin.classList.toggle("btn-active", mode === "login");

  const body =
    mode === "auto"
      ? el("div", { class: "modal-body" })
      : (el("form", { class: "modal-body", id: formId, autocomplete: "off", method: "post" }) as HTMLFormElement);
  if (mode === "auto") {
    body.append(
      el("div", { class: "modal-title" }, ["Вход"]),
      el("div", { class: "modal-help" }, ["Проверяем сохранённую сессию…"]),
      el("div", { class: "modal-help" }, ["Если не удаётся войти — выберите «Регистрация» или «Войти по ID»."])
    );
  } else if (mode === "register") {
    body.append(
      el("div", { class: "modal-title" }, ["Регистрация"]),
      el("label", { class: "modal-label", for: "auth-pw1" }, ["Пароль:"]),
      el("input", {
        class: "modal-input",
        id: "auth-pw1",
        name: "new-password",
        type: "password",
        placeholder: "••••••",
        autocomplete: "new-password",
        autocorrect: "off",
        autocapitalize: "off",
        spellcheck: "false",
        enterkeyhint: "next",
      }),
      el("label", { class: "modal-label", for: "auth-pw2" }, ["Подтверждение пароля:"]),
      el("input", {
        class: "modal-input",
        id: "auth-pw2",
        name: "new-password-confirm",
        type: "password",
        placeholder: "••••••",
        autocomplete: "new-password",
        autocorrect: "off",
        autocapitalize: "off",
        spellcheck: "false",
        enterkeyhint: "done",
      }),
      el("div", { class: "modal-help" }, ["После регистрации вы получите новый ID. Сохраните его."])
    );
  } else {
    const idInput = el("input", {
      class: "modal-input",
      id: "auth-id",
      name: "username",
      placeholder: "517-048-184",
      inputmode: "numeric",
      autocomplete: "off",
      autocorrect: "off",
      autocapitalize: "off",
      spellcheck: "false",
      enterkeyhint: "next",
      value: rememberedId ?? "",
    }) as HTMLInputElement;
    idInput.addEventListener("input", () => {
      applyLegacyIdMask(idInput);
    });
    body.append(
      el("div", { class: "modal-title" }, ["Войти по ID"]),
      el("label", { class: "modal-label", for: "auth-id" }, ["ID:"]),
      idInput,
      el("label", { class: "modal-label", for: "auth-pw" }, ["Пароль:"]),
      el("input", {
        class: "modal-input",
        id: "auth-pw",
        name: "password",
        type: "password",
        placeholder: "••••••",
        autocomplete: "current-password",
        autocorrect: "off",
        autocapitalize: "off",
        spellcheck: "false",
        enterkeyhint: "done",
      })
    );
  }

  box.append(
    header,
    tabs,
    body,
    el("div", { class: "auth-extra" }, [skinLabel, skinSelect]),
    message ? el("div", { class: "modal-warn" }, [message]) : el("div", { class: "modal-warn" }),
    mode === "auto" ? el("div", { class: "modal-actions" }) : el("div", { class: "modal-actions" }, btnOk ? [btnOk] : [])
  );

  tabRegister.addEventListener("click", () => actions.onModeChange("register"));
  tabLogin.addEventListener("click", () => actions.onModeChange("login"));
  skinSelect.addEventListener("change", () => actions.onSkinChange(skinSelect.value));
  btnClose.addEventListener("click", () => actions.onClose());

  if (mode !== "auto") {
    (body as HTMLFormElement).addEventListener("submit", (e) => {
      e.preventDefault();
      if (mode === "register") actions.onRegister();
      else actions.onLogin();
    });
  }
  return box;
}
