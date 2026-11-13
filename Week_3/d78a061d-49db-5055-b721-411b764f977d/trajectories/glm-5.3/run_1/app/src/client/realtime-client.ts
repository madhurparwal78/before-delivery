import { store } from './store.js';
import { notify } from './store.js';

/**
 * The realtime client (DP-51, DP-64): reconnects, resumes by seq,
 * resends intents with their original IDs, and never shows an event twice.
 */
export type RealtimeEvent = { type: string; stream?: string; seq?: number; event_id?: string; event?: Record<string, unknown> } & Record<string, unknown>;

export type EventHandler = (message: RealtimeEvent) => void;

type PendingIntent = { sessionId: string; intentId: string; message: Record<string, unknown> };

const handlers = new Set<EventHandler>();
const pendingIntents = new Map<string, PendingIntent>();
const shownEventIds = new Set<string>();
const lastSeq = new Map<string, number>();
let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let currentPartyId: string | null = null;
let currentSessionId: string | null = null;

export function shownAlready(eventId: string): boolean {
  if (shownEventIds.has(eventId)) return true;
  shownEventIds.add(eventId);
  if (shownEventIds.size > 5000) shownEventIds.clear();
  return false;
}

export function rememberSeq(stream: string, seq: number): void {
  lastSeq.set(stream, Math.max(lastSeq.get(stream) ?? 0, seq));
}

export function followParty(partyId: string | null): void {
  currentPartyId = partyId;
}

export function followSession(sessionId: string | null): void {
  currentSessionId = sessionId;
}

export function onEvent(handler: EventHandler): void {
  handlers.add(handler);
}

export function queueIntent(intentId: string, sessionId: string, message: Record<string, unknown>): void {
  pendingIntents.set(intentId, { sessionId, intentId, message });
  sendIntent(pendingIntents.get(intentId) as PendingIntent);
}

function sendIntent(pending: PendingIntent): void {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(pending.message));
  }
}

export function openRealtime(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${proto}//${location.host}/api/realtime`);
  socket.addEventListener('open', () => {
    const resume: Record<string, number> = {};
    for (const [stream, seq] of lastSeq.entries()) resume[stream] = seq;
    socket?.send(JSON.stringify({ type: 'hello', resume }));
    socket?.send(JSON.stringify({ type: 'heartbeat' }));
    if (currentSessionId) socket?.send(JSON.stringify({ type: 'join_session', session_id: currentSessionId }));
    for (const pending of pendingIntents.values()) sendIntent(pending);
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  });
  socket.addEventListener('message', (ev) => {
    try {
      const message = JSON.parse(String(ev.data)) as RealtimeEvent;
      if (message.type === 'event' && message.stream && message.seq !== undefined) {
        if (message.event_id && shownAlready(message.event_id)) return;
        rememberSeq(message.stream, message.seq);
        const inner = message.event as { event_id?: string; seq?: number };
        if (inner?.event_id && shownAlready(inner.event_id)) return;
      }
      if (message.type === 'event' && message.event) {
        const inner = message.event as { event_id?: string };
        if (inner.event_id && shownAlready(inner.event_id)) return;
      }
      for (const handler of handlers) handler(message);
    } catch {
      // A malformed frame is ignored; the next one may be well formed.
    }
  });
  const scheduleReconnect = () => {
    if (reconnectTimer !== null) return;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      openRealtime();
    }, 2000);
  };
  socket.addEventListener('close', () => {
    socket = null;
    scheduleReconnect();
  });
  socket.addEventListener('error', () => {
    socket?.close();
  });
}

window.addEventListener('online', () => {
  openRealtime();
});
window.addEventListener('offline', () => {
  socket?.close();
  socket = null;
});

setInterval(() => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'heartbeat' }));
  }
}, 10000);
