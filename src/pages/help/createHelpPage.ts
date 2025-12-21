import { el } from "../../helpers/dom/el";
import type { AppState } from "../../stores/types";

export interface HelpPage {
  root: HTMLElement;
  update: (state: AppState) => void;
  focus: () => void;
}

const HELP_ROWS: Array<{ key: string; label: string }> = [
  { key: "F1", label: "помощь" },
  { key: "F2", label: "профиль" },
  { key: "F3", label: "поиск" },
  { key: "Ctrl+U", label: "обновление" },
  { key: "F5", label: "создать чат" },
  { key: "F6", label: "создать доску" },
  { key: "F7", label: "файлы" },
  { key: "Enter", label: "отправить сообщение" },
  { key: "Shift+Enter", label: "новая строка" },
  { key: "Esc", label: "назад/закрыть" },
];

export function createHelpPage(): HelpPage {
  const title = el("div", { class: "chat-title" }, ["Помощь"]);

  const rows = el(
    "div",
    { class: "help-grid" },
    HELP_ROWS.map((r) =>
      el("div", { class: "help-row" }, [
        el("span", { class: "hk-kbd help-kbd", "aria-hidden": "true" }, [r.key]),
        el("span", { class: "help-label" }, [r.label]),
      ])
    )
  );

  const hint = el("div", { class: "msg msg-sys" }, ["Esc — назад"]);

  const root = el("div", { class: "page" }, [title, rows, hint]);

  return {
    root,
    update: (_state: AppState) => {},
    focus: () => {
      // nothing to focus by default
    },
  };
}

