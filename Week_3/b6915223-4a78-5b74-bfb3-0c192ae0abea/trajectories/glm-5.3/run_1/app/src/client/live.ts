export interface PointsUpdate {
  perPlayer: { player_id: string; delta: number; team_points: number }[];
  gameweek_total: number;
  eventLabel?: string;
  playerName?: string;
  eventPlayerId?: string;
  playerDelta?: number;
}

export interface ServerMessage {
  gameweekStatus?: { number: number; status: string };
  notice?: { id: string; kind: string; gameweek: number; message: string; read: boolean; created: string };
  receipt?: { manager_id: string; gameweek: number; receipt: 'stored' | 'pending' };
  points?: PointsUpdate;
  standings?: { league_id?: string };
  price?: { player_id: string; price_tenths: number };
  squadUpdate?: { manager_id: string };
  history?: unknown;
}

export class LiveSocket {
  private socket: WebSocket | null = null;
  private closedByUs = false;
  private backoff = 500;

  constructor(
    private readonly onMessage: (message: ServerMessage) => void,
    private readonly isOperator: () => boolean,
  ) {}

  connect(): void {
    this.closedByUs = false;
    this.open();
  }

  private open(): void {
    const path = this.isOperator() ? '/live/operator' : '/live';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}${path}`);
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      try {
        const parsed = JSON.parse(event.data as string) as ServerMessage;
        this.onMessage(parsed);
      } catch {
        // ignore malformed frames
      }
    });
    socket.addEventListener('close', () => {
      if (this.closedByUs) return;
      this.backoff = Math.min(this.backoff * 2, 8000);
      window.setTimeout(() => this.open(), this.backoff);
    });
    socket.addEventListener('open', () => {
      this.backoff = 500;
    });
  }

  close(): void {
    this.closedByUs = true;
    this.socket?.close();
    this.socket = null;
  }
}
