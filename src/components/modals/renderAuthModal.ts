import { el } from "../../helpers/dom/el";
import { applyLegacyIdMask } from "../../helpers/id/legacyIdMask";
import { focusElement } from "../../helpers/ui/focus";
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
  function wrapWithIdUnlock(input: HTMLInputElement, locked: boolean): HTMLElement {
    if (!locked) return input;

    const toggle = el(
      "button",
      {
        class: "btn field-action field-action-edit",
        type: "button",
        "aria-label": "Сменить ID",
        title: "Сменить ID",
      },
      [""]
    ) as HTMLButtonElement;

    try {
      input.setAttribute("readonly", "true");
    } catch {
      // ignore
    }

    toggle.addEventListener("click", () => {
      try {
        input.removeAttribute("readonly");
      } catch {
        // ignore
      }
      focusElement(input, { select: true });
    });

    return el("div", { class: "field-with-action auth-id-lock" }, [input, toggle]);
  }

  function wrapWithPasswordToggle(input: HTMLInputElement): HTMLElement {
    const toggle = el(
      "button",
      {
        class: "btn field-action field-action-eye",
        type: "button",
        "aria-label": "Показать пароль",
        "aria-pressed": "false",
        title: "Показать пароль",
      },
      [""]
    ) as HTMLButtonElement;

    const apply = (visible: boolean) => {
      try {
        input.type = visible ? "text" : "password";
      } catch {
        // ignore
      }
      toggle.classList.toggle("on", visible);
      toggle.setAttribute("aria-pressed", visible ? "true" : "false");
      toggle.setAttribute("aria-label", visible ? "Скрыть пароль" : "Показать пароль");
      toggle.title = visible ? "Скрыть пароль" : "Показать пароль";
    };

    toggle.addEventListener("click", () => {
      const visible = String(input.type || "").toLowerCase() === "password";
      apply(visible);
      focusElement(input);
    });

    const wrap = el("div", { class: "field-with-action" }, [input, toggle]);
    return wrap;
  }

  const root = el("div", { id: "auth-pages" });
  const scrollable = el("div", { class: "scrollable" });
  const placeholderTop = el("div", { class: "auth-placeholder" }, [""]);
  const placeholderBottom = el("div", { class: "auth-placeholder" }, [""]);
  const tabsContainer = el("div", { class: "tabs-container" });
  const tabsTab = el("div", { class: "tabs-tab active" });
  const pageClass = mode === "register" ? "page-signUp" : "page-sign";
  const container = el("div", { class: `container modal-auth ${pageClass}` });
  const tabRegister = el("button", { class: "btn auth-tab", type: "button" }, ["Регистрация"]);
  const tabLogin = el("button", { class: "btn auth-tab", type: "button" }, ["Войти по ID/@логину"]);
  const btnClose = el("button", { class: "btn auth-close", type: "button", title: "Закрыть", "aria-label": "Закрыть" }, [
    "×",
  ]);
  const formId = "auth-form";
  const btnOkLabel = mode === "register" ? "Зарегистрироваться" : "Войти";
  const btnOk =
    mode === "auto"
      ? null
      : el("button", { class: "btn btn-primary", type: "submit", form: formId }, [btnOkLabel]);
  const authImage = el("div", { class: "auth-image", "aria-hidden": "true" }, [""]);
  const header = el("div", { class: "auth-header" }, [
    el("div", { class: "auth-header-top" }, [el("div", { class: "auth-brand" }, ["Ягодка"]), btnClose]),
    el("div", { class: "subtitle auth-subtitle" }, ["Вход и синхронизация"]),
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
      ? el("div", { class: "modal-body input-wrapper" })
      : (el("form", { class: "modal-body input-wrapper", id: formId, autocomplete: "off", method: "post" }) as HTMLFormElement);
  if (mode === "auto") {
    body.append(
      el("div", { class: "modal-title" }, ["Вход"]),
      el("div", { class: "modal-help" }, ["Проверяем сохранённую сессию…"]),
      el("div", { class: "modal-help" }, ["Если не удаётся войти — выберите «Регистрация» или «Войти по ID»."])
    );
  } else if (mode === "register") {
    const pw1Input = el("input", {
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
    }) as HTMLInputElement;
    const pw2Input = el("input", {
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
    }) as HTMLInputElement;
    body.append(
      el("div", { class: "modal-title" }, ["Регистрация"]),
      el("label", { class: "modal-label", for: "auth-pw1" }, ["Пароль:"]),
      wrapWithPasswordToggle(pw1Input),
      el("label", { class: "modal-label", for: "auth-pw2" }, ["Подтверждение пароля:"]),
      wrapWithPasswordToggle(pw2Input),
      el("div", { class: "modal-help" }, ["После регистрации вы получите новый ID. Сохраните его."])
    );
  } else {
    const hasRemembered = Boolean(String(rememberedId ?? "").trim());
    const idInput = el("input", {
      class: "modal-input",
      id: "auth-id",
      name: "username",
      placeholder: "517-048-184 или @login",
      "data-ios-assistant": "off",
      inputmode: "text",
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
    const pwInput = el("input", {
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
    }) as HTMLInputElement;

    body.append(
      el("div", { class: "modal-title" }, ["Войти по ID/@логину"]),
      el("label", { class: "modal-label", for: "auth-id" }, ["ID или @логин:"]),
      wrapWithIdUnlock(idInput, hasRemembered),
      el("label", { class: "modal-label", for: "auth-pw" }, ["Пароль:"]),
      wrapWithPasswordToggle(pwInput)
    );
  }

  container.append(
    authImage,
    header,
    tabs,
    body,
    el("div", { class: "auth-extra" }, [skinLabel, skinSelect]),
    message ? el("div", { class: "modal-warn" }, [message]) : el("div", { class: "modal-warn" }),
    mode === "auto" ? el("div", { class: "modal-actions" }) : el("div", { class: "modal-actions" }, btnOk ? [btnOk] : [])
  );
  tabsTab.append(container);
  tabsContainer.append(tabsTab);
  scrollable.append(placeholderTop, tabsContainer, placeholderBottom);
  root.append(scrollable);

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
  return root;
}
