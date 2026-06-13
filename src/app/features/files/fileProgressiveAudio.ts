import { resolveProgressiveMediaUrl } from "../../../helpers/files/progressiveMedia";
import { applyFileTransferMutation } from "../../../helpers/runtime/deliverySync";
import type { Store } from "../../../stores/store";
import type { AppState, FileTransferEntry } from "../../../stores/types";

export function markProgressiveAudioTransferReady(params: {
  store: Store<AppState>;
  fileId: string;
  url: string;
  name: string;
  size: number;
  mime: string | null | undefined;
  silent: boolean;
  nextTransferId: () => string;
  scheduleSaveFileTransfers: () => void;
  clearSilentFileGet: (fileId: string) => void;
  finishFileGet: (fileId: string) => void;
  debugHook?: (kind: string, data?: any) => void;
}): boolean {
  const { store, fileId, url, name, size, mime, silent } = params;
  const progressiveUrl = resolveProgressiveMediaUrl({ fileId, url, name, size, mime });
  if (!progressiveUrl) return false;

  store.set((prev) => {
    const current = Array.isArray(prev.fileTransfers) ? prev.fileTransfers : [];
    const idx = current.findIndex((entry) => entry.id === fileId || entry.localId === fileId);
    const base = idx >= 0 ? current[idx] : null;
    const nextEntry: FileTransferEntry = {
      localId: base?.localId || params.nextTransferId(),
      id: base?.id || fileId,
      name: name || base?.name || fileId,
      size: size || base?.size || 0,
      direction: base?.direction || "in",
      peer: base?.peer || "—",
      room: base?.room ?? null,
      status: "complete",
      progress: 100,
      url: progressiveUrl,
      error: null,
      ...(mime || base?.mime ? { mime: mime || base?.mime || null } : {}),
      ...(base?.acceptedBy ? { acceptedBy: base.acceptedBy } : {}),
      ...(base?.receivedBy ? { receivedBy: base.receivedBy } : {}),
    };
    const transfers = idx >= 0 ? current.map((entry, index) => (index === idx ? nextEntry : entry)) : [nextEntry, ...current];
    return applyFileTransferMutation(prev, transfers);
  });
  params.scheduleSaveFileTransfers();
  params.clearSilentFileGet(fileId);
  params.finishFileGet(fileId);
  if (!silent) store.set({ status: `Аудио готово к воспроизведению: ${name || fileId}` });
  params.debugHook?.("file.audio.progressive_ready", { fileId, name, size, mime: mime || null });
  return true;
}
