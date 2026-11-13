// Valkey is the shared hold ledger and live fan-out. Every key and channel starts
// with the prefix, because channels ignore database numbers. None of these keys has
// a time to live. Losing a server-side script from the ledger's cache never breaks a claim.
import { createClient, type RedisClientType } from "redis";
import { config } from "./config";

export interface LedgerValue<T> {
  ok: boolean;
  value: T | null;
}

let client: RedisClientType | null = null;
let subscriber: RedisClientType | null = null;
let connected = false;

export function prefix(): string {
  return config.valkeyPrefix;
}

export async function ledgerConnect(): Promise<void> {
  if (client) return;
  client = createClient({ url: config.valkeyUrl, socket: { connectTimeout: 2000 } }) as RedisClientType;
  client.on("error", () => {
    connected = false;
  });
  client.on("end", () => {
    connected = false;
  });
  client.on("ready", () => {
    connected = true;
  });
  await client.connect();
  subscriber = client.duplicate();
  await subscriber.connect();
  connected = true;
}

export function isLedgerConnected(): boolean {
  return connected && client !== null && client.isOpen;
}

// A real write tests the ledger; a ping is not enough, because a write refused for
// lack of replicas can still let a ping pass.
export async function ledgerTestWrite(): Promise<boolean> {
  if (!client || !client.isOpen) return false;
  try {
    const p = prefix();
    const res = (await withTimeout(
      client.set(`${p}:heartbeat`, String(Date.now()), { KEEPTTL: false }),
      3000
    )) as string | null;
    return res === "OK";
  } catch {
    return false;
  }
}

export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("ledger-timeout")), ms)),
  ]);
}

export function kOnHand(hub: string, model: string, finish: string): string {
  return `${prefix()}:onhand:${hub}:${model}:${finish}`;
}

export function kHolds(hub: string, model: string, finish: string): string {
  return `${prefix()}:holds:${hub}:${model}:${finish}`;
}

export function kSlot(hub: string, slotKey: string): string {
  // slotKey is `YYYY-MM-DDTHH:mm` in IST
  return `${prefix()}:slot:${hub}:${slotKey}`;
}

export function kPlaces(hub: string, date: string): string {
  return `${prefix()}:places:${hub}:${date}`;
}

// ---------- atomic claim scripts ----------
// The scripts are re-created on demand so a lost script cache never breaks a claim.

// Try to add a hold member if its score would leave onHand units free.
// KEYS[1]=onhand KEYS[2]=holds ARGV[1]=ref ARGV[2]=score
// Returns: 1 claimed, 0 none left.
const CLAIM_HOLD = `
local onhand = redis.call('GET', KEYS[1])
if onhand == false or not tostring(onhand):match('^%-?%d+$') then
  return -1
end
onhand = tonumber(onhand)
local count = redis.call('ZCARD', KEYS[2])
if count < onhand then
  redis.call('ZADD', KEYS[2], ARGV[2], ARGV[1])
  return 1
end
return 0
`;

// Remove a hold member; returns 1 when removed, 0 when absent, -1 on damage.
const RELEASE_HOLD = `
local removed = redis.call('ZREM', KEYS[1], ARGV[1])
return removed
`;

// Claim a ride slot: only one member may hold it.
// KEYS[1]=slot key ARGV[1]=ride id
const CLAIM_SLOT = `
local existing = redis.call('GET', KEYS[1])
if existing then
  return 0
end
redis.call('SET', KEYS[1], ARGV[1])
return 1
`;

// Claim a delivery place: only capacity members may be present.
// KEYS[1]=places ARGV[1]=ref ARGV[2]=capacity
const CLAIM_PLACE = `
local count = redis.call('SCARD', KEYS[1])
local cap = tonumber(ARGV[2])
if redis.call('SISMEMBER', KEYS[1], ARGV[1]) == 1 then
  return 1
end
if count < cap then
  redis.call('SADD', KEYS[1], ARGV[1])
  return 1
end
return 0
`;

// A freed place goes to the earliest waiter with no moment when it is open:
// if placesLeft is zero and waiters exist, atomically add the promoted ref.
// This atomics is done in Postgres for the waiter; the ledger place is added
// within the same Postgres transaction's commit ordering (see services/holds).
const REMOVE_PLACE = `
redis.call('SREM', KEYS[1], ARGV[1])
return 1
`;

async function runScript(source: string, keys: string[], args: (string | number)[]): Promise<number> {
  if (!client || !client.isOpen) throw new Error("ledger-down");
  const result = (await withTimeout(client.eval(source, { keys, arguments: args.map(String) }), 3000)) as number;
  return Number(result);
}

export async function claimHold(
  hub: string,
  model: string,
  finish: string,
  ref: string,
  score: number
): Promise<number> {
  return await runScript(CLAIM_HOLD, [kOnHand(hub, model, finish), kHolds(hub, model, finish)], [ref, score]);
}

export async function releaseHold(hub: string, model: string, finish: string, ref: string): Promise<number> {
  return await runScript(RELEASE_HOLD, [kHolds(hub, model, finish)], [ref]);
}

export async function claimSlot(hub: string, slotKey: string, rideId: string): Promise<number> {
  return await runScript(CLAIM_SLOT, [kSlot(hub, slotKey)], [rideId]);
}

export async function releaseSlot(hub: string, slotKey: string): Promise<number> {
  if (!client || !client.isOpen) throw new Error("ledger-down");
  await withTimeout(client.del(kSlot(hub, slotKey)), 3000);
  return 1;
}

export async function claimPlace(hub: string, date: string, ref: string, capacity: number): Promise<number> {
  return await runScript(CLAIM_PLACE, [kPlaces(hub, date)], [ref, capacity]);
}

export async function removePlace(hub: string, date: string, ref: string): Promise<number> {
  return await runScript(REMOVE_PLACE, [kPlaces(hub, date)], [ref]);
}

// raw reads for the sweep and repair
export async function readOnHand(hub: string, model: string, finish: string): Promise<string | null> {
  if (!client || !client.isOpen) throw new Error("ledger-down");
  const v = await withTimeout(client.get(kOnHand(hub, model, finish)), 1000);
  return v;
}

export async function writeOnHand(hub: string, model: string, finish: string, value: number): Promise<void> {
  if (!client || !client.isOpen) throw new Error("ledger-down");
  await withTimeout(client.set(kOnHand(hub, model, finish), String(value)), 1000);
}

export async function holdsCount(hub: string, model: string, finish: string): Promise<number> {
  if (!client || !client.isOpen) throw new Error("ledger-down");
  const v = await withTimeout(client.zCard(kHolds(hub, model, finish)), 1000);
  return Number(v);
}

export async function holdsMembersWithScores(
  hub: string,
  model: string,
  finish: string
): Promise<{ value: string; score: number }[]> {
  if (!client || !client.isOpen) throw new Error("ledger-down");
  const v = await withTimeout(client.zRangeWithScores(kHolds(hub, model, finish), 0, -1), 1000);
  return v.map((x: { value: string; score: number }) => ({ value: x.value, score: Number(x.score) }));
}

export async function holdsMembers(hub: string, model: string, finish: string): Promise<string[]> {
  const rows = await holdsMembersWithScores(hub, model, finish);
  return rows.map((x) => x.value);
}

export async function addHoldIfMissing(hub: string, model: string, finish: string, ref: string, score: number): Promise<void> {
  if (!client || !client.isOpen) throw new Error("ledger-down");
  await withTimeout(client.zAdd(kHolds(hub, model, finish), { score, value: ref }), 1000);
}

export async function setSlotIfMissing(hub: string, startMs: number, rideId: string): Promise<void> {
  if (!client || !client.isOpen) throw new Error("ledger-down");
  const existing = await withTimeout(client.get(kSlot(hub, slotKeyFromMs(startMs))), 1000);
  if (existing === null) {
    await withTimeout(client.set(kSlot(hub, slotKeyFromMs(startMs)), rideId), 1000);
  }
}

function slotKeyFromMs(ms: number): string {
  const shifted = new Date(ms + 5.5 * 3600000);
  const d = shifted.toISOString().slice(0, 10);
  const hh = String(shifted.getUTCHours()).padStart(2, "0");
  const mm = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${d}T${hh}:${mm}`;
}

export async function addPlaceIfMissing(hub: string, date: string, member: string): Promise<void> {
  if (!client || !client.isOpen) throw new Error("ledger-down");
  await withTimeout(client.sAdd(kPlaces(hub, date), member), 1000);
}

export async function placesMembers(hub: string, date: string): Promise<string[]> {
  if (!client || !client.isOpen) throw new Error("ledger-down");
  const v = await withTimeout(client.sMembers(kPlaces(hub, date)), 1000);
  return v;
}

export async function slotValue(hub: string, slotKey: string): Promise<string | null> {
  if (!client || !client.isOpen) throw new Error("ledger-down");
  return await withTimeout(client.get(kSlot(hub, slotKey)), 1000);
}

export async function deleteAllPrefixKeys(): Promise<void> {
  if (!client || !client.isOpen) return;
  const p = prefix();
  let cursor = "0";
  do {
    const reply = await withTimeout(client.scan(cursor, { MATCH: `${p}:*`, COUNT: 500 }), 3000);
    cursor = reply.cursor.toString();
    if (reply.keys.length > 0) {
      await withTimeout(client.del(reply.keys.map((k: string) => k.toString())), 3000);
    }
  } while (cursor !== "0");
}

export async function trimHoldsByScore(hub: string, model: string, finish: string, nowMs: number): Promise<string[]> {
  if (!client || !client.isOpen) throw new Error("ledger-down");
  // Trimming uses the app clock's value, never a clock from the ledger.
  const members = await holdsMembersWithScores(hub, model, finish);
  const removed: string[] = [];
  for (const m of members) {
    if (m.score < nowMs) {
      removed.push(m.value);
    }
  }
  if (removed.length > 0) {
    await withTimeout(client.zRem(kHolds(hub, model, finish), removed), 3000);
  }
  return removed;
}

// Setting a delivery day changes the hold's score to infinity, so a rival after
// the old expiry still gets none_left.
export async function setHoldScoreInfinity(hub: string, model: string, finish: string, ref: string): Promise<void> {
  if (!client || !client.isOpen) throw new Error("ledger-down");
  await withTimeout(client.zAdd(kHolds(hub, model, finish), { score: Number.MAX_SAFE_INTEGER, value: ref }), 3000);
}

// Withdrawal, refusal and delivery lower onHand together with the hold.
export async function decOnHand(hub: string, model: string, finish: string): Promise<void> {
  if (!client || !client.isOpen) throw new Error("ledger-down");
  await withTimeout(
    client.eval(
      `local v = redis.call('GET', KEYS[1])
       if v == false then
         redis.call('SET', KEYS[1], '0')
         return 0
       end
       if not tostring(v):match('^%-?%d+$') then
         return -1
       end
       local n = tonumber(v)
       n = math.max(0, n - 1)
       redis.call('SET', KEYS[1], tostring(n))
       return 1`,
      { keys: [kOnHand(hub, model, finish)], arguments: [] as string[] }
    ),
    3000
  );
}

// ---------- fan-out ----------
// A message is only a hint: streams re-read Postgres.

export async function publishHubChange(hub: string, seq: number): Promise<void> {
  if (!client || !client.isOpen) return;
  try {
    await client.publish(`${prefix()}:live`, JSON.stringify({ hub, seq }));
  } catch {
    // a hint may be dropped
  }
}

export async function publishRiderChange(riderId: string): Promise<void> {
  if (!client || !client.isOpen) return;
  try {
    await client.publish(`${prefix()}:rider`, JSON.stringify({ rider: riderId }));
  } catch {
    // a hint may be dropped
  }
}

export interface Subscription {
  close(): void;
}

export async function subscribeLive(onHub: (hub: string) => void, onRider: (riderId: string) => void): Promise<Subscription> {
  if (!subscriber || !subscriber.isOpen) throw new Error("ledger-down");
  await subscriber.subscribe(`${prefix()}:live`, (message: string) => {
    try {
      const parsed = JSON.parse(message) as { hub?: string };
      if (typeof parsed.hub === "string") onHub(parsed.hub);
    } catch {
      // garbage text leaves streams working
    }
  });
  await subscriber.subscribe(`${prefix()}:rider`, (message: string) => {
    try {
      const parsed = JSON.parse(message) as { rider?: string };
      if (typeof parsed.rider === "string") onRider(parsed.rider);
    } catch {
      // garbage text leaves streams working
    }
  });
  return {
    close() {
      void subscriber?.unsubscribe([`${prefix()}:live`, `${prefix()}:rider`]).catch(() => {});
    },
  };
}

// returns true when the key exists and has the expected type and integer value
export async function onHandKeyHealthy(hub: string, model: string, finish: string): Promise<boolean> {
  if (!client || !client.isOpen) return false;
  try {
    const t = await withTimeout(client.type(kOnHand(hub, model, finish)), 1000);
    if (t !== "string") return false;
    const v = await withTimeout(client.get(kOnHand(hub, model, finish)), 1000);
    return v !== null && /^-?\d+$/.test(v);
  } catch {
    return false;
  }
}

export async function keyType(key: string): Promise<string> {
  if (!client || !client.isOpen) throw new Error("ledger-down");
  return await withTimeout(client.type(key), 1000);
}
