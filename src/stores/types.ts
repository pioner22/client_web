export type ConnStatus = "connecting" | "connected" | "disconnected";

export type ModalKind =
  | "auth"
  | "update"
  | "pwa_update"
  | "members_add"
  | "members_remove"
  | "rename"
  | "confirm"
  | "file_viewer"
  | "action"
  | "context_menu";

export interface ActionModalAuthIn {
  kind: "auth_in";
  peer: string;
  note?: string | null;
}

export interface ActionModalAuthOut {
  kind: "auth_out";
  peer: string;
}

export interface ActionModalGroupInvite {
  kind: "group_invite";
  groupId: string;
  from: string;
  name?: string | null;
  handle?: string | null;
}

export interface ActionModalGroupJoinRequest {
  kind: "group_join_request";
  groupId: string;
  from: string;
  name?: string | null;
  handle?: string | null;
}

export interface ActionModalBoardInvite {
  kind: "board_invite";
  boardId: string;
  from: string;
  name?: string | null;
  handle?: string | null;
}

export interface ActionModalFileOffer {
  kind: "file_offer";
  fileId: string;
  from: string;
  name: string;
  size: number;
  room?: string | null;
}

export type ActionModalPayload =
  | ActionModalAuthIn
  | ActionModalAuthOut
  | ActionModalGroupInvite
  | ActionModalGroupJoinRequest
  | ActionModalBoardInvite
  | ActionModalFileOffer;

export type ContextMenuTargetKind = "dm" | "group" | "board" | "auth_in" | "auth_out" | "message";

export interface ContextMenuTarget {
  kind: ContextMenuTargetKind;
  id: string;
}

export interface ContextMenuItem {
  id: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
}

export interface ContextMenuPayload {
  x: number;
  y: number;
  title: string;
  target: ContextMenuTarget;
  items: ContextMenuItem[];
}

export type ConfirmAction =
  | { kind: "chat_clear"; peer: string }
  | { kind: "friend_remove"; peer: string }
  | { kind: "group_leave"; groupId: string }
  | { kind: "board_leave"; boardId: string }
  | { kind: "group_disband"; groupId: string }
  | { kind: "board_disband"; boardId: string };

export type FileTransferStatus =
  | "offering"
  | "uploading"
  | "uploaded"
  | "downloading"
  | "complete"
  | "rejected"
  | "error";

export interface FileOfferIn {
  id: string;
  from: string;
  name: string;
  size: number;
  room?: string | null;
}

export interface FileTransferEntry {
  localId: string;
  id?: string | null;
  name: string;
  size: number;
  direction: "out" | "in";
  peer: string;
  room?: string | null;
  status: FileTransferStatus;
  progress: number;
  error?: string | null;
  url?: string | null;
  acceptedBy?: string[];
  receivedBy?: string[];
}

export type ModalState =
  | { kind: "auth"; message?: string }
  | { kind: "update" }
  | { kind: "pwa_update" }
  | { kind: "members_add"; targetKind: "group" | "board"; targetId: string; title: string; message?: string }
  | { kind: "members_remove"; targetKind: "group" | "board"; targetId: string; title: string; message?: string }
  | { kind: "rename"; targetKind: "group" | "board"; targetId: string; title: string; currentName: string | null; message?: string }
  | { kind: "confirm"; title: string; message: string; action: ConfirmAction; confirmLabel?: string; cancelLabel?: string; danger?: boolean }
  | { kind: "file_viewer"; url: string; name: string; size: number; mime?: string | null }
  | { kind: "action"; payload: ActionModalPayload; message?: string }
  | { kind: "context_menu"; payload: ContextMenuPayload };

export type PageKind = "main" | "search" | "profile" | "files" | "help" | "group_create" | "board_create";

export type AuthMode = "auto" | "register" | "login";

export type MobileSidebarTab = "chats" | "contacts";

export type TargetKind = "dm" | "group" | "board";

export interface TargetRef {
  kind: TargetKind;
  id: string;
}

export type ChatAttachment =
  | {
      kind: "file";
      localId?: string | null;
      fileId?: string | null;
      name: string;
      size: number;
      mime?: string | null;
    };

export interface ChatMessage {
  ts: number;
  from: string;
  text: string;
  to?: string;
  room?: string;
  localId?: string | null;
  id?: number | null;
  status?: "sending" | "queued" | "delivered" | "read" | "error";
  edited?: boolean;
  kind: "in" | "out" | "sys";
  attachment?: ChatAttachment | null;
}

export interface OutboxEntry {
  localId: string;
  ts: number;
  text: string;
  to?: string;
  room?: string;
  status?: "queued" | "sending";
  attempts?: number;
  lastAttemptAt?: number;
}

export interface EditingMessageState {
  key: string;
  id: number;
  prevDraft: string;
}

export interface FriendEntry {
  id: string;
  online: boolean;
  unread: number;
  last_seen_at?: string | null;
}

export interface GroupEntry {
  id: string;
  name?: string | null;
  owner_id?: string | null;
  handle?: string | null;
}

export interface BoardEntry {
  id: string;
  name?: string | null;
  owner_id?: string | null;
  handle?: string | null;
}

export interface SearchResultEntry {
  id: string;
  online?: boolean;
  friend?: boolean;
  group?: boolean;
  board?: boolean;
}

export interface UserProfile {
  id: string;
  display_name?: string | null;
  handle?: string | null;
  client_version?: string | null;
}

export type ToastKind = "info" | "success" | "warn" | "error";

export interface ToastAction {
  id: string;
  label: string;
  primary?: boolean;
}

export interface ToastState {
  message: string;
  kind?: ToastKind;
  actions?: ToastAction[];
}

export interface SkinInfo {
  id: string;
  title: string;
}

export interface AppState {
  conn: ConnStatus;
  authed: boolean;
  selfId: string | null;
  serverVersion: string | null;
  clientVersion: string;
  status: string;

  authMode: AuthMode;
  authRememberedId: string | null;

  skin: string;
  skins: SkinInfo[];

  mobileSidebarTab: MobileSidebarTab;

  friends: FriendEntry[];
  pendingIn: string[];
  pendingOut: string[];
  muted: string[];
  blocked: string[];
  blockedBy: string[];
  pinned: string[];
  pinnedMessages: Record<string, number[]>;
  pinnedMessageActive: Record<string, number>;
  pendingGroupInvites: ActionModalGroupInvite[];
  pendingGroupJoinRequests: ActionModalGroupJoinRequest[];
  pendingBoardInvites: ActionModalBoardInvite[];
  fileOffersIn: FileOfferIn[];
  fileTransfers: FileTransferEntry[];

  groups: GroupEntry[];
  boards: BoardEntry[];

  selected: TargetRef | null;
  conversations: Record<string, ChatMessage[]>;
  historyLoaded: Record<string, boolean>;
  historyCursor: Record<string, number>;
  historyHasMore: Record<string, boolean>;
  historyLoading: Record<string, boolean>;

  outbox: Record<string, OutboxEntry[]>;

  drafts: Record<string, string>;
  input: string;
  editing: EditingMessageState | null;

  chatSearchOpen: boolean;
  chatSearchQuery: string;
  chatSearchHits: number[];
  chatSearchPos: number;

  page: PageKind;
  searchQuery: string;
  searchResults: SearchResultEntry[];
  groupCreateMessage: string;
  boardCreateMessage: string;
  profiles: Record<string, UserProfile>;
  profileDraftDisplayName: string;
  profileDraftHandle: string;

  toast: ToastState | null;
  modal: ModalState | null;
  updateLatest: string | null;
  updateDismissedLatest: string | null;
  pwaUpdateAvailable: boolean;

  avatarsRev: number;
}
