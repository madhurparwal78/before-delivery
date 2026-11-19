/**
 * Holds one page's event stream off the page (one worker per stream, never shared between pages), so a page with a
 * stream open still counts as loaded. The page sends `{ url, types }` once and `'close'` when it stops listening; the
 * worker forwards each event's data and reports `open` and `lost`. A closed stream reconnects after two seconds.
 */
interface ConnectEvent {
  readonly ports: readonly MessagePort[];
}

interface Start {
  url: string;
  types: string[];
}

const scope = self as unknown as { onconnect: ((event: ConnectEvent) => void) | null; close(): void };
const RECONNECT_MS = 2000;

scope.onconnect = (connection) => {
  const port = connection.ports[0];
  if (!port) return;
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const connect = ({ url, types }: Start): void => {
    const current = new EventSource(url);
    source = current;
    for (const type of types) current.addEventListener(type, (message) => port.postMessage({ kind: 'event', data: (message as MessageEvent<string>).data }));
    current.onopen = () => port.postMessage({ kind: 'open' });
    current.onerror = () => {
      port.postMessage({ kind: 'lost' });
      if (current.readyState === EventSource.CLOSED && !stopped) timer = setTimeout(() => connect({ url, types }), RECONNECT_MS);
    };
  };

  port.onmessage = (message: MessageEvent<Start | 'close'>) => {
    if (message.data === 'close') {
      stopped = true;
      clearTimeout(timer);
      source?.close();
      scope.close();
      return;
    }
    if (!source) connect(message.data);
  };
};
