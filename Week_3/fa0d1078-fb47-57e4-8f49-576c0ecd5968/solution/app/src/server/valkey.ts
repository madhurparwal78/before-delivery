import { Redis } from "ioredis";
import type { ServerMessage } from "../shared/protocol";
import { config } from "./config";
import { ApiError } from "./errors";

const CHANNEL = "seam:live";
const RETRY_MS = 3000;

function connect(): Redis {
  const client = new Redis(config.valkeyUrl, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    connectTimeout: 2000,
    retryStrategy: () => RETRY_MS,
  });
  client.on("error", () => undefined);
  return client;
}

export const valkey = connect();
const subscriber = connect();

/** Who a live message is for: both seats of a room, or every page watching one date's leaderboard. */
export type Audience = { players: string[] } | { leaderboard: string };

interface Envelope {
  audience: Audience;
  message: ServerMessage;
}

export function valkeyReady(): boolean {
  return valkey.status === "ready";
}

/** Runs a Valkey call and reports an unreachable Valkey as 503 LIVE_UNAVAILABLE. */
export async function live<Result>(call: () => Promise<Result>): Promise<Result> {
  if (!valkeyReady()) throw new ApiError("LIVE_UNAVAILABLE");
  try {
    return await call();
  } catch (error) {
    if (/connection|stream|ECONN|ETIMEDOUT|EPIPE|timed out/i.test(String(error))) throw new ApiError("LIVE_UNAVAILABLE");
    throw error;
  }
}

export async function publish(audience: Audience, message: ServerMessage): Promise<void> {
  const envelope: Envelope = { audience, message };
  await live(() => valkey.publish(CHANNEL, JSON.stringify(envelope)));
}

/** Calls `handler` for every live message published by any server process, this one included. */
export function onLive(handler: (audience: Audience, message: ServerMessage) => void): void {
  subscriber.on("ready", () => {
    void subscriber.subscribe(CHANNEL).catch(() => undefined);
  });
  subscriber.on("message", (_channel: string, payload: string) => {
    const envelope = JSON.parse(payload) as Envelope;
    handler(envelope.audience, envelope.message);
  });
}

export function onValkeyLost(handler: () => void): void {
  valkey.on("close", handler);
}

export async function valkeyReachable(): Promise<boolean> {
  try {
    return valkeyReady() && (await valkey.ping()) === "PONG";
  } catch {
    return false;
  }
}
