import { useEffect, useRef, useState } from 'react';
import type { RoomEvent } from '../../shared/protocol';

export type Transport = 'live' | 'backup' | 'reconnecting' | 'idle';

export interface RoomLinkOptions {
  roomId: string;
  /** Query string identifying the client, without the leading '?'. */
  query: string;
  enabled: boolean;
  /** Loads the authoritative state and returns its lastEventId. */
  resync: () => Promise<number | null>;
  onEvent: (event: RoomEvent, replayed: boolean) => void;
  onSuperseded: () => void;
  onEnded: () => void;
  onLost: () => void;
}

const STREAM_RETRY_MS = 1_000;
const BACKUP_POLL_MS = 5_000;

type Attempt = 'closed' | 'refused' | 'fatal';

export function useRoomLink(options: RoomLinkOptions): Transport {
  const [transport, setTransport] = useState<Transport>('idle');
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    if (!options.enabled) return undefined;
    let stopped = false;
    let lastSeen = 0;
    const aborts = new Set<AbortController>();

    const delay = (ms: number): Promise<void> =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      });

    const tracked = (): AbortController => {
      const controller = new AbortController();
      aborts.add(controller);
      return controller;
    };

    const apply = (event: RoomEvent, replayed: boolean): void => {
      if (event.id <= lastSeen) return;
      lastSeen = event.id;
      latest.current.onEvent(event, replayed);
    };

    const fatal = (status: number): boolean => {
      if (status === 409) {
        latest.current.onSuperseded();
        return true;
      }
      if (status === 410) {
        latest.current.onEnded();
        return true;
      }
      if (status === 401 || status === 404) {
        latest.current.onLost();
        return true;
      }
      return false;
    };

    const streamOnce = async (): Promise<Attempt> => {
      const controller = tracked();
      let response: Response;
      try {
        response = await fetch(
          `/api/rooms/${options.roomId}/stream?${latest.current.query}&lastEventId=${lastSeen}`,
          {
            headers: { 'Last-Event-ID': String(lastSeen) },
            credentials: 'same-origin',
            signal: controller.signal,
          },
        );
      } catch {
        aborts.delete(controller);
        return 'closed';
      }
      if (response.status === 503) {
        aborts.delete(controller);
        return 'refused';
      }
      if (!response.ok || !response.body) {
        aborts.delete(controller);
        return fatal(response.status) ? 'fatal' : 'closed';
      }
      if (!stopped) setTransport('live');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let replaying = true;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let split = buffer.indexOf('\n\n');
          while (split >= 0) {
            const frame = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            if (frame.startsWith(': live-edge')) replaying = false;
            else if (!frame.startsWith(':')) {
              const parsed = parseFrame(frame);
              if (parsed === 'superseded') {
                latest.current.onSuperseded();
                aborts.delete(controller);
                return 'fatal';
              }
              if (parsed) apply(parsed, replaying);
            }
            split = buffer.indexOf('\n\n');
          }
        }
      } catch {
        // A dropped line is a reconnect, not a failure.
      }
      aborts.delete(controller);
      return 'closed';
    };

    const pollOnce = async (): Promise<Attempt> => {
      const controller = tracked();
      const timer = setTimeout(() => controller.abort(), BACKUP_POLL_MS);
      try {
        const response = await fetch(
          `/api/rooms/${options.roomId}/poll?after=${lastSeen}&${latest.current.query}`,
          { credentials: 'same-origin', signal: controller.signal },
        );
        if (!response.ok) return fatal(response.status) ? 'fatal' : 'closed';
        const body = (await response.json()) as { events: RoomEvent[] };
        for (const event of body.events) apply(event, false);
        return 'closed';
      } catch {
        return 'closed';
      } finally {
        clearTimeout(timer);
        aborts.delete(controller);
      }
    };

    const run = async (): Promise<void> => {
      const startId = await latest.current.resync();
      if (startId === null || stopped) return;
      lastSeen = startId;
      while (!stopped) {
        const attempt = await streamOnce();
        if (attempt === 'fatal' || stopped) return;
        if (attempt === 'refused') {
          setTransport('backup');
          if ((await pollOnce()) === 'fatal') return;
          continue;
        }
        setTransport('reconnecting');
        await delay(STREAM_RETRY_MS);
      }
    };

    void run();
    return () => {
      stopped = true;
      for (const controller of aborts) controller.abort();
      aborts.clear();
    };
  }, [options.roomId, options.enabled]);

  return transport;
}

function parseFrame(frame: string): RoomEvent | 'superseded' | null {
  let id = 0;
  let type = '';
  let data = '';
  for (const line of frame.split('\n')) {
    if (line.startsWith('id: ')) id = Number(line.slice(4));
    else if (line.startsWith('event: ')) type = line.slice(7);
    else if (line.startsWith('data: ')) data = line.slice(6);
  }
  if (type === 'superseded') return 'superseded';
  if (!type || !data) return null;
  return { id, type, data: JSON.parse(data) } as RoomEvent;
}
