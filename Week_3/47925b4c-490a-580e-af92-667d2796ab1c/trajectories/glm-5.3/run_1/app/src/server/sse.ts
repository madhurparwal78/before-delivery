// SSE hub: per-process subscribers fed by a poller that resumes from the last seen
// sequence, so delivery happens on any process without a single writer's memory.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { isConnectionError, type Database } from './db.js';
import { EventStream, parseLastEventId, type OutboxEvent, type StreamFilter } from './events.js';

interface Subscription {
  stream: EventStream;
  filter: StreamFilter;
  lastSent: number | null;
}

const POLL_MS = 400;

// bigserial arrives as a string; keep sequences as numbers on this side
function sequenceOf(value: unknown): number {
  return typeof value === 'number' ? value : Number(value);
}

export class SseHub {
  private readonly subscriptions = new Set<Subscription>();
  private timer: NodeJS.Timeout | null = null;
  private lastSequence = 0;
  private readonly guards = new Map<Subscription, NodeJS.Timeout>();

  constructor(private readonly db: Database) {}

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => void this.poll(), POLL_MS);
    this.timer.unref();
    // A stream without a readable Last-Event-ID begins with events after connection,
    // so the hub first seeks to the head; until the schema exists this simply retries.
    void this.seekToHead();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const guard of this.guards.values()) clearInterval(guard);
    this.guards.clear();
    this.subscriptions.clear();
  }

  subscribe(req: IncomingMessage, res: ServerResponse, filter: StreamFilter): void {
    const last = parseLastEventId(req.headers['last-event-id'] as string | undefined);
    const stream = new EventStream(req, res);
    stream.open();
    const subscription: Subscription = { stream, filter, lastSent: last };
    this.subscriptions.add(subscription);
    const guard = setInterval(() => {
      if (subscription.stream.isClosed) {
        this.remove(subscription);
      } else {
        subscription.stream.comment();
      }
    }, 15000);
    guard.unref();
    this.guards.set(subscription, guard);
    void this.catchUp(subscription);
  }

  remove(subscription: Subscription): void {
    this.subscriptions.delete(subscription);
    const guard = this.guards.get(subscription);
    if (guard !== undefined) {
      clearInterval(guard);
      this.guards.delete(subscription);
    }
  }

  // A stream resumed with Last-Event-ID on any process receives every later event once,
  // in order; the initial catch-up reads from the outbox before the poller takes over.
  private async catchUp(subscription: Subscription): Promise<void> {
    if (subscription.lastSent === null) return;
    const from = subscription.lastSent;
    let rows: (OutboxEvent & { at: Date })[] = [];
    try {
      rows = await this.readFrom(from);
    } catch {
      return; // the next poll retries; nothing is lost because the client keeps its id
    }
    for (const event of rows) {
      if (subscription.stream.isClosed) return;
      if (subscription.filter(event)) subscription.stream.send(event);
      subscription.lastSent = event.sequence;
    }
  }

  private async poll(): Promise<void> {
    if (this.subscriptions.size === 0) return;
    let events: (OutboxEvent & { at: Date })[];
    try {
      events = await this.readFrom(this.lastSequence);
    } catch (err) {
      if (isConnectionError(err)) return;
      return; // the schema may not exist yet; the seed loop brings it in
    }
    if (events.length === 0) return;
    const newest = sequenceOf(events[events.length - 1]!.sequence);
    if (newest <= this.lastSequence) return;
    const fresh = events.filter((event) => sequenceOf(event.sequence) > this.lastSequence);
    this.lastSequence = newest;
    for (const subscription of [...this.subscriptions]) {
      if (subscription.stream.isClosed) {
        this.remove(subscription);
        continue;
      }
      for (const event of fresh) {
        if (subscription.lastSent !== null && event.sequence <= subscription.lastSent) continue;
        if (subscription.filter(event)) subscription.stream.send(event);
      }
    }
  }

  private async seekToHead(): Promise<void> {
    const client = await this.db.connect();
    try {
      const rows = await client.query('SELECT sequence FROM outbox ORDER BY sequence DESC LIMIT 1');
      const head = rows.rows[0] ?? null;
      if (head !== null) {
        this.lastSequence = sequenceOf(head.sequence);
      }
    } catch (err) {
      if (!isConnectionError(err)) {
        // The schema may not exist yet; the seed loop brings it in and the poller
        // retries from the head at that point.
        this.lastSequence = 0;
      }
    } finally {
      client.release();
    }
  }

  private async readFrom(sequence: number): Promise<(OutboxEvent & { at: Date })[]> {
    const client = await this.db.connect();
    try {
      const rows = await client.query(
        'SELECT sequence, aggregate, aggregate_id, type, data, at FROM outbox WHERE sequence > $1 ORDER BY sequence',
        [sequence],
      );
      return rows.rows as unknown as (OutboxEvent & { at: Date })[];
    } finally {
      client.release();
    }
  }
}
