import { el } from "../../helpers/dom/el";
import type { AppState } from "../../stores/types";

export interface CreateGroupPageActions {
  onCreate: () => void;
  onCancel: () => void;
}

export interface CreateGroupPage {
  root: HTMLElement;
  update: (state: AppState) => void;
  focus: () => void;
}

export function createGroupCreatePage(actions: CreateGroupPageActions): CreateGroupPage {
  const title = el("div", { class: "chat-title" }, ["Создать чат"]);

  const nameLabel = el("div", { class: "pane-section" }, ["Название"]);
  const nameInput = el("input", {
    class: "modal-input",
    id: "group-name",
    placeholder: "Например, Команда",
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
    { class: "chips-field", id: "group-members-field", role: "group", "aria-label": "Участники" },
    [
      el("div", { class: "chips", id: "group-members-chips" }),
      el("input", {
        class: "chips-entry",
        id: "group-members-entry",
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
      el("input", { id: "group-members", type: "hidden", value: "" }),
    ]
  );

  const warn = el("div", { class: "page-warn" }, [""]);

  const btnCreate = el("button", { class: "btn", type: "button" }, ["Создать"]);
  const btnCancel = el("button", { class: "btn", type: "button" }, ["Отмена"]);
  const actionsRow = el("div", { class: "page-actions" }, [btnCreate, btnCancel]);

  const hint = el("div", { class: "msg msg-sys" }, ["Enter — создать | Esc — назад"]);

  const root = el("div", { class: "page" }, [title, nameLabel, nameInput, membersLabel, membersField, warn, actionsRow, hint]);

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
      const message = String(state.groupCreateMessage || "");
      warn.textContent = message;
      warn.classList.toggle("hidden", !message);

      const canSubmit = state.conn === "connected" && state.authed;
      btnCreate.disabled = !canSubmit;
    },
    focus: () => {
      nameInput.value = "";
      const hidden = root.querySelector("#group-members") as HTMLInputElement | null;
      const entry = root.querySelector("#group-members-entry") as HTMLInputElement | null;
      const chips = root.querySelector("#group-members-chips") as HTMLElement | null;
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
