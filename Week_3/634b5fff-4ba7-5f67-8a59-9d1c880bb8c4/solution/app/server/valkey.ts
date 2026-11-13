import { Redis } from "ioredis";
import { config, named } from "./config.js";

/** Valkey: holds and lookup counters. `isUp` follows the connection so sales pause while it is away. */

const client = new Redis(config.valkeyUrl || "redis://127.0.0.1:9/0", {
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 0,
  connectTimeout: 2000,
  retryStrategy: () => 500,
});
client.on("error", () => undefined);

let up = false;
client.on("ready", () => { up = true; });
client.on("close", () => { up = false; });
client.on("end", () => { up = false; });

export class ValkeyUnreachable extends Error {
  constructor() {
    super("valkey unreachable");
  }
}

export const isUp = (): boolean => up;

export const connectValkey = (): void => {
  void client.connect().catch(() => undefined);
};

const guarded = async <T>(work: () => Promise<T>): Promise<T> => {
  if (!up) throw new ValkeyUnreachable();
  try {
    return await work();
  } catch {
    throw new ValkeyUnreachable();
  }
};

const holdKey = (number: number): string => named(`hold:${number}`);

/** Takes the hold with set-if-absent and a TTL; true for exactly one caller. */
export const grantHold = (number: number, token: string, holdMs: number): Promise<boolean> =>
  guarded(async () => (await client.set(holdKey(number), token, "PX", holdMs, "NX")) === "OK");

interface HoldState {
  owner: string | null;
  remainingMs: number;
}

/** The hold's token and its time left, read together so they always agree. */
export const holdState = (number: number): Promise<HoldState> =>
  guarded(async () => {
    const answers = await client.pipeline().get(holdKey(number)).pttl(holdKey(number)).exec();
    const owner = answers?.[0]?.[1];
    const remainingMs = answers?.[1]?.[1];
    return { owner: typeof owner === "string" ? owner : null, remainingMs: typeof remainingMs === "number" && remainingMs > 0 ? remainingMs : 0 };
  });

/** Deletes the hold only when the token still owns it. */
export const releaseHold = (number: number, token: string): Promise<boolean> =>
  guarded(async () => {
    const deleted = await client.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1, holdKey(number), token,
    );
    return deleted === 1;
  });

export const heldNumbers = (count: number): Promise<Set<number>> =>
  guarded(async () => {
    const keys = Array.from({ length: count }, (_, index) => holdKey(index + 1));
    const owners = await client.mget(...keys);
    const held = new Set<number>();
    owners.forEach((owner, index) => { if (owner !== null) held.add(index + 1); });
    return held;
  });

const lookupKey = (clientId: string): string => named(`lookup:${clientId}`);

/** Claims a lookup try in a fixed window, atomically; returns the count and the seconds left in the window. */
export const claimLookupTry = (clientId: string, windowSeconds: number): Promise<{ count: number; ttl: number }> =>
  guarded(async () => {
    const key = lookupKey(clientId);
    const count = await client.incr(key);
    if (count === 1) await client.expire(key, windowSeconds);
    const ttl = await client.ttl(key);
    return { count, ttl: ttl > 0 ? ttl : windowSeconds };
  });

/** Gives back a claimed try: a successful lookup does not count. */
export const returnLookupTry = (clientId: string): Promise<void> =>
  guarded(async () => {
    await client.decr(lookupKey(clientId));
  });
