import { announceSessionEnded, get, loadedAt, quietFor } from './api.ts';

interface LiveMessage {
  readonly kind: string;
  readonly id: string;
}

type Listener = (message: LiveMessage) => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;
let pending: number | null = null;

// The stream stays open for the whole visit, so it waits until the screen has loaded and the page is
// quiet; it starts from the cursor of the page's first answer, so nothing changed meanwhile is missed.
const QUIET_MS = 700;
const LATEST_MS = 3_000;

export function onLive(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function startLive(): void {
  if (source || pending !== null) return;
  const since = performance.now();
  pending = window.setInterval(() => {
    const waited = performance.now() - since;
    if (waited < LATEST_MS && (document.readyState !== 'complete' || quietFor() < QUIET_MS)) return;
    window.clearInterval(pending!);
    pending = null;
    open();
  }, 100);
}

function open(): void {
  const after = loadedAt();
  const stream = new EventSource(after ? `/api/events?after=${encodeURIComponent(after)}` : '/api/events');
  source = stream;
  stream.addEventListener('message', (event) => {
    let message: LiveMessage;
    try {
      message = JSON.parse((event as MessageEvent<string>).data) as LiveMessage;
    } catch {
      return;
    }
    if (message.kind === 'session') {
      announceSessionEnded();
      stopLive();
      return;
    }
    for (const listener of listeners) listener(message);
  });
  stream.addEventListener('error', () => {
    // The browser reconnects by itself, unless the stream was refused (the session ended before it
    // opened): then ask the server, whose `unauthenticated` answer shows the session-ended state.
    if (stream.readyState === EventSource.CLOSED) void get('/api/me').catch(() => undefined);
  });
}

export function stopLive(): void {
  if (pending !== null) window.clearInterval(pending);
  pending = null;
  source?.close();
  source = null;
}
