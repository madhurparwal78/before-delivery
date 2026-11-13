import type { ClientSocketMessage, ServerSocketMessage } from '../shared/api';

export interface LiveHandlers {
  onMessage(message: ServerSocketMessage): void;
  onOpen?(): void;
  onClose?(code: number): void;
}

/** The one WebSocket the app server serves on its own port. */
export class LiveSocket {
  private socket: WebSocket | null = null;
  private readonly queue: ClientSocketMessage[] = [];
  private closed = false;

  constructor(handlers: LiveHandlers) {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.addEventListener('open', () => {
      for (const message of this.queue.splice(0)) socket.send(JSON.stringify(message));
      handlers.onOpen?.();
    });
    socket.addEventListener('message', (event) => {
      handlers.onMessage(JSON.parse(String(event.data)) as ServerSocketMessage);
    });
    socket.addEventListener('close', (event) => {
      if (!this.closed) handlers.onClose?.(event.code);
    });
  }

  send(message: ClientSocketMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
    else this.queue.push(message);
  }

  close(): void {
    this.closed = true;
    this.socket?.close();
    this.socket = null;
  }
}
