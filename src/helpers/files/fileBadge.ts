export type FileBadgeKind = "image" | "video" | "audio" | "archive" | "doc" | "pdf" | "other";

export interface FileBadge {
  kind: FileBadgeKind;
  label: string;
  hue: number; // 0..359
}

const IMAGE_NAME_HINT_RE =
  /^(?:img|image|photo|pic|picture|screenshot|screen[_\-\s]?shot|shot|dsc|pxl|selfie|scan|скрин(?:шот)?|фото|картин|изображ|снимок)([_\-\s]|\d|$)/;
const VIDEO_NAME_HINT_RE =
  /^(?:video|vid|movie|clip|screencast|screen[_\-\s]?(?:rec|record|recording)|видео|ролик)([_\-\s]|\d|$)/;
const AUDIO_NAME_HINT_RE =
  /^(?:audio|voice|sound|music|song|track|record|rec|memo|note|voice[_\-\s]?note|аудио|звук|музык|песня|голос|запис|диктофон|заметк)([_\-\s]|\d|$)/;

function hashHue(seed: string): number {
  const s = String(seed ?? "");
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) % 360;
  }
  return h;
}

function normalizeName(name: string): string {
  const raw = String(name ?? "").trim();
  if (!raw) return "";
  const noQuery = raw.split(/[?#]/)[0];
  const leaf = noQuery.split(/[\\/]/).pop() || "";
  return leaf.trim();
}

function extOf(name: string): string {
  const n = normalizeName(name);
  if (!n) return "";
  const idx = n.lastIndexOf(".");
  if (idx <= 0 || idx === n.length - 1) return "";
  return n.slice(idx + 1).toLowerCase();
}

function hintKindOfName(name: string): FileBadgeKind | null {
  const n = normalizeName(name).toLowerCase();
  if (!n) return null;
  if (IMAGE_NAME_HINT_RE.test(n)) return "image";
  if (VIDEO_NAME_HINT_RE.test(n)) return "video";
  if (AUDIO_NAME_HINT_RE.test(n)) return "audio";
  return null;
}

function kindOf(name: string, mime?: string | null): FileBadgeKind {
  const mt = String(mime ?? "")
    .trim()
    .toLowerCase();
  if (mt.startsWith("image/")) return "image";
  if (mt.startsWith("video/")) return "video";
  if (mt.startsWith("audio/")) return "audio";

  const ext = extOf(name);
  if (!ext) return hintKindOfName(name) ?? "other";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "heic", "heif"].includes(ext)) return "image";
  if (["mp4", "mov", "webm", "mkv", "avi"].includes(ext)) return "video";
  if (["mp3", "wav", "ogg", "m4a", "flac"].includes(ext)) return "audio";
  if (["zip", "rar", "7z", "tar", "gz", "bz2", "xz"].includes(ext)) return "archive";
  if (["pdf"].includes(ext)) return "pdf";
  if (["doc", "docx", "rtf", "txt", "md", "odt", "xls", "xlsx", "csv", "ppt", "pptx"].includes(ext)) return "doc";
  return hintKindOfName(name) ?? "other";
}

function labelFor(name: string, kind: FileBadgeKind): string {
  if (kind === "image") return "IMG";
  if (kind === "video") return "VID";
  if (kind === "audio") return "AUD";
  if (kind === "pdf") return "PDF";
  if (kind === "archive") return "ZIP";

  const ext = extOf(name);
  if (!ext) return "FILE";
  const up = ext.toUpperCase();
  return up.length > 4 ? up.slice(0, 4) : up;
}

export function fileBadge(name: string, mime?: string | null): FileBadge {
  const safeName = String(name ?? "").trim();
  const kind = kindOf(safeName, mime);
  const label = labelFor(safeName, kind);
  const hue = hashHue(`${kind}:${label}:${safeName}`);
  return { kind, label, hue };
}
