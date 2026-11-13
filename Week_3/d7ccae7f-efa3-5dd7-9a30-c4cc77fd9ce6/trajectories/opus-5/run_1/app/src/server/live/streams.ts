import type { RoomEvent } from '../../shared/protocol.js';

export interface StreamHandle {
  send(event: RoomEvent): void;
  sendSuperseded(): void;
  close(): void;
}

const openStreams = new Map<string, Set<StreamHandle>>();

export function registerStream(clientId: string, handle: StreamHandle): () => void {
  const handles = openStreams.get(clientId) ?? new Set<StreamHandle>();
  handles.add(handle);
  openStreams.set(clientId, handles);
  return () => {
    const current = openStreams.get(clientId);
    if (!current) return;
    current.delete(handle);
    if (current.size === 0) openStreams.delete(clientId);
  };
}

/** Tells a retired client its seat has moved on and closes its stream. */
export function supersedeClient(clientId: string): void {
  const handles = openStreams.get(clientId);
  if (!handles) return;
  for (const handle of handles) {
    handle.sendSuperseded();
    handle.close();
  }
  openStreams.delete(clientId);
}

export function closeAllStreams(): void {
  for (const handles of openStreams.values()) {
    for (const handle of handles) handle.close();
  }
  openStreams.clear();
}
