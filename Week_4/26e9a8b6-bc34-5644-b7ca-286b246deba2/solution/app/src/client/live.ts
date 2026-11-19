import type { LiveEvent } from '../shared/types';

interface LiveOptions {
  guideId?: string;
  editor?: boolean;
  /** Re-reads whatever the page shows; runs after every (re)connect so nothing is lost or repeated. */
  catchUp: () => void;
  onEvent: (event: LiveEvent) => void;
}

const RETRY_MS = 500;

/** The page's one same-origin live connection; it reconnects on `online` and within a second, then catches up. */
export class Live {
  private socket: WebSocket | null = null;
  private retry = 0;
  private step = 0;
  private opened = false;

  constructor(private readonly options: LiveOptions) {
    window.addEventListener('online', () => this.connect());
    this.connect();
  }

  selectStep(step: number): void {
    this.step = step;
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'step', step }));
  }

  private connect(): void {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;
    clearTimeout(this.retry);
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live`);
    this.socket = socket;
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'hello', guide: this.options.guideId, editor: this.options.editor === true, step: this.step }));
      if (this.opened) this.options.catchUp();
      this.opened = true;
    });
    socket.addEventListener('message', (message) => this.options.onEvent(JSON.parse(String(message.data)) as LiveEvent));
    const dropped = () => {
      if (this.socket !== socket) return;
      this.retry = window.setTimeout(() => this.connect(), RETRY_MS);
    };
    socket.addEventListener('close', dropped);
    socket.addEventListener('error', () => {
      socket.close();
      dropped();
    });
  }
}
