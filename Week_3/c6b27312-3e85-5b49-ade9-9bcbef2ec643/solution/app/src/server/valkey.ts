// Valkey: live updates between processes, evaluation cancel handles and the signed-out pre-flight counters.
// Every feature built on it degrades quietly while Valkey is unreachable.
import { Redis } from "ioredis";
import { config } from "./config";

let lastLogged = "";

function connect(offlineQueue: boolean): Redis {
  const client = new Redis(config.valkey.url, {
    maxRetriesPerRequest: offlineQueue ? null : 1,
    enableOfflineQueue: offlineQueue,
    connectTimeout: 2000,
    retryStrategy: (attempt) => Math.min(attempt * 500, 2000),
  });
  client.on("error", (error) => {
    if (error.message !== lastLogged) console.error("valkey:", error.message);
    lastLogged = error.message;
  });
  client.on("ready", () => {
    lastLogged = "";
  });
  return client;
}

export const valkey = connect(false);
const subscriber = connect(true);

export const key = (name: string): string => `${config.valkey.prefix}${name}`;

/** Runs a command, answering `fallback` when Valkey cannot be reached. */
export async function attempt<T>(work: (client: Redis) => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work(valkey);
  } catch {
    return fallback;
  }
}

type Handler = (message: string, channel: string) => void;
const handlers = new Map<string, Handler>();
const patterns = new Map<string, Handler>();

subscriber.on("message", (channel: string, message: string) => handlers.get(channel)?.(message, channel));
subscriber.on("pmessage", (pattern: string, channel: string, message: string) => patterns.get(pattern)?.(message, channel));

export function listen(channel: string, handler: Handler): void {
  handlers.set(key(channel), handler);
  subscriber.subscribe(key(channel)).catch(() => undefined);
}

export function listenPattern(pattern: string, handler: Handler): void {
  patterns.set(key(pattern), handler);
  subscriber.psubscribe(key(pattern)).catch(() => undefined);
}
