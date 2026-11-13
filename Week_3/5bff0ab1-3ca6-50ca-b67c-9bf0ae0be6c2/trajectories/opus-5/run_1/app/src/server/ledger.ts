import Redis from 'ioredis';
import type { FinishId, HubId, ModelId } from '../shared/catalogue.js';

const PREFIX = process.env.VALKEY_PREFIX ?? 'malhar';
const URL = process.env.VALKEY_URL ?? 'redis://valkey:6379/0';
const TIMEOUT_MS = 3_000;

function client(): Redis {
  return new Redis(URL, {
    commandTimeout: TIMEOUT_MS,
    connectTimeout: TIMEOUT_MS,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    enableReadyCheck: true,
    retryStrategy: (attempt) => Math.min(1_000 * attempt, 5_000),
    reconnectOnError: () => true,
  });
}

const commands = client();
let subscriber: Redis | null = null;

commands.on('error', () => {
  /* health is decided by command outcomes, not by connection events */
});

export class LedgerDown extends Error {
  constructor() {
    super('hold ledger unreachable');
    this.name = 'LedgerDown';
  }
}

export class DamagedKey extends Error {
  readonly hub: HubId;
  constructor(hub: HubId) {
    super('hold ledger key damaged');
    this.name = 'DamagedKey';
    this.hub = hub;
  }
}

function isDamage(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('WRONGTYPE') ||
    message.includes('not a valid float') ||
    message.includes('not an integer') ||
    message.includes('DAMAGED')
  );
}

async function run<T>(hub: HubId | null, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (hub && isDamage(error)) throw new DamagedKey(hub);
    throw new LedgerDown();
  }
}

export const keys = {
  onHand: (hub: HubId, model: ModelId, finish: FinishId) =>
    `${PREFIX}:onhand:${hub}:${model}:${finish}`,
  holds: (hub: HubId, model: ModelId, finish: FinishId) =>
    `${PREFIX}:holds:${hub}:${model}:${finish}`,
  slot: (hub: HubId, slot: string) => `${PREFIX}:slot:${hub}:${slot}`,
  places: (hub: HubId, date: string) => `${PREFIX}:places:${hub}:${date}`,
  heartbeat: () => `${PREFIX}:heartbeat`,
  prefix: () => PREFIX,
};

export const channels = {
  live: () => `${PREFIX}:live`,
  rider: () => `${PREFIX}:rider`,
};

const CLAIM_HOLD = `
local onhand = redis.call('GET', KEYS[1])
if not onhand then return -3 end
local count = tonumber(onhand)
if count == nil then return redis.error_reply('DAMAGED onhand') end
local held = redis.call('ZCARD', KEYS[2])
if count - held <= 0 then return -1 end
redis.call('ZADD', KEYS[2], ARGV[2], ARGV[1])
return count - held - 1
`;

const CLAIM_PLACE = `
local taken = redis.call('SCARD', KEYS[1])
local capacity = tonumber(ARGV[2])
if taken >= capacity then return -1 end
redis.call('SADD', KEYS[1], ARGV[1])
return capacity - taken - 1
`;

const SWAP_PLACE = `
redis.call('SREM', KEYS[1], ARGV[1])
if ARGV[2] ~= '' then redis.call('SADD', KEYS[1], ARGV[2]) end
return 1
`;

const RELEASE_SLOT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1]) end
return 1
`;

export interface HoldClaim {
  outcome: 'held' | 'none_left' | 'missing';
  unitsLeftAfter: number;
}

export async function claimHold(
  hub: HubId,
  model: ModelId,
  finish: FinishId,
  ref: string,
  score: number | 'inf',
): Promise<HoldClaim> {
  const result = await run(hub, () =>
    commands.eval(
      CLAIM_HOLD,
      2,
      keys.onHand(hub, model, finish),
      keys.holds(hub, model, finish),
      ref,
      score === 'inf' ? '+inf' : String(score),
    ),
  );
  const value = Number(result);
  if (value === -3) return { outcome: 'missing', unitsLeftAfter: 0 };
  if (value === -1) return { outcome: 'none_left', unitsLeftAfter: 0 };
  return { outcome: 'held', unitsLeftAfter: value };
}

export async function removeHold(
  hub: HubId,
  model: ModelId,
  finish: FinishId,
  ref: string,
): Promise<void> {
  await run(hub, () => commands.zrem(keys.holds(hub, model, finish), ref));
}

export async function setHoldScore(
  hub: HubId,
  model: ModelId,
  finish: FinishId,
  ref: string,
  score: number | 'inf',
): Promise<void> {
  await run(hub, () =>
    commands.zadd(keys.holds(hub, model, finish), score === 'inf' ? '+inf' : String(score), ref),
  );
}

export async function trimHolds(
  hub: HubId,
  model: ModelId,
  finish: FinishId,
  refs: readonly string[],
): Promise<void> {
  if (refs.length === 0) return;
  await run(hub, () => commands.zrem(keys.holds(hub, model, finish), ...refs));
}

export async function readOnHand(
  hub: HubId,
  model: ModelId,
  finish: FinishId,
): Promise<number | null> {
  const value = await run(hub, () => commands.get(keys.onHand(hub, model, finish)));
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new DamagedKey(hub);
  return parsed;
}

export async function writeOnHand(
  hub: HubId,
  model: ModelId,
  finish: FinishId,
  onHand: number,
): Promise<void> {
  await run(hub, () => commands.set(keys.onHand(hub, model, finish), String(onHand)));
}

export async function claimSlot(hub: HubId, slot: string, rideId: string): Promise<boolean> {
  const result = await run(hub, () => commands.set(keys.slot(hub, slot), rideId, 'NX'));
  return result === 'OK';
}

export async function releaseSlot(hub: HubId, slot: string, rideId: string): Promise<void> {
  await run(hub, () => commands.eval(RELEASE_SLOT, 1, keys.slot(hub, slot), rideId));
}

export async function writeSlot(hub: HubId, slot: string, rideId: string): Promise<void> {
  await run(hub, () => commands.set(keys.slot(hub, slot), rideId));
}

export async function claimPlace(
  hub: HubId,
  date: string,
  ref: string,
  capacity: number,
): Promise<{ outcome: 'held' | 'full'; placesLeftAfter: number }> {
  const result = await run(hub, () =>
    commands.eval(CLAIM_PLACE, 1, keys.places(hub, date), ref, String(capacity)),
  );
  const value = Number(result);
  if (value === -1) return { outcome: 'full', placesLeftAfter: 0 };
  return { outcome: 'held', placesLeftAfter: value };
}

/** One step, so a freed place is never open: the leaver goes and the waiter arrives together. */
export async function swapPlace(
  hub: HubId,
  date: string,
  leavingRef: string,
  arrivingRef: string | null,
): Promise<void> {
  await run(hub, () =>
    commands.eval(SWAP_PLACE, 1, keys.places(hub, date), leavingRef, arrivingRef ?? ''),
  );
}

export async function removePlace(hub: HubId, date: string, ref: string): Promise<void> {
  await run(hub, () => commands.srem(keys.places(hub, date), ref));
}

export async function readPlaces(hub: HubId, date: string): Promise<string[]> {
  return run(hub, () => commands.smembers(keys.places(hub, date)));
}

export async function writePlaces(
  hub: HubId,
  date: string,
  refs: readonly string[],
): Promise<void> {
  await run(hub, async () => {
    await commands.del(keys.places(hub, date));
    if (refs.length > 0) await commands.sadd(keys.places(hub, date), ...refs);
  });
}

export async function writeHolds(
  hub: HubId,
  model: ModelId,
  finish: FinishId,
  holds: readonly { ref: string; score: number | 'inf' }[],
): Promise<void> {
  await run(hub, async () => {
    const key = keys.holds(hub, model, finish);
    await commands.del(key);
    for (const hold of holds) {
      await commands.zadd(key, hold.score === 'inf' ? '+inf' : String(hold.score), hold.ref);
    }
  });
}

export async function heartbeat(at: string): Promise<void> {
  await run(null, () => commands.set(keys.heartbeat(), at));
}

export async function scanPrefix(): Promise<string[]> {
  return run(null, async () => {
    const found: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await commands.scan(cursor, 'MATCH', `${PREFIX}:*`, 'COUNT', 500);
      cursor = next;
      found.push(...batch);
    } while (cursor !== '0');
    return found;
  });
}

export async function keyType(key: string): Promise<string> {
  return run(null, () => commands.type(key));
}

export async function deleteKey(key: string): Promise<void> {
  await run(null, () => commands.del(key));
}

export async function setMembers(key: string): Promise<string[]> {
  return run(null, () => commands.smembers(key));
}

export async function stringValue(key: string): Promise<string | null> {
  return run(null, () => commands.get(key));
}

export async function zsetMembers(key: string): Promise<string[]> {
  return run(null, () => commands.zrange(key, '0', '-1'));
}

export async function publishHint(channel: string, payload: unknown): Promise<void> {
  try {
    await commands.publish(channel, JSON.stringify(payload));
  } catch {
    /* fan-out is only a hint; streams re-read Postgres on their own */
  }
}

export function subscribeHints(onHint: (channel: string) => void): void {
  if (subscriber) return;
  subscriber = client();
  subscriber.on('error', () => {
    /* the subscriber re-subscribes on reconnect below */
  });
  subscriber.on('ready', () => {
    void subscriber?.subscribe(channels.live(), channels.rider());
  });
  subscriber.on('message', (channel) => onHint(channel));
  void subscriber.subscribe(channels.live(), channels.rider()).catch(() => undefined);
}
