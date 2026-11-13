export interface LiveMessage {
  seq: number;
  type: string;
  data: Record<string, unknown>;
}

export type ConnectionStatus = 'live' | 'reconnecting' | 'closed';

export interface LiveChannel {
  send(message: Record<string, unknown>): void;
  close(): void;
  lastSeq(): number;
}

export interface LiveOptions {
  path: string;
  onMessage(message: LiveMessage): void;
  onStatus(status: ConnectionStatus): void;
}

export function openLive(options: LiveOptions): LiveChannel {
  let socket: WebSocket | null = null;
  let seq = 0;
  let closed = false;
  let timer = 0;

  const connect = (): void => {
    if (closed) return;
    const url = new URL(options.path, window.location.href);
    url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(url.href);
    socket.addEventListener('open', () => {
      options.onStatus('live');
      socket?.send(JSON.stringify({ type: 'hello', since: seq }));
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as LiveMessage;
      if (typeof message.seq === 'number' && message.seq > seq) seq = message.seq;
      options.onMessage(message);
    });
    socket.addEventListener('close', () => {
      if (closed) return;
      options.onStatus('reconnecting');
      timer = window.setTimeout(connect, 400);
    });
    socket.addEventListener('error', () => {
      socket?.close();
    });
  };

  connect();

  return {
    send: (message) => {
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    },
    close: () => {
      closed = true;
      window.clearTimeout(timer);
      socket?.close();
      options.onStatus('closed');
    },
    lastSeq: () => seq,
  };
}
