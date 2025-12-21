export type Listener = () => void;

export class Store<TState> {
  private state: TState;
  private listeners = new Set<Listener>();

  constructor(initial: TState) {
    this.state = initial;
  }

  get(): TState {
    return this.state;
  }

  set(patch: Partial<TState> | ((prev: TState) => TState)) {
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

