import type { LiveMessage } from '../shared/types.js';
import { setBusinessNow } from './core.js';

type Handler = (message: LiveMessage) => void;

let socket: WebSocket | null = null;
const queue: string[] = [];
const watching = new Set<string>();
const handlers = new Set<Handler>();

function flush(): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  while (queue.length > 0) {
    const payload = queue.shift();
    if (payload) socket.send(payload);
  }
}

function send(payload: Record<string, unknown>): void {
  queue.push(JSON.stringify(payload));
  flush();
}

export function connectLive(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live`;
  socket = new WebSocket(url);
  socket.addEventListener('open', () => {
    for (const payload of watching) queue.push(payload);
    flush();
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as LiveMessage;
    if (message.type === 'clock') setBusinessNow(message.now);
    for (const handler of handlers) handler(message);
  });
  socket.addEventListener('close', () => {
    socket = null;
    window.setTimeout(connectLive, 1000);
  });
  socket.addEventListener('error', () => undefined);
}

export function onLive(handler: Handler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export function watch(target: Record<string, unknown>): void {
  const payload = JSON.stringify({ type: 'watch', ...target });
  watching.add(payload);
  send({ type: 'watch', ...target });
}

export function unwatch(target: Record<string, unknown>): void {
  watching.delete(JSON.stringify({ type: 'watch', ...target }));
  send({ type: 'unwatch', ...target });
}
