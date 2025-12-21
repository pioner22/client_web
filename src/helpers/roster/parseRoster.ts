import type { FriendEntry } from "../../stores/types";

export function parseRoster(msg: any): { friends: FriendEntry[]; pendingIn: string[]; pendingOut: string[] } {
  const friendsRaw = Array.isArray(msg?.friends) ? msg.friends : [];
  const onlineRaw = Array.isArray(msg?.online) ? msg.online : [];
  const onlineSet = new Set(onlineRaw.map((x: any) => String(x)).filter(Boolean));

  const friends: FriendEntry[] = friendsRaw
    .map((x: any) => {
      if (typeof x === "string") {
        return { id: x, online: onlineSet.has(x), unread: 0, last_seen_at: null };
      }
      const id = String(x?.id ?? "");
      return {
        id,
        online: Boolean(x?.online) || onlineSet.has(id),
        unread: Number(x?.unread ?? 0) || 0,
        last_seen_at: (x?.last_seen_at ?? null) as any,
      };
    })
    .filter((x: FriendEntry) => x.id);
  const pendingIn = (Array.isArray(msg?.pending_in) ? msg.pending_in : []).map((x: any) => String(x)).filter(Boolean);
  const pendingOut = (Array.isArray(msg?.pending_out) ? msg.pending_out : []).map((x: any) => String(x)).filter(Boolean);
  return { friends, pendingIn, pendingOut };
}
