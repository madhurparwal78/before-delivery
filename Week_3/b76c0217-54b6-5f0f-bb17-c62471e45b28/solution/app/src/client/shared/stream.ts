const RECONNECT_MS = 3000;

/**
 * Follow a live event stream, a WebSocket at `path`: each message names an event and carries its data.
 * A stream that was open and dropped is opened again; one the server refused is not. Returns the function that stops it.
 */
export function follow(path: string, onEvent: (event: string, data: unknown) => void): () => void {
  let socket: WebSocket | null = null;
  let stopped = false;
  const open = (): void => {
    const next = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}`);
    let opened = false;
    socket = next;
    next.addEventListener('open', () => {
      opened = true;
    });
    next.addEventListener('message', (message) => {
      const { event, data } = JSON.parse(String(message.data)) as { event: string; data: unknown };
      onEvent(event, data);
    });
    next.addEventListener('close', () => {
      if (opened && !stopped) {
        setTimeout(open, RECONNECT_MS);
      }
    });
  };
  open();
  return () => {
    stopped = true;
    socket?.close();
  };
}
