import Redis from 'ioredis';
import { config } from './config';
import { ApiError } from './errors';

function client(): Redis {
  return new Redis(config.valkeyUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    enableReadyCheck: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    retryStrategy: () => 2000,
    reconnectOnError: () => true,
  });
}

const commands = client();
const subscriber = client();

let commandsReady = false;
let subscriberReady = false;

commands.on('ready', () => {
  commandsReady = true;
});
commands.on('end', () => {
  commandsReady = false;
});
commands.on('error', () => {
  commandsReady = false;
});

subscriber.on('ready', () => {
  subscriberReady = true;
});
subscriber.on('end', () => {
  subscriberReady = false;
});
subscriber.on('error', () => {
  subscriberReady = false;
});

type ChannelListener = (payload: unknown) => void;

const listeners = new Map<string, Set<ChannelListener>>();

subscriber.on('message', (channel: string, raw: string) => {
  const set = listeners.get(channel);
  if (!set) return;
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return;
  }
  for (const listener of set) listener(payload);
});

export function isValkeyUp(): boolean {
  return commandsReady;
}

export function valkey(): Redis {
  if (!commandsReady) throw new ApiError('LIVE_UNAVAILABLE');
  return commands;
}

/** Runs a Valkey command, turning an unreachable server into LIVE_UNAVAILABLE. */
export async function live<T>(work: (redis: Redis) => Promise<T>): Promise<T> {
  const redis = valkey();
  try {
    return await work(redis);
  } catch (cause) {
    if (cause instanceof ApiError) throw cause;
    commandsReady = false;
    throw new ApiError('LIVE_UNAVAILABLE');
  }
}

export async function publish(channel: string, payload: unknown): Promise<void> {
  if (!commandsReady) return;
  await commands.publish(channel, JSON.stringify(payload)).catch(() => undefined);
}

export function subscribe(channel: string, listener: ChannelListener): () => void {
  let set = listeners.get(channel);
  if (!set) {
    set = new Set();
    listeners.set(channel, set);
    if (subscriberReady) void subscriber.subscribe(channel).catch(() => undefined);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) {
      listeners.delete(channel);
      if (subscriberReady) void subscriber.unsubscribe(channel).catch(() => undefined);
    }
  };
}

subscriber.on('ready', () => {
  for (const channel of listeners.keys()) void subscriber.subscribe(channel).catch(() => undefined);
});

export async function connectValkey(): Promise<void> {
  for (const connection of [commands, subscriber]) {
    if (connection.status === 'end' || connection.status === 'close') {
      await connection.connect().catch(() => undefined);
    }
  }
}

export function startValkey(): void {
  void commands.connect().catch(() => undefined);
  void subscriber.connect().catch(() => undefined);
}

export const keys = {
  room: (code: string): string => `seam:room:${code}`,
  presence: (code: string, playerId: string): string => `seam:presence:${code}:${playerId}`,
  leaderboard: (date: string): string => `seam:leaderboard:${date}`,
  joins: (playerId: string): string => `seam:joins:${playerId}`,
  roomChannel: (code: string): string => `seam:channel:room:${code}`,
  leaderboardChannel: (date: string): string => `seam:channel:leaderboard:${date}`,
};
