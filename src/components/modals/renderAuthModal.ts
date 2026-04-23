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
  const hasRememberedId = mode === "login" && Boolean(rememberedIdValue);
  const showSkinPicker = mode !== "auto" && (mode === "register" || !hasRememberedId);
  const connected = conn === "connected";
  const connLabel = connected ? "Связь готова" : conn === "connecting" ? "Подключаемся" : "Нет связи";
  const secondaryModeChip =
    mode === "auto" ? "Автовход" : mode === "register" ? "Новый аккаунт" : hasRememberedId ? "Быстрый вход" : "Вход";
  const rawStatus = String(status ?? "").trim();
  const rawMessage = String(message ?? "").trim();
  const visibleNotice = (() => {
    if (rawMessage) return rawMessage;
    if (!rawStatus) return "";
    if (rawStatus === "Связь с сервером установлена" || rawStatus === "Вы снова в Ягодке." || rawStatus === "Вход выполнен") return "";
    if (
      rawStatus.startsWith("Подключение") ||
      rawStatus.startsWith("Пробуем восстановить") ||
      rawStatus.startsWith("Проверяем сохранённую сессию")
    ) {
      return mode === "auto" ? rawStatus : "";
    }
    if (connected && rawStatus.startsWith("Соединение установлено")) return "";
    return rawStatus;
  })();

  const headerCopy = (() => {
    if (mode === "auto") {
      return {
        chip: "Сохранённая сессия",
        subtitle: "Восстанавливаем вход на этом устройстве",
        noteLines: [
          "Если сессия ещё действует, откроем ваши чаты без повторного ввода ID и пароля.",
          "Если хотите войти иначе, можно сразу переключиться на ручной вход или другой аккаунт.",
        ],
      };
    }
    if (mode === "register") {
      return {
        chip: "Новый аккаунт",
        subtitle: "Создать аккаунт без лишних шагов",
        noteLines: [
          "Пароль задаёте вы, а ID создадим автоматически и покажем сразу после регистрации.",
        ],
      };
    }
    if (hasRememberedId) {
      return {
        chip: "Быстрый вход",
        subtitle: "Продолжить как сохранённый аккаунт",
        noteLines: [
          "Сохранённый ID уже подставлен. Обычно достаточно ввести пароль, чтобы продолжить.",
        ],
      };
    }
    return {
      chip: "Вход по ID",
      subtitle: "Войти по ID или @логину",
      noteLines: [
        "Если аккаунт уже есть, введите ID или @логин и пароль. Если нет — переключитесь на регистрацию.",
      ],
    };
  })();

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
  const tabLogin = el("button", { class: "btn auth-tab", type: "button" }, ["Вход"]);
  const btnClose = el("button", { class: "btn auth-close", type: "button", title: "Закрыть", "aria-label": "Закрыть" }, [
    "×",
  ]);
  const formId = "auth-form";
  const btnOkLabel = mode === "register" ? "Зарегистрироваться" : "Войти";
  const btnOk =
    mode === "auto"
      ? null
      : el(
          "button",
          { class: "btn btn-primary", type: "submit", form: formId, ...(connected ? {} : { disabled: "true" }) },
          [connected ? btnOkLabel : "Ждём соединение"]
        );
  const authImage = el("div", { class: "auth-image", "aria-hidden": "true" }, [
    el("img", { class: "auth-logo", src: "./icons/icon.svg", alt: "" }, []),
  ]);
  const brand = el("div", { class: "auth-brand" }, [
    el("img", { class: "auth-brand-icon", src: "./icons/icon.svg", alt: "" }, []),
    el("div", { class: "auth-brand-text" }, ["Ягодка"]),
  ]);
  const header = el("div", { class: "auth-header" }, [
    el("div", { class: "auth-header-top" }, [brand, btnClose]),
    el("div", { class: "auth-chip-row" }, [
      el("div", { class: "auth-status-chip" }, [headerCopy.chip]),
      el("div", { class: `auth-conn-chip auth-conn-chip-${conn}` }, [connLabel]),
      el("div", { class: "auth-mode-chip" }, [secondaryModeChip]),
    ]),
    el("div", { class: "subtitle auth-subtitle" }, [headerCopy.subtitle]),
    el("div", { class: "auth-note" }, [
      ...headerCopy.noteLines.map((line) => el("span", { class: "auth-note-line" }, [line])),
    ]),
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
  if (mode === "register" && typeof (tabRegister as HTMLElement).setAttribute === "function") {
    tabRegister.setAttribute("aria-pressed", "true");
  }
  if (mode === "login" && typeof (tabLogin as HTMLElement).setAttribute === "function") {
    tabLogin.setAttribute("aria-pressed", "true");
  }

  const body =
    mode === "auto"
      ? el("div", { class: "modal-body input-wrapper" })
      : (el("form", { class: "modal-body input-wrapper", id: formId, autocomplete: "off", method: "post" }) as HTMLFormElement);
  if (mode === "auto") {
    const useManualLogin = el("button", { class: "btn btn-primary", type: "button" }, ["Войти вручную"]) as HTMLButtonElement;
    const useOtherAccount = el("button", { class: "btn btn-secondary", type: "button" }, ["Другой аккаунт"]) as HTMLButtonElement;
    useManualLogin.addEventListener("click", () => actions.onModeChange(rememberedIdValue ? "login" : "register"));
    useOtherAccount.addEventListener("click", () => actions.onUseDifferentAccount());
    body.append(
      el("div", { class: "modal-title" }, ["Почти готово"]),
      el("div", { class: "auth-progress-card" }, [
        el("div", { class: "auth-progress-title" }, ["Что происходит сейчас"]),
        el("div", { class: "auth-progress-list" }, [
          el("div", { class: `auth-progress-step${connected ? " is-done" : " is-active"}` }, [
            el("span", { class: "auth-progress-step-title" }, ["Подключаем устройство"]),
            el("span", { class: "auth-progress-step-copy" }, [connected ? "Связь с сервером готова." : "Устанавливаем безопасное соединение."]),
          ]),
          el("div", { class: `auth-progress-step${connected ? " is-active" : ""}` }, [
            el("span", { class: "auth-progress-step-title" }, ["Проверяем сохранённую сессию"]),
            el("span", { class: "auth-progress-step-copy" }, ["Если она ещё действует, войдём без повторного ввода данных."]),
          ]),
          el("div", { class: "auth-progress-step" }, [
            el("span", { class: "auth-progress-step-title" }, ["Откроем ваши чаты"]),
            el("span", { class: "auth-progress-step-copy" }, ["Сразу после успешной проверки."]),
          ]),
        ]),
      ]),
      el("div", { class: "modal-help" }, ["Если нужно, можно сразу перейти на ручной вход или выбрать другой аккаунт."]),
      el("div", { class: "modal-actions modal-actions-compose auth-inline-actions" }, [useManualLogin, useOtherAccount])
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
      "data-ios-assistant": "off",
      "data-fancy-caret": "off",
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
      "data-ios-assistant": "off",
      "data-fancy-caret": "off",
      enterkeyhint: "done",
    }) as HTMLInputElement;
    body.append(
      el("div", { class: "modal-title" }, ["Регистрация"]),
      el("div", { class: "modal-help auth-section-lead" }, ["Создадим новый аккаунт и сразу покажем ваш ID, чтобы вы могли его сохранить."]),
      el("label", { class: "modal-label", for: "auth-pw1" }, ["Пароль:"]),
      wrapWithPasswordToggle(pw1Input),
      el("label", { class: "modal-label", for: "auth-pw2" }, ["Подтверждение пароля:"]),
      wrapWithPasswordToggle(pw2Input),
      el("div", { class: "modal-help" }, ["Используйте пароль, который сможете безопасно сохранить или восстановить."])
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
      placeholder: "••••••",
      "data-ios-assistant": "off",
      "data-fancy-caret": "off",
      autocomplete: "current-password",
      autocorrect: "off",
      autocapitalize: "off",
      spellcheck: "false",
      enterkeyhint: "done",
    }) as HTMLInputElement;
    const manualIdBlock = el("div", { class: `auth-manual-id${hasRememberedId ? " auth-manual-id-hidden" : ""}` }, [
      el("label", { class: "modal-label", for: "auth-id" }, ["ID или @логин:"]),
      wrapWithIdEditAction(idInput, hasRememberedId),
    ]);
    const sessionCard =
      hasRememberedId
        ? (() => {
            const switchBtn = el("button", { class: "btn btn-secondary", type: "button" }, ["Другой аккаунт"]) as HTMLButtonElement;
            switchBtn.addEventListener("click", () => actions.onUseDifferentAccount());
            return el("div", { class: "auth-session-card" }, [
              el("div", { class: "auth-session-label" }, ["Сохранённый аккаунт"]),
              el("div", { class: "auth-session-id" }, [rememberedIdValue]),
              el("div", { class: "auth-session-copy" }, [
                "Введите пароль, чтобы продолжить в этом аккаунте, или переключитесь на другой ID.",
              ]),
              el("div", { class: "auth-session-actions" }, [switchBtn]),
            ]);
          })()
        : null;

    body.append(
      el("div", { class: "modal-title" }, ["Вход"]),
      el("div", { class: "modal-help auth-section-lead" }, [
        hasRememberedId
          ? "ID уже сохранён на этом устройстве. Обычно достаточно ввести пароль."
          : "Введите ID или @логин и пароль, чтобы войти в мессенджер.",
      ]),
      ...(sessionCard ? [sessionCard] : []),
      manualIdBlock,
      el("label", { class: "modal-label", for: "auth-pw" }, ["Пароль:"]),
      wrapWithPasswordToggle(pwInput),
      el("div", { class: "modal-help" }, [
        hasRememberedId
          ? "Пароль нигде не показывается и нужен только для подтверждения входа."
          : "Можно использовать числовой ID вида 123-456-789 или @логин.",
      ])
    );
  }

  container.append(
    authImage,
    header,
    tabs,
    ...(visibleNotice ? [el("div", { class: "auth-entry-notice" }, [visibleNotice])] : []),
    body,
    ...(showSkinPicker
      ? [
          el("div", { class: "auth-extra" }, [
            skinLabel,
            skinSelect,
            el("div", { class: "modal-help auth-extra-help" }, ["Оформление можно поменять и позже, уже после входа."]),
          ]),
        ]
      : []),
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
