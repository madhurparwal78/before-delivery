import { Redis } from "ioredis";
import { z } from "zod";
import { roomEventSchema, type StoredEvent } from "../../shared/schemas.js";
import { config } from "../config.js";
import { apiError } from "../errors.js";
import { parseJson } from "../json.js";

const REPLAY_BUFFER = 500;
const ROOM_KEY_TTL_SECONDS = 3600;
const PING_EVERY_MS = 2000;
const PING_TIMEOUT_MS = 1500;

const key = (roomId: string, name: string): string => `lastbell:room:${roomId}:${name}`;
const channelOf = (roomId: string): string => key(roomId, "events");

const storedEventSchema = z.intersection(roomEventSchema, z.object({ id: z.number().int() }));
const channelMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("event"), event: storedEventSchema }),
  z.object({ kind: z.literal("superseded"), clientId: z.string() }),
]);
export type ChannelMessage = z.infer<typeof channelMessageSchema>;
type Handler = (message: ChannelMessage) => void;

const options = {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 0,
  connectTimeout: 2000,
  keepAlive: 5000,
  retryStrategy: (attempt: number): number => Math.min(attempt * 400, 2000),
  autoResubscribe: false,
  lazyConnect: true,
};
const commands = new Redis(config.valkeyUrl, options);
const subscriber = new Redis(config.valkeyUrl, options);
for (const client of [commands, subscriber]) client.on("error", () => undefined);

let up = false;
let hooks: { onDown: () => void; onRecovered: () => void } | null = null;

export const liveUnavailable = () => apiError(503, "live_unavailable");
export const isLive = (): boolean => up;

function setUp(next: boolean): void {
  if (next === up) return;
  up = next;
  if (next) {
    hooks?.onRecovered();
  } else {
    subscriptions.clear();
    hooks?.onDown();
  }
}

const bothReady = (): boolean => commands.status === "ready" && subscriber.status === "ready";

async function ping(): Promise<void> {
  if (!up) return;
  try {
    await Promise.race([commands.ping(), new Promise((_, reject) => setTimeout(reject, PING_TIMEOUT_MS))]);
  } catch {
    commands.disconnect(true);
    subscriber.disconnect(true);
    setUp(false);
  }
}

// Connects in the background: the app serves with or without Valkey, and `isLive` follows its reachability.
export function startLive(callbacks: { onDown: () => void; onRecovered: () => void }): void {
  hooks = callbacks;
  for (const client of [commands, subscriber]) {
    client.on("ready", () => setUp(bothReady()));
    client.on("close", () => setUp(false));
    client.connect().catch(() => undefined);
  }
  setInterval(() => void ping(), PING_EVERY_MS).unref();
}

async function attempt<T>(work: (client: Redis) => Promise<T>): Promise<T | undefined> {
  if (!up) return undefined;
  try {
    return await work(commands);
  } catch {
    return undefined;
  }
}

const subscriptions = new Map<string, { handlers: Set<Handler>; ready: Promise<unknown> }>();

subscriber.on("message", (channel: string, raw: string) => {
  const parsed = channelMessageSchema.safeParse(parseJson(raw));
  if (!parsed.success) return;
  for (const handler of subscriptions.get(channel)?.handlers ?? []) handler(parsed.data);
});

// One handler per open stream; the channel is subscribed with its first stream and released with its last.
export async function subscribeRoom(roomId: string, handler: Handler): Promise<() => void> {
  if (!up) throw liveUnavailable();
  const channel = channelOf(roomId);
  let entry = subscriptions.get(channel);
  if (!entry) {
    entry = { handlers: new Set(), ready: subscriber.subscribe(channel) };
    subscriptions.set(channel, entry);
  }
  entry.handlers.add(handler);
  try {
    await entry.ready;
  } catch {
    entry.handlers.delete(handler);
    throw liveUnavailable();
  }
  return () => {
    entry.handlers.delete(handler);
    if (entry.handlers.size === 0 && subscriptions.get(channel) === entry) {
      subscriptions.delete(channel);
      subscriber.unsubscribe(channel).catch(() => undefined);
    }
  };
}

export async function publishEvents(roomId: string, events: StoredEvent[]): Promise<void> {
  await attempt(async (client) => {
    const pipeline = client.pipeline();
    for (const event of events) {
      const message: ChannelMessage = { kind: "event", event };
      pipeline.rpush(key(roomId, "replay"), JSON.stringify(event));
      pipeline.publish(channelOf(roomId), JSON.stringify(message));
    }
    pipeline.ltrim(key(roomId, "replay"), -REPLAY_BUFFER, -1);
    await pipeline.exec();
  });
}

export async function publishSuperseded(roomId: string, clientIds: string[]): Promise<void> {
  await attempt(async (client) => {
    for (const clientId of clientIds) {
      const message: ChannelMessage = { kind: "superseded", clientId };
      await client.publish(channelOf(roomId), JSON.stringify(message));
    }
  });
}

// The last events held in Valkey, oldest first; null when Valkey cannot answer.
export async function readReplayBuffer(roomId: string): Promise<StoredEvent[] | null> {
  const raw = await attempt((client) => client.lrange(key(roomId, "replay"), 0, -1));
  if (!raw) return null;
  return raw.flatMap((line) => {
    const parsed = storedEventSchema.safeParse(parseJson(line));
    return parsed.success ? [parsed.data] : [];
  });
}

export async function trackClient(roomId: string, clientId: string, present: boolean): Promise<void> {
  await attempt((client) => (present ? client.sadd(key(roomId, "clients"), clientId) : client.srem(key(roomId, "clients"), clientId)));
}

export async function writeScores(roomId: string, scores: { seatId: string; score: number }[]): Promise<void> {
  if (scores.length === 0) return;
  await attempt((client) => client.zadd(key(roomId, "leaderboard"), ...scores.flatMap(({ seatId, score }) => [score, seatId])));
}

// After an outage: the leaderboard is rebuilt from Postgres standings and the clients set from this process's open streams.
export async function rebuildRoom(roomId: string, scores: { seatId: string; score: number }[], clientIds: string[]): Promise<void> {
  await attempt(async (client) => {
    const transaction = client.multi();
    transaction.del(key(roomId, "leaderboard"), key(roomId, "clients"));
    if (scores.length) transaction.zadd(key(roomId, "leaderboard"), ...scores.flatMap(({ seatId, score }) => [score, seatId]));
    if (clientIds.length) transaction.sadd(key(roomId, "clients"), ...clientIds);
    await transaction.exec();
  });
}

export async function expireRoomKeys(roomId: string): Promise<void> {
  await attempt(async (client) => {
    const pipeline = client.pipeline();
    for (const name of ["leaderboard", "clients", "replay"]) pipeline.expire(key(roomId, name), ROOM_KEY_TTL_SECONDS);
    await pipeline.exec();
  });
}
