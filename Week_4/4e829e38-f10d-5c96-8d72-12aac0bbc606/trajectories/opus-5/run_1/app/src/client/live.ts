export interface LiveEvent {
  type: string;
  teamId: string | null;
  [key: string]: unknown;
}

type Listener = (event: LiveEvent) => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;

export function startLive(): void {
  if (source) return;
  source = new EventSource('/api/events');
  source.addEventListener('message', (event) => {
    const payload = JSON.parse((event as MessageEvent<string>).data) as LiveEvent;
    for (const listener of Array.from(listeners)) listener(payload);
  });
  source.addEventListener('error', () => {
    /* the browser reconnects on its own */
  });
}

export function onLive(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
