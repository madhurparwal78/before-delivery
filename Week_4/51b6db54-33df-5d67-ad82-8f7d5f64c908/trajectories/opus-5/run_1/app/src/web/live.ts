export interface LiveMessage {
  type: string;
  [key: string]: unknown;
}

export interface LiveChannel {
  close(): void;
}

/**
 * The private live channel. The browser reporting itself offline counts as a
 * dropped connection at once, with no timer.
 */
export function openChannel(
  path: string,
  onMessage: (message: LiveMessage) => void,
  onState?: (connected: boolean) => void,
): LiveChannel {
  let source: EventSource | null = null;
  let closed = false;

  const connect = (): void => {
    if (closed || !navigator.onLine) return;
    source = new EventSource(path, { withCredentials: true });
    source.onmessage = (event) => {
      onMessage(JSON.parse(event.data) as LiveMessage);
    };
    source.onopen = () => onState?.(true);
    source.onerror = () => {
      onState?.(false);
      source?.close();
      source = null;
      if (!closed) window.setTimeout(connect, 500);
    };
  };

  const goOffline = (): void => {
    source?.close();
    source = null;
    onState?.(false);
  };
  const goOnline = (): void => {
    onState?.(true);
    connect();
  };
  window.addEventListener('offline', goOffline);
  window.addEventListener('online', goOnline);
  connect();

  return {
    close: () => {
      closed = true;
      source?.close();
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    },
  };
}
