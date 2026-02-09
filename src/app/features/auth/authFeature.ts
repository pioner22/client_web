import { getStoredSessionToken, isSessionAutoAuthBlocked } from "../../../helpers/auth/session";
import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";

export interface AuthFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => void;
}

export interface AuthFeature {
  resetAutoAuthAttempt: () => void;
  maybeAutoAuthOnConnected: () => void;
  authLoginFromDom: () => void;
  authRegisterFromDom: () => void;
}

export function createAuthFeature(deps: AuthFeatureDeps): AuthFeature {
  const { store, send } = deps;

  let autoAuthAttemptedForConn = false;

  function resetAutoAuthAttempt() {
    autoAuthAttemptedForConn = false;
  }

  function maybeAutoAuthOnConnected() {
    const st = store.get();
    if (st.authed) return;
    const token = getStoredSessionToken();
    if (token && isSessionAutoAuthBlocked()) {
      store.set((prev) => ({
        ...prev,
        authMode: prev.authRememberedId ? "login" : "register",
        status: "Сессия активна в другом окне. Нажмите «Войти», чтобы продолжить здесь.",
      }));
      return;
    }
    if (token && !autoAuthAttemptedForConn) {
      autoAuthAttemptedForConn = true;
      store.set({ status: "Авторизация…" });
      send({ type: "auth", session: token });
      return;
    }
    if (token && autoAuthAttemptedForConn) {
      return;
    }
    store.set((prev) => ({
      ...prev,
      authMode: prev.authRememberedId ? "login" : "register",
      status: prev.authRememberedId
        ? "Связь установлена. Нажмите «Войти», чтобы продолжить."
        : "Связь установлена. Нажмите «Войти», чтобы войти или зарегистрироваться.",
    }));
  }

  function authLoginFromDom() {
    if (store.get().conn !== "connected") {
      store.set({ status: "Нет соединения" });
      return;
    }
    const id = (document.getElementById("auth-id") as HTMLInputElement | null)?.value?.trim() ?? "";
    const pw = (document.getElementById("auth-pw") as HTMLInputElement | null)?.value ?? "";
    if (!id) {
      store.set({ modal: { kind: "auth", message: "Введите ID" } });
      return;
    }
    if (!pw) {
      store.set({ modal: { kind: "auth", message: "Введите пароль" } });
      return;
    }
    send({ type: "auth", id, password: pw });
  }

  function authRegisterFromDom() {
    if (store.get().conn !== "connected") {
      store.set({ status: "Нет соединения" });
      return;
    }
    const pw1 = (document.getElementById("auth-pw1") as HTMLInputElement | null)?.value ?? "";
    const pw2 = (document.getElementById("auth-pw2") as HTMLInputElement | null)?.value ?? "";
    const pw = pw1;
    if (!pw) {
      store.set({ modal: { kind: "auth", message: "Введите пароль для регистрации" } });
      return;
    }
    if (pw1 !== pw2) {
      store.set({ modal: { kind: "auth", message: "Пароли не совпадают" } });
      return;
    }
    send({ type: "register", password: pw });
  }

  return { resetAutoAuthAttempt, maybeAutoAuthOnConnected, authLoginFromDom, authRegisterFromDom };
}

