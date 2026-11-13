import type { ChangeEvent, ChangeKind } from '../shared/types.js';
import { config } from './config.js';

interface Subscriber {
  userId: string;
  write: (frame: string) => void;
}

const subscribers = new Set<Subscriber>();

/**
 * Notices are numbered and kept for a short while, so a page whose stream opens a moment after it loaded (or that
 * reconnects) still receives the notices published since: the page shell carries the cursor of its load.
 */
interface KeptNotice {
  id: number;
  at: number;
  recipients: readonly string[];
  frame: string;
}
const NOTICE_REPLAY_MS = 60_000;
const NOTICE_REPLAY_MAX = 500;
const kept: KeptNotice[] = [];
let lastNoticeId = 0;

/** The id of the latest notice: a stream opened with this cursor receives every notice published after it. */
export const liveCursor = (): number => lastNoticeId;

function prune(now: number): void {
  while (kept.length > 0 && (kept.length > NOTICE_REPLAY_MAX || now - (kept[0] as KeptNotice).at > NOTICE_REPLAY_MS)) kept.shift();
}

const frame = (event: string, data: unknown): string => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function deliver(recipients: readonly string[], text: string): void {
  for (const subscriber of subscribers) if (recipients.includes(subscriber.userId)) subscriber.write(text);
}

/** Tells every listed user that something about an athlete changed. Call after the change is committed. */
export function publishChange(recipients: readonly string[], athleteId: string, what: readonly ChangeKind[], workoutId?: string): void {
  for (const kind of what) {
    const event: ChangeEvent = { athlete_id: athleteId, what: kind, ...(workoutId !== undefined && { workout_id: workoutId }) };
    deliver(recipients, frame('change', event));
  }
}

export function publishNotice(recipients: readonly string[], text: string): void {
  lastNoticeId += 1;
  const notice: KeptNotice = { id: lastNoticeId, at: Date.now(), recipients: [...recipients], frame: `id: ${lastNoticeId}\n${frame('notice', { text })}` };
  kept.push(notice);
  prune(notice.at);
  deliver(recipients, notice.frame);
}

/** Reads a stream cursor (a notice id): a whole number no later than the latest notice, else null. */
export function parseCursor(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || !/^\d{1,15}$/.test(raw)) return null;
  const value = Number(raw);
  return value <= lastNoticeId ? value : null;
}

/** The live event stream of one user: a comment line every LIVE_HEARTBEAT_MS, and the events they may see. */
export function openStream(userId: string, signal: AbortSignal, after: number | null = null): Response {
  const encoder = new TextEncoder();
  let subscriber: Subscriber | undefined;
  let timer: NodeJS.Timeout | undefined;
  const stop = (): void => {
    if (timer) clearInterval(timer);
    if (subscriber) subscribers.delete(subscriber);
  };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (text: string): void => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          stop();
        }
      };
      subscriber = { userId, write };
      subscribers.add(subscriber);
      write(': connected\n\n');
      if (after !== null) {
        prune(Date.now());
        for (const notice of kept) if (notice.id > after && notice.recipients.includes(userId)) write(notice.frame);
      }
      timer = setInterval(() => write(': heartbeat\n\n'), config.liveHeartbeatMs);
      signal.addEventListener('abort', stop);
    },
    cancel: stop
  });
  return new Response(body, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' }
  });
}
