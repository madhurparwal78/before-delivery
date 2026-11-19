import { api } from './dom';

export interface LiveEvent { kind: string; data?: unknown; at: string; }

interface Handler { (ev: LiveEvent): void }

const handlers: Handler[] = [];

export function subscribeLive(onEvent: Handler): () => void {
  handlers.push(onEvent);
  ensureStream();
  return () => {
    const i = handlers.indexOf(onEvent);
    if (i >= 0) handlers.splice(i, 1);
  };
}

let es: EventSource | null = null;
let retry: number | null = null;

function ensureStream(): void {
  if (es) return;
  try {
    es = new EventSource('/api/events');
    es.onmessage = ev => {
      try {
        const parsed = JSON.parse(ev.data) as LiveEvent;
        for (const h of [...handlers]) h(parsed);
      } catch { /* ignore malformed */ }
    };
    es.onerror = () => {
      es?.close();
      es = null;
      if (retry) window.clearTimeout(retry);
      retry = window.setTimeout(ensureStream, 2000);
    };
  } catch { /* EventSource unsupported */ }
}

export interface Me {
  id: string;
  name: string;
  email: string;
  verified: boolean;
  teams: { id: string; name: string; role: string }[];
}

export async function me(): Promise<Me | null> {
  const r = await api<Me>('GET', '/api/me');
  if (!r.ok) return null;
  return r.data;
}

export function pathParts(): string[] {
  return window.location.pathname.split('/').filter(Boolean);
}

export function queryView(): string {
  return new URLSearchParams(window.location.search).get('view') ?? 'list';
}
