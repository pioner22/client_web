import { el } from "../../helpers/dom/el";
import { formatTime } from "../../helpers/time";
import { conversationKey } from "../../helpers/chat/conversationKey";
import { isMessageContinuation } from "../../helpers/chat/messageGrouping";
import type { AppState, ChatMessage, FileTransferEntry } from "../../stores/types";
import { avatarHue, avatarMonogram, getStoredAvatar } from "../../helpers/avatar/avatarStore";
import { fileBadge } from "../../helpers/files/fileBadge";
import { safeUrl } from "../../helpers/security/safeUrl";
import type { Layout } from "../layout/types";

function dayKey(ts: number): string {
  try {
    const d = new Date(ts * 1000);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  } catch {
    return "";
  }
}

function formatDayLabel(ts: number): string {
  try {
    const d = new Date(ts * 1000);
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    // Prefer RU locale, but keep it robust if runtime doesn't support it.
    const label = d.toLocaleDateString("ru-RU", sameYear ? { day: "2-digit", month: "short" } : { day: "2-digit", month: "short", year: "numeric" });
    return label || dayKey(ts) || "—";
  } catch {
    return dayKey(ts) || "—";
  }
}

function avatar(kind: "dm" | "group" | "board", id: string): HTMLElement {
  const url = getStoredAvatar(kind, id);
  const a = el("span", { class: url ? "avatar avatar-img" : "avatar", "aria-hidden": "true" }, [url ? "" : avatarMonogram(kind, id)]);
  a.style.setProperty("--avatar-h", String(avatarHue(`${kind}:${id}`)));
  if (url) a.style.backgroundImage = `url(${url})`;
  return a;
}

function chatTitleNodes(state: AppState): Array<string | HTMLElement> {
  const sel = state.selected;
  if (!sel) return ["Чат"];
  if (sel.kind === "dm") {
    const p = state.profiles?.[sel.id];
    const dn = p?.display_name ? String(p.display_name).trim() : "";
    const h = p?.handle ? String(p.handle).trim() : "";
    const label = dn || (h ? (h.startsWith("@") ? h : `@${h}`) : sel.id);
    return [avatar("dm", sel.id), `Чат с: ${label}`];
  }
  if (sel.kind === "group") {
    const g = (state.groups || []).find((x) => x.id === sel.id);
    return [avatar("group", sel.id), `Чат: ${String(g?.name || sel.id)}`];
  }
  const b = (state.boards || []).find((x) => x.id === sel.id);
  return [avatar("board", sel.id), `Доска: ${String(b?.name || sel.id)}`];
}

function formatBytes(size: number): string {
  if (!size || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const precision = value >= 100 || idx === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[idx]}`;
}

function isImageFile(name: string, mime?: string | null): boolean {
  const mt = String(mime || "").toLowerCase();
  if (mt.startsWith("image/")) return true;
  const n = String(name || "").toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|ico|svg)$/.test(n);
}

function transferStatus(entry: FileTransferEntry): string {
  const pct = Math.max(0, Math.min(100, Math.round(entry.progress || 0)));
  if (entry.status === "uploading") return `Загрузка (${pct}%)`;
  if (entry.status === "downloading") return `Скачивание (${pct}%)`;
  if (entry.status === "uploaded") return "Файл загружен";
  if (entry.status === "complete") return "Готово";
  if (entry.status === "rejected") return "Отклонено";
  if (entry.status === "error") return `Ошибка: ${entry.error || "неизвестно"}`;
  return entry.direction === "out" ? "Ожидание подтверждения" : "Ожидание отправителя";
}

function statusLabel(m: ChatMessage): string {
  const status = m.status;
  if (!status) return "";
  const hasServerId = typeof m.id === "number" && Number.isFinite(m.id) && m.id > 0;
  if (status === "sending") return "…";
  if (status === "queued") return hasServerId ? "✓" : "…";
  if (status === "delivered") return "✓✓";
  if (status === "read") return "✓✓";
  if (status === "error") return "!";
  return "";
}

function statusTitle(m: ChatMessage): string {
  const status = m.status;
  if (!status) return "";
  const hasServerId = typeof m.id === "number" && Number.isFinite(m.id) && m.id > 0;
  if (status === "sending") return "Отправляется…";
  if (status === "queued") return hasServerId ? "В очереди (адресат оффлайн)" : "В очереди (нет соединения)";
  if (status === "delivered") return "Доставлено";
  if (status === "read") return "Прочитано";
  if (status === "error") return "Ошибка отправки";
  return "";
}

function skeletonLine(widthPct: number, cls = "skel-line"): HTMLElement {
  const w = Math.max(8, Math.min(100, Math.round(widthPct)));
  return el("div", { class: cls, style: `width: ${w}%;` }, [""]);
}

function skeletonMsg(kind: "in" | "out", seed: number): HTMLElement {
  const variants: Array<[number, number, number]> = [
    [76, 42, 22],
    [64, 30, 18],
    [82, 54, 26],
    [58, 36, 20],
    [70, 46, 24],
  ];
  const v = variants[Math.abs(seed) % variants.length] || variants[0];
  const body = el("div", { class: "msg-body" }, [
    skeletonLine(v[0], "skel-line"),
    skeletonLine(v[1], "skel-line"),
    skeletonLine(v[2], "skel-line skel-meta"),
  ]);
  const children: HTMLElement[] = [];
  if (kind === "in") {
    children.push(el("div", { class: "msg-avatar" }, [el("span", { class: "avatar avatar-skel", "aria-hidden": "true" }, [""])]));
  }
  children.push(body);
  return el("div", { class: `msg msg-${kind} msg-skel`, "aria-hidden": "true" }, children);
}

function splitUrlToken(raw: string): { href: string; label: string; trailing: string } {
  let token = raw;
  let trailing = "";
  // Strip trailing punctuation, keep it outside the link.
  while (token.length && /[)\].,!?:;]+$/.test(token)) {
    trailing = token.slice(-1) + trailing;
    token = token.slice(0, -1);
  }
  const href = token;
  return { href, label: token, trailing };
}

function renderRichText(text: string): Array<HTMLElement | string> {
  const s = String(text ?? "");
  if (!s) return [""];
  // Note: keep it conservative; avoid any HTML injection.
  const re = /(https?:\/\/[^\s<]+|@[a-z0-9_]{3,16})/gi;
  const out: Array<HTMLElement | string> = [];
  let last = 0;
  for (;;) {
    const m = re.exec(s);
    if (!m) break;
    const idx = m.index;
    if (idx > last) out.push(s.slice(last, idx));
    const token = m[0] || "";
    if (token.startsWith("@")) {
      out.push(el("span", { class: "msg-mention" }, [token]));
    } else {
      const { href, label, trailing } = splitUrlToken(token);
      const base = typeof location !== "undefined" ? location.href : "http://localhost/";
      const safeHref = safeUrl(href, { base, allowedProtocols: ["http:", "https:"] });
      if (safeHref) {
        out.push(el("a", { class: "msg-link", href: safeHref, target: "_blank", rel: "noopener noreferrer" }, [label]));
      } else {
        out.push(label);
      }
      if (trailing) out.push(trailing);
    }
    last = idx + token.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out.length ? out : [s];
}

function messageLine(state: AppState, m: ChatMessage): HTMLElement {
  function sysActions(payload: any): HTMLElement | null {
    if (!payload || typeof payload !== "object") return null;
    const kind = String(payload.kind || "");
    const buttons: HTMLElement[] = [];

    const btn = (
      label: string,
      attrs: Record<string, string>,
      cls: string
    ): HTMLElement => el("button", { class: `btn msg-action-btn ${cls}`.trim(), type: "button", ...attrs }, [label]);

    if (kind === "auth_in") {
      const peer = String(payload.peer || "").trim();
      if (peer) {
        buttons.push(btn("Принять", { "data-action": "auth-accept", "data-peer": peer }, "btn-primary"));
        buttons.push(btn("Отклонить", { "data-action": "auth-decline", "data-peer": peer }, "btn-danger"));
      }
    } else if (kind === "auth_out") {
      const peer = String(payload.peer || "").trim();
      if (peer) {
        buttons.push(btn("Отменить", { "data-action": "auth-cancel", "data-peer": peer }, "btn-danger"));
      }
    } else if (kind === "group_invite") {
      const groupId = String(payload.groupId || payload.group_id || "").trim();
      if (groupId) {
        buttons.push(btn("Принять", { "data-action": "group-invite-accept", "data-group-id": groupId }, "btn-primary"));
        buttons.push(btn("Отклонить", { "data-action": "group-invite-decline", "data-group-id": groupId }, "btn-danger"));
      }
    } else if (kind === "group_join_request") {
      const groupId = String(payload.groupId || payload.group_id || "").trim();
      const peer = String(payload.from || payload.peer || "").trim();
      if (groupId && peer) {
        buttons.push(
          btn("Принять", { "data-action": "group-join-accept", "data-group-id": groupId, "data-peer": peer }, "btn-primary")
        );
        buttons.push(
          btn("Отклонить", { "data-action": "group-join-decline", "data-group-id": groupId, "data-peer": peer }, "btn-danger")
        );
      }
    } else if (kind === "board_invite") {
      const boardId = String(payload.boardId || payload.board_id || "").trim();
      if (boardId) {
        buttons.push(btn("Принять", { "data-action": "board-invite-accept", "data-board-id": boardId }, "btn-primary"));
        buttons.push(btn("Отклонить", { "data-action": "board-invite-decline", "data-board-id": boardId }, "btn-danger"));
      }
    }

    if (!buttons.length) return null;
    return el("div", { class: "msg-actions" }, buttons);
  }

  if (m.kind === "sys") {
    const bodyChildren: HTMLElement[] = [el("div", { class: "msg-text" }, renderRichText(m.text))];
    if (m.attachment?.kind === "action") {
      const actions = sysActions(m.attachment.payload);
      if (actions) bodyChildren.push(actions);
    }
    return el("div", { class: "msg msg-sys" }, [
      el("div", { class: "msg-body" }, bodyChildren),
    ]);
  }
  const fromId = String(m.from || "").trim();
  const showFrom = m.kind === "in" && Boolean(m.room);
  const fromLabel = fromId || "—";
  const status = m.kind === "out" ? statusLabel(m) : "";
  const meta: HTMLElement[] = [el("span", { class: "msg-time" }, [formatTime(m.ts)])];
  if (m.edited) {
    const editedTs = typeof m.edited_ts === "number" && Number.isFinite(m.edited_ts) ? m.edited_ts : null;
    const time = editedTs !== null ? formatTime(editedTs) : "";
    meta.push(
      el(
        "span",
        { class: "msg-edited", "aria-label": "Изменено", ...(time ? { title: `Изменено: ${time}` } : {}) },
        [time ? `изменено ${time}` : "изменено"]
      )
    );
  }
  if (status)
    meta.push(el("span", { class: `msg-status msg-status-${m.status || "delivered"}`, title: statusTitle(m) || undefined }, [status]));
  const bodyChildren: HTMLElement[] = [];
  if (showFrom) bodyChildren.push(el("div", { class: "msg-from" }, [fromLabel]));
  if (m.attachment?.kind === "file") {
    const att = m.attachment;
    const transfer =
      (att.localId ? state.fileTransfers.find((t) => t.localId === att.localId) : null) ||
      (att.fileId ? state.fileTransfers.find((t) => t.id === att.fileId) : null) ||
      null;
    const offer = !transfer && att.fileId ? state.fileOffersIn.find((o) => o.id === att.fileId) : null;
    const name = String(transfer?.name || offer?.name || att.name || "файл");
    const size = Number(transfer?.size ?? offer?.size ?? att.size ?? 0) || 0;
    const base = typeof location !== "undefined" ? location.href : "http://localhost/";
    const url = transfer?.url ? safeUrl(transfer.url, { base, allowedProtocols: ["http:", "https:", "blob:"] }) : null;
    const statusLine = transfer ? transferStatus(transfer) : offer ? "Входящий файл (принять в «Файлы» / F7)" : "";

    const metaEls: HTMLElement[] = [];
    metaEls.push(el("div", { class: "file-meta" }, [`Размер: ${formatBytes(size)}`]));
    if (statusLine) metaEls.push(el("div", { class: "file-meta" }, [statusLine]));
    if (transfer?.acceptedBy?.length) metaEls.push(el("div", { class: "file-meta" }, [`Приняли: ${transfer.acceptedBy.join(", ")}`]));
    if (transfer?.receivedBy?.length) metaEls.push(el("div", { class: "file-meta" }, [`Получили: ${transfer.receivedBy.join(", ")}`]));

    const badge = fileBadge(name, att.mime);
    const icon = el("span", { class: `file-icon file-icon-${badge.kind}`, "aria-hidden": "true" }, [badge.label]);
    icon.style.setProperty("--file-h", String(badge.hue));
    const mainChildren: HTMLElement[] = [el("div", { class: "file-title" }, [icon, el("div", { class: "file-name" }, [name])]), ...metaEls];
    if (transfer && (transfer.status === "uploading" || transfer.status === "downloading")) {
      const bar = el("div", { class: "file-progress-bar" });
      bar.style.width = `${Math.max(0, Math.min(100, Math.round(transfer.progress || 0)))}%`;
      mainChildren.push(el("div", { class: "file-progress" }, [bar]));
    }

    const actions: HTMLElement[] = [];
    if (offer?.id) {
      actions.push(
        el(
          "button",
          { class: "btn btn-primary file-action file-action-accept", type: "button", "data-action": "file-accept", "data-file-id": offer.id, "aria-label": `Принять: ${name}` },
          ["Принять"]
        )
      );
    } else if (url) {
      actions.push(el("a", { class: "btn file-action file-action-download", href: url, download: name }, ["Скачать"]));
    } else if (att.fileId) {
      actions.push(
        el(
          "button",
          { class: "btn file-action file-action-download", type: "button", "data-action": "file-download", "data-file-id": att.fileId, "aria-label": `Скачать: ${name}` },
          ["Скачать"]
        )
      );
    }

    const rowChildren: HTMLElement[] = [
      el("div", { class: "file-main" }, mainChildren),
      el("div", { class: "file-actions" }, actions),
    ];

    const isImage = isImageFile(name, att.mime);
    if (isImage) {
      const attrs: Record<string, string | undefined> = {
        class: url ? "chat-file-preview" : "chat-file-preview chat-file-preview-empty",
        type: "button",
        "data-action": "open-file-viewer",
        "data-name": name,
        "data-size": String(size || 0),
        "aria-label": `Открыть: ${name}`,
      };
      if (url) attrs["data-url"] = url;
      if (!url && att.fileId) attrs["data-file-id"] = String(att.fileId);
      if (att.mime) attrs["data-mime"] = String(att.mime);

      const child = url
        ? el("img", { class: "chat-file-img", src: url, alt: name, loading: "lazy", decoding: "async" })
        : el("div", { class: "chat-file-placeholder", "aria-hidden": "true" }, ["Фото"]);
    if (url || att.fileId) {
      rowChildren.unshift(el("button", attrs, [child]));
    }
  }

    const hasProgress = Boolean(transfer && (transfer.status === "uploading" || transfer.status === "downloading"));
    const fileRowClass = isImage ? `file-row file-row-chat file-row-image${hasProgress ? " file-row-progress" : ""}` : "file-row file-row-chat";
    bodyChildren.push(el("div", { class: fileRowClass }, rowChildren));
    const caption = String(m.text || "").trim();
    if (caption && !caption.startsWith("[file]")) {
      bodyChildren.push(el("div", { class: "msg-text msg-caption" }, renderRichText(caption)));
    }
  } else {
    bodyChildren.push(el("div", { class: "msg-text" }, renderRichText(m.text)));
  }
  bodyChildren.push(el("div", { class: "msg-meta" }, meta));
  const lineChildren: HTMLElement[] = [];
  if (m.kind === "in" && fromId) {
    lineChildren.push(el("div", { class: "msg-avatar" }, [avatar("dm", fromId)]));
  }
  lineChildren.push(el("div", { class: "msg-body" }, bodyChildren));
  const cls = m.attachment ? `msg msg-${m.kind} msg-attach` : `msg msg-${m.kind}`;
  return el("div", { class: cls }, lineChildren);
}

export function renderChat(layout: Layout, state: AppState) {
  const scrollHost = layout.chatHost;
  const key = state.selected ? conversationKey(state.selected) : "";
  const prevKey = String(scrollHost.getAttribute("data-chat-key") || "");
  const keyChanged = key !== prevKey;
  const atBottom = scrollHost.scrollTop + scrollHost.clientHeight >= scrollHost.scrollHeight - 24;
  const stickToBottom = keyChanged || atBottom;
  scrollHost.setAttribute("data-chat-key", key);

  const msgs = (key && state.conversations[key]) || [];
  const hasMore = Boolean(key && state.historyHasMore && state.historyHasMore[key]);
  const loadingMore = Boolean(key && state.historyLoading && state.historyLoading[key]);
  const lines: HTMLElement[] = [];
  const searchActive = Boolean(state.chatSearchOpen && state.chatSearchQuery.trim());
  const hits = searchActive ? state.chatSearchHits || [] : [];
  const hitSet = searchActive && hits.length ? new Set(hits) : null;
  const activePos = searchActive ? Math.max(0, Math.min(hits.length ? hits.length - 1 : 0, state.chatSearchPos | 0)) : 0;
  const activeMsgIdx = searchActive && hits.length ? hits[activePos] : null;
  let prevDay = "";
  let prevMsg: ChatMessage | null = null;
  let msgIdx = 0;
  for (const m of msgs) {
    const dk = dayKey(m.ts);
    if (dk && dk !== prevDay) {
      prevDay = dk;
      lines.push(el("div", { class: "msg-sep", "aria-hidden": "true" }, [el("span", { class: "msg-sep-text" }, [formatDayLabel(m.ts)])]));
      prevMsg = null;
    }
    const line = messageLine(state, m);
    if (m.kind !== "sys" && isMessageContinuation(prevMsg, m)) line.classList.add("msg-cont");
    line.setAttribute("data-msg-idx", String(msgIdx));
    if (hitSet?.has(msgIdx)) line.classList.add("msg-hit");
    if (activeMsgIdx === msgIdx) line.classList.add("msg-hit-active");
    lines.push(line);
    msgIdx += 1;
    prevMsg = m.kind === "sys" ? null : m;
  }

  if (key && (hasMore || loadingMore)) {
    const btn = el(
      "button",
      {
        class: loadingMore ? "btn chat-history-more btn-loading" : "btn chat-history-more",
        type: "button",
        "data-action": "chat-history-more",
        ...(loadingMore ? { disabled: "true" } : {}),
      },
      [loadingMore ? "Загрузка…" : "Показать предыдущие сообщения"]
    );
    lines.unshift(el("div", { class: "chat-history-more-wrap" }, [btn]));
  }

  if (!lines.length) {
    if (!state.selected) {
      layout.chatTop.replaceChildren(el("div", { class: "chat-title" }, ["Сообщения"]));
      scrollHost.replaceChildren(
        el("div", { class: "chat-empty" }, [
          el("div", { class: "chat-empty-title" }, ["Выберите чат или контакт слева"]),
          el("div", { class: "chat-empty-sub" }, ["F3 — поиск, F5/F6 — создать"]),
        ])
      );
      layout.chatJump.classList.add("hidden");
      return;
    }
    const loaded = key ? Boolean(state.historyLoaded[key]) : true;
    if (!loaded) {
      for (let i = 0; i < 7; i += 1) {
        lines.push(skeletonMsg(i % 2 === 0 ? "in" : "out", i));
      }
    } else {
      lines.push(el("div", { class: "chat-empty" }, [el("div", { class: "chat-empty-title" }, ["Пока нет сообщений"])]));
    }
  }
  const titleChildren: Array<string | HTMLElement> = [...chatTitleNodes(state)];
  if (state.selected) {
    titleChildren.push(el("span", { class: "chat-title-spacer", "aria-hidden": "true" }, [""]));
    titleChildren.push(
      el(
        "button",
        {
          class: state.chatSearchOpen ? "btn chat-search-toggle btn-active" : "btn chat-search-toggle",
          type: "button",
          "data-action": state.chatSearchOpen ? "chat-search-close" : "chat-search-open",
          title: "Поиск в чате (Ctrl+F)",
          "aria-label": "Поиск в чате",
        },
        [state.chatSearchOpen ? "Закрыть поиск" : "Поиск"]
      )
    );
  }

  let searchBar: HTMLElement | null = null;
  if (state.selected && state.chatSearchOpen) {
    const input = el("input", {
      class: "modal-input chat-search-input",
      id: "chat-search-input",
      type: "search",
      placeholder: "Найти в чате…",
      "data-ios-assistant": "off",
      autocomplete: "off",
      autocorrect: "off",
      autocapitalize: "off",
      spellcheck: "false",
      inputmode: "text",
      enterkeyhint: "search",
    }) as HTMLInputElement;
    input.value = state.chatSearchQuery || "";
    const total = hits.length;
    const countLabel = total ? `${Math.min(activePos + 1, total)}/${total}` : "0";
    const btnPrev = el(
      "button",
      { class: "btn chat-search-nav", type: "button", "data-action": "chat-search-prev", ...(total ? {} : { disabled: "true" }) },
      ["↑"]
    );
    const btnNext = el(
      "button",
      { class: "btn chat-search-nav", type: "button", "data-action": "chat-search-next", ...(total ? {} : { disabled: "true" }) },
      ["↓"]
    );
    const btnClose = el("button", { class: "btn chat-search-close", type: "button", "data-action": "chat-search-close", title: "Закрыть" }, ["×"]);
    searchBar = el("div", { class: "chat-search" }, [
      input,
      el("span", { class: "chat-search-count", "aria-live": "polite" }, [countLabel]),
      btnPrev,
      btnNext,
      btnClose,
    ]);
  }

  let pinnedBar: HTMLElement | null = null;
  const pinnedIds = key && state.pinnedMessages ? state.pinnedMessages[key] : null;
  if (Array.isArray(pinnedIds) && pinnedIds.length) {
    const activeRaw = key && state.pinnedMessageActive ? state.pinnedMessageActive[key] : null;
    const activeId = typeof activeRaw === "number" && pinnedIds.includes(activeRaw) ? activeRaw : pinnedIds[0];
    const activeIdx = Math.max(0, pinnedIds.indexOf(activeId));
    const pinnedMsg = msgs.find((m) => typeof m.id === "number" && m.id === activeId) || null;
    const preview =
      pinnedMsg?.attachment?.kind === "file"
        ? `Файл: ${String(pinnedMsg.attachment.name || "файл")}`
        : String(pinnedMsg?.text || "").trim() || `Сообщение #${activeId}`;
    const titleNodes: Array<string | HTMLElement> = ["Закреплено"];
    if (pinnedIds.length > 1) {
      titleNodes.push(
        el("span", { class: "chat-pinned-count", "aria-label": `Закреп ${activeIdx + 1} из ${pinnedIds.length}` }, [
          `${activeIdx + 1}/${pinnedIds.length}`,
        ])
      );
    }

    const jumpBtn = el("button", { class: "chat-pinned-body", type: "button", "data-action": "chat-pinned-jump", "aria-label": "Показать закреплённое сообщение" }, [
      el("div", { class: "chat-pinned-title" }, titleNodes),
      el("div", { class: "chat-pinned-text" }, [preview.length > 140 ? `${preview.slice(0, 137)}…` : preview]),
    ]);
    const closeBtn = el("button", { class: "btn chat-pinned-close", type: "button", "data-action": "chat-pinned-unpin", "aria-label": "Открепить" }, [
      "×",
    ]);
    const actions: HTMLElement[] = [];
    if (pinnedIds.length > 1) {
      actions.push(el("button", { class: "btn chat-pinned-nav", type: "button", "data-action": "chat-pinned-prev", "aria-label": "Предыдущий закреп" }, ["↑"]));
      actions.push(el("button", { class: "btn chat-pinned-nav", type: "button", "data-action": "chat-pinned-next", "aria-label": "Следующий закреп" }, ["↓"]));
    }
    actions.push(closeBtn);
    pinnedBar = el("div", { class: "chat-pinned", role: "note" }, [
      jumpBtn,
      el("div", { class: "chat-pinned-actions" }, actions),
    ]);
  }

  const topChildren: HTMLElement[] = [el("div", { class: "chat-title" }, titleChildren)];
  if (pinnedBar) topChildren.push(pinnedBar);
  if (searchBar) topChildren.push(searchBar);
  layout.chatTop.replaceChildren(...topChildren);
  scrollHost.replaceChildren(el("div", { class: "chat-lines" }, lines));
  layout.chatJump.classList.toggle("hidden", stickToBottom);
  if (stickToBottom && key) {
    queueMicrotask(() => {
      if (String(scrollHost.getAttribute("data-chat-key") || "") !== key) return;
      scrollHost.scrollTop = scrollHost.scrollHeight;
    });
  }
}
