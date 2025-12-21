export type ConnStatus = "connecting" | "connected" | "disconnected";

export type ModalKind = "auth" | "help" | "search" | "profile" | "update";

export interface ChatMessage {
  ts: number;
  from: string;
  text: string;
  to?: string;
  room?: string;
  id?: number | null;
  kind: "in" | "out" | "sys";
}

export interface FriendEntry {
  id: string;
  online: boolean;
  unread: number;
  last_seen_at?: string | null;
}

export interface AppState {
  conn: ConnStatus;
  authed: boolean;
  selfId: string | null;
  serverVersion: string | null;
  clientVersion: string;
  status: string;

  friends: FriendEntry[];
  pendingIn: string[];
  pendingOut: string[];

  selectedPeer: string | null;
  conversations: Record<string, ChatMessage[]>;

  input: string;
  modal: { kind: ModalKind; message?: string } | null;
  updateLatest: string | null;
  updateDismissedLatest: string | null;
}

export type Listener = () => void;

export class Store {
  private state: AppState;
  private listeners = new Set<Listener>();

  constructor(initial: AppState) {
    this.state = initial;
  }

  get(): AppState {
    return this.state;
  }

  set(patch: Partial<AppState> | ((prev: AppState) => AppState)) {
    if (typeof patch === "function") {
      this.state = patch(this.state);
    } else {
      this.state = { ...this.state, ...patch };
    }
    for (const fn of this.listeners) fn();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

