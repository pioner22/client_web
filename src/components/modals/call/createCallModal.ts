import type { AppState } from "../../../stores/types";
import { getMeetBaseUrl } from "../../../config/env";
import { el } from "../../../helpers/dom/el";
import { buildMeetJoinUrl } from "../../../helpers/calls/meetUrl";
import { loadJitsiExternalApi, resolveJitsiApiDomain, resolveJitsiExternalApiScriptUrl } from "../../../helpers/calls/jitsiExternalApi";
import { copyText } from "../../../helpers/dom/copyText";
import { avatarHue, avatarMonogram, getStoredAvatar } from "../../../helpers/avatar/avatarStore";

export interface CallModalActions {
  onHangup: () => void;
  onAccept: (callId: string) => void;
  onDecline: (callId: string) => void;
  onOpenExternal: (url: string) => void;
}

export interface CallModalController {
  root: HTMLElement;
  update: (state: AppState, modal: Extract<AppState["modal"], { kind: "call" }>) => void;
  destroy: () => void;
}

function normalizeId(value: unknown): string {
  return String(value ?? "").trim();
}

function resolveDmPeerId(state: AppState, modal: Extract<AppState["modal"], { kind: "call" }>): string {
  const incoming = Boolean(modal.incoming);
  const selfId = normalizeId(state.selfId);
  if (incoming) {
    const fromId = normalizeId(modal.from);
    if (fromId && fromId !== selfId) return fromId;
  }
  const toId = normalizeId(modal.to);
  if (toId && toId !== selfId) return toId;
  return incoming ? normalizeId(modal.from) : toId;
}

function resolvePeerLabel(state: AppState, modal: Extract<AppState["modal"], { kind: "call" }>): string {
  const roomId = normalizeId(modal.room);
  if (roomId) {
    const g = (state.groups || []).find((x) => normalizeId(x.id) === roomId);
    const name = normalizeId(g?.name);
    return name || roomId;
  }
  const peerId = resolveDmPeerId(state, modal);
  const p = peerId ? state.profiles?.[peerId] : null;
  const friend = peerId ? (state.friends || []).find((f) => normalizeId(f.id) === peerId) : null;
  const dn = normalizeId(friend?.display_name || p?.display_name);
  if (dn) return dn;
  const h = normalizeId(friend?.handle || p?.handle);
  if (h) return h.startsWith("@") ? h : `@${h}`;
  return peerId || "Звонок";
}

function resolvePeerAvatar(state: AppState, modal: Extract<AppState["modal"], { kind: "call" }>): { kind: "dm" | "group"; id: string } | null {
  const roomId = normalizeId(modal.room);
  if (roomId) return { kind: "group", id: roomId };
  const peerId = resolveDmPeerId(state, modal);
  return peerId ? { kind: "dm", id: peerId } : null;
}

function formatPhaseLabel(modal: Extract<AppState["modal"], { kind: "call" }>): string {
  const incoming = Boolean(modal.incoming);
  const phase = modal.phase ?? (modal.callId && modal.roomName ? "active" : modal.roomName ? "ringing" : "creating");
  if (phase === "active") return "в звонке";
  if (phase === "ringing") return incoming ? "входящий…" : "звоним…";
  return "создание…";
}

function formatDuration(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}:${String(s).padStart(2, "0")}`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}:${String(mm).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function createCallModal(actions: CallModalActions): CallModalController {
  const titleEl = el("div", { class: "call-peer-title" }, ["Звонок"]);
  const subEl = el("div", { class: "call-peer-sub" }, [""]);

  const openExternalBtn = el("button", { class: "btn call-top-btn", type: "button", title: "Открыть отдельно", "aria-label": "Открыть отдельно", "data-icon": "open" }, []) as HTMLButtonElement;
  const copyDefaultLabel = "Скопировать ссылку";
  const copyBtn = el("button", { class: "btn call-top-btn", type: "button", title: copyDefaultLabel, "aria-label": copyDefaultLabel, "data-icon": "copy" }, []) as HTMLButtonElement;

  const top = el("div", { class: "call-topbar" }, [
    el("div", { class: "call-peer" }, [titleEl, subEl]),
    el("div", { class: "call-top-actions" }, [openExternalBtn, copyBtn]),
  ]);

  let avatarKindId: { kind: "dm" | "group"; id: string } = { kind: "dm", id: "" };
  const avatarEl = el("div", { class: "call-avatar", "aria-hidden": "true" }, [""]);
  const heroTitleEl = el("div", { class: "call-hero-title" }, ["Звонок"]);
  const heroSubEl = el("div", { class: "call-hero-sub" }, [""]);
  const hero = el("div", { class: "call-hero" }, [avatarEl, heroTitleEl, heroSubEl]);

  const surface = el("div", { class: "call-surface" }, [hero]);
  const jitsiHost = el("div", { class: "call-jitsi" }, []);

  const micBtn = el("button", { class: "call-ctl call-ctl-action", type: "button", disabled: "true", title: "Микрофон", "aria-label": "Микрофон", "data-icon": "mic" }, []) as HTMLButtonElement;
  const camBtn = el("button", { class: "call-ctl call-ctl-action", type: "button", disabled: "true", title: "Камера", "aria-label": "Камера", "data-icon": "cam" }, []) as HTMLButtonElement;
  const hangupBtn = el("button", { class: "call-ctl call-ctl-end", type: "button", title: "Завершить", "aria-label": "Завершить", "data-icon": "hangup" }, []) as HTMLButtonElement;
  const acceptBtn = el("button", { class: "call-ctl call-ctl-accept", type: "button", title: "Принять", "aria-label": "Принять", "data-icon": "accept" }, []) as HTMLButtonElement;
  const declineBtn = el("button", { class: "call-ctl call-ctl-decline", type: "button", title: "Отклонить", "aria-label": "Отклонить", "data-icon": "hangup" }, []) as HTMLButtonElement;

  const controls = el("div", { class: "call-controls" }, [micBtn, camBtn, hangupBtn, acceptBtn, declineBtn]);

  const stage = el("div", { class: "call-stage" }, [top, surface, controls]);
  const root = el("div", { class: "modal modal-call" }, [stage]);

  let activeTimer: number | null = null;
  let activeSinceMs: number | null = null;
  let iframe: HTMLIFrameElement | null = null;
  let jitsiApi: any | null = null;
  let jitsiKey: string = "";
  let jitsiInitToken = 0;
  let jitsiFallbackTimer: number | null = null;
  let audioMuted: boolean | null = null;
  let videoMuted: boolean | null = null;
  let jitsiDisabledKey: string | null = null;
  let lastJoinUrl: string | null = null;
  let lastPhase: string = "";
  let lastIncoming = false;
  let lastCallId = "";
  let ensureAfterAttachToken = 0;

  function stopTimer() {
    if (activeTimer === null) return;
    try {
      window.clearInterval(activeTimer);
    } catch {
      // ignore
    }
    activeTimer = null;
  }

  function startTimer() {
    stopTimer();
    activeTimer = window.setInterval(() => {
      if (!activeSinceMs) return;
      const now = Date.now();
      const dur = formatDuration(now - activeSinceMs);
      const base = String(subEl.dataset.baseLabel || "").trim();
      subEl.textContent = base ? `${base} · ${dur}` : dur;
      heroSubEl.textContent = subEl.textContent || "";
    }, 1000);
  }

  function clearJitsiFallbackTimer() {
    if (jitsiFallbackTimer === null) return;
    try {
      window.clearTimeout(jitsiFallbackTimer);
    } catch {
      // ignore
    }
    jitsiFallbackTimer = null;
  }

  function disposeJitsi() {
    clearJitsiFallbackTimer();
    audioMuted = null;
    videoMuted = null;
    micBtn.disabled = true;
    camBtn.disabled = true;
    micBtn.classList.remove("call-ctl-off", "call-ctl-on");
    camBtn.classList.remove("call-ctl-off", "call-ctl-on");
    if (!jitsiApi) {
      jitsiKey = "";
      return;
    }
    try {
      jitsiApi.dispose?.();
    } catch {
      // ignore
    }
    jitsiApi = null;
    jitsiKey = "";
  }

  function ensureIframe(joinUrl: string, title: string) {
    disposeJitsi();
    if (!iframe) {
      iframe = el("iframe", {
        class: "call-frame",
        allow: "camera; microphone; fullscreen; display-capture; autoplay",
        referrerpolicy: "no-referrer",
        allowfullscreen: "true",
        title,
      }) as HTMLIFrameElement;
    }
    if (iframe.src !== joinUrl) iframe.src = joinUrl;
    if (!surface.contains(iframe)) surface.replaceChildren(iframe);
  }

  function showHero() {
    disposeJitsi();
    if (surface.firstElementChild !== hero) surface.replaceChildren(hero);
  }

  function setMutedUi(btn: HTMLButtonElement, muted: boolean | null) {
    btn.classList.toggle("call-ctl-off", muted === true);
    btn.classList.toggle("call-ctl-on", muted === false);
  }

  async function ensureJitsi(roomName: string, mode: "audio" | "video", joinUrl: string, title: string) {
    const base = getMeetBaseUrl();
    const domain = resolveJitsiApiDomain(base);
    const scriptUrl = resolveJitsiExternalApiScriptUrl(base);
    if (!domain || !scriptUrl) {
      ensureIframe(joinUrl, title);
      return;
    }
    const key = `${domain}:${roomName}:${mode}`;
    if (jitsiDisabledKey === key) {
      ensureIframe(joinUrl, title);
      return;
    }
    if (jitsiApi && jitsiKey === key) return;
    if (!jitsiApi && jitsiKey === key) return; // init in progress

    // Cancel any previous init and dispose any existing instance.
    jitsiInitToken += 1;
    disposeJitsi();
    jitsiKey = key;
    jitsiDisabledKey = null;
    const token = jitsiInitToken;

    // If the External API doesn't load quickly (CSP/network), fall back to plain iframe to keep calls usable.
    clearJitsiFallbackTimer();
    jitsiFallbackTimer = window.setTimeout(() => {
      if (token !== jitsiInitToken) return;
      if (!jitsiApi && joinUrl) ensureIframe(joinUrl, title);
    }, 1800);

    const Ctor = await loadJitsiExternalApi(scriptUrl);
    if (token !== jitsiInitToken) return;
    if (!Ctor) {
      jitsiDisabledKey = key;
      ensureIframe(joinUrl, title);
      return;
    }

    try {
      if (surface.firstElementChild !== jitsiHost) surface.replaceChildren(jitsiHost);
      const configOverwrite: Record<string, unknown> = {
        prejoinPageEnabled: false,
        disableDeepLinking: true,
        startWithVideoMuted: mode === "audio",
        startWithAudioMuted: false,
        toolbarButtons: [],
      };
      const interfaceConfigOverwrite: Record<string, unknown> = {
        TOOLBAR_BUTTONS: [],
        SHOW_JITSI_WATERMARK: false,
        SHOW_WATERMARK_FOR_GUESTS: false,
      };
      jitsiApi = new Ctor(domain, {
        roomName,
        parentNode: jitsiHost,
        width: "100%",
        height: "100%",
        configOverwrite,
        interfaceConfigOverwrite,
      });
    } catch {
      jitsiApi = null;
      jitsiDisabledKey = key;
      ensureIframe(joinUrl, title);
      return;
    } finally {
      clearJitsiFallbackTimer();
    }

    micBtn.disabled = false;
    camBtn.disabled = false;

    try {
      jitsiApi.addEventListener?.("audioMuteStatusChanged", (e: any) => {
        audioMuted = Boolean(e?.muted);
        setMutedUi(micBtn, audioMuted);
      });
      jitsiApi.addEventListener?.("videoMuteStatusChanged", (e: any) => {
        videoMuted = Boolean(e?.muted);
        setMutedUi(camBtn, videoMuted);
      });
      jitsiApi.addEventListener?.("readyToClose", () => {
        actions.onHangup();
      });
    } catch {
      // ignore
    }
  }

  function updateControls(phase: string, incoming: boolean, callId: string) {
    const isIncomingRinging = phase === "ringing" && incoming;
    acceptBtn.classList.toggle("hidden", !isIncomingRinging);
    declineBtn.classList.toggle("hidden", !isIncomingRinging);
    micBtn.classList.toggle("hidden", isIncomingRinging);
    camBtn.classList.toggle("hidden", isIncomingRinging);
    hangupBtn.classList.toggle("hidden", isIncomingRinging);

    acceptBtn.disabled = !callId;
    declineBtn.disabled = !callId;
    hangupBtn.title = phase === "active" ? "Завершить" : "Отменить";
    hangupBtn.setAttribute("aria-label", hangupBtn.title);
  }

  function destroy() {
    stopTimer();
    disposeJitsi();
    jitsiDisabledKey = null;
    activeSinceMs = null;
    lastJoinUrl = null;
    lastPhase = "";
    lastIncoming = false;
    lastCallId = "";
    iframe = null;
    try {
      root.replaceChildren();
    } catch {
      // ignore
    }
  }

  hangupBtn.addEventListener("click", () => {
    try {
      jitsiApi?.executeCommand?.("hangup");
    } catch {
      // ignore
    }
    actions.onHangup();
  });
  micBtn.addEventListener("click", () => {
    try {
      jitsiApi?.executeCommand?.("toggleAudio");
    } catch {
      // ignore
    }
  });
  camBtn.addEventListener("click", () => {
    try {
      jitsiApi?.executeCommand?.("toggleVideo");
    } catch {
      // ignore
    }
  });
  declineBtn.addEventListener("click", () => {
    const cid = String(lastCallId || "").trim();
    if (!cid) return;
    actions.onDecline(cid);
  });
  acceptBtn.addEventListener("click", () => {
    const cid = String(lastCallId || "").trim();
    if (!cid) return;
    actions.onAccept(cid);
  });
  openExternalBtn.addEventListener("click", () => {
    const url = String(lastJoinUrl || "").trim();
    if (!url) return;
    actions.onOpenExternal(url);
  });
  copyBtn.addEventListener("click", async () => {
    const url = String(lastJoinUrl || "").trim();
    if (!url) return;
    const ok = await copyText(url);
    copyBtn.setAttribute("aria-label", ok ? "Скопировано" : "Не удалось");
    window.setTimeout(() => {
      copyBtn.setAttribute("aria-label", copyDefaultLabel);
    }, 2000);
  });

  function update(state: AppState, modal: Extract<AppState["modal"], { kind: "call" }>) {
    const roomName = normalizeId(modal.roomName);
    const mode = modal.mode === "audio" ? "audio" : "video";
    const joinUrl = roomName ? buildMeetJoinUrl(roomName, mode) : null;

    const phase = modal.phase ?? (modal.callId && roomName ? "active" : roomName ? "ringing" : "creating");
    const incoming = Boolean(modal.incoming);
    const callId = normalizeId(modal.callId);
    lastCallId = callId;
    lastJoinUrl = joinUrl;

    const peerLabel = resolvePeerLabel(state, modal);
    const phaseLabel = formatPhaseLabel(modal);
    const modeLabel = mode === "audio" ? "аудио" : "видео";

    titleEl.textContent = peerLabel || "Звонок";
    const baseSub = `${modeLabel} · ${phaseLabel}`;
    subEl.dataset.baseLabel = baseSub;
    subEl.textContent = baseSub;
    heroTitleEl.textContent = peerLabel || "Звонок";
    heroSubEl.textContent = baseSub;

    const av = resolvePeerAvatar(state, modal);
    if (av) {
      avatarKindId.kind = av.kind;
      avatarKindId.id = av.id;
    } else {
      avatarKindId.kind = "dm";
      avatarKindId.id = "";
    }
    const avatarId = avatarKindId.id;
    const avatarUrl = avatarId ? getStoredAvatar(avatarKindId.kind, avatarId) : null;
    avatarEl.style.setProperty("--avatar-h", String(avatarHue(`${avatarKindId.kind}:${avatarId || peerLabel}`)));
    if (avatarUrl) {
      avatarEl.textContent = "";
      avatarEl.style.backgroundImage = `url(${avatarUrl})`;
      avatarEl.classList.add("call-avatar-img");
    } else {
      avatarEl.style.backgroundImage = "";
      avatarEl.classList.remove("call-avatar-img");
      avatarEl.textContent = av ? avatarMonogram(avatarKindId.kind, avatarId) : "—";
    }

    // Open/copy availability.
    openExternalBtn.disabled = !joinUrl;
    copyBtn.disabled = !joinUrl;

    // Preload the Jitsi External API early so join is fast when the call becomes active.
    if (joinUrl) {
      const base = getMeetBaseUrl();
      const scriptUrl = resolveJitsiExternalApiScriptUrl(base);
      if (scriptUrl) {
        try {
          void loadJitsiExternalApi(scriptUrl);
        } catch {
          // ignore
        }
      }
    }

    // Timer: run only in active state (visual only, does not touch the store).
    const phaseKey = `${phase}:${incoming ? "in" : "out"}`;
    if (phaseKey !== `${lastPhase}:${lastIncoming ? "in" : "out"}`) {
      stopTimer();
      activeSinceMs = null;
      if (phase === "active") {
        const since = typeof modal.phaseAt === "number" ? Math.trunc(modal.phaseAt) : Date.now();
        activeSinceMs = Number.isFinite(since) ? since : Date.now();
        startTimer();
      }
    }
    lastPhase = phase;
    lastIncoming = incoming;

    updateControls(phase, incoming, callId);

    // Show meeting as early as possible for outgoing calls: once room exists and we are already "ringing".
    // Incoming ringing still stays on the hero screen until user accepts.
    const shouldShowMeeting = Boolean(joinUrl) && (phase === "active" || (!incoming && phase === "ringing"));
    if (!shouldShowMeeting) {
      showHero();
      return;
    }
    if (!joinUrl) {
      showHero();
      heroSubEl.textContent = "Сервис звонков не настроен";
      return;
    }
    // Prefer the Jitsi External API (enables Telegram-like controls). Fall back to a plain iframe on failure.
    if (!root.isConnected) {
      // renderApp mounts the node after update(); defer Jitsi init to avoid first-open races.
      const tok = (ensureAfterAttachToken += 1);
      showHero();
      queueMicrotask(() => {
        if (tok !== ensureAfterAttachToken) return;
        if (!root.isConnected) return;
        if (lastPhase !== "active") return;
        if (String(lastJoinUrl || "").trim() !== String(joinUrl || "").trim()) return;
        void ensureJitsi(roomName, mode, joinUrl, peerLabel || "Звонок");
      });
      return;
    }
    void ensureJitsi(roomName, mode, joinUrl, peerLabel || "Звонок");
  }

  return { root, update, destroy };
}
