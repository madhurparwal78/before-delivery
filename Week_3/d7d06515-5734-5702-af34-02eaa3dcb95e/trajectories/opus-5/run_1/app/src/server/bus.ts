import Redis from 'ioredis';
import { config } from './config';

export type BusMessage = Record<string, unknown>;
type Listener = (message: BusMessage) => void;

const listeners = new Map<string, Set<Listener>>();
const availabilityListeners = new Set<(available: boolean) => void>();

function clientOptions(): Record<string, unknown> {
  return {
    retryStrategy: () => 2000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 3000,
    reconnectOnError: () => true,
  };
}

const publisher = new Redis(config.valkeyUrl, clientOptions());
const subscriber = new Redis(config.valkeyUrl, clientOptions());

let available = false;

function setAvailable(next: boolean): void {
  if (available === next) return;
  available = next;
  for (const listener of availabilityListeners) listener(next);
}

for (const client of [publisher, subscriber]) {
  client.on('error', () => setAvailable(false));
  client.on('end', () => setAvailable(false));
  client.on('close', () => setAvailable(false));
}

publisher.on('ready', () => {
  if (subscriber.status === 'ready') setAvailable(true);
});
subscriber.on('ready', () => {
  void subscriber.psubscribe('drawing:*', 'account:*').catch(() => setAvailable(false));
  if (publisher.status === 'ready') setAvailable(true);
});

subscriber.on('pmessage', (_pattern: string, channel: string, payload: string) => {
  const set = listeners.get(channel);
  if (set === undefined || set.size === 0) return;
  const message = JSON.parse(payload) as BusMessage;
  for (const listener of [...set]) listener(message);
});

export function valkeyAvailable(): boolean {
  return available;
}

export function onAvailabilityChange(listener: (next: boolean) => void): () => void {
  availabilityListeners.add(listener);
  return () => availabilityListeners.delete(listener);
}

export function subscribe(channel: string, listener: Listener): () => void {
  const set = listeners.get(channel) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(channel, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(channel);
  };
}

export async function publish(channel: string, message: BusMessage): Promise<void> {
  try {
    await publisher.publish(channel, JSON.stringify(message));
  } catch {
    setAvailable(false);
  }
}

export function drawingChannel(drawingId: string): string {
  return `drawing:${drawingId}`;
}

export function accountChannel(userId: string): string {
  return `account:${userId}`;
}

export interface PresenceTab {
  tab_id: string;
  actor: string;
  name: string;
  access: string;
  last_input_at: number;
}

const PRESENCE_TTL_SECONDS = 30;

function presenceSetKey(drawingId: string): string {
  return `presence:${drawingId}`;
}

function presenceTabKey(drawingId: string, tabId: string): string {
  return `presence:${drawingId}:${tabId}`;
}

export async function recordPresenceInput(
  drawingId: string,
  tabId: string,
  actor: string,
  name: string,
  access: string,
  at: Date,
): Promise<void> {
  try {
    await publisher
      .multi()
      .sadd(presenceSetKey(drawingId), tabId)
      .expire(presenceSetKey(drawingId), PRESENCE_TTL_SECONDS * 4)
      .hset(presenceTabKey(drawingId, tabId), {
        actor,
        name,
        access,
        last_input_at: String(at.getTime()),
      })
      .expire(presenceTabKey(drawingId, tabId), PRESENCE_TTL_SECONDS)
      .exec();
  } catch {
    setAvailable(false);
  }
}

export async function refreshPresenceTab(drawingId: string, tabId: string): Promise<void> {
  try {
    await publisher
      .multi()
      .expire(presenceTabKey(drawingId, tabId), PRESENCE_TTL_SECONDS)
      .expire(presenceSetKey(drawingId), PRESENCE_TTL_SECONDS * 4)
      .exec();
  } catch {
    setAvailable(false);
  }
}

export async function dropPresenceTab(drawingId: string, tabId: string): Promise<void> {
  try {
    await publisher.multi().srem(presenceSetKey(drawingId), tabId).del(presenceTabKey(drawingId, tabId)).exec();
  } catch {
    setAvailable(false);
  }
}

export async function listPresenceTabs(drawingId: string): Promise<PresenceTab[]> {
  try {
    const tabIds = await publisher.smembers(presenceSetKey(drawingId));
    const tabs: PresenceTab[] = [];
    const stale: string[] = [];
    for (const tabId of tabIds) {
      const hash = await publisher.hgetall(presenceTabKey(drawingId, tabId));
      if (hash.name === undefined) {
        stale.push(tabId);
        continue;
      }
      tabs.push({
        tab_id: tabId,
        actor: hash.actor ?? hash.name,
        name: hash.name,
        access: hash.access ?? 'view',
        last_input_at: Number(hash.last_input_at ?? '0'),
      });
    }
    if (stale.length > 0) await publisher.srem(presenceSetKey(drawingId), ...stale);
    return tabs;
  } catch {
    setAvailable(false);
    return [];
  }
}
