import { useEffect, useRef } from 'react';

interface StreamEvent {
  readonly kind: string;
  readonly payload: unknown;
  readonly id: string;
}

const KINDS = [
  'snapshot',
  'server',
  'presence',
  'friends',
  'party',
  'leaderboard',
  'weather',
  'invite',
  'trade',
  'achievement',
  'world',
  'chat',
  'table',
  'announcement',
  'error',
] as const;

type Listener = (event: StreamEvent) => void;

/*
 * One EventSource per stream address, shared by every component that listens
 * to it, so a page never holds more than one connection per stream. The
 * browser's EventSource sends Last-Event-ID on a reconnect, so missed events
 * arrive in order with no gaps.
 */
const sources = new Map<string, { source: EventSource; listeners: Set<Listener> }>();

function subscribe(path: string, listener: Listener): () => void {
  let entry = sources.get(path);
  if (entry === undefined) {
    const source = new EventSource(path, { withCredentials: true });
    const listeners = new Set<Listener>();
    for (const kind of KINDS) {
      source.addEventListener(kind, (event: MessageEvent<string>) => {
        let payload: unknown;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
        for (const each of [...listeners]) each({ kind, payload, id: event.lastEventId });
      });
    }
    entry = { source, listeners };
    sources.set(path, entry);
  }
  const current = entry;
  current.listeners.add(listener);
  return () => {
    current.listeners.delete(listener);
    if (current.listeners.size === 0) {
      current.source.close();
      sources.delete(path);
    }
  };
}

/** Subscribes to one event stream for as long as the component is mounted. */
function useStream(path: string | null, onEvent: Listener): void {
  const latest = useRef(onEvent);
  latest.current = onEvent;
  useEffect(() => {
    if (path === null) return;
    return subscribe(path, (event) => latest.current(event));
  }, [path]);
}

export const useServerStream = (
  slug: string | undefined,
  onEvent: (event: StreamEvent) => void,
): void => useStream(slug === undefined ? null : `/api/servers/${slug}/events`, onEvent);

export const useWorldStream = (
  slug: string | undefined,
  world: string | undefined,
  onEvent: (event: StreamEvent) => void,
): void =>
  useStream(
    slug === undefined || world === undefined
      ? null
      : `/api/servers/${slug}/worlds/${world}/events`,
    onEvent,
  );

export const useTableStream = (
  tableId: string | null,
  onEvent: (event: StreamEvent) => void,
): void => useStream(tableId === null ? null : `/api/tables/${tableId}/events`, onEvent);
