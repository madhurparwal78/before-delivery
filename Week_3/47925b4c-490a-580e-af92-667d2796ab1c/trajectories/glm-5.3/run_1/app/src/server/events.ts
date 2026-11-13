// The transactional outbox: every committed state change writes its event in the same
// transaction, and streams deliver it on any process within the bound (DP-48).

import type { PoolClient } from 'pg';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface OutboxEvent {
  sequence: number;
  aggregate: string;
  aggregate_id: string;
  type: string;
  data: unknown;
  at: Date;
}

const HEARTBEAT_MS = 15000;

export async function writeOutbox(
  client: PoolClient,
  type: string,
  aggregate: string,
  aggregateId: string,
  data: Record<string, unknown>,
): Promise<void> {
  await client.query(
    'INSERT INTO outbox (aggregate, aggregate_id, type, data) VALUES ($1,$2,$3,$4)',
    [aggregate, aggregateId, type, JSON.stringify(data)],
  );
}

export interface StreamFilter {
  (event: OutboxEvent): boolean;
}

// A WHATWG server-sent events stream; a stream resumed with Last-Event-ID receives
// every later event once, in order, and a comment line goes out at least every 15 seconds.
export class EventStream {
  private closed = false;

  constructor(
    private readonly req: IncomingMessage,
    private readonly res: ServerResponse,
  ) {}

  open(): void {
    this.res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    this.res.write(': open\n\n');
    this.req.on('close', () => {
      this.closed = true;
    });
  }

  get isClosed(): boolean {
    return this.closed || this.res.writableEnded || this.res.destroyed;
  }

  send(event: OutboxEvent): void {
    if (this.isClosed) return;
    const payload = {
      type: event.type,
      aggregate: event.aggregate,
      aggregateId: event.aggregate_id,
      sequence: event.sequence,
      at: event.at.toISOString().replace(/\.\d{3}Z$/, '+00:00'),
      data: event.data,
    };
    this.res.write(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(payload)}\n\n`);
  }

  comment(text = 'keep-alive'): void {
    if (this.isClosed) return;
    this.res.write(`: ${text}\n\n`);
  }
}

export function heartbeatTimer(send: () => void): NodeJS.Timeout {
  const timer = setInterval(send, HEARTBEAT_MS);
  timer.unref();
  return timer;
}

export function parseLastEventId(header: string | undefined): number | null {
  if (header === undefined || header === '') return null;
  const parsed = Number(header);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}
