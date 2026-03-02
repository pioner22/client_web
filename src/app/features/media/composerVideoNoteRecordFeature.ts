import { getStoredSessionToken, isSessionAutoAuthBlocked } from "../../../helpers/auth/session";
import { formatMediaAccessError, queryCapturePermissionState } from "../../../helpers/media/permissions";
import { nowTs } from "../../../helpers/time";
import type { Store } from "../../../stores/store";
import type { AppState, TargetRef } from "../../../stores/types";
import type { ToastFn } from "./composerVoiceRecordFeature";

export interface ComposerVideoNoteRecordFeatureDeps {
  store: Store<AppState>;
  videoNoteBtn: HTMLButtonElement;
  showToast: ToastFn;
  openFileSendModal: (files: File[], target: TargetRef) => void;
}

export interface ComposerVideoNoteRecordFeature {
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
  if (mt.includes("webm")) return "webm";
  if (mt.includes("mp4")) return "mp4";
  if (mt.includes("ogg")) return "ogv";
  return "webm";
}

export function createComposerVideoNoteRecordFeature(deps: ComposerVideoNoteRecordFeatureDeps): ComposerVideoNoteRecordFeature {
  const { store, videoNoteBtn, showToast, openFileSendModal } = deps;

  const baseTitle = videoNoteBtn.getAttribute("title") || "Видео-сота";
  const baseAriaLabel = videoNoteBtn.getAttribute("aria-label") || "Записать видеосообщение (сота)";
  let lastUiState: string | null = null;

  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: BlobPart[] = [];
  let startedAt = 0;
  let recordingTarget: TargetRef | null = null;

  const applyPermissionUi = (mic: PermissionState | null, cam: PermissionState | null) => {
    const ui =
      mic === "denied" || cam === "denied"
        ? "denied"
        : mic === "granted" && cam === "granted"
          ? "granted"
          : mic || cam
            ? "prompt"
            : null;
    if (ui === lastUiState) return;
    lastUiState = ui;
    try {
      if (ui) videoNoteBtn.setAttribute("data-media-perm", ui);
      else videoNoteBtn.removeAttribute("data-media-perm");
      if (ui === "denied") {
        const deniedMic = mic === "denied";
        const deniedCam = cam === "denied";
        const suffix = deniedCam && deniedMic ? " (нет доступа к камере и микрофону)" : deniedCam ? " (нет доступа к камере)" : " (нет доступа к микрофону)";
        videoNoteBtn.setAttribute("title", `${baseTitle}${suffix}`);
        videoNoteBtn.setAttribute("aria-label", `${baseAriaLabel}.${suffix}`);
      } else {
        videoNoteBtn.setAttribute("title", baseTitle);
        videoNoteBtn.setAttribute("aria-label", baseAriaLabel);
      }
    } catch {
      // ignore
    }
  };

  const syncPermissionUi = async () => {
    const mic = await queryCapturePermissionState("microphone");
    const cam = await queryCapturePermissionState("camera");
    applyPermissionUi(mic, cam);
  };

  const setRecordingUi = (on: boolean) => {
    try {
      videoNoteBtn.classList.toggle("is-recording", on);
      videoNoteBtn.setAttribute("aria-pressed", on ? "true" : "false");
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

    const micPerm = await queryCapturePermissionState("microphone");
    const camPerm = await queryCapturePermissionState("camera");
    applyPermissionUi(micPerm, camPerm);
    if (micPerm === "denied") {
      showToast("Доступ к микрофону запрещён в настройках сайта/браузера", { kind: "warn", timeoutMs: 9000, placement: "center" });
      return;
    }
    if (camPerm === "denied") {
      showToast("Доступ к камере запрещён в настройках сайта/браузера", { kind: "warn", timeoutMs: 9000, placement: "center" });
      return;
    }

    try {
      stream = await mediaDevices.getUserMedia({
        video: { width: { ideal: 720 }, height: { ideal: 720 }, facingMode: "user" },
        audio: true,
      });
    } catch (error) {
      showToast(formatMediaAccessError("camera_microphone", error), { kind: "warn", timeoutMs: 9000, placement: "center" });
      void syncPermissionUi();
      stopTracks();
      reset();
      return;
    }

    recordingTarget = target;
    chunks = [];
    startedAt = Date.now();

    const mimeType =
      pickSupportedMimeType([
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
        "video/mp4",
      ]) || undefined;
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
        const type = recorder?.mimeType || mimeType || "video/webm";
        stopTracks();
        reset();
        if (!tgt) return;
        if (!nextChunks.length) {
          showToast("Запись слишком короткая", { kind: "info", timeoutMs: 4500, placement: "center" });
          return;
        }
        const blob = new Blob(nextChunks, { type });
        const ext = extForMime(blob.type);
        const name = `video_note_${nowTs()}.${ext}`;
        const file = new File([blob], name, { type: blob.type || "video/webm" });
        openFileSendModal([file], tgt);
        const seconds = Math.round(elapsedMs / 1000);
        if (seconds > 0) showToast(`Видео: ${seconds} сек`, { kind: "success", timeoutMs: 3500 });
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
    showToast("Запись видео… нажмите ещё раз чтобы остановить", { kind: "info", timeoutMs: 5000, placement: "center" });
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
    videoNoteBtn.addEventListener("click", () => {
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
