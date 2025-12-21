/// <reference types="vite/client" />
import { GatewayClient } from "./net/gateway";
import { createLayout } from "./ui/layout";
import type { AppState, ChatMessage, FriendEntry } from "./state";
import { Store } from "./state";
import { el } from "./ui/dom";

declare const __APP_VERSION__: string;

function nowTs(): number {
  return Date.now() / 1000;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function fmtTime(ts: number): string {
  try {
    const d = new Date(ts * 1000);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  } catch {
    return "??:??";
  }
}

function gatewayUrl(): string {
  const u = (import.meta as any).env?.VITE_GATEWAY_URL as string | undefined;
  return (u && u.trim()) || "ws://127.0.0.1:8787/ws";
}

function upsertConv(state: AppState, key: string, msg: ChatMessage): AppState {
  const prev = state.conversations[key] ?? [];
  const next = [...prev, msg].slice(-500);
  return {
    ...state,
    conversations: { ...state.conversations, [key]: next },
  };
}

function parseRoster(msg: any): { friends: FriendEntry[]; pendingIn: string[]; pendingOut: string[] } {
  const friendsRaw = Array.isArray(msg?.friends) ? msg.friends : [];
  const friends: FriendEntry[] = friendsRaw
    .map((x: any) => ({
      id: String(x?.id ?? ""),
      online: Boolean(x?.online),
      unread: Number(x?.unread ?? 0) || 0,
      last_seen_at: (x?.last_seen_at ?? null) as any,
    }))
    .filter((x: FriendEntry) => x.id);
  const pendingIn = (Array.isArray(msg?.pending_in) ? msg.pending_in : []).map((x: any) => String(x)).filter(Boolean);
  const pendingOut = (Array.isArray(msg?.pending_out) ? msg.pending_out : []).map((x: any) => String(x)).filter(Boolean);
  return { friends, pendingIn, pendingOut };
}

export function mountApp(root: HTMLElement) {
  const store = new Store({
    conn: "connecting",
    authed: false,
    selfId: null,
    serverVersion: null,
    clientVersion: __APP_VERSION__,
    status: "Connecting…",
    friends: [],
    pendingIn: [],
    pendingOut: [],
    selectedPeer: null,
    conversations: {},
    input: "",
    modal: { kind: "auth" },
    updateLatest: null,
    updateDismissedLatest: null,
  });

  const layout = createLayout(root);

  const gw = new GatewayClient(
    gatewayUrl(),
    (msg) => {
      const t = String(msg?.type ?? "");
      const st = store.get();

      if (t === "welcome") {
        store.set({
          serverVersion: typeof msg?.server_version === "string" ? msg.server_version : st.serverVersion,
          status: "Handshake OK",
        });
        return;
      }
      if (t === "auth_ok") {
        store.set({
          authed: true,
          selfId: String(msg?.id ?? st.selfId ?? ""),
          modal: null,
          status: "Connected",
        });
        return;
      }
      if (t === "auth_fail") {
        store.set({ modal: { kind: "auth", message: "Неверный пароль" }, status: "Auth failed" });
        return;
      }
      if (t === "register_ok") {
        store.set({
          authed: true,
          selfId: String(msg?.id ?? ""),
          modal: null,
          status: "Registered",
        });
        return;
      }
      if (t === "register_fail") {
        store.set({ modal: { kind: "auth", message: "Регистрация не удалась" }, status: "Register failed" });
        return;
      }
      if (t === "roster_full") {
        const r = parseRoster(msg);
        store.set({ friends: r.friends, pendingIn: r.pendingIn, pendingOut: r.pendingOut });
        return;
      }
      if (t === "message") {
        const from = String(msg?.from ?? "");
        const to = msg?.to ? String(msg.to) : undefined;
        const room = msg?.room ? String(msg.room) : undefined;
        const text = String(msg?.text ?? "");
        const ts = Number(msg?.ts ?? nowTs()) || nowTs();
        const key = room || (from === st.selfId ? (to ?? "") : from);
        if (!key) return;
        const kind: ChatMessage["kind"] = from === st.selfId ? "out" : "in";
        store.set((prev) => upsertConv(prev, key, { kind, from, to, room, text, ts, id: msg?.id ?? null }));
        return;
      }
      if (t === "update_required") {
        const latest = String(msg?.latest ?? "").trim();
        if (!latest) return;
        const dismissed = store.get().updateDismissedLatest;
        if (dismissed && dismissed === latest) return;
        store.set({ updateLatest: latest, modal: { kind: "update" }, status: `Обнаружено обновление до v${latest}` });
        return;
      }
      if (t === "error") {
        const message = String(msg?.message ?? "error");
        store.set({ status: `Ошибка: ${message}` });
        return;
      }
    },
    (conn, detail) => {
      const base = conn === "connected" ? "Связь с сервером установлена" : conn === "connecting" ? "Подключение…" : "Нет соединения";
      store.set({ conn, status: detail ? `${base}: ${detail}` : base });
    }
  );

  gw.connect();

  function sendAuthOrRegister() {
    const id = (document.getElementById("auth-id") as HTMLInputElement | null)?.value?.trim() ?? "";
    const pw = (document.getElementById("auth-pw") as HTMLInputElement | null)?.value ?? "";
    if (!pw) {
      store.set({ modal: { kind: "auth", message: "Введите пароль" } });
      return;
    }
    if (id) {
      gw.send({ type: "auth", id, password: pw });
    } else {
      gw.send({ type: "register", password: pw });
    }
  }

  function sendChat() {
    const st = store.get();
    const text = (st.input || "").trimEnd();
    const to = st.selectedPeer;
    if (!text) return;
    if (!to) {
      store.set({ status: "Выберите контакт слева" });
      return;
    }
    gw.send({ type: "send", to, text });
    store.set({ input: "" });
  }

  layout.input.addEventListener("input", () => {
    store.set({ input: layout.input.value });
    // autosize
    layout.input.style.height = "auto";
    layout.input.style.height = `${Math.min(120, layout.input.scrollHeight)}px`;
  });

  layout.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
    if (e.key === "F1") {
      e.preventDefault();
      store.set({ modal: { kind: "help" } });
    }
    if (e.key === "Escape") {
      const st = store.get();
      if (st.modal?.kind) {
        if (st.modal.kind === "update") {
          store.set({ modal: null, updateDismissedLatest: st.updateLatest });
        } else {
          store.set({ modal: null });
        }
      }
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === "u" || e.key === "U")) {
      e.preventDefault();
      store.set({ modal: { kind: "update" } });
    }
  });

  store.subscribe(() => render(store.get()));
  render(store.get());

  function render(state: AppState) {
    const title = state.selectedPeer ? `Чат с: ${state.selectedPeer}` : "Чат";
    layout.headerLeft.textContent = `Ваш ID: ${state.selfId ?? "—"}  v${state.clientVersion}/srv ${state.serverVersion ?? "—"} |  ${title}`;
    layout.headerRight.textContent = state.status || "";
    layout.hotkeys.replaceChildren(
      ...[
        ["F1", "помощь"],
        ["F2", "профиль"],
        ["F3", "поиск"],
        ["F5", "чат"],
        ["F6", "доска"],
        ["F7", "файлы"],
      ].map(([k, v]) => el("button", { class: "hk-btn", type: "button", "data-key": k }, [`[ ${k} ${v} ]`]))
    );

    // Sidebar
    const online = state.friends.filter((f) => f.online);
    const offline = state.friends.filter((f) => !f.online);
    const pending = state.pendingIn.length;
    layout.sidebar.replaceChildren(
      el("div", { class: "pane-title" }, ["Контакты"]),
      el("div", { class: "pane-section" }, [`Онлайн: ${online.length}`]),
      ...online.map((f) => friendRow(f, state.selectedPeer === f.id)),
      el("div", { class: "pane-section" }, [`Оффлайн: ${offline.length}`]),
      ...offline.map((f) => friendRow(f, state.selectedPeer === f.id)),
      el("div", { class: "pane-section" }, [`Ожидают: ${pending}`])
    );

    // Chat
    const key = state.selectedPeer ?? "";
    const msgs = (key && state.conversations[key]) || [];
    const lines: HTMLElement[] = [];
    for (const m of msgs) {
      const mark = m.kind === "out" ? "Вы" : m.from;
      lines.push(el("div", { class: `msg msg-${m.kind}` }, [`${fmtTime(m.ts)} ${mark}: ${m.text}`]));
    }
    if (!lines.length) {
      lines.push(el("div", { class: "msg msg-sys" }, ["(пусто)"]));
    }
    layout.chat.replaceChildren(el("div", { class: "chat-title" }, [title]), el("div", { class: "chat-lines" }, lines));

    // Footer
    layout.footer.textContent = `Онлайн: ${online.length} | Оффлайн: ${offline.length} | Ожидают: ${pending} | Отправлено: 0 — ${title}`;

    // Overlay (modal)
    if (!state.modal) {
      layout.overlay.classList.add("hidden");
      layout.overlay.replaceChildren();
      return;
    }
    layout.overlay.classList.remove("hidden");
    layout.overlay.replaceChildren(renderModal(state));
  }

  function friendRow(f: FriendEntry, selected: boolean): HTMLElement {
    const star = f.unread > 0 ? "★" : " ";
    const dot = f.online ? "●" : "○";
    const cls = selected ? "row row-sel" : "row";
    const btn = el("button", { class: cls, type: "button" }, [`${star} ${dot} ${f.id}`]);
    btn.addEventListener("click", () => store.set({ selectedPeer: f.id }));
    return btn;
  }

  function renderModal(state: AppState): HTMLElement {
    const box = el("div", { class: "modal" });
    const kind = state.modal?.kind;
    if (kind === "auth") {
      const msg = state.modal?.message;
      box.append(
        el("div", { class: "modal-title" }, ["Авторизация / Регистрация"]),
        el("div", { class: "modal-line" }, ["ID (для входа) — оставьте пустым для регистрации:"]),
        el("input", {
          class: "modal-input",
          id: "auth-id",
          type: "text",
          placeholder: "517-048-184",
          autocomplete: "off",
          autocorrect: "off",
          autocapitalize: "off",
          spellcheck: "false",
          inputmode: "numeric",
          enterkeyhint: "next",
        }),
        el("div", { class: "modal-line" }, ["Пароль:"]),
        el("input", {
          class: "modal-input",
          id: "auth-pw",
          type: "password",
          placeholder: "••••••",
          autocomplete: "current-password",
          autocorrect: "off",
          autocapitalize: "off",
          spellcheck: "false",
          enterkeyhint: "done",
        }),
        msg ? el("div", { class: "modal-warn" }, [msg]) : el("div", { class: "modal-warn" }),
        el("div", { class: "modal-actions" }, [
          el("button", { class: "btn", type: "button" }, ["Enter — продолжить"]),
          el("button", { class: "btn", type: "button" }, ["Esc — закрыть"]),
        ])
      );
      // Focus + key handler
      queueMicrotask(() => (document.getElementById("auth-pw") as HTMLInputElement | null)?.focus());
      box.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          sendAuthOrRegister();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          // auth modal is allowed to stay until authed, but we let user close it
          store.set({ modal: null });
        }
      });
      return box;
    }
    if (kind === "help") {
      box.append(
        el("div", { class: "modal-title" }, ["Подсказка клавиш"]),
        el("div", { class: "modal-line" }, ["F1 — помощь"]),
        el("div", { class: "modal-line" }, ["Ctrl+U — обновление (manual)"]),
        el("div", { class: "modal-line" }, ["Enter — отправить сообщение"]),
        el("div", { class: "modal-line" }, ["Shift+Enter — новая строка"]),
        el("div", { class: "modal-line" }, ["Esc — закрыть окно"])
      );
      return box;
    }
    if (kind === "update") {
      const latest = state.updateLatest ?? "—";
      box.append(
        el("div", { class: "modal-title" }, ["Обнаружено обновление клиента"]),
        el("div", { class: "modal-line" }, [`web ${state.clientVersion} → ${latest}`]),
        el("div", { class: "modal-line" }, ["Ctrl+U или Enter (OK) — обновить"]),
        el("div", { class: "modal-line" }, ["Esc или любая клавиша — позже"])
      );
      box.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          store.set({ modal: null, updateDismissedLatest: state.updateLatest });
        }
        if (e.key === "Enter") {
          e.preventDefault();
          // Пока обновление web-версии — это обновление страницы/сервис-воркера.
          store.set({ modal: null });
          window.location.reload();
        }
      });
      return box;
    }
    box.append(el("div", { class: "modal-title" }, ["Окно"]), el("div", { class: "modal-line" }, ["(в разработке)"]));
    return box;
  }
}
