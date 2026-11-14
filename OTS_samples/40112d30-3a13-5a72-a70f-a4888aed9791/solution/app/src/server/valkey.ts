import { Redis } from 'ioredis';
import { config } from './config.ts';

// Valkey orders and fans out live changes and holds rate-limit counters (brief: Services).
// Down means: every command fails fast and the callers carry on without it.

const COMMAND_TIMEOUT_MS = 1_500;
const RECONNECT_CEILING_MS = 2_000;
const RECONNECT_STEP_MS = 200;

function connect(): Redis {
  const client = new Redis({
    ...config.valkey,
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: COMMAND_TIMEOUT_MS,
    commandTimeout: COMMAND_TIMEOUT_MS,
    retryStrategy: (attempt) => Math.min(attempt * RECONNECT_STEP_MS, RECONNECT_CEILING_MS),
  });
  client.on('error', () => undefined);
  return client;
}

const commands = connect();
const subscriber = connect();

export const valkeyUp = (): boolean => commands.status === 'ready';

/** Run a command; null when Valkey is down or the command fails. */
export async function attempt<T>(run: (client: Redis) => Promise<T>): Promise<T | null> {
  if (!valkeyUp()) return null;
  try {
    return await run(commands);
  } catch {
    return null;
  }
}

export function startValkey(onMessage: (channel: string, payload: string) => void): void {
  void commands.connect().catch(() => undefined);
  subscriber.on('ready', () => {
    void subscriber.psubscribe('nf:form:*', 'nf:summary:*').catch(() => undefined);
  });
  subscriber.on('pmessage', (_pattern, channel, payload) => onMessage(channel, payload));
  void subscriber.connect().catch(() => undefined);
}

export async function checkValkey(): Promise<boolean> {
  return (await attempt((client) => client.ping())) === 'PONG';
}

export const formChannel = (formId: string): string => `nf:form:${formId}`;
export const summaryChannel = (formId: string): string => `nf:summary:${formId}`;
export const sequenceKey = (formId: string): string => `nf:form:${formId}:seq`;
export const presenceKey = (formId: string): string => `nf:presence:${formId}`;
