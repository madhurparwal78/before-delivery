// Valkey: claims on covered slots, the replayable event stream and its change notifications.
import { Redis } from "ioredis";
import { config } from "./config.js";
import { recordHolds } from "./dependencies.js";
import { apiErrors } from "./errors.js";

const TIMEOUT_MS = 2_000;
// A dropped connection gets this long to come back before a command answers 503, keeping the
// whole refusal inside the three seconds the brief allows; commands are never queued to run later.
const RECONNECT_GRACE_MS = 1_500;
const options = {
  enableOfflineQueue: false,
  enableReadyCheck: false,
  maxRetriesPerRequest: 1,
  connectTimeout: TIMEOUT_MS,
  retryStrategy: (attempt: number) => Math.min(attempt * 100, 500),
};

const commands = new Redis(config.valkeyUrl, { ...options, commandTimeout: TIMEOUT_MS });
export const subscriber = new Redis(config.valkeyUrl, { ...options, enableOfflineQueue: true, maxRetriesPerRequest: null });
commands.on("error", () => undefined);
subscriber.on("error", () => undefined);

export function key(name: string): string {
  return `${config.keyPrefix}${name}`;
}

/** Resolves once the command connection is ready, or after the reconnect grace. */
function connected(): Promise<void> {
  if (commands.status === "ready") return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      commands.off("ready", done);
      resolve();
    };
    const timer = setTimeout(done, RECONNECT_GRACE_MS);
    commands.once("ready", done);
  });
}

/** Runs a Valkey command; any failure pauses holds and answers 503 holds_paused. */
async function guarded<Result>(command: () => Promise<Result>): Promise<Result> {
  try {
    await connected();
    return await command();
  } catch {
    recordHolds(false);
    throw apiErrors.holdsPaused();
  }
}

const CLAIM_ALL = `
for _, name in ipairs(KEYS) do
  if redis.call('EXISTS', name) == 1 then return 0 end
end
for _, name in ipairs(KEYS) do
  redis.call('SET', name, ARGV[1], 'PX', ARGV[2])
end
return 1`;

const RELEASE_OWNED = `
local removed = 0
for _, name in ipairs(KEYS) do
  if redis.call('GET', name) == ARGV[1] then removed = removed + redis.call('DEL', name) end
end
return removed`;

/** Sets every key for the owner, or none of them when any already exists. */
export async function claimAll(names: string[], owner: string, ttlMs: number): Promise<boolean> {
  return (await guarded(() => commands.eval(CLAIM_ALL, names.length, ...names, owner, ttlMs))) === 1;
}

/** Removes the keys the owner holds. */
export async function releaseOwned(names: string[], owner: string): Promise<void> {
  await guarded(() => commands.eval(RELEASE_OWNED, names.length, ...names, owner));
}

export async function ping(): Promise<void> {
  await commands.ping();
}

/** Throws 503 holds_paused unless Valkey answers right now. */
export async function requireAnswering(): Promise<void> {
  await guarded(ping);
}

interface StreamEntry {
  id: string;
  data: string;
}

const RETENTION_MS = 10 * 60_000;

export function eventStreamKey(date: string): string {
  return key(`events:${date}`);
}

/** Appends to the date's stream, keeps ten minutes, and wakes every instance's reader. */
export async function appendEvent(date: string, data: string): Promise<void> {
  const stream = eventStreamKey(date);
  const id = await commands.xadd(stream, "MINID", "=", String(Date.now() - RETENTION_MS), "*", "data", data);
  if (id !== null) await commands.publish(stream, id);
}

export async function entriesAfter(date: string, afterId: string | null): Promise<StreamEntry[]> {
  const found = await commands.xrange(eventStreamKey(date), afterId === null ? "-" : `(${afterId}`, "+");
  return found.map(([id, fields]) => ({ id, data: fields[1] ?? "" }));
}

export async function lastEntryId(date: string): Promise<string | null> {
  const [latest] = await commands.xrevrange(eventStreamKey(date), "+", "-", "COUNT", 1);
  return latest?.[0] ?? null;
}
