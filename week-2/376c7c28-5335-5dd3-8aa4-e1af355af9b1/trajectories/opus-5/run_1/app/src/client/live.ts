import { announceSessionEnded } from './api.ts';

export interface LiveMessage {
  readonly kind: string;
  readonly id: string;
}

type Listener = (message: LiveMessage) => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;

export function onLive(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function startLive(): void {
  if (source) return;
  const stream = new EventSource('/api/events');
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
    /* the browser reconnects by itself */
  });
}

export function stopLive(): void {
  source?.close();
  source = null;
}
