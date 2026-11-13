import { Redis } from 'ioredis';
import { config, SERVICE_PING_MS } from '../config.js';

const RECONNECT_STEP_MS = 500;
const RECONNECT_MAX_MS = 5_000;

const options = {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  autoResubscribe: false,
  connectTimeout: SERVICE_PING_MS,
  commandTimeout: SERVICE_PING_MS,
  retryStrategy: (attempt: number): number => Math.min(attempt * RECONNECT_STEP_MS, RECONNECT_MAX_MS),
};

export const valkey = new Redis(config.valkeyUrl, options);
const subscriber = valkey.duplicate();

const channels = new Set<string>();

export const isValkeyUp = (): boolean => valkey.status === 'ready' && subscriber.status === 'ready';

interface Handlers {
  onMessage: (channel: string, message: string) => void;
  /** Called whenever a connection to Valkey closes. */
  onDown: () => void;
}

/** Starts connecting; the server is already listening, and Valkey being down never stops it. */
export const connectValkey = (handlers: Handlers): void => {
  let wasUp = false;
  for (const client of [valkey, subscriber]) {
    client.on('error', () => undefined);
    client.on('ready', () => { wasUp = isValkeyUp(); });
    client.on('close', () => {
      if (wasUp) handlers.onDown();
      wasUp = false;
    });
  }
  subscriber.on('ready', () => {
    if (channels.size > 0) subscriber.subscribe(...channels).catch(() => undefined);
  });
  subscriber.on('message', handlers.onMessage);
  valkey.connect().catch(() => undefined);
  subscriber.connect().catch(() => undefined);
};

export const watchChannel = (channel: string): void => {
  channels.add(channel);
  if (subscriber.status === 'ready') subscriber.subscribe(channel).catch(() => undefined);
};

export const unwatchChannel = (channel: string): void => {
  channels.delete(channel);
  if (subscriber.status === 'ready') subscriber.unsubscribe(channel).catch(() => undefined);
};

/** Publishes a live message; false when Valkey cannot take it. */
export const publish = async (channel: string, message: object): Promise<boolean> => {
  if (!isValkeyUp()) return false;
  try {
    await valkey.publish(channel, JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
};

export const pingValkey = async (): Promise<boolean> => {
  try {
    return (await valkey.ping()) === 'PONG';
  } catch {
    return false;
  }
};
