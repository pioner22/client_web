import type { Store } from "../../../stores/store";
import type { AppState, ThemeMode } from "../../../stores/types";

export interface AuthUiActionsFeatureDeps {
  store: Store<AppState>;
  logout: () => void;
  authLoginFromDom: () => void;
  authRegisterFromDom: () => void;
  closeModal: () => void;
  forceUpdateReload: (reason: string) => void;
  applyPwaUpdateNow: () => Promise<void> | void;
  setSkin: (skinId: string) => void;
  setTheme: (theme: ThemeMode) => void;
}

export interface AuthUiActionsFeature {
  onAuthOpen: () => void;
  onAuthLogout: () => void;
  onAuthLogin: () => void;
  onAuthRegister: () => void;
  onAuthModeChange: (mode: "register" | "login") => void;
  onCloseModal: () => void;
  onDismissUpdate: () => void;
  onReloadUpdate: () => void;
  onApplyPwaUpdate: () => void;
  onSkinChange: (skinId: string) => void;
  onThemeChange: (theme: ThemeMode) => void;
}

export function createAuthUiActionsFeature(deps: AuthUiActionsFeatureDeps): AuthUiActionsFeature {
  const {
    store,
    logout,
    authLoginFromDom,
    authRegisterFromDom,
    closeModal,
    forceUpdateReload,
    applyPwaUpdateNow,
    setSkin,
    setTheme,
  } = deps;

  const onAuthOpen = () =>
    store.set((prev) => ({
      ...prev,
      authMode: prev.authRememberedId ? "login" : "register",
      modal: { kind: "auth" },
    }));

  const onAuthLogout = () => logout();

  const onAuthLogin = () => authLoginFromDom();

  const onAuthRegister = () => authRegisterFromDom();

  const onAuthModeChange = (mode: "register" | "login") => {
    store.set({ authMode: mode, modal: { kind: "auth" } });
  };

  const onCloseModal = () => closeModal();

  const onDismissUpdate = () => {
    store.set({ modal: null, updateDismissedLatest: store.get().updateLatest });
  };

  const onReloadUpdate = () => forceUpdateReload("update_required");

  const onApplyPwaUpdate = () => {
    void applyPwaUpdateNow();
  };

  const onSkinChange = (skinId: string) => setSkin(skinId);

  const onThemeChange = (theme: ThemeMode) => setTheme(theme);

  return {
    onAuthOpen,
    onAuthLogout,
    onAuthLogin,
    onAuthRegister,
    onAuthModeChange,
    onCloseModal,
    onDismissUpdate,
    onReloadUpdate,
    onApplyPwaUpdate,
    onSkinChange,
    onThemeChange,
  };
}
