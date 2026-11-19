export type LiveHandler = (type: string, data: Record<string, unknown>) => void;

export interface LiveOptions {
  ride?: string;
  thread?: string;
  /** Called on every `hello`, so a reconnect brings the page up to date. */
  onHello: () => void;
  onEvent: LiveHandler;
  onDropped?: (dropped: boolean) => void;
}

const TYPES = [
  'seat',
  'ride',
  'booking',
  'notice',
  'message',
  'presence',
  'rating',
  'id_review',
  'wallet',
  'clock',
] as const;

export interface LiveConnection {
  close(): void;
}

export function connectLive(options: LiveOptions): LiveConnection {
  const params = new URLSearchParams();
  if (options.ride) params.set('ride', options.ride);
  if (options.thread) params.set('thread', options.thread);
  const url = `/api/live${params.size > 0 ? `?${params.toString()}` : ''}`;
  const source = new EventSource(url, { withCredentials: true });

  source.addEventListener('hello', () => {
    options.onDropped?.(false);
    options.onHello();
  });
  for (const type of TYPES) {
    source.addEventListener(type, (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as Record<
        string,
        unknown
      >;
      options.onEvent(type, payload);
    });
  }
  source.addEventListener('error', () => {
    if (source.readyState !== EventSource.OPEN) options.onDropped?.(true);
  });

  return {
    close() {
      source.close();
    },
  };
}
