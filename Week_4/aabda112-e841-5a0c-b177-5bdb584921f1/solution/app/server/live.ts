import type { ServerResponse } from 'node:http';
import type { LiveEvent } from '../shared/domain.js';
import { listen, notify, pool, type Db } from './db.js';

/**
 * The one publisher. Every state change goes through `publish`; Postgres NOTIFY carries it to every process of the
 * database, and each process fans it out to the event streams of the clinic's open windows.
 */
interface Subscriber {
  clinicId: string;
  userId: string;
  res: ServerResponse;
}

const CHANNEL = 'rb_live';
const subscribers = new Set<Subscriber>();

/**
 * Every delivered event is numbered and kept for a short while, so a window whose stream opens after the page has
 * settled (or reconnects) resumes from the sequence it last knew and misses nothing published in between.
 */
interface Recent {
  seq: number;
  clinicId: string;
  event: LiveEvent;
  at: number;
}
const REPLAY_MS = 120_000;
const REPLAY_MAX = 2_000;
const recent: Recent[] = [];
let seq = 0;

export function currentSeq(): number {
  return seq;
}

function reaches(sub: Subscriber, clinicId: string): boolean {
  return clinicId === EVERY_CLINIC || sub.clinicId === clinicId;
}

/** Writes one numbered event; false once the stream is finished (closed, or the subscriber was just removed). */
function write(sub: Subscriber, entry: Recent): boolean {
  if (sub.res.writableEnded) return false;
  sub.res.write(`id: ${entry.seq}\ndata: ${JSON.stringify(entry.event)}\n\n`);
  if (entry.event.t === 'removed' && entry.event.userId === sub.userId) {
    sub.res.end();
    return false;
  }
  return true;
}

export async function publish(db: Db, clinicId: string, event: LiveEvent): Promise<void> {
  await notify(db, CHANNEL, { clinicId, event });
}

export function publishNow(clinicId: string, event: LiveEvent): Promise<void> {
  return publish(pool, clinicId, event);
}

/** Every open window of every clinic, for changes the grading clock makes at once. */
export const EVERY_CLINIC = '*';

function deliver(clinicId: string, event: LiveEvent): void {
  const entry = { seq: ++seq, clinicId, event, at: Date.now() };
  recent.push(entry);
  while (recent.length > REPLAY_MAX || (recent.length && recent[0]!.at < entry.at - REPLAY_MS)) recent.shift();
  for (const sub of subscribers) {
    if (reaches(sub, clinicId) && !write(sub, entry)) subscribers.delete(sub);
  }
}

export function startLive(): void {
  listen(CHANNEL, (payload) => {
    const { clinicId, event } = JSON.parse(payload) as { clinicId: string; event: LiveEvent };
    deliver(clinicId, event);
  });
  setInterval(() => {
    for (const sub of subscribers) if (!sub.res.writableEnded) sub.res.write(': keep-alive\n\n');
  }, 15_000).unref();
}

export function subscribe(clinicId: string, userId: string, res: ServerResponse, after?: number): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 1000\n\n');
  const sub = { clinicId, userId, res };
  if (after !== undefined) {
    for (const entry of recent) {
      if (entry.seq > after && reaches(sub, entry.clinicId) && !write(sub, entry)) return;
    }
  }
  subscribers.add(sub);
  res.on('close', () => subscribers.delete(sub));
  res.on('error', () => subscribers.delete(sub));
}

export function subscribedClinics(): string[] {
  return [...new Set([...subscribers].map((s) => s.clinicId))];
}
