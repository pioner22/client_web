import type { RenderActions } from "../../renderApp";

type AuthUiActions = Pick<
  RenderActions,
  | "onAuthOpen"
  | "onAuthLogout"
  | "onAuthLogin"
  | "onAuthRegister"
  | "onAuthModeChange"
  | "onCloseModal"
  | "onDismissUpdate"
  | "onReloadUpdate"
  | "onApplyPwaUpdate"
  | "onSkinChange"
  | "onThemeChange"
>;

type ProfileActions = Pick<
  RenderActions,
  | "onProfileDraftChange"
  | "onSearchServerForward"
  | "onProfileSave"
  | "onProfileRefresh"
  | "onProfileAvatarSelect"
  | "onProfileAvatarClear"
>;

type NotifyActions = Pick<
  RenderActions,
  | "onPushEnable"
  | "onPushDisable"
  | "onNotifyInAppEnable"
  | "onNotifyInAppDisable"
  | "onNotifySoundEnable"
  | "onNotifySoundDisable"
  | "onForcePwaUpdate"
>;

export type ActionsAccountFeature = AuthUiActions & ProfileActions & NotifyActions;

export interface ActionsAccountFeatureDeps {
  authUiActions: AuthUiActions;
  profileActions: ProfileActions;
  notifyActions: NotifyActions;
}

export function createActionsAccountFeature(deps: ActionsAccountFeatureDeps): ActionsAccountFeature {
  const { authUiActions, profileActions, notifyActions } = deps;
  return {
    ...authUiActions,
    ...profileActions,
    ...notifyActions,
  };
}
