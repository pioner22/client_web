import { el } from "../../helpers/dom/el";
import type { Layout } from "./types";

export function createLayout(root: HTMLElement): Layout {
  const headerLeft = el("div", { class: "hdr-left" });
  const headerRight = el("div", { class: "hdr-right" });
  const hotkeys = el("div", { class: "hotkeys" });

  const header = el("header", { class: "hdr" }, [headerLeft, headerRight, hotkeys]);

  const sidebar = el("aside", { class: "sidebar" });
  const chat = el("main", { class: "chat" });

  const input = el("textarea", {
    class: "input",
    rows: "1",
    placeholder: "Сообщение",
    spellcheck: "false",
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    inputmode: "text",
    enterkeyhint: "send",
  }) as HTMLTextAreaElement;
  const attachBtn = el("button", { class: "btn composer-attach", type: "button", title: "Файл", "aria-label": "Прикрепить файл" }, [
    "＋",
  ]) as HTMLButtonElement;
  const sendBtn = el("button", { class: "btn composer-send", type: "button", "aria-label": "Отправить" }, ["Отправить"]);
  const editBar = el("div", { class: "composer-edit hidden", id: "composer-edit", role: "status", "aria-live": "polite" }, [
    el("div", { class: "composer-edit-body" }, [
      el("div", { class: "composer-edit-title" }, ["Редактирование"]),
      el("div", { class: "composer-edit-text", id: "composer-edit-text" }, [""]),
    ]),
    el(
      "button",
      {
        class: "btn composer-edit-cancel",
        type: "button",
        "data-action": "composer-edit-cancel",
        title: "Отменить редактирование",
        "aria-label": "Отменить редактирование",
      },
      ["×"]
    ),
  ]);
  const composerMeta = el("div", { class: "composer-meta" }, [
    el("span", { class: "composer-hint", "aria-hidden": "true" }, ["Shift+Enter — новая строка"]),
    el("span", { class: "composer-count", "aria-hidden": "true" }, ["0/4000"]),
  ]);
  const inputWrap = el("div", { class: "input-wrap" }, [editBar, el("div", { class: "composer-field" }, [attachBtn, input, sendBtn]), composerMeta]);

  const footer = el("footer", { class: "footer" });
  const toastHost = el("div", { class: "toast-host hidden", "aria-live": "polite", "aria-atomic": "true" });
  const navOverlay = el("div", { class: "nav-overlay hidden", "aria-hidden": "true" });
  const overlay = el("div", { class: "overlay hidden" });

  const grid = el("div", { class: "grid" }, [sidebar, chat]);

  const app = el("div", { class: "app" }, [header, grid, inputWrap, footer, toastHost, navOverlay, overlay]);
  // Keep the boot screen in DOM until the app signals it has booted.
  // This prevents a "black screen" during PWA update/restart flows.
  const boot = root.querySelector(".boot");
  if (boot) root.replaceChildren(boot, app);
  else root.replaceChildren(app);

  return { headerLeft, headerRight, hotkeys, sidebar, chat, toastHost, inputWrap, input, attachBtn, sendBtn, footer, navOverlay, overlay };
}
