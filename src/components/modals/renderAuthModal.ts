import { el } from "../../helpers/dom/el";
import { applyLegacyIdMask } from "../../helpers/id/legacyIdMask";
import { focusElement } from "../../helpers/ui/focus";
import type { AuthMode, ConnStatus, SkinInfo } from "../../stores/types";

export interface AuthModalActions {
  onLogin: () => void;
  onRegister: () => void;
  onModeChange: (mode: "register" | "login") => void;
  onUseDifferentAccount: () => void;
  onSkinChange: (skinId: string) => void;
  onClose: () => void;
}

type RenderAuthModalLegacyArgs = [
  skins: SkinInfo[],
  currentSkin: string,
  actions: AuthModalActions,
];

type RenderAuthModalExtendedArgs = [
  status: string | undefined,
  conn: ConnStatus,
  skins: SkinInfo[],
  currentSkin: string,
  actions: AuthModalActions,
];

interface EntryCopy {
  eyebrow: string;
  title: string;
  subtitle: string;
  heroTitle: string;
  heroCopy: string;
  primaryLabel: string;
  helper: string;
}

function connLabel(conn: ConnStatus): string {
  if (conn === "connected") return "Сервер готов";
  if (conn === "connecting") return "Подключаемся";
  return "Нет связи";
}

function modeLabel(mode: AuthMode, hasRememberedId: boolean): string {
  if (mode === "auto") return "Автовход";
  if (mode === "register") return "Новый аккаунт";
  return hasRememberedId ? "Быстрый вход" : "Вход";
}

function isQuietStatus(status: string, connected: boolean, mode: AuthMode): boolean {
  if (!status) return true;
  if (status === "Связь с сервером установлена" || status === "Вы снова в Ягодке." || status === "Вход выполнен") return true;
  if (connected && status.startsWith("Соединение установлено")) return true;
  if (status.startsWith("Подключение") || status.startsWith("Подключаем")) return mode !== "auto";
  return false;
}

function resolveNotice(message: string, status: string, connected: boolean, mode: AuthMode): string {
  if (message) return message;
  if (isQuietStatus(status, connected, mode)) return "";
  return status;
}

function resolveCopy(mode: AuthMode, hasRememberedId: boolean): EntryCopy {
  if (mode === "auto") {
    return {
      eyebrow: "Сохранённая сессия",
      title: "Возвращаем вас в Ягодку",
      subtitle: "Проверяем сессию и готовим чаты без лишних действий.",
      heroTitle: "Вход должен ощущаться как продолжение, а не как препятствие.",
      heroCopy: "Если сохранённая сессия действует, приложение откроется само. Если нет — рядом есть ручной вход и смена аккаунта.",
      primaryLabel: "Войти вручную",
      helper: "Можно не ждать автовход и сразу подтвердить доступ вручную.",
    };
  }
  if (mode === "register") {
    return {
      eyebrow: "Первый вход",
      title: "Создайте аккаунт за один шаг",
      subtitle: "Придумайте пароль, а ID мы создадим автоматически после регистрации.",
      heroTitle: "Новый аккаунт без перегруженной анкеты.",
      heroCopy: "На старте нужен только пароль. ID появится после регистрации — сохраните его для входа на других устройствах.",
      primaryLabel: "Зарегистрироваться",
      helper: "После регистрации сразу откроются чаты и профиль.",
    };
  }
  if (hasRememberedId) {
    return {
      eyebrow: "Сохранённый аккаунт",
      title: "Продолжить вход",
      subtitle: "ID уже сохранён на этом устройстве. Введите пароль, чтобы продолжить.",
      heroTitle: "Быстрый вход для знакомого устройства.",
      heroCopy: "Мы оставили главный путь коротким: сохранённый ID, пароль и один понятный следующий шаг.",
      primaryLabel: "Войти",
      helper: "Нужен другой профиль? Переключитесь на другой аккаунт.",
    };
  }
  return {
    eyebrow: "Вход по ID",
    title: "Войдите в аккаунт",
    subtitle: "Введите ID или @логин и пароль, чтобы открыть свои чаты.",
    heroTitle: "Понятный вход без технических экранов.",
    heroCopy: "Если аккаунт уже есть, используйте ID или @логин. Если нет — переключитесь на регистрацию рядом.",
    primaryLabel: "Войти",
    helper: "ID можно вводить в формате 123-456-789 или как @логин.",
  };
}

function createPill(className: string, text: string): HTMLElement {
  return el("div", { class: `auth-pill ${className}` }, [text]);
}

export function renderAuthModal(
  mode: AuthMode,
  rememberedId: string | null,
  message: string | undefined,
  ...rest: RenderAuthModalLegacyArgs | RenderAuthModalExtendedArgs
): HTMLElement {
  let status = "";
  let conn: ConnStatus = "connected";
  let skins: SkinInfo[] = [];
  let currentSkin = "";
  let actions: AuthModalActions;

  if (Array.isArray(rest[0])) {
    skins = rest[0];
    currentSkin = String(rest[1] ?? "");
    actions = rest[2] as AuthModalActions;
  } else {
    status = String(rest[0] ?? "");
    conn = (rest[1] as ConnStatus) ?? "connected";
    skins = Array.isArray(rest[2]) ? rest[2] : [];
    currentSkin = String(rest[3] ?? "");
    actions = rest[4] as AuthModalActions;
  }

  const rememberedIdValue = String(rememberedId ?? "").trim();
  const connected = conn === "connected";
  const hasRememberedId = mode === "login" && Boolean(rememberedIdValue);
  const copy = resolveCopy(mode, hasRememberedId);
  const rawMessage = String(message ?? "").trim();
  const rawStatus = String(status ?? "").trim();
  const visibleNotice = resolveNotice(rawMessage, rawStatus, connected, mode);
  const showSkinPicker = mode !== "auto" && (mode === "register" || !hasRememberedId);

  function wrapWithIdEditAction(input: HTMLInputElement, hasRemembered: boolean): HTMLElement {
    if (!hasRemembered) return input;
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

    toggle.addEventListener("click", () => {
      focusElement(input, { select: true });
    });

    return el("div", { class: "field-with-action auth-id-edit" }, [input, toggle]);
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

    return el("div", { class: "field-with-action" }, [input, toggle]);
  }

  const root = el("div", { id: "auth-pages", class: `auth-entry-page auth-entry-${mode}` });
  const scrollable = el("div", { class: "scrollable auth-entry-scroll" });
  const layout = el("div", { class: `container modal-auth auth-entry-layout ${mode === "register" ? "page-signUp" : "page-sign"}` });
  const btnClose = el("button", { class: "btn auth-close", type: "button", title: "Закрыть", "aria-label": "Закрыть" }, [
    "×",
  ]) as HTMLButtonElement;

  const hero = el("section", { class: "auth-entry-hero", "aria-label": "Ягодка" }, [
    el("div", { class: "auth-hero-orb", "aria-hidden": "true" }, [
      el("img", { class: "auth-logo", src: "./icons/icon.svg", alt: "" }, []),
    ]),
    el("div", { class: "auth-hero-kicker" }, ["Ягодка"]),
    el("div", { class: "auth-hero-title" }, [copy.heroTitle]),
    el("div", { class: "auth-hero-copy" }, [copy.heroCopy]),
    el("div", { class: "auth-hero-stack" }, [
      el("div", { class: `auth-hero-step${conn === "connected" ? " is-done" : " is-active"}` }, [
        el("span", { class: "auth-hero-step-mark" }, ["1"]),
        el("span", { class: "auth-hero-step-text" }, [conn === "connected" ? "Связь с сервером готова" : "Устанавливаем связь"]),
      ]),
      el("div", { class: `auth-hero-step${mode === "auto" ? " is-active" : ""}` }, [
        el("span", { class: "auth-hero-step-mark" }, ["2"]),
        el("span", { class: "auth-hero-step-text" }, [mode === "auto" ? "Проверяем сохранённую сессию" : "Вы выбираете вход или регистрацию"]),
      ]),
      el("div", { class: "auth-hero-step" }, [
        el("span", { class: "auth-hero-step-mark" }, ["3"]),
        el("span", { class: "auth-hero-step-text" }, ["Открываем чаты и доски"]),
      ]),
    ]),
  ]);

  const brand = el("div", { class: "auth-brand" }, [
    el("img", { class: "auth-brand-icon", src: "./icons/icon.svg", alt: "" }, []),
    el("div", { class: "auth-brand-text" }, ["Ягодка"]),
  ]);
  const tabRegister = el("button", { class: "btn auth-tab", type: "button" }, ["Создать"]);
  const tabLogin = el("button", { class: "btn auth-tab", type: "button" }, ["Вход"]);
  const tabs = el("div", { class: "modal-tabs auth-segmented-tabs" }, [tabRegister, tabLogin]);
  tabRegister.classList.toggle("btn-active", mode === "register");
  tabLogin.classList.toggle("btn-active", mode === "login");
  if (mode === "register") tabRegister.setAttribute("aria-pressed", "true");
  if (mode === "login") tabLogin.setAttribute("aria-pressed", "true");

  const panel = el("section", { class: "auth-entry-panel" }, [
    el("div", { class: "auth-panel-top" }, [brand, btnClose]),
    el("div", { class: "auth-chip-row" }, [
      createPill("auth-status-chip", copy.eyebrow),
      createPill(`auth-conn-chip auth-conn-chip-${conn}`, connLabel(conn)),
      createPill("auth-mode-chip", modeLabel(mode, hasRememberedId)),
    ]),
    el("div", { class: "auth-panel-heading" }, [
      el("div", { class: "auth-subtitle" }, [copy.title]),
      el("div", { class: "auth-note" }, [copy.subtitle]),
    ]),
    ...(mode === "auto" ? [] : [tabs]),
    ...(visibleNotice ? [el("div", { class: "auth-entry-notice" }, [visibleNotice])] : []),
  ]);

  const skinLabel = el("label", { class: "modal-label", for: "auth-skin" }, ["Оформление"]);
  const skinSelect = el("select", { class: "modal-input", id: "auth-skin" }, []) as HTMLSelectElement;
  skinSelect.replaceChildren(
    ...(skins || []).map((s) => {
      const opt = el("option", { value: s.id }, [s.title]);
      (opt as HTMLOptionElement).selected = s.id === currentSkin;
      return opt;
    })
  );

  const formId = "auth-form";
  const primaryButton =
    mode === "auto"
      ? null
      : (el(
          "button",
          { class: "btn btn-primary auth-primary-cta", type: "submit", form: formId, ...(connected ? {} : { disabled: "true" }) },
          [connected ? copy.primaryLabel : "Ждём соединение"]
        ) as HTMLButtonElement);

  const body =
    mode === "auto"
      ? el("div", { class: "modal-body input-wrapper auth-entry-form auth-entry-form-auto" })
      : (el("form", { class: "modal-body input-wrapper auth-entry-form", id: formId, autocomplete: "off", method: "post" }) as HTMLFormElement);

  if (mode === "auto") {
    const useManualLogin = el("button", { class: "btn btn-primary auth-primary-cta", type: "button" }, [copy.primaryLabel]) as HTMLButtonElement;
    const useOtherAccount = el("button", { class: "btn btn-secondary", type: "button" }, ["Другой аккаунт"]) as HTMLButtonElement;
    useManualLogin.addEventListener("click", () => actions.onModeChange(rememberedIdValue ? "login" : "register"));
    useOtherAccount.addEventListener("click", () => actions.onUseDifferentAccount());
    body.append(
      el("div", { class: "auth-progress-card" }, [
        el("div", { class: "auth-progress-title" }, ["Автовход"]),
        el("div", { class: "auth-progress-list" }, [
          el("div", { class: `auth-progress-step${connected ? " is-done" : " is-active"}` }, [
            el("span", { class: "auth-progress-step-title" }, ["Подключение"]),
            el("span", { class: "auth-progress-step-copy" }, [connected ? "Связь с сервером установлена." : "Готовим защищённый канал."]),
          ]),
          el("div", { class: `auth-progress-step${connected ? " is-active" : ""}` }, [
            el("span", { class: "auth-progress-step-title" }, ["Сессия"]),
            el("span", { class: "auth-progress-step-copy" }, ["Проверяем, можно ли открыть чаты без пароля."]),
          ]),
          el("div", { class: "auth-progress-step" }, [
            el("span", { class: "auth-progress-step-title" }, ["Готово"]),
            el("span", { class: "auth-progress-step-copy" }, ["После подтверждения сразу покажем рабочее пространство."]),
          ]),
        ]),
      ]),
      el("div", { class: "modal-help auth-section-lead" }, [copy.helper]),
      el("div", { class: "modal-actions modal-actions-compose auth-inline-actions" }, [useManualLogin, useOtherAccount])
    );
  } else if (mode === "register") {
    const pw1Input = el("input", {
      class: "modal-input",
      id: "auth-pw1",
      name: "new-password",
      type: "password",
      placeholder: "Пароль",
      autocomplete: "new-password",
      autocorrect: "off",
      autocapitalize: "off",
      spellcheck: "false",
      "data-ios-assistant": "off",
      "data-fancy-caret": "off",
      enterkeyhint: "next",
    }) as HTMLInputElement;
    const pw2Input = el("input", {
      class: "modal-input",
      id: "auth-pw2",
      name: "new-password-confirm",
      type: "password",
      placeholder: "Повторите пароль",
      autocomplete: "new-password",
      autocorrect: "off",
      autocapitalize: "off",
      spellcheck: "false",
      "data-ios-assistant": "off",
      "data-fancy-caret": "off",
      enterkeyhint: "done",
    }) as HTMLInputElement;
    body.append(
      el("div", { class: "auth-field-stack" }, [
        el("label", { class: "modal-label", for: "auth-pw1" }, ["Пароль"]),
        wrapWithPasswordToggle(pw1Input),
      ]),
      el("div", { class: "auth-field-stack" }, [
        el("label", { class: "modal-label", for: "auth-pw2" }, ["Подтверждение"]),
        wrapWithPasswordToggle(pw2Input),
      ]),
      el("div", { class: "modal-help auth-section-lead" }, [copy.helper]),
      el("div", { class: "modal-actions" }, primaryButton ? [primaryButton] : [])
    );
  } else {
    const idInput = el("input", {
      class: "modal-input",
      id: "auth-id",
      name: "username",
      placeholder: "517-048-184 или @login",
      "data-ios-assistant": "off",
      "data-fancy-caret": "off",
      inputmode: "text",
      autocomplete: "off",
      autocorrect: "off",
      autocapitalize: "off",
      spellcheck: "false",
      enterkeyhint: "next",
      value: rememberedIdValue,
    }) as HTMLInputElement;
    let autoSelected = false;
    idInput.addEventListener("focus", () => {
      if (autoSelected) return;
      if (!hasRememberedId) return;
      if (idInput.value !== rememberedIdValue) return;
      autoSelected = true;
      try {
        idInput.select();
      } catch {
        // ignore
      }
    });
    idInput.addEventListener("input", () => {
      applyLegacyIdMask(idInput);
    });
    const pwInput = el("input", {
      class: "modal-input",
      id: "auth-pw",
      name: "password",
      type: "password",
      placeholder: "Пароль",
      "data-ios-assistant": "off",
      "data-fancy-caret": "off",
      autocomplete: "current-password",
      autocorrect: "off",
      autocapitalize: "off",
      spellcheck: "false",
      enterkeyhint: "done",
    }) as HTMLInputElement;
    const manualIdBlock = el("div", { class: `auth-field-stack auth-manual-id${hasRememberedId ? " auth-manual-id-hidden" : ""}` }, [
      el("label", { class: "modal-label", for: "auth-id" }, ["ID или @логин"]),
      wrapWithIdEditAction(idInput, hasRememberedId),
    ]);
    const sessionCard =
      hasRememberedId
        ? (() => {
            const switchBtn = el("button", { class: "btn btn-secondary", type: "button" }, ["Другой аккаунт"]) as HTMLButtonElement;
            switchBtn.addEventListener("click", () => actions.onUseDifferentAccount());
            return el("div", { class: "auth-session-card" }, [
              el("div", { class: "auth-session-label" }, ["Продолжить как"]),
              el("div", { class: "auth-session-id" }, [rememberedIdValue]),
              el("div", { class: "auth-session-copy" }, ["Введите пароль для этого аккаунта или выберите другой ID."]),
              el("div", { class: "auth-session-actions" }, [switchBtn]),
            ]);
          })()
        : null;

    body.append(
      ...(sessionCard ? [sessionCard] : []),
      manualIdBlock,
      el("div", { class: "auth-field-stack" }, [
        el("label", { class: "modal-label", for: "auth-pw" }, ["Пароль"]),
        wrapWithPasswordToggle(pwInput),
      ]),
      el("div", { class: "modal-help auth-section-lead" }, [copy.helper]),
      el("div", { class: "modal-actions" }, primaryButton ? [primaryButton] : [])
    );
  }

  panel.append(
    body,
    ...(showSkinPicker
      ? [
          el("div", { class: "auth-extra" }, [
            skinLabel,
            skinSelect,
            el("div", { class: "modal-help auth-extra-help" }, ["Можно поменять и после входа."]),
          ]),
        ]
      : []),
    rawMessage ? el("div", { class: "modal-warn" }, [rawMessage]) : el("div", { class: "modal-warn" })
  );
  layout.append(hero, panel);
  scrollable.append(layout);
  root.append(scrollable);

  tabRegister.addEventListener("click", () => actions.onModeChange("register"));
  tabLogin.addEventListener("click", () => actions.onModeChange("login"));
  skinSelect.addEventListener("change", () => actions.onSkinChange(skinSelect.value));
  btnClose.addEventListener("click", () => actions.onClose());

  if (mode !== "auto") {
    const submitCurrentMode = () => {
      if (mode === "register") actions.onRegister();
      else actions.onLogin();
    };

    (body as HTMLFormElement).addEventListener("submit", (e) => {
      e.preventDefault();
      submitCurrentMode();
    });

    if (primaryButton) {
      // iOS Safari/PWA can miss linked-form submits. Keep a direct tap path.
      primaryButton.addEventListener("click", (e) => {
        e.preventDefault();
        submitCurrentMode();
      });
    }
  }
  return root;
}
