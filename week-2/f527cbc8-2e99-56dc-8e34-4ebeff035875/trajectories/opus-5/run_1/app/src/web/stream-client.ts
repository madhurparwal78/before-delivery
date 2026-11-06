/** An event stream that reconnects by itself with its last event id. */
export interface StreamEvent {
  type: string;
  data: unknown;
}

export interface StreamHandle {
  close: () => void;
}

export interface StreamOptions {
  onEvent: (event: StreamEvent) => void;
}

export function openStream(path: string, options: StreamOptions): StreamHandle {
  let source: EventSource | null = null;
  let closed = false;

  const connect = (): void => {
    if (closed) return;
    source = new EventSource(path, { withCredentials: true });
    const forward = (type: string) => (event: MessageEvent<string>) => {
      let data: unknown = null;
      try {
        data = event.data === '' ? null : JSON.parse(event.data);
      } catch {
        data = null;
      }
      options.onEvent({ type, data });
    };
    for (const type of [
      'booking_added',
      'booking_removed',
      'booking_moved',
      'day_status',
      'allocation_fixed',
      'allocation_adjusted',
      'marks_saved',
      'visit_closed',
      'reset',
    ]) {
      source.addEventListener(type, forward(type) as EventListener);
    }
    source.addEventListener('error', () => {
      // The browser reconnects with Last-Event-ID on its own; a closed session ends it.
      if (source?.readyState === EventSource.CLOSED && !closed) {
        window.setTimeout(connect, 2000);
      }
    });
  };

  connect();

  return {
    close: () => {
      closed = true;
      source?.close();
    },
  };
}
