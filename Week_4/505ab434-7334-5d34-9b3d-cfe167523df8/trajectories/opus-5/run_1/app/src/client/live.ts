import type { LiveEvent } from '../shared/types.js';

type Listener = (event: LiveEvent) => void;

const listeners = new Set<Listener>();
let socket: WebSocket | null = null;

export function connectLive(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${window.location.host}/api/live`);
  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(String(event.data)) as LiveEvent;
    for (const listener of [...listeners]) listener(payload);
  });
  socket.addEventListener('close', () => {
    socket = null;
    window.setTimeout(connectLive, 1000);
  });
  socket.addEventListener('error', () => socket?.close());
}

export function closeLive(): void {
  listeners.clear();
  socket?.close();
  socket = null;
}

export function onLive(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
