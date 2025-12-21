import { el } from "../../helpers/dom/el";
import type { AppState } from "../../stores/types";

export interface CreateBoardPageActions {
  onCreate: () => void;
  onCancel: () => void;
}

export interface CreateBoardPage {
  root: HTMLElement;
  update: (state: AppState) => void;
  focus: () => void;
}

export function createBoardCreatePage(actions: CreateBoardPageActions): CreateBoardPage {
  const title = el("div", { class: "chat-title" }, ["Создать доску"]);

  const nameLabel = el("div", { class: "pane-section" }, ["Название"]);
  const nameInput = el("input", {
    class: "modal-input",
    id: "board-name",
    placeholder: "Например, Новости",
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    spellcheck: "false",
    inputmode: "text",
    enterkeyhint: "done",
  }) as HTMLInputElement;

  const handleLabel = el("div", { class: "pane-section" }, ["Хэндл (опционально)"]);
  const handleInput = el("input", {
    class: "modal-input",
    id: "board-handle",
    placeholder: "@news",
    "data-ios-assistant": "off",
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    spellcheck: "false",
    inputmode: "text",
    enterkeyhint: "done",
  }) as HTMLInputElement;

  const membersLabel = el("div", { class: "pane-section" }, ["Участники (опционально)"]);
  const membersField = el(
    "div",
    { class: "chips-field", id: "board-members-field", role: "group", "aria-label": "Участники" },
    [
      el("div", { class: "chips", id: "board-members-chips" }),
      el("input", {
        class: "chips-entry",
        id: "board-members-entry",
        placeholder: "ID или @handle (можно вставить список)",
        "data-ios-assistant": "off",
        autocomplete: "off",
        autocorrect: "off",
        autocapitalize: "off",
        spellcheck: "false",
        inputmode: "text",
        enterkeyhint: "done",
      }),
      // Hidden canonical value for submit.
      el("input", { id: "board-members", type: "hidden", value: "" }),
    ]
  );

  const warn = el("div", { class: "page-warn" }, [""]);

  const btnCreate = el("button", { class: "btn", type: "button" }, ["Создать"]);
  const btnCancel = el("button", { class: "btn", type: "button" }, ["Отмена"]);
  const actionsRow = el("div", { class: "page-actions" }, [btnCreate, btnCancel]);

  const hint = el("div", { class: "msg msg-sys" }, ["Enter — создать | Esc — назад"]);

  const root = el("div", { class: "page" }, [
    title,
    nameLabel,
    nameInput,
    handleLabel,
    handleInput,
    membersLabel,
    membersField,
    warn,
    actionsRow,
    hint,
  ]);

  function submit() {
    actions.onCreate();
  }

  btnCreate.addEventListener("click", () => submit());
  btnCancel.addEventListener("click", () => actions.onCancel());

  root.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });

  return {
    root,
    update: (state: AppState) => {
      const message = String(state.boardCreateMessage || "");
      warn.textContent = message;
      warn.classList.toggle("hidden", !message);

      const canSubmit = state.conn === "connected" && state.authed;
      btnCreate.disabled = !canSubmit;
    },
    focus: () => {
      nameInput.value = "";
      handleInput.value = "";
      const hidden = root.querySelector("#board-members") as HTMLInputElement | null;
      const entry = root.querySelector("#board-members-entry") as HTMLInputElement | null;
      const chips = root.querySelector("#board-members-chips") as HTMLElement | null;
      if (hidden) hidden.value = "";
      if (entry) entry.value = "";
      chips?.replaceChildren();
      try {
        nameInput.focus();
        nameInput.select();
      } catch {
        // ignore
      }
    },
  };
}
