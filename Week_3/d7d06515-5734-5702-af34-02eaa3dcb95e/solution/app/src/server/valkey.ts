// Valkey connections: one for commands and publishing, one subscribed to every drawing and account channel.
import { Redis } from 'ioredis';
import { config } from './config.ts';

function connect(): Redis {
  const client = new Redis(config.valkeyUrl, {
    enableOfflineQueue: false,
    connectTimeout: 3000,
    commandTimeout: 3000,
    keepAlive: 5000,
    retryStrategy: () => 1000,
    autoResubscribe: false,
  });
  // Outages are reported by the provider loop; a connection error must never take the process down.
  client.on('error', () => undefined);
  return client;
}

export const commands = connect();
const subscriber = connect();
let subscribed = false;
const listeners: ((channel: string, payload: string) => void)[] = [];

subscriber.on('ready', () => {
  subscriber.psubscribe('drawing:*', 'account:*').then(() => { subscribed = true; }, () => undefined);
});
subscriber.on('close', () => { subscribed = false; });
subscriber.on('pmessage', (_pattern: string, channel: string, payload: string) => {
  for (const listener of listeners) listener(channel, payload);
});

/** Receives every message published on a drawing or account channel, from any app instance. */
export function onMessage(listener: (channel: string, payload: string) => void): void {
  listeners.push(listener);
}

/** Resolves when Valkey answers PING and this instance is subscribed to the channels. Throws otherwise. */
export async function checkValkey(): Promise<void> {
  await commands.ping();
  if (!subscribed) throw new Error('not subscribed');
}

export function closeValkey(): void {
  commands.disconnect();
  subscriber.disconnect();
}
