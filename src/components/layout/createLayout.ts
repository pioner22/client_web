import { el } from "../../helpers/dom/el";
import type { Layout } from "./types";

export function createLayout(root: HTMLElement, opts?: { iosStandalone?: boolean }): Layout {
  const iosStandalone = Boolean(opts?.iosStandalone);
  const headerLeft = el("div", { class: "hdr-left" });
  const headerRight = el("div", { class: "hdr-right" });
  const hotkeys = el("div", { class: "hotkeys" });

  const header = el("header", { class: "hdr" }, [headerLeft, headerRight, hotkeys]);

  const sidebar = el("aside", { class: "sidebar" });
  const sidebarBody = el("div", { class: "sidebar-body" });
  sidebar.appendChild(sidebarBody);
  const chatTop = el("div", { class: "chat-top hidden" });
  const chatHost = el("div", { class: "chat-host" });
  const chatJump = el(
    "button",
    { class: "btn chat-jump hidden", type: "button", "data-action": "chat-jump-bottom", "aria-label": "Вниз" },
    ["↓"]
  ) as HTMLButtonElement;
  const chat = el("main", { class: "chat" }, [chatTop, chatHost, chatJump]);

  const input = el("textarea", {
    class: "input",
    rows: "1",
    placeholder: "Сообщение",
    "data-ios-assistant": "composer",
    // iOS PWA (standalone) иногда показывает системную панель Undo/Redo/✓ вместо подсказок.
    // Для композера включаем “обычный” режим клавиатуры, чтобы снизить шанс появления панели.
    // На остальных платформах оставляем строгий режим (без автокоррекции/спеллчека) по умолчанию.
    spellcheck: iosStandalone ? "true" : "false",
    autocomplete: "off",
    autocorrect: iosStandalone ? "on" : "off",
    autocapitalize: iosStandalone ? "sentences" : "off",
    inputmode: "text",
    enterkeyhint: "send",
  }) as HTMLTextAreaElement;
  const attachBtn = el("button", { class: "btn composer-attach", type: "button", title: "Файл", "aria-label": "Прикрепить файл" }, [
    "＋",
  ]) as HTMLButtonElement;
  const emojiBtn = el("button", { class: "btn composer-emoji", type: "button", title: "Эмодзи", "aria-label": "Открыть эмодзи" }, [
    "☺︎",
  ]) as HTMLButtonElement;
  const sendBtn = el("button", { class: "btn composer-send", type: "button", "aria-label": "Отправить" }, ["Отправить"]);
  const sidebarDock = el("div", { class: "sidebar-bottom-dock", "aria-hidden": "true" });
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
  const composerRow = el("div", { class: "composer-row" }, [sidebarDock, el("div", { class: "composer-field" }, [attachBtn, emojiBtn, input, sendBtn])]);
  const inputWrap = el("div", { class: "input-wrap" }, [editBar, composerRow, composerMeta]);

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

  return {
    headerLeft,
    headerRight,
    hotkeys,
    sidebar,
    sidebarBody,
    sidebarDock,
    chat,
    chatTop,
    chatHost,
    chatJump,
    toastHost,
    inputWrap,
    input,
    attachBtn,
    emojiBtn,
    sendBtn,
    footer,
    navOverlay,
    overlay,
  };
}
