import { Redis, type RedisOptions } from 'ioredis';
import { config } from './config.js';

/** Every command gives up after one second and nothing queues while Valkey is away; the connection is retried every two seconds. */
const options: RedisOptions = {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 0,
  connectTimeout: 1000,
  commandTimeout: 1000,
  retryStrategy: () => 2000,
};

const publisher = new Redis(config.valkeyUrl, options);
export const subscriber = new Redis(config.valkeyUrl, { ...options, commandTimeout: undefined });

/** Valkey being away is a state of the product (live updates paused), so its errors are reported once per message, not thrown. */
let lastReported = '';
for (const client of [publisher, subscriber]) {
  client.on('error', (error: Error) => {
    if (error.message === lastReported) return;
    lastReported = error.message;
    console.warn('valkey:', error.message);
  });
}

/** The result of a Valkey call, or `fallback` while Valkey does not answer. */
const orElse = <T>(call: Promise<T>, fallback: T): Promise<T> => call.catch(() => fallback);

let lastCheck: { at: number; answer: Promise<boolean> } | null = null;

/** Whether Valkey answers a PING now; the answer is shared for one second. */
export function valkeyLive(): Promise<boolean> {
  const now = Date.now();
  if (!lastCheck || now - lastCheck.at >= 1000) {
    lastCheck = { at: now, answer: orElse(publisher.ping().then(() => true), false) };
  }
  return lastCheck.answer;
}

const layoutChannel = (layoutId: string): string => `layout:${layoutId}`;
const presenceKey = (layoutId: string, username: string): string => `presence:${layoutId}:${username}`;

/** Publish a change on its layout's channel; while Valkey is away nothing is pushed. */
export async function publish(layoutId: string, message: unknown): Promise<void> {
  await orElse(publisher.publish(layoutChannel(layoutId), JSON.stringify(message)), 0);
}

export async function markPresent(layoutId: string, username: string): Promise<void> {
  await orElse(publisher.set(presenceKey(layoutId, username), '1', 'EX', config.presenceSeconds), null);
}

export async function markAbsent(layoutId: string, username: string): Promise<void> {
  await orElse(publisher.del(presenceKey(layoutId, username)), 0);
}

/** Usernames with a live presence key for the layout, or null when Valkey does not answer. */
export async function presentIn(layoutId: string): Promise<string[] | null> {
  const prefix = presenceKey(layoutId, '');
  const names: string[] = [];
  let cursor = '0';
  do {
    const page = await orElse(publisher.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200), null);
    if (!page) return null;
    cursor = page[0];
    names.push(...page[1].map((key) => key.slice(prefix.length)));
  } while (cursor !== '0');
  return names;
}
