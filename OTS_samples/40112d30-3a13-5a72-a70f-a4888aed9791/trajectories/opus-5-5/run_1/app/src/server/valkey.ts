import { Redis, type RedisOptions } from "ioredis";
import { config } from "./config.js";

function options(): RedisOptions {
  const url = new URL(config.valkeyUrl);
  const db = Number(url.pathname.replace("/", "") || "0");
  return {
    host: url.hostname,
    port: Number(url.port || "6379"),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number.isInteger(db) ? db : 0,
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    connectTimeout: 2000,
    commandTimeout: 2000,
    retryStrategy: () => 1000,
  };
}

/** Commands connection; rejects at once while Valkey is down. */
export const valkey = new Redis(options());
/** Pub/sub connection. */
export const subscriber = new Redis({ ...options(), enableOfflineQueue: true });

for (const client of [valkey, subscriber]) {
  client.on("error", () => undefined);
  client.connect().catch(() => undefined);
}

export function valkeyUp(): boolean {
  return valkey.status === "ready";
}

export const keys = {
  seq: (formId: string) => `nf:form:${formId}:seq`,
  formChannel: (formId: string) => `nf:form:${formId}`,
  summaryChannel: (formId: string) => `nf:summary:${formId}`,
  presence: (formId: string) => `nf:presence:${formId}`,
  submitLimit: (ip: string, minute: string) => `nf:rl:submit:${ip}:${minute}`,
  resumeLimit: (ip: string, hour: string) => `nf:rl:resume:${ip}:${hour}`,
};

/** Publishes when Valkey is up; live fan-out simply pauses while it is down. */
export async function publish(channel: string, message: unknown): Promise<void> {
  if (!valkeyUp()) return;
  await valkey.publish(channel, JSON.stringify(message)).catch(() => undefined);
}

/** Counts one use against a limit; returns false when over it. Limits pause while Valkey is down. */
export async function withinLimit(key: string, limit: number, ttlSeconds: number): Promise<boolean> {
  if (!valkeyUp()) return true;
  try {
    const results = await valkey.multi().incr(key).expire(key, ttlSeconds).exec();
    const count = Number(results?.[0]?.[1] ?? 0);
    return count <= limit;
  } catch {
    return true;
  }
}
