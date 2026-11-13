import type {
  ClientIntent,
  EmoteName,
  Party,
  ServerEvent,
  ServerMessage,
  Snapshot,
} from '../shared/types.js';

type EventHandler = (event: ServerEvent) => void;
type StateHandler = (party: Party) => void;
type SnapshotHandler = (snapshot: Snapshot) => void;
type AckHandler = (ack: {
  intent_id: string;
  applied: boolean;
  duplicate: boolean;
  tick: number;
  reason: string | null;
}) => void;
type JoinHandler = (message: Extract<ServerMessage, { type: 'joined' | 'join_refused' }>) => void;

const RETRY_MS = 2000;

class RealtimeClient {
  private socket: WebSocket | null = null;
  private readonly lastSeq = new Map<string, number>();
  private readonly shownEventIds = new Set<string>();
  private readonly pendingIntents = new Map<string, ClientIntent>();
  private readonly eventHandlers = new Set<EventHandler>();
  private readonly stateHandlers = new Set<StateHandler>();
  private readonly snapshotHandlers = new Set<SnapshotHandler>();
  private readonly ackHandlers = new Set<AckHandler>();
  private readonly joinHandlers = new Set<JoinHandler>();
  private sessionId: string | null = null;
  private heartbeatTimer: number | null = null;
  private retryTimer: number | null = null;
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    window.addEventListener('online', () => this.open());
    this.open();
    window.setInterval(() => {
      if (this.socket === null || this.socket.readyState > WebSocket.OPEN) this.open();
    }, RETRY_MS);
  }

  onEvent(handler: EventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  onState(handler: StateHandler): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  onSnapshot(handler: SnapshotHandler): () => void {
    this.snapshotHandlers.add(handler);
    return () => this.snapshotHandlers.delete(handler);
  }

  onAck(handler: AckHandler): () => void {
    this.ackHandlers.add(handler);
    return () => this.ackHandlers.delete(handler);
  }

  onJoin(handler: JoinHandler): () => void {
    this.joinHandlers.add(handler);
    return () => this.joinHandlers.delete(handler);
  }

  /** Remembers the newest seq the page has shown for a stream, so resume skips it. */
  seen(stream: string, seq: number): void {
    const current = this.lastSeq.get(stream) ?? 0;
    if (seq > current) this.lastSeq.set(stream, seq);
  }

  hasShown(eventId: string): boolean {
    return this.shownEventIds.has(eventId);
  }

  markShown(eventId: string): void {
    this.shownEventIds.add(eventId);
  }

  joinSession(sessionId: string): void {
    this.sessionId = sessionId;
    this.send({ type: 'join_session', session_id: sessionId });
  }

  leaveSession(): void {
    this.sessionId = null;
  }

  sendIntent(intent: ClientIntent): void {
    this.pendingIntents.set(intent.intent_id, intent);
    this.send(intent);
  }

  moveTo(sessionId: string, x: number, z: number): void {
    this.sendIntent({
      type: 'intent',
      session_id: sessionId,
      intent_id: crypto.randomUUID(),
      action: 'move_to',
      x,
      z,
    });
  }

  swing(sessionId: string): void {
    this.sendIntent({
      type: 'intent',
      session_id: sessionId,
      intent_id: crypto.randomUUID(),
      action: 'swing',
    });
  }

  emote(sessionId: string, emote: EmoteName): void {
    this.sendIntent({
      type: 'intent',
      session_id: sessionId,
      intent_id: crypto.randomUUID(),
      action: 'emote',
      emote,
    });
  }

  private send(message: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  private open(): void {
    if (this.socket !== null && this.socket.readyState <= WebSocket.OPEN) return;
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${window.location.host}/api/realtime`);
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.send({ type: 'hello', resume: Object.fromEntries(this.lastSeq) });
      this.send({ type: 'heartbeat' });
      if (this.sessionId !== null) this.send({ type: 'join_session', session_id: this.sessionId });
      for (const intent of this.pendingIntents.values()) this.send(intent);
      if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = window.setInterval(() => this.send({ type: 'heartbeat' }), 10_000);
    });

    socket.addEventListener('message', (raw) => {
      const message = JSON.parse(String(raw.data)) as ServerMessage;
      if (message.type === 'event') {
        if (this.shownEventIds.has(message.event_id)) {
          this.seen(message.stream, message.seq);
          return;
        }
        this.shownEventIds.add(message.event_id);
        this.seen(message.stream, message.seq);
        for (const handler of this.eventHandlers) handler(message);
        return;
      }
      if (message.type === 'state') {
        for (const handler of this.stateHandlers) handler(message.party);
        return;
      }
      if (message.type === 'snapshot') {
        for (const handler of this.snapshotHandlers) handler(message.session);
        return;
      }
      if (message.type === 'ack') {
        this.pendingIntents.delete(message.intent_id);
        for (const handler of this.ackHandlers) handler(message);
        return;
      }
      for (const handler of this.joinHandlers) handler(message);
    });

    const reopen = (): void => {
      if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
      if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
      this.retryTimer = window.setTimeout(() => this.open(), 100);
    };
    socket.addEventListener('close', reopen);
    socket.addEventListener('error', () => socket.close());
  }
}

export const realtime = new RealtimeClient();
