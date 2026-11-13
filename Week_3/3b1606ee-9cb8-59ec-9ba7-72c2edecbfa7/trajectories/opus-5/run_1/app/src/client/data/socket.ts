import type { SocketFrame } from '../../shared/types.js';
import { setConnected } from '../ui/live.js';
import { api } from './api.js';
import { kick } from './outbox.js';
import { emit, state } from './store.js';
import { absorbConversation, handleLetterFrame, syncNow } from './sync.js';

let socket: WebSocket | null = null;
let attempts = 0;
let reconnectTimer: number | null = null;

function scheduleReconnect(): void {
  if (reconnectTimer !== null) return;
  const delay = Math.min(
    state.config.timers.retry_cap_ms,
    state.config.timers.retry_base_ms * 2 ** attempts,
  );
  attempts += 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    openSocket();
  }, delay);
}

function openSocket(): void {
  if (state.signedOut) return;
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  const connection = new WebSocket(url);
  socket = connection;

  connection.addEventListener('open', () => {
    attempts = 0;
    setConnected(true);
    kick();
    void syncNow();
  });

  connection.addEventListener('message', (event) => {
    const frame = JSON.parse(String(event.data)) as SocketFrame;
    void handleFrame(frame);
  });

  connection.addEventListener('close', () => {
    if (socket === connection) socket = null;
    setConnected(false);
    // A refused socket may mean this browser's session was revoked; one call tells us.
    void api.me().catch(() => undefined);
    scheduleReconnect();
  });

  connection.addEventListener('error', () => {
    connection.close();
  });
}

async function handleFrame(frame: SocketFrame): Promise<void> {
  switch (frame.type) {
    case 'letter':
      await handleLetterFrame(frame.letter);
      break;
    case 'conversation':
      await absorbConversation(frame.conversation);
      emit('conversations');
      break;
    case 'keys':
      await syncNow();
      break;
    case 'signed_out':
      state.signedOut = true;
      emit('signed-out');
      break;
  }
}

export function startSocket(): void {
  openSocket();
  window.addEventListener('online', () => {
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    attempts = 0;
    if (socket === null) openSocket();
    kick();
  });
  window.addEventListener('offline', () => {
    setConnected(false);
    socket?.close();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow();
  });
}
