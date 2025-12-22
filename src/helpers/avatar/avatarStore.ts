export type AvatarTargetKind = "dm" | "group" | "board";

const STORAGE_PREFIX = "yagodka_avatar:";
const REV_PREFIX = "yagodka_avatar_rev:";
const MAX_DATA_URL_LEN = 220_000;

function key(kind: AvatarTargetKind, id: string): string {
  return `${STORAGE_PREFIX}${kind}:${String(id ?? "").trim()}`;
}

function revKey(kind: AvatarTargetKind, id: string): string {
  return `${REV_PREFIX}${kind}:${String(id ?? "").trim()}`;
}

function isSafeDataUrl(value: string): boolean {
  if (!value) return false;
  if (value.length > MAX_DATA_URL_LEN) return false;
  return value.startsWith("data:image/");
}

export function getStoredAvatar(kind: AvatarTargetKind, id: string): string | null {
  const k = key(kind, id);
  try {
    const v = String(localStorage.getItem(k) || "");
    return isSafeDataUrl(v) ? v : null;
  } catch {
    return null;
  }
}

export function getStoredAvatarRev(kind: AvatarTargetKind, id: string): number {
  const k = revKey(kind, id);
  try {
    const raw = String(localStorage.getItem(k) || "").trim();
    const n = Math.trunc(Number(raw || 0) || 0);
    return n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function storeAvatarRev(kind: AvatarTargetKind, id: string, rev: number): void {
  const k = revKey(kind, id);
  const n = Math.max(0, Math.trunc(Number(rev || 0) || 0));
  try {
    localStorage.setItem(k, String(n));
  } catch {
    // ignore
  }
}

export function storeAvatar(kind: AvatarTargetKind, id: string, dataUrl: string): void {
  const v = String(dataUrl ?? "");
  if (!isSafeDataUrl(v)) throw new Error("bad_avatar_data");
  const k = key(kind, id);
  localStorage.setItem(k, v);
}

export function clearStoredAvatar(kind: AvatarTargetKind, id: string): void {
  try {
    localStorage.removeItem(key(kind, id));
    localStorage.removeItem(revKey(kind, id));
  } catch {
    // ignore
  }
}

export function avatarMonogram(kind: AvatarTargetKind, id: string): string {
  const raw = String(id ?? "").trim();
  if (kind === "group") return "G";
  if (kind === "board") return "B";
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 2) return digits.slice(-2);
  if (digits.length === 1) return digits;
  return raw.slice(0, 2).toUpperCase() || "—";
}

export function avatarHue(seed: string): number {
  const s = String(seed ?? "");
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) % 360;
  }
  return h;
}

export async function imageFileToAvatarDataUrl(file: File, size = 128): Promise<string> {
  if (!file) throw new Error("no_file");
  if (!file.type.startsWith("image/")) throw new Error("not_image");
  if (file.size > 6 * 1024 * 1024) throw new Error("file_too_large");

  const srcUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("image_load_failed"));
      i.src = srcUrl;
    });

    const sw = img.naturalWidth || img.width || 0;
    const sh = img.naturalHeight || img.height || 0;
    if (!sw || !sh) throw new Error("bad_image_size");

    const side = Math.min(sw, sh);
    const sx = Math.floor((sw - side) / 2);
    const sy = Math.floor((sh - side) / 2);

    const canvas = document.createElement("canvas");
    const target = Math.max(48, Math.min(256, Math.floor(size || 128)));
    canvas.width = target;
    canvas.height = target;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no_canvas");
    ctx.drawImage(img, sx, sy, side, side, 0, 0, target, target);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(srcUrl);
  }
}
