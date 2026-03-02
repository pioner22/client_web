import { getStoredSessionToken, isSessionAutoAuthBlocked } from "../../../helpers/auth/session";
import { formatMediaAccessError, queryCapturePermissionState } from "../../../helpers/media/permissions";
import { nowTs } from "../../../helpers/time";
import type { Store } from "../../../stores/store";
import type { AppState, TargetRef } from "../../../stores/types";

export type ToastFn = (
  message: string,
  opts?: {
    kind?: "info" | "success" | "warn" | "error";
    timeoutMs?: number;
    placement?: "bottom" | "center";
  }
) => void;

export interface ComposerVoiceRecordFeatureDeps {
  store: Store<AppState>;
  voiceBtn: HTMLButtonElement;
  showToast: ToastFn;
  openFileSendModal: (files: File[], target: TargetRef) => void;
}

export interface ComposerVoiceRecordFeature {
  bind: () => void;
  stop: () => void;
}

function pickSupportedMimeType(candidates: string[]): string | null {
  const MR = (globalThis as any).MediaRecorder as typeof MediaRecorder | undefined;
  if (!MR || typeof MR.isTypeSupported !== "function") return null;
  for (const c of candidates) {
    const t = String(c || "").trim();
    if (!t) continue;
    try {
      if (MR.isTypeSupported(t)) return t;
    } catch {
      // ignore
    }
  }
  return null;
}

function extForMime(mimeRaw: string): string {
  const mt = String(mimeRaw || "").toLowerCase();
  if (!mt) return "webm";
  if (mt.includes("ogg") || mt.includes("opus")) return "ogg";
  if (mt.includes("webm")) return "webm";
  if (mt.includes("mp4")) return "m4a";
  if (mt.includes("mpeg")) return "mp3";
  return "webm";
}

export function createComposerVoiceRecordFeature(deps: ComposerVoiceRecordFeatureDeps): ComposerVoiceRecordFeature {
  const { store, voiceBtn, showToast, openFileSendModal } = deps;

  const baseTitle = voiceBtn.getAttribute("title") || "Голосовое";
  const baseAriaLabel = voiceBtn.getAttribute("aria-label") || "Записать голосовое сообщение";
  let lastPermState: PermissionState | null = null;

  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: BlobPart[] = [];
  let startedAt = 0;
  let recordingTarget: TargetRef | null = null;

  const applyPermissionUi = (state: PermissionState | null) => {
    if (state === lastPermState) return;
    lastPermState = state;
    try {
      if (state) voiceBtn.setAttribute("data-media-perm", state);
      else voiceBtn.removeAttribute("data-media-perm");
      if (state === "denied") {
        voiceBtn.setAttribute("title", `${baseTitle} (нет доступа к микрофону)`);
        voiceBtn.setAttribute("aria-label", `${baseAriaLabel}. Нет доступа к микрофону.`);
      } else {
        voiceBtn.setAttribute("title", baseTitle);
        voiceBtn.setAttribute("aria-label", baseAriaLabel);
      }
    } catch {
      // ignore
    }
  };

  const syncPermissionUi = async () => {
    const state = await queryCapturePermissionState("microphone");
    applyPermissionUi(state);
  };

  const setRecordingUi = (on: boolean) => {
    try {
      voiceBtn.classList.toggle("is-recording", on);
      voiceBtn.setAttribute("aria-pressed", on ? "true" : "false");
    } catch {
      // ignore
    }
  };

  const stopTracks = () => {
    try {
      for (const t of stream?.getTracks() ?? []) t.stop();
    } catch {
      // ignore
    }
    stream = null;
  };

  const reset = () => {
    try {
      recorder = null;
      chunks = [];
      startedAt = 0;
      recordingTarget = null;
      setRecordingUi(false);
    } catch {
      // ignore
    }
  };

  const stop = () => {
    try {
      recorder?.stop();
    } catch {
      // ignore
    } finally {
      stopTracks();
      reset();
    }
  };

  function ensureSendContext(): TargetRef | null {
    const st = store.get();
    if (st.conn !== "connected") {
      store.set({ status: "Нет соединения" });
      showToast("Нет соединения", { kind: "warn", timeoutMs: 4500 });
      return null;
    }
    if (!st.authed) {
      const token = getStoredSessionToken();
      if (token) {
        if (isSessionAutoAuthBlocked()) {
          store.set({
            authMode: st.authRememberedId ? "login" : "register",
            modal: { kind: "auth", message: "Сессия активна в другом окне. Чтобы продолжить здесь — войдите снова." },
          });
          return null;
        }
        store.set({ status: "Авторизация… подождите" });
        showToast("Авторизация…", { kind: "info", timeoutMs: 3500 });
        return null;
      }
      store.set({ modal: { kind: "auth", message: "Сначала войдите или зарегистрируйтесь" } });
      return null;
    }
    const target = st.selected;
    if (!target) {
      store.set({ status: "Выберите контакт или чат слева" });
      showToast("Выберите чат слева", { kind: "info", timeoutMs: 4500 });
      return null;
    }
    if (st.modal && st.modal.kind !== "context_menu") {
      showToast("Сначала закройте окно", { kind: "info", timeoutMs: 4500 });
      return null;
    }
    return target;
  }

  async function startRecording(target: TargetRef) {
    if (recorder) return;
    if (typeof window !== "undefined" && !window.isSecureContext) {
      showToast("Запись доступна только по HTTPS", { kind: "warn", timeoutMs: 9000, placement: "center" });
      return;
    }
    const mediaDevices = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!mediaDevices?.getUserMedia) {
      showToast("Запись не поддерживается в этом браузере", { kind: "warn", timeoutMs: 7000, placement: "center" });
      return;
    }
    const MR = (globalThis as any).MediaRecorder as typeof MediaRecorder | undefined;
    if (!MR) {
      showToast("Запись не поддерживается в этом браузере", { kind: "warn", timeoutMs: 7000, placement: "center" });
      return;
    }
    const perm = await queryCapturePermissionState("microphone");
    applyPermissionUi(perm);
    if (perm === "denied") {
      showToast("Доступ к микрофону запрещён в настройках сайта/браузера", { kind: "warn", timeoutMs: 9000, placement: "center" });
      return;
    }
    try {
      stream = await mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (error) {
      showToast(formatMediaAccessError("microphone", error), { kind: "warn", timeoutMs: 9000, placement: "center" });
      void syncPermissionUi();
      stopTracks();
      reset();
      return;
    }

    recordingTarget = target;
    chunks = [];
    startedAt = Date.now();

    const mimeType =
      pickSupportedMimeType(["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"]) || undefined;
    try {
      recorder = mimeType ? new MR(stream, { mimeType }) : new MR(stream);
    } catch (error) {
      void error;
      showToast("Не удалось начать запись", { kind: "error", timeoutMs: 7000, placement: "center" });
      stopTracks();
      reset();
      return;
    }

    recorder.addEventListener("dataavailable", (e) => {
      try {
        const data = (e as BlobEvent).data;
        if (data && data.size > 0) chunks.push(data);
      } catch {
        // ignore
      }
    });

    recorder.addEventListener(
      "stop",
      () => {
        const tgt = recordingTarget;
        const elapsedMs = startedAt ? Math.max(0, Date.now() - startedAt) : 0;
        const nextChunks = chunks.slice();
        const type = recorder?.mimeType || mimeType || "audio/webm";
        stopTracks();
        reset();
        if (!tgt) return;
        if (!nextChunks.length) {
          showToast("Запись слишком короткая", { kind: "info", timeoutMs: 4500, placement: "center" });
          return;
        }
        const blob = new Blob(nextChunks, { type });
        const ext = extForMime(blob.type);
        const name = `voice_${nowTs()}.${ext}`;
        const file = new File([blob], name, { type: blob.type || "audio/webm" });
        openFileSendModal([file], tgt);
        const seconds = Math.round(elapsedMs / 1000);
        if (seconds > 0) showToast(`Голосовое: ${seconds} сек`, { kind: "success", timeoutMs: 3500 });
      },
      { once: true }
    );

    try {
      recorder.start();
    } catch (error) {
      void error;
      showToast("Не удалось начать запись", { kind: "error", timeoutMs: 7000, placement: "center" });
      stopTracks();
      reset();
      return;
    }
    setRecordingUi(true);
    showToast("Запись голосового… нажмите ещё раз чтобы остановить", { kind: "info", timeoutMs: 5000, placement: "center" });
  }

  const bind = () => {
    void syncPermissionUi();
    try {
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) void syncPermissionUi();
      });
      window.addEventListener("focus", () => void syncPermissionUi());
    } catch {
      // ignore
    }
    voiceBtn.addEventListener("click", () => {
      if (recorder) {
        try {
          recorder.stop();
        } catch {
          stop();
        }
        return;
      }
      const target = ensureSendContext();
      if (!target) return;
      void startRecording(target);
    });
  };

  return { bind, stop };
}
