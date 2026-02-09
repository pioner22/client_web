import type { Store } from "../../../stores/store";
import type { AppState, SearchResultEntry } from "../../../stores/types";

interface AvatarFeatureLike {
  setProfileAvatar: (file: File | null) => void;
  clearProfileAvatar: () => void;
}

export interface ProfileActionsFeatureDeps {
  store: Store<AppState>;
  send: (payload: any) => void;
  markUserInput: () => void;
  buildSearchServerShareText: (state: AppState, items: SearchResultEntry[]) => string;
  tryAppendShareTextToSelected: (text: string) => boolean;
  copyText: (text: string) => void;
  getAvatarFeature: () => AvatarFeatureLike | null;
}

export interface ProfileActionsFeature {
  onProfileDraftChange: (draft: { displayName: string; handle: string; bio: string; status: string }) => void;
  onSearchServerForward: (items: SearchResultEntry[]) => void;
  onProfileSave: (draft: { displayName: string; handle: string; bio: string; status: string }) => void;
  onProfileRefresh: () => void;
  onProfileAvatarSelect: (file: File | null) => void;
  onProfileAvatarClear: () => void;
}

export function createProfileActionsFeature(deps: ProfileActionsFeatureDeps): ProfileActionsFeature {
  const { store, send, markUserInput, buildSearchServerShareText, tryAppendShareTextToSelected, copyText, getAvatarFeature } = deps;

  const onProfileDraftChange = (draft: { displayName: string; handle: string; bio: string; status: string }) => {
    markUserInput();
    store.set({
      profileDraftDisplayName: draft.displayName,
      profileDraftHandle: draft.handle,
      profileDraftBio: draft.bio,
      profileDraftStatus: draft.status,
    });
  };

  const onSearchServerForward = (items: SearchResultEntry[]) => {
    const st = store.get();
    const list = Array.isArray(items) ? items : [];
    const text = buildSearchServerShareText(st, list);
    if (!text) return;
    if (tryAppendShareTextToSelected(text)) return;
    copyText(text);
  };

  const onProfileSave = (draft: { displayName: string; handle: string; bio: string; status: string }) => {
    const display_name = draft.displayName.trim();
    const handle = draft.handle.trim();
    const bio = draft.bio.trim();
    const status = draft.status.trim();
    send({
      type: "profile_set",
      display_name: display_name || null,
      handle: handle || null,
      bio: bio || null,
      status: status || null,
    });
    store.set({ status: "Сохранение профиля…" });
  };

  const onProfileRefresh = () => {
    send({ type: "profile_get" });
  };

  const onProfileAvatarSelect = (file: File | null) => {
    getAvatarFeature()?.setProfileAvatar(file);
  };

  const onProfileAvatarClear = () => {
    getAvatarFeature()?.clearProfileAvatar();
  };

  return {
    onProfileDraftChange,
    onSearchServerForward,
    onProfileSave,
    onProfileRefresh,
    onProfileAvatarSelect,
    onProfileAvatarClear,
  };
}
