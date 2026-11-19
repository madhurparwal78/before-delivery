import { LiveEvent } from '../shared/live.js';

type Handler = (event: LiveEvent) => void;

const handlers = new Set<Handler>();
let socket: WebSocket | null = null;
let workspaceId = '';
let retry = 0;

function connect(): void {
  if (!workspaceId) return;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${window.location.host}/api/w/${workspaceId}/live`);
  socket.addEventListener('message', (message) => {
    const event = JSON.parse(message.data as string) as LiveEvent;
    for (const handler of [...handlers]) handler(event);
  });
  socket.addEventListener('close', () => {
    socket = null;
    retry = window.setTimeout(connect, 1000);
  });
  socket.addEventListener('error', () => socket?.close());
}

/** One live channel per workspace, shared by every page of that workspace. */
export function connectLive(id: string): void {
  if (workspaceId === id && socket) return;
  workspaceId = id;
  window.clearTimeout(retry);
  if (socket) {
    const previous = socket;
    socket = null;
    previous.close();
  }
  connect();
}

export function onLive(handler: Handler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}
