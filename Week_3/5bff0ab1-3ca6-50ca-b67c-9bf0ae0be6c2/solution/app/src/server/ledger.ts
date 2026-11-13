import { Redis } from "ioredis";
import { config } from "./config.js";
import { CLAIM_UNIT } from "./rules.js";

/** The hold ledger: Valkey, reached only through the published keys and channels under the configured prefix. */
export class LedgerDown extends Error {}
export class LedgerDamaged extends Error {}

const p = config.valkeyPrefix;
export const keys = {
  onhand: (hub: string, model: string, finish: string): string => `${p}:onhand:${hub}:${model}:${finish}`,
  holds: (hub: string, model: string, finish: string): string => `${p}:holds:${hub}:${model}:${finish}`,
  slot: (hub: string, minute: string): string => `${p}:slot:${hub}:${minute}`,
  places: (hub: string, date: string): string => `${p}:places:${hub}:${date}`,
  heartbeat: `${p}:heartbeat`,
  liveChannel: `${p}:live`,
  riderChannel: `${p}:rider`,
  all: `${p}:*`,
};

const options = {
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 0,
  commandTimeout: 3000,
  connectTimeout: 3000,
  retryStrategy: (times: number): number => Math.min(times * 200, 1000),
};

const client = new Redis(config.valkeyUrl, options);
client.on("error", () => undefined);
client.connect().catch(() => undefined);

const subscriber = new Redis(config.valkeyUrl, { ...options, commandTimeout: undefined });
subscriber.on("error", () => undefined);

/** Hints from the other copies: only a nudge to re-read Postgres, never data. */
export function listen(onHint: () => void): void {
  subscriber.on("message", () => onHint());
  subscriber.on("ready", () => void subscriber.subscribe(keys.liveChannel, keys.riderChannel).catch(() => undefined));
  subscriber.connect().catch(() => undefined);
}

async function run<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof LedgerDamaged || error instanceof LedgerDown) throw error;
    const message = error instanceof Error ? error.message : "";
    if (/WRONGTYPE|not an integer|damaged/i.test(message)) throw new LedgerDamaged(message);
    throw new LedgerDown(message);
  }
}

const eval1 = (script: string, keyList: string[], args: (string | number)[]): Promise<unknown> =>
  client.eval(script, keyList.length, ...keyList, ...args.map(String));

const WITHDRAW = `
redis.call('ZREM', KEYS[2], ARGV[1])
if redis.call('EXISTS', KEYS[1]) == 1 then redis.call('DECR', KEYS[1]) end
if ARGV[2] ~= '' then redis.call('SREM', KEYS[3], ARGV[1]) end
if ARGV[3] ~= '' then
  redis.call('SADD', KEYS[3], ARGV[3])
  redis.call('ZADD', KEYS[4], '+inf', ARGV[3])
end
return 'ok'`;

const CLAIM_PLACE = `
if redis.call('EXISTS', KEYS[1]) == 0 and ARGV[3] ~= '1' then return 'missing' end
if redis.call('SCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 'full' end
redis.call('SADD', KEYS[1], ARGV[1])
redis.call('ZADD', KEYS[2], '+inf', ARGV[1])
return 'ok'`;

const DROP_SLOT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1]) end
return 'ok'`;

type Gate = "ok" | "none" | "missing";
type PlaceGate = "ok" | "full" | "missing";

export const ledger = {
  /** The atomic gate on a unit: refuses once the holds fill the on-hand count. */
  claimUnit: (hub: string, model: string, finish: string, ref: string, score: number, skipMissing: boolean): Promise<Gate> =>
    run(async () => {
      const answer = await eval1(CLAIM_UNIT, [keys.onhand(hub, model, finish), keys.holds(hub, model, finish)], [ref, score, skipMissing ? 1 : 0]);
      if (answer === "damaged") throw new LedgerDamaged("on-hand value");
      return answer as Gate;
    }),

  /** A unit left the floor (refused, withdrawn or delivered): removes the hold, lowers on-hand and frees a delivery place to the earliest waiter. */
  freeUnit: (hub: string, model: string, finish: string, ref: string, place?: { date: string; waiter?: { ref: string; model: string; finish: string } }): Promise<void> =>
    run(async () => {
      const waiter = place?.waiter;
      await eval1(
        WITHDRAW,
        [keys.onhand(hub, model, finish), keys.holds(hub, model, finish), place ? keys.places(hub, place.date) : "", waiter ? keys.holds(hub, waiter.model, waiter.finish) : ""],
        [ref, place ? "1" : "", waiter?.ref ?? ""],
      );
    }),

  /** A real write on a hold that exists, to prove the ledger accepts writes. */
  touchHold: (hub: string, model: string, finish: string, ref: string, score: number): Promise<void> =>
    run(async () => {
      await client.zadd(keys.holds(hub, model, finish), "XX", score, ref);
    }),

  claimPlace: (hub: string, date: string, model: string, finish: string, ref: string, capacity: number, skipMissing: boolean): Promise<PlaceGate> =>
    run(async () => (await eval1(CLAIM_PLACE, [keys.places(hub, date), keys.holds(hub, model, finish)], [ref, capacity, skipMissing ? 1 : 0])) as PlaceGate),

  claimSlot: (hub: string, minute: string, rideId: string): Promise<boolean> =>
    run(async () => (await client.set(keys.slot(hub, minute), rideId, "NX")) === "OK"),

  dropSlot: (hub: string, minute: string, rideId: string): Promise<void> =>
    run(async () => {
      await eval1(DROP_SLOT, [keys.slot(hub, minute)], [rideId]);
    }),

  setSlot: (hub: string, minute: string, rideId: string): Promise<void> =>
    run(async () => {
      await client.set(keys.slot(hub, minute), rideId);
    }),

  setOnHand: (entries: { hub: string; model: string; finish: string; onHand: number }[]): Promise<void> =>
    run(async () => {
      const pipeline = client.multi();
      for (const e of entries) pipeline.set(keys.onhand(e.hub, e.model, e.finish), String(e.onHand));
      await pipeline.exec();
    }),

  /** Rebuilds a unit's keys from what Postgres holds. */
  rebuildUnit: (hub: string, model: string, finish: string, onHand: number, holds: { ref: string; score: number | null }[]): Promise<void> =>
    run(async () => {
      const pipeline = client.multi();
      pipeline.set(keys.onhand(hub, model, finish), String(onHand));
      const key = keys.holds(hub, model, finish);
      pipeline.del(key);
      for (const h of holds) pipeline.zadd(key, h.score === null ? "+inf" : h.score, h.ref);
      await pipeline.exec();
    }),

  rebuildPlaces: (hub: string, date: string, members: string[]): Promise<void> =>
    run(async () => {
      if (members.length > 0) await client.sadd(keys.places(hub, date), ...members);
    }),

  /** Removes holds that the app clock has ended. */
  trimHolds: (hub: string, model: string, finish: string, nowMs: number): Promise<void> =>
    run(async () => {
      await client.zremrangebyscore(keys.holds(hub, model, finish), "-inf", nowMs);
    }),

  removeHold: (hub: string, model: string, finish: string, ref: string): Promise<void> =>
    run(async () => {
      await client.zrem(keys.holds(hub, model, finish), ref);
    }),

  heartbeat: (appNowMs: number): Promise<void> =>
    run(async () => {
      await client.set(keys.heartbeat, String(appNowMs));
    }),

  /** Every key under the prefix with its type, for the sweep. */
  keyTypes: (): Promise<{ key: string; type: string }[]> =>
    run(async () => {
      const found: string[] = [];
      let cursor = "0";
      do {
        const [next, batch] = await client.scan(cursor, "MATCH", keys.all, "COUNT", 500);
        cursor = next;
        found.push(...batch);
      } while (cursor !== "0");
      const pipeline = client.pipeline();
      for (const key of found) pipeline.type(key);
      const types = (await pipeline.exec()) ?? [];
      return found.map((key, i) => ({ key, type: String(types[i]?.[1] ?? "none") }));
    }),

  string: (key: string): Promise<string | null> => run(() => client.get(key)),
  members: (key: string): Promise<string[]> => run(() => client.smembers(key)),
  holdMembers: (key: string): Promise<string[]> => run(() => client.zrange(key, 0, -1)),
  add: (key: string, kind: "set" | "zset", member: string, score?: number | null): Promise<void> =>
    run(async () => {
      if (kind === "set") await client.sadd(key, member);
      else await client.zadd(key, score === null || score === undefined ? "+inf" : score, member);
    }),
  remove: (key: string, kind: "set" | "zset", member: string): Promise<void> =>
    run(async () => {
      if (kind === "set") await client.srem(key, member);
      else await client.zrem(key, member);
    }),
  del: (key: string): Promise<void> =>
    run(async () => {
      await client.del(key);
    }),
  setString: (key: string, value: string): Promise<void> =>
    run(async () => {
      await client.set(key, value);
    }),

  publishLive: (hub: string, seq: number): void => {
    client.publish(keys.liveChannel, JSON.stringify({ hub, seq })).catch(() => undefined);
  },
  publishRider: (rider: string): void => {
    client.publish(keys.riderChannel, JSON.stringify({ rider })).catch(() => undefined);
  },
};
