import type { ClientMessage, ServerMessage } from '../../shared/wire.js';

const RECONNECT_MS = 1_000;

export interface Socket { send: (message: ClientMessage) => void; close: () => void }

/**
 * The page's live connection. `onOpen` runs on every (re)connection, where the page says what it watches; the page's own
 * timer reconnects after a drop.
 */
export const openSocket = (onOpen: (send: Socket['send']) => void, onMessage: (message: ServerMessage) => void): Socket => {
  let socket: WebSocket | null = null;
  let closed = false;
  const send = (message: ClientMessage): void => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };
  const connect = (): void => {
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
    socket.addEventListener('open', () => onOpen(send));
    socket.addEventListener('message', (event: MessageEvent<string>) => onMessage(JSON.parse(event.data) as ServerMessage));
    socket.addEventListener('close', () => { if (!closed) setTimeout(connect, RECONNECT_MS); });
  };
  connect();
  return { send, close: () => { closed = true; socket?.close(); } };
};
