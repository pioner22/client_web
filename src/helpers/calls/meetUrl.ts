import { getMeetBaseUrl } from "../../config/env";
import { safeUrl } from "../security/safeUrl";

export type CallMode = "audio" | "video";

function stripTrailingSlashes(value: string): string {
  return String(value || "").replace(/\/+$/, "");
}

function buildMeetJoinUrlRaw(baseUrl: string, roomName: string, mode: CallMode): string | null {
  const base = stripTrailingSlashes(baseUrl);
  const room = String(roomName || "").trim();
  if (!base || !room) return null;

  const hash = new URLSearchParams();
  hash.set("config.prejoinPageEnabled", "false");
  if (mode === "audio") {
    hash.set("config.startWithVideoMuted", "true");
    hash.set("config.startWithAudioMuted", "false");
  }
  const hashText = hash.toString();
  const safeRoom = encodeURIComponent(room);
  return `${base}/${safeRoom}${hashText ? `#${hashText}` : ""}`;
}

export function buildMeetJoinUrl(roomName: string, mode: CallMode): string | null {
  const baseUrl = getMeetBaseUrl();
  const raw = buildMeetJoinUrlRaw(baseUrl, roomName, mode);
  if (!raw) return null;
  const base = typeof location !== "undefined" ? location.href : "http://localhost/";
  return safeUrl(raw, { base, allowedProtocols: ["https:", "http:"] });
}

