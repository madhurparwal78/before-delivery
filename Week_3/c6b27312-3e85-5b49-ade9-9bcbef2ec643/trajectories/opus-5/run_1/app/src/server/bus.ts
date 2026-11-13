import Redis from 'ioredis';
import { config, PREFLIGHT_COUNTER_TTL_SECONDS } from './config';

export type PartEvent = { id: string; type: string; roomId: string | null; data: unknown };

type Listener = (slug: string, event: PartEvent) => void;

const listeners = new Set<Listener>();
const cancelListeners = new Set<(evaluationId: string) => void>();

function client(options: { fastFail: boolean }): Redis {
  const connection = new Redis(config.valkey.url, {
    maxRetriesPerRequest: options.fastFail ? 1 : null,
    retryStrategy: (times) => Math.min(2000, times * 200),
  });
  connection.on('error', () => {
    /* pages work without live updates and recover when Valkey returns */
  });
  return connection;
}

const commands = client({ fastFail: true });
const subscriber = client({ fastFail: false });

const partChannel = (slug: string): string => `${config.valkey.prefix}part:${slug}`;
const cancelChannel = `${config.valkey.prefix}eval-cancel`;

subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
  const slug = channel.slice(partChannel('').length);
  let event: PartEvent;
  try {
    event = JSON.parse(message) as PartEvent;
  } catch {
    return;
  }
  for (const listener of listeners) listener(slug, event);
});

subscriber.on('message', (channel: string, message: string) => {
  if (channel !== cancelChannel) return;
  for (const listener of cancelListeners) listener(message);
});

/** The relay: each committed outbox row is published on its part's channel. */
export async function publishPartEvent(slug: string, event: PartEvent): Promise<void> {
  try {
    await commands.publish(partChannel(slug), JSON.stringify(event));
  } catch {
    /* live updates resume when Valkey returns */
  }
}

export function onPartEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function onEvaluationCancel(listener: (evaluationId: string) => void): () => void {
  cancelListeners.add(listener);
  return () => cancelListeners.delete(listener);
}

export async function rememberInFlightEvaluation(
  viewerId: string,
  evaluationId: string,
  seq: number,
): Promise<void> {
  try {
    const key = `${config.valkey.prefix}eval:${viewerId}`;
    await commands.hset(key, { evaluationId, seq: String(seq) });
    await commands.expire(key, 60);
  } catch {
    /* cancellation falls back to this process only */
  }
}

export async function readInFlightEvaluation(
  viewerId: string,
): Promise<{ evaluationId: string; seq: number } | null> {
  try {
    const value = await commands.hgetall(`${config.valkey.prefix}eval:${viewerId}`);
    if (!value.evaluationId) return null;
    return { evaluationId: value.evaluationId, seq: Number(value.seq) };
  } catch {
    return null;
  }
}

export async function forgetInFlightEvaluation(viewerId: string, evaluationId: string): Promise<void> {
  try {
    const current = await readInFlightEvaluation(viewerId);
    if (current && current.evaluationId === evaluationId) {
      await commands.del(`${config.valkey.prefix}eval:${viewerId}`);
    }
  } catch {
    /* the key expires by itself */
  }
}

/** Cancellation is published so whichever process runs the evaluation stops it. */
export async function publishEvaluationCancel(evaluationId: string): Promise<void> {
  for (const listener of cancelListeners) listener(evaluationId);
  try {
    await commands.publish(cancelChannel, evaluationId);
  } catch {
    /* the running process already heard it locally */
  }
}

export type PreflightClaim = { allowed: boolean; used: number; retryAfterSeconds: number };

/** A run claims one report from the session's counter atomically before computing. */
export async function claimPreflightReport(visitorId: string, limit: number): Promise<PreflightClaim> {
  const key = `${config.valkey.prefix}preflight:${visitorId}`;
  try {
    const used = await commands.incr(key);
    if (used === 1) await commands.expire(key, PREFLIGHT_COUNTER_TTL_SECONDS);
    if (used > limit) {
      await commands.decr(key);
      const ttl = await commands.ttl(key);
      return {
        allowed: false,
        used: limit,
        retryAfterSeconds: Math.min(PREFLIGHT_COUNTER_TTL_SECONDS, Math.max(1, ttl)),
      };
    }
    return { allowed: true, used, retryAfterSeconds: 0 };
  } catch {
    return { allowed: true, used: 0, retryAfterSeconds: 0 };
  }
}

/** A refused or failed run gives its claim back, so only 201 answers count. */
export async function releasePreflightClaim(visitorId: string): Promise<void> {
  try {
    await commands.decr(`${config.valkey.prefix}preflight:${visitorId}`);
  } catch {
    /* the counter expires by itself */
  }
}

export async function readPreflightUsed(visitorId: string): Promise<number> {
  try {
    const value = await commands.get(`${config.valkey.prefix}preflight:${visitorId}`);
    return value === null ? 0 : Math.max(0, Number(value));
  } catch {
    return 0;
  }
}

export async function setEvaluatorDelay(slug: string, ms: number): Promise<void> {
  const key = `${config.valkey.prefix}grading:delay:${slug}`;
  try {
    if (ms === 0) await commands.del(key);
    else await commands.set(key, String(ms));
  } catch {
    /* the delay is a grading aid only */
  }
}

export async function readEvaluatorDelay(slug: string): Promise<number> {
  try {
    const value = await commands.get(`${config.valkey.prefix}grading:delay:${slug}`);
    return value === null ? 0 : Math.max(0, Number(value));
  } catch {
    return 0;
  }
}

const dropChannel = `${config.valkey.prefix}grading:drop-streams`;
const dropListeners = new Set<() => void>();

subscriber.on('message', (channel: string) => {
  if (channel !== dropChannel) return;
  for (const listener of dropListeners) listener();
});

/** Subscriptions are claimed once the connection is ready, and after every reconnect. */
function subscribeAll(): void {
  void subscriber.psubscribe(`${config.valkey.prefix}part:*`).catch(() => undefined);
  void subscriber.subscribe(cancelChannel, dropChannel).catch(() => undefined);
}

subscriber.on('ready', subscribeAll);
if (subscriber.status === 'ready') subscribeAll();

export function onDropStreams(listener: () => void): () => void {
  dropListeners.add(listener);
  return () => dropListeners.delete(listener);
}

export async function publishDropStreams(): Promise<void> {
  for (const listener of dropListeners) listener();
  try {
    await commands.publish(dropChannel, '1');
  } catch {
    /* this process already dropped its own streams */
  }
}
