import { api, ApiError, type RoomEvent } from './api.ts';

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const fields = err.body.fields as Record<string, string> | undefined;
    if (fields) {
      const first = Object.values(fields)[0];
      if (first) return first;
    }
    return '';
  }
  return '';
}

// ---------- server clock ----------

let clockOffset = 0;

export function serverNow(): number {
  return Date.now() + clockOffset;
}

export async function syncClock(): Promise<void> {
  try {
    const before = Date.now();
    const { serverNow: reported } = await api.serverTime();
    const after = Date.now();
    const rtt = after - before;
    clockOffset = reported + rtt / 2 - after;
  } catch {
    /* keep last offset */
  }
}

export function secondsLeft(deadlineAt: number): number {
  return Math.max(0, Math.ceil((deadlineAt - serverNow()) / 1000));
}

// ---------- live link with backup polling ----------

export interface LiveHandlers {
  onEvent: (event: RoomEvent) => void;
  onTransport: (transport: 'live' | 'backup') => void;
}

export class LiveLink {
  private readonly roomId: string;
  private readonly query: string;
  private readonly handlers: LiveHandlers;
  private es: EventSource | null = null;
  private lastEventId = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private transport: 'live' | 'backup' = 'live';

  constructor(roomId: string, query: string, handlers: LiveHandlers, startEventId = 0) {
    this.roomId = roomId;
    this.query = query;
    this.handlers = handlers;
    this.lastEventId = startEventId;
  }

  start(): void {
    this.openStream();
  }

  stop(): void {
    this.stopped = true;
    this.es?.close();
    this.es = null;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  seen(eventId: number): void {
    if (eventId > this.lastEventId) this.lastEventId = eventId;
  }

  private setTransport(transport: 'live' | 'backup'): void {
    if (this.transport !== transport) {
      this.transport = transport;
      this.handlers.onTransport(transport);
    }
  }

  private openStream(): void {
    if (this.stopped) return;
    const url = `/api/rooms/${this.roomId}/stream?${this.query}`;
    const es = new EventSource(url, { withCredentials: true });
    this.es = es;
    es.onopen = () => {
      this.setTransport('live');
    };
    es.onerror = () => {
      if (this.stopped) return;
      es.close();
      this.es = null;
      this.setTransport('backup');
      this.pollNow();
    };
    const forward = (type: string, id: number, raw: string) => {
      if (type === 'superseded' || type === 'ended') {
        this.handlers.onEvent({ id: 0, type, data: {} });
        es.close();
        return;
      }
      if (id > this.lastEventId) this.lastEventId = id;
      let data: unknown = {};
      try {
        data = JSON.parse(raw || '{}');
      } catch {
        data = {};
      }
      this.handlers.onEvent({ id, type, data });
    };
    for (const type of ['player_joined', 'presence', 'question_open', 'answer_count', 'locked', 'reveal', 'leaderboard', 'podium', 'ended', 'superseded']) {
      es.addEventListener(type, (ev: MessageEvent) => {
        forward(type, Number((ev as MessageEvent & { lastEventId?: string }).lastEventId ?? 0), ev.data as string);
      });
    }
  }

  private async pollNow(): Promise<void> {
    if (this.stopped) return;
    try {
      const res = await fetch(
        `/api/rooms/${this.roomId}/poll?after=${this.lastEventId}&${this.query}`,
        { withCredentials: true } as RequestInit,
      );
      if (res.status === 503) {
        this.schedulePoll(1000);
        return;
      }
      if (res.ok) {
        const body = (await res.json()) as { events: RoomEvent[] };
        for (const event of body.events) {
          if (event.id > this.lastEventId) this.lastEventId = event.id;
          this.handlers.onEvent(event);
        }
        if (body.events.length > 0 && this.transport === 'backup') {
          // data flowed over the backup link; keep polling until the live link returns
          this.schedulePoll(500);
        } else {
          this.schedulePoll(500);
        }
        this.retryLive();
        return;
      }
      if (res.status === 401 || res.status === 409 || res.status === 410) {
        const body = (await res.json()) as { error?: string };
        this.handlers.onEvent({ id: 0, type: body.error === 'client_superseded' ? 'superseded' : body.error === 'room_ended' ? 'ended' : 'poll_error', data: {} });
        return;
      }
      this.schedulePoll(1000);
    } catch {
      this.schedulePoll(1000);
    }
  }

  private schedulePoll(delayMs: number): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.pollNow();
    }, delayMs);
  }

  private retryLive(): void {
    if (this.transport === 'backup') {
      this.openStream();
    }
  }
}

// ---------- countdown hook ----------

export interface CountdownHandle {
  read: () => number;
  stop: () => void;
}

export function startCountdown(
  deadlineAt: number | null,
  onTick: (secondsLeft: number) => void,
): CountdownHandle {
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    if (deadlineAt !== null) {
      onTick(secondsLeft(deadlineAt));
      if (deadlineAt - serverNow() < -5000) return;
    }
    setTimeout(tick, 200);
  };
  setTimeout(tick, 100);
  return {
    read: () => (deadlineAt === null ? 0 : secondsLeft(deadlineAt)),
    stop: () => {
      stopped = true;
    },
  };
}

export function tallyMark(position: number): string {
  return '𝍸'.repeat(Math.max(1, position));
}

export function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

export function sharePercent(count: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((count / total) * 100 + Number.EPSILON);
}
