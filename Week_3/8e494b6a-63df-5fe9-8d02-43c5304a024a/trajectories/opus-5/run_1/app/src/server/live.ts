import type { ServerResponse } from 'node:http';
import { nowIso, nowMs } from './clock.js';
import { one } from './db.js';
import { rates, settings } from './env.js';

export type MessageType = 'clock' | 'alert' | 'inbox' | 'case' | 'upload' | 'lifecycle';

type Subscriber = { spaceId: number; res: ServerResponse; timer: NodeJS.Timeout };

const subscribers = new Set<Subscriber>();

type TailSubscriber = {
  streamId: number;
  res: ServerResponse;
  timer: NodeJS.Timeout;
  second: number;
  sent: number;
  skipped: number;
};

const tails = new Set<TailSubscriber>();

export async function currentSeq(spaceId: number): Promise<number> {
  const row = await one<{ seq: string }>(`select seq::text as seq from spaces where id = $1`, [spaceId]);
  return Number(row?.seq ?? '0');
}

/** Every live message takes the next per-space sequence number. */
export async function publish(
  spaceId: number,
  type: MessageType,
  data: Record<string, unknown>,
): Promise<number> {
  const row = await one<{ seq: string }>(
    `update spaces set seq = seq + 1 where id = $1 returning seq::text as seq`,
    [spaceId],
  );
  const seq = Number(row?.seq ?? '0');
  const payload = JSON.stringify({ type, seq, at: nowIso(), ...data });
  for (const subscriber of subscribers) {
    if (subscriber.spaceId !== spaceId) continue;
    subscriber.res.write(`id: ${seq}\nevent: message\ndata: ${payload}\n\n`);
  }
  return seq;
}

export function subscribeSpace(spaceId: number, res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  });
  res.write(`: connected\n\n`);
  const timer = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, settings.sseHeartbeatMs);
  const subscriber: Subscriber = { spaceId, res, timer };
  subscribers.add(subscriber);
  res.on('close', () => {
    clearInterval(timer);
    subscribers.delete(subscriber);
  });
}

export function subscribeTail(streamId: number, streamName: string, res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  });
  res.write(`event: start\ndata: ${JSON.stringify({ stream: streamName })}\n\n`);
  const timer = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, settings.sseHeartbeatMs);
  const subscriber: TailSubscriber = {
    streamId,
    res,
    timer,
    second: Math.floor(nowMs() / 1000),
    sent: 0,
    skipped: 0,
  };
  tails.add(subscriber);
  res.on('close', () => {
    clearInterval(timer);
    tails.delete(subscriber);
  });
}

/** A tail sends at most SPOOR_TAIL_RATE lines per server-clock second. */
export function publishTailLine(streamId: number, event: Record<string, unknown>): void {
  const second = Math.floor(nowMs() / 1000);
  for (const subscriber of tails) {
    if (subscriber.streamId !== streamId) continue;
    if (subscriber.second !== second) {
      subscriber.second = second;
      subscriber.sent = 0;
      subscriber.skipped = 0;
    }
    if (subscriber.sent >= rates.tail) {
      subscriber.skipped += 1;
      subscriber.res.write(`event: slowed\ndata: ${JSON.stringify({ skipped: subscriber.skipped })}\n\n`);
      continue;
    }
    subscriber.sent += 1;
    subscriber.res.write(`event: line\ndata: ${JSON.stringify(event)}\n\n`);
  }
}
