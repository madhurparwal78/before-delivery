import type { WebSocket } from 'ws';

// The server's live sockets, so a removal can end the person's socket after
// the removal event has been sent.

const sockets = new Map<string, Set<WebSocket>>();

export function registerSocket(personId: string, ws: WebSocket): () => void {
  let set = sockets.get(personId);
  if (!set) {
    set = new Set();
    sockets.set(personId, set);
  }
  set.add(ws);
  return () => {
    set!.delete(ws);
    if (set!.size === 0) sockets.delete(personId);
  };
}

export function closePersonSockets(personId: string): Promise<void> {
  const set = sockets.get(personId);
  if (!set) return Promise.resolve();
  // Let the removal event flush before the close frame.
  return new Promise((resolve) => {
    setTimeout(() => {
      for (const ws of set ?? []) ws.close(1000, 'access removed');
      resolve();
    }, 50);
  });
}

export function socketCount(personId: string): number {
  return sockets.get(personId)?.size ?? 0;
}

