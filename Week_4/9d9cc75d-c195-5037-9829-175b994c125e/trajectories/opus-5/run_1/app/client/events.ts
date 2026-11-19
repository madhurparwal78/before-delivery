import { session } from './session.js';

export interface ExtractEvent {
  source: string;
  state: 'live' | 'refreshing' | 'refresh_failed';
  stale: boolean;
  last_success_at: string | null;
  last_failure_at: string | null;
  next_run_at: string | null;
}

export interface ExportEvent {
  id: string;
  status: 'queued' | 'rendering' | 'ready' | 'failed';
  progress: number;
}

type Handlers = {
  clock: (data: { server_now: string }) => void;
  extract: (data: ExtractEvent) => void;
  export: (data: ExportEvent) => void;
  inbox: (data: { unread: number }) => void;
};

const listeners: { [K in keyof Handlers]: Set<Handlers[K]> } = {
  clock: new Set(),
  extract: new Set(),
  export: new Set(),
  inbox: new Set(),
};

export function onEvent<K extends keyof Handlers>(name: K, handler: Handlers[K]): () => void {
  listeners[name].add(handler);
  return () => {
    listeners[name].delete(handler);
  };
}

let source: EventSource | null = null;

export function connectEvents(): void {
  if (source !== null) return;
  source = new EventSource('/api/events');
  source.addEventListener('clock', (event) => {
    const data = JSON.parse((event as MessageEvent<string>).data) as { server_now: string };
    session.serverNow = Date.parse(data.server_now);
    listeners.clock.forEach((handler) => handler(data));
  });
  source.addEventListener('extract', (event) => {
    const data = JSON.parse((event as MessageEvent<string>).data) as ExtractEvent;
    listeners.extract.forEach((handler) => handler(data));
  });
  source.addEventListener('export', (event) => {
    const data = JSON.parse((event as MessageEvent<string>).data) as ExportEvent;
    listeners.export.forEach((handler) => handler(data));
  });
  source.addEventListener('inbox', (event) => {
    const data = JSON.parse((event as MessageEvent<string>).data) as { unread: number };
    session.unread = data.unread;
    listeners.inbox.forEach((handler) => handler(data));
  });
}

export function disconnectEvents(): void {
  source?.close();
  source = null;
}
