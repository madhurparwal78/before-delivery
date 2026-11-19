export interface StreamHandlers {
  onEvent: (seq: number, type: string, data: unknown) => void;
  onResync: () => void;
  onDown: (down: boolean) => void;
}

/**
 * One event stream connection. The browser replays what it missed through
 * Last-Event-ID and falls back to re-reading the snapshot while it is unavailable.
 */
export function openStream(url: string, handlers: StreamHandlers): () => void {
  let source: EventSource | null = null;
  let poll: number | null = null;
  let closed = false;

  const stopPolling = (): void => {
    if (poll !== null) {
      window.clearInterval(poll);
      poll = null;
    }
  };

  const startPolling = (): void => {
    if (poll !== null) return;
    poll = window.setInterval(() => handlers.onResync(), 3000);
  };

  const connect = (): void => {
    if (closed) return;
    source = new EventSource(url, { withCredentials: true });

    source.addEventListener('open', () => {
      stopPolling();
      handlers.onDown(false);
    });

    source.addEventListener('resync', () => handlers.onResync());

    source.addEventListener('message', (event) => {
      const message = event as MessageEvent<string>;
      handlers.onEvent(Number.parseInt(message.lastEventId, 10), 'message', JSON.parse(message.data));
    });

    for (const type of [
      'tick.committed',
      'authority.granted',
      'authority.refused',
      'authority.released',
      'train.moved',
      'conflict.closed',
      'conflict.changed',
      'session.status',
      'session.version',
      'block.changed',
      'turnout.changed',
      'packet.changed',
      'name.changed',
      'piece.added',
      'piece.changed',
      'piece.removed',
      'module.changed',
      'version.changed',
      'timetable.changed',
    ]) {
      source.addEventListener(type, (event) => {
        const message = event as MessageEvent<string>;
        handlers.onEvent(
          Number.parseInt(message.lastEventId, 10),
          type,
          JSON.parse(message.data) as unknown,
        );
      });
    }

    source.addEventListener('error', () => {
      handlers.onDown(true);
      startPolling();
    });
  };

  connect();

  return () => {
    closed = true;
    stopPolling();
    source?.close();
  };
}
