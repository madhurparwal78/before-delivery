import { useEffect, useRef } from 'react';

export interface StreamEvent {
  readonly kind: string;
  readonly payload: unknown;
  readonly id: string;
}

/**
 * Subscribes to one event stream. The browser's EventSource sends
 * Last-Event-ID on a reconnect, so missed events arrive in order with no gaps.
 */
export function useStream(path: string | null, onEvent: (event: StreamEvent) => void): void {
  const latest = useRef(onEvent);
  latest.current = onEvent;

  useEffect(() => {
    if (path === null) return;
    const source = new EventSource(path, { withCredentials: true });
    const kinds = [
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
    ];
    const handlers = kinds.map((kind) => {
      const handler = (event: MessageEvent<string>): void => {
        let payload: unknown = null;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
        latest.current({ kind, payload, id: event.lastEventId });
      };
      source.addEventListener(kind, handler as EventListener);
      return { kind, handler };
    });

    return () => {
      for (const entry of handlers) {
        source.removeEventListener(entry.kind, entry.handler as EventListener);
      }
      source.close();
    };
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
