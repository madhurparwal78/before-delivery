import { Redis } from "ioredis";
import { config } from "./config.js";
import { LIVE_DOWN_TEXT } from "../shared/protocol.js";
import { Refusal } from "./http.js";


class LiveUnavailable extends Refusal {
  constructor() {
    super(503, LIVE_DOWN_TEXT);
  }
}

function connect(): Redis {
  const client = new Redis(config.valkeyUrl, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    connectTimeout: 1500,
    retryStrategy: () => 1000,
    reconnectOnError: () => false,
  });
  client.on("error", () => undefined);
  return client;
}

const commands = connect();
const subscriber = connect();

let flaggedDown = false;
const recoveryListeners: (() => void)[] = [];
const outageListeners: (() => void)[] = [];

export function setValkeyDown(down: boolean): void {
  const recovered = flaggedDown && !down;
  const failed = !flaggedDown && down;
  flaggedDown = down;
  if (recovered) recoveryListeners.forEach((listener) => listener());
  if (failed) outageListeners.forEach((listener) => listener());
}

export const onValkeyRecovered = (listener: () => void): void => {
  recoveryListeners.push(listener);
};

export const onValkeyDown = (listener: () => void): void => {
  outageListeners.push(listener);
};

/** The command connection, or the one refusal every live route answers when Valkey cannot be used. */
export function live(): Redis {
  if (flaggedDown || commands.status !== "ready") throw new LiveUnavailable();
  return commands;
}

export async function run<T>(work: (client: Redis) => Promise<T>): Promise<T> {
  const client = live();
  try {
    return await work(client);
  } catch (error) {
    if (error instanceof Refusal) throw error;
    throw new LiveUnavailable();
  }
}

export async function valkeyReachable(): Promise<boolean> {
  if (commands.status !== "ready") return false;
  try {
    return (await commands.ping()) === "PONG";
  } catch {
    return false;
  }
}

export const valkeyFlaggedDown = (): boolean => flaggedDown;

// ---------------------------------------------------------------------------------------------
// Atomic claims. Positions, tile occupancy and members of one session live in three keys.

export const positionsKey = (sessionId: string): string => `session:${sessionId}:positions`;
export const tilesKey = (sessionId: string): string => `session:${sessionId}:tiles`;
export const membersKey = (sessionId: string): string => `session:${sessionId}:members`;
const eventsChannel = (sessionId: string): string => `session:${sessionId}:events`;
export const presenceKey = (personId: string): string => `presence:${personId}`;
export const socketsKey = (personId: string): string => `sockets:${personId}`;
const PEOPLE_CHANNEL = "people:events";

/** Takes a tile for a person: refused when someone else holds it. Frees the tile the person leaves. */
const MOVE = `
local holder = redis.call('HGET', KEYS[2], ARGV[3])
if holder and holder ~= ARGV[1] then return 0 end
if redis.call('HGET', KEYS[2], ARGV[2]) == ARGV[1] then redis.call('HDEL', KEYS[2], ARGV[2]) end
redis.call('HSET', KEYS[2], ARGV[3], ARGV[1])
redis.call('HSET', KEYS[1], ARGV[1], ARGV[4])
return 1`;

/** Takes the last places: one more person only while the session has room. */
const TAKE_PLACE = `
if redis.call('SISMEMBER', KEYS[1], ARGV[1]) == 1 then return 2 end
if redis.call('SCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
redis.call('SADD', KEYS[1], ARGV[1])
return 1`;

/** Gives up a person's tile, position and place. */
const RELEASE = `
local record = redis.call('HGET', KEYS[1], ARGV[1])
if record then
  local x, y = string.match(record, '"x":(%-?%d+),"y":(%-?%d+)')
  if x and redis.call('HGET', KEYS[2], x .. ',' .. y) == ARGV[1] then redis.call('HDEL', KEYS[2], x .. ',' .. y) end
end
redis.call('HDEL', KEYS[1], ARGV[1])
redis.call('SREM', KEYS[3], ARGV[1])
return 1`;

export async function moveTile(sessionId: string, personId: string, from: string, to: string, record: string): Promise<boolean> {
  const result = await run((client) => client.eval(MOVE, 2, positionsKey(sessionId), tilesKey(sessionId), personId, from, to, record));
  return result === 1;
}

export async function takePlace(sessionId: string, personId: string, capacity: number): Promise<"taken" | "already" | "full"> {
  const result = await run((client) => client.eval(TAKE_PLACE, 1, membersKey(sessionId), personId, String(capacity)));
  return result === 1 ? "taken" : result === 2 ? "already" : "full";
}

export async function releasePerson(sessionId: string, personId: string): Promise<void> {
  await run((client) => client.eval(RELEASE, 3, positionsKey(sessionId), tilesKey(sessionId), membersKey(sessionId), personId));
}

/** Claims a first free tile for a person with no tile yet, returning whether it was free. */
export const claimSpawn = (sessionId: string, personId: string, tile: string, record: string): Promise<boolean> =>
  moveTile(sessionId, personId, "", tile, record);

export async function dropSession(sessionId: string): Promise<void> {
  await run((client) => client.del(positionsKey(sessionId), tilesKey(sessionId), membersKey(sessionId)));
}

// ---------------------------------------------------------------------------------------------
// Publish and subscribe: events cross instances on the published channel.

export interface SessionEvent {
  kind: string;
  [key: string]: unknown;
}

export async function publishSession(sessionId: string, event: SessionEvent): Promise<void> {
  await run((client) => client.publish(eventsChannel(sessionId), JSON.stringify(event)));
}

export async function publishPerson(personId: string, frame: unknown): Promise<void> {
  await run((client) => client.publish(PEOPLE_CHANNEL, JSON.stringify({ personId, frame })));
}

type SessionListener = (sessionId: string, event: SessionEvent) => void;
type PersonListener = (personId: string, frame: unknown) => void;
const sessionListeners: SessionListener[] = [];
const personListeners: PersonListener[] = [];

export const onSessionEvent = (listener: SessionListener): void => {
  sessionListeners.push(listener);
};
export const onPersonEvent = (listener: PersonListener): void => {
  personListeners.push(listener);
};

subscriber.on("ready", () => {
  subscriber.psubscribe("session:*:events", PEOPLE_CHANNEL).catch(() => undefined);
});

subscriber.on("pmessage", (_pattern, channel, message) => {
  if (flaggedDown) return;
  const parsed: unknown = JSON.parse(message);
  if (channel === PEOPLE_CHANNEL) {
    const { personId, frame } = parsed as { personId: string; frame: unknown };
    personListeners.forEach((listener) => listener(personId, frame));
    return;
  }
  const sessionId = channel.split(":")[1] ?? "";
  sessionListeners.forEach((listener) => listener(sessionId, parsed as SessionEvent));
});
