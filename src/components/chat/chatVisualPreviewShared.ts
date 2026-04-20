import type { FileOfferIn, FileTransferEntry } from "../../stores/types";

export type FileAttachmentInfo = {
  name: string;
  size: number;
  mime: string | null;
  fileId: string | null;
  url: string | null;
  thumbUrl: string | null;
  thumbW: number | null;
  thumbH: number | null;
  mediaW: number | null;
  mediaH: number | null;
  transfer: FileTransferEntry | null;
  offer: FileOfferIn | null;
  statusLine: string;
  isImage: boolean;
  isVideo: boolean;
  isAudio: boolean;
  hasProgress: boolean;
};

export type ChatVisualPreviewOptions = {
  className?: string;
  msgIdx?: number;
  caption?: string | null;
  mobileUi?: boolean;
};

export const CHAT_MEDIA_PREVIEW_SCALE = 0.33;
export const CHAT_MEDIA_PREVIEW_FALLBACK_BASE_PX = 420;

export function resolvePreviewBaseWidthPx(info: FileAttachmentInfo): number | null {
  const w = info.thumbW || info.mediaW || CHAT_MEDIA_PREVIEW_FALLBACK_BASE_PX;
  if (!Number.isFinite(w) || w <= 0) return null;
  return Math.trunc(w);
}

function normalizePreviewFileName(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const noQuery = raw.split(/[?#]/)[0];
  const leaf = noQuery.split(/[\\/]/).pop() || "";
  return leaf.trim().toLowerCase();
}

export function isVideoNoteName(name: string): boolean {
  const n = normalizePreviewFileName(name);
  return n.startsWith("video_note") || n.startsWith("video-note") || n.includes("_video_note");
}
