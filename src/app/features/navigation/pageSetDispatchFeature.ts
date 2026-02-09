import type { Store } from "../../../stores/store";
import type { AppState, PageKind } from "../../../stores/types";

export interface PageSetDispatchFeatureDeps {
  store: Store<AppState>;
  setPage: (page: PageKind) => void;
  send: (payload: any) => void;
}

export interface PageSetDispatchFeature {
  handleSetPage: (page: PageKind) => void;
}

export function createPageSetDispatchFeature(deps: PageSetDispatchFeatureDeps): PageSetDispatchFeature {
  const { store, setPage, send } = deps;

  const handleSetPage = (page: PageKind) => {
    setPage(page);
    const st = store.get();
    if (page === "profile" && st.authed && st.conn === "connected") {
      send({ type: "profile_get" });
      return;
    }
    if (page === "group" && st.authed && st.conn === "connected" && st.groupViewId) {
      send({ type: "group_info", group_id: st.groupViewId });
      return;
    }
    if (page === "board" && st.authed && st.conn === "connected" && st.boardViewId) {
      send({ type: "board_info", board_id: st.boardViewId });
    }
  };

  return { handleSetPage };
}
