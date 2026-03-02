export type CapturePermissionKind = "microphone" | "camera";

export type MediaAccessKind = "microphone" | "camera" | "camera_microphone";

export async function queryCapturePermissionState(kind: CapturePermissionKind): Promise<PermissionState | null> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return null;
  try {
    const status = await navigator.permissions.query({ name: kind as PermissionName });
    return status?.state ?? null;
  } catch {
    return null;
  }
}

export function formatMediaAccessError(kind: MediaAccessKind, errorRaw: unknown): string {
  const name = String((errorRaw as { name?: unknown } | null)?.name ?? "").trim().toLowerCase();
  const accessLabel =
    kind === "camera" ? "камере" : kind === "camera_microphone" ? "камере и микрофону" : "микрофону";
  if (name === "notallowederror" || name === "permissiondeniederror" || name === "securityerror") {
    return `Разрешите доступ к ${accessLabel} в браузере`;
  }
  if (name === "notfounderror" || name === "devicesnotfounderror") {
    if (kind === "camera") return "Камера не найдена";
    if (kind === "camera_microphone") return "Камера или микрофон не найдены";
    return "Микрофон не найден";
  }
  if (name === "notreadableerror" || name === "trackstarterror" || name === "aborterror") {
    if (kind === "camera") return "Камера занята другим приложением";
    if (kind === "camera_microphone") return "Камера или микрофон заняты другим приложением";
    return "Микрофон занят другим приложением";
  }
  if (kind === "camera") return "Не удалось получить доступ к камере";
  if (kind === "camera_microphone") return "Не удалось получить доступ к камере и микрофону";
  return "Не удалось получить доступ к микрофону";
}
