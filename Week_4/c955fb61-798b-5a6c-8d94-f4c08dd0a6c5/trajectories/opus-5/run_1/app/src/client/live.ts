import type { LiveMessage } from '../shared/types.js';

let socket: WebSocket | null = null;
let selected: string | null = null;
let heartbeat = 0;

export function openLiveChannel(
  projectId: string,
  onMessage: (message: LiveMessage) => void,
  onReconnect: () => void,
): void {
  closeLiveChannel();
  let reopened = false;

  const connect = (): void => {
    const url = new URL(`/live?project=${encodeURIComponent(projectId)}`, location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(url);
    socket.addEventListener('open', () => {
      if (selected !== null) socket?.send(JSON.stringify({ type: 'select', itemId: selected }));
      if (reopened) onReconnect();
    });
    socket.addEventListener('message', (event) => {
      onMessage(JSON.parse(String(event.data)) as LiveMessage);
    });
    socket.addEventListener('close', () => {
      if (socket === null) return;
      reopened = true;
      window.setTimeout(connect, 1000);
    });
  };

  connect();
  heartbeat = window.setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
  }, 2000);
}

export function closeLiveChannel(): void {
  if (heartbeat) window.clearInterval(heartbeat);
  heartbeat = 0;
  const open = socket;
  socket = null;
  selected = null;
  open?.close();
}

export function sendSelection(itemId: string | null): void {
  if (itemId === selected) return;
  selected = itemId;
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'select', itemId }));
  }
}
