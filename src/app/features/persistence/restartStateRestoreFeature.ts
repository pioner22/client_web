import type { Store } from "../../../stores/store";
import type { AppState } from "../../../stores/types";
import type { RestartStateFeature } from "./restartStateFeature";

export interface RestartStateRestoreFeatureDeps {
  store: Store<AppState>;
  restartStateFeature: RestartStateFeature;
  input: HTMLTextAreaElement;
  autosizeInput: (input: HTMLTextAreaElement) => void;
}

export function applyRestartStateSnapshot(deps: RestartStateRestoreFeatureDeps): void {
  const { store, restartStateFeature, input, autosizeInput } = deps;

  const restored = restartStateFeature.consume();
  if (!restored) return;

  store.set((prev) => ({
    ...prev,
    ...(restored.page ? { page: restored.page } : {}),
    userViewId: restored.userViewId ?? prev.userViewId,
    groupViewId: restored.groupViewId ?? prev.groupViewId,
    boardViewId: restored.boardViewId ?? prev.boardViewId,
    input: restored.input ?? prev.input,
    drafts: restored.drafts ?? prev.drafts,
    pinned: restored.pinned ?? prev.pinned,
    archived: restored.archived ?? prev.archived,
    chatSearchOpen: restored.chatSearchOpen ?? prev.chatSearchOpen,
    chatSearchQuery: restored.chatSearchQuery ?? prev.chatSearchQuery,
    chatSearchDate: restored.chatSearchDate ?? prev.chatSearchDate,
    chatSearchFilter: restored.chatSearchFilter ?? prev.chatSearchFilter,
    chatSearchPos: restored.chatSearchPos ?? prev.chatSearchPos,
    searchQuery: restored.searchQuery ?? prev.searchQuery,
    profileDraftDisplayName: restored.profileDraftDisplayName ?? prev.profileDraftDisplayName,
    profileDraftHandle: restored.profileDraftHandle ?? prev.profileDraftHandle,
    profileDraftBio: restored.profileDraftBio ?? prev.profileDraftBio,
    profileDraftStatus: restored.profileDraftStatus ?? prev.profileDraftStatus,
  }));

  try {
    input.value = restored.input ?? "";
    autosizeInput(input);
  } catch {
    // ignore
  }
}
