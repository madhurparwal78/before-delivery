import Redis from 'ioredis';
import { config } from './config.js';

const OPTIONS = {
  connectTimeout: 1000,
  commandTimeout: 1000,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  retryStrategy: (): number => 2000,
  lazyConnect: false,
} as const;

const commands = new Redis(config.valkeyUrl, OPTIONS);
const subscriber = new Redis(config.valkeyUrl, OPTIONS);

for (const client of [commands, subscriber]) client.on('error', () => undefined);

const CHANNEL_PREFIX = 'layout:';

type Listener = (layoutId: string, payload: unknown) => void;
const listeners = new Set<Listener>();

subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
  const layoutId = channel.slice(CHANNEL_PREFIX.length);
  let payload: unknown;
  try {
    payload = JSON.parse(message);
  } catch {
    return;
  }
  for (const listener of listeners) listener(layoutId, payload);
});

function resubscribe(): void {
  subscriber.psubscribe(`${CHANNEL_PREFIX}*`).catch(() => undefined);
}
subscriber.on('ready', resubscribe);
resubscribe();

export function onLayoutMessage(listener: Listener): void {
  listeners.add(listener);
}

/** Whether Valkey answers a PING within a second. */
export async function valkeyAnswers(): Promise<boolean> {
  try {
    const result = await commands.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}

export async function publishToLayout(layoutId: string, payload: unknown): Promise<void> {
  try {
    await commands.publish(`${CHANNEL_PREFIX}${layoutId}`, JSON.stringify(payload));
  } catch {
    /* Valkey is unreachable, so nothing is pushed live. */
  }
}

function presenceKey(layoutId: string, username: string): string {
  return `presence:${layoutId}:${username}`;
}

export async function renewPresence(layoutId: string, username: string): Promise<void> {
  try {
    await commands.set(presenceKey(layoutId, username), '1', 'EX', config.presenceSeconds);
  } catch {
    /* Presence is live-only state. */
  }
}

export async function dropPresence(layoutId: string, username: string): Promise<void> {
  try {
    await commands.del(presenceKey(layoutId, username));
  } catch {
    /* Presence is live-only state. */
  }
}

export async function presentDesigners(layoutId: string): Promise<string[] | null> {
  const match = presenceKey(layoutId, '*');
  const found: string[] = [];
  let cursor = '0';
  try {
    do {
      const [next, keys] = await commands.scan(cursor, 'MATCH', match, 'COUNT', 500);
      cursor = next;
      for (const key of keys) found.push(key.slice(`presence:${layoutId}:`.length));
    } while (cursor !== '0');
  } catch {
    return null;
  }
  return found.sort();
}
