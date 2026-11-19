export type LiveEvent =
  | {
      type: 'version_saved';
      recipeId: string;
      version: number;
      name: string;
      authorId: string;
      authorName: string;
      teamId: string | null;
    }
  | { type: 'membership_changed'; teamId: string };

export interface LiveChannel {
  readonly connected: () => boolean;
}

/** Keeps one socket open, retrying every two seconds on a page timer. */
export function openLiveChannel(handlers: {
  onEvent: (event: LiveEvent) => void;
  onStateChange: (connected: boolean) => void;
  onReconnect: () => void;
}): LiveChannel {
  let socket: WebSocket | null = null;
  let connected = false;
  let everConnected = false;

  const connect = (): void => {
    if (socket !== null && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${window.location.host}/api/live`);
    socket.addEventListener('open', () => {
      connected = true;
      handlers.onStateChange(true);
      if (everConnected) handlers.onReconnect();
      everConnected = true;
    });
    socket.addEventListener('message', (event) => {
      handlers.onEvent(JSON.parse(String(event.data)) as LiveEvent);
    });
    socket.addEventListener('close', () => {
      if (connected) handlers.onStateChange(false);
      connected = false;
      socket = null;
    });
    socket.addEventListener('error', () => {
      handlers.onStateChange(false);
    });
  };

  connect();
  window.setInterval(() => {
    if (socket === null) connect();
  }, 2000);

  return { connected: () => connected };
}
