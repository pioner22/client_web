import { el } from "./dom";

export interface Layout {
  headerLeft: HTMLElement;
  headerRight: HTMLElement;
  hotkeys: HTMLElement;
  sidebar: HTMLElement;
  chat: HTMLElement;
  input: HTMLTextAreaElement;
  footer: HTMLElement;
  overlay: HTMLElement;
}

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
  const inputWrap = el("div", { class: "input-wrap" }, [el("span", { class: "prompt" }, [">"]), input]);

  const footer = el("footer", { class: "footer" });
  const overlay = el("div", { class: "overlay hidden" });

  const grid = el("div", { class: "grid" }, [sidebar, chat]);

  root.replaceChildren(el("div", { class: "app" }, [header, grid, inputWrap, footer, overlay]));

  return { headerLeft, headerRight, hotkeys, sidebar, chat, input, footer, overlay };
}
