export function isVideoLikeFile(name: string, mime?: string | null): boolean {
  const mt = String(mime || "").toLowerCase();
  if (mt.startsWith("video/")) return true;
  const n = String(name || "").toLowerCase();
  return /\.(mp4|m4v|mov|webm|ogv|mkv|avi|3gp|3g2)$/.test(n);
}
