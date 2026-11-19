// Valkey: the live bus. Every live fact of a running session is a key here, and every change is an
// atomic command or script; changes cross instances on the channel `sh:events`.
import { Redis } from 'ioredis';
import type { ChatMessage, LiveEvent } from '../../shared/wire';
import { config } from '../config';
import { BUS_PAUSED, Refusal } from '../errors';

export interface BusEvent {
  sessionId: string;
  event: LiveEvent;
  displayName?: string | null;
  tableId?: string;
  message?: ChatMessage;
}

interface BreakoutLive {
  deadlineMs: number;
  warning: boolean;
  lengthSeconds: number;
  tables: number;
  members: Record<string, string>;
}

export interface LiveData {
  seats: Record<string, string>;
  slide: number | null;
  hands: string[];
  locked: boolean;
  spotlight: string | null;
  breakout: BreakoutLive | null;
  pollCounts: Record<string, string>;
  answers: Record<string, string>;
}

const CHANNEL = 'sh:events';
const key = {
  seats: (sid: string) => `sh:${sid}:seats`,
  seatOf: (sid: string) => `sh:${sid}:seat-of`,
  slide: (sid: string) => `sh:${sid}:slide`,
  hands: (sid: string) => `sh:${sid}:hands`,
  poll: (sid: string, pollId: string) => `sh:${sid}:poll:${pollId}`,
  answers: (sid: string, pollId: string) => `sh:${sid}:poll:${pollId}:answers`,
  flags: (sid: string) => `sh:${sid}:flags`,
  breakout: (sid: string) => `sh:${sid}:breakout`,
  members: (sid: string) => `sh:${sid}:breakout:members`,
  online: (sid: string) => `sh:${sid}:online`,
  connections: (sid: string) => `sh:${sid}:connections`,
  heartbeat: (sid: string, instance: string) => `sh:${sid}:heartbeat:${instance}`,
};

const options = {
  retryStrategy: (times: number) => Math.min(times * 250, 2000),
  connectTimeout: 2000,
};
const commands = new Redis(config.valkeyUrl, { ...options, enableAutoPipelining: true, enableOfflineQueue: false, maxRetriesPerRequest: 1 });
const subscriber = new Redis(config.valkeyUrl, { ...options, maxRetriesPerRequest: null });

let flaggedDown = false;
let lastUp = false;
let onStatus: (up: boolean) => void = () => undefined;
let onEvent: (event: BusEvent) => void = () => undefined;

export function isUp(): boolean {
  return !flaggedDown && commands.status === 'ready' && subscriber.status === 'ready';
}

function refresh(): void {
  const up = isUp();
  if (up === lastUp) return;
  lastUp = up;
  onStatus(up);
}

for (const client of [commands, subscriber]) {
  client.on('error', () => undefined);
  client.on('ready', refresh);
  client.on('close', refresh);
  client.on('end', refresh);
}

subscriber.on('message', (_channel, payload) => {
  if (!isUp()) return;
  try {
    onEvent(JSON.parse(payload) as BusEvent);
  } catch (error) {
    console.error('bad bus message', error);
  }
});
subscriber.subscribe(CHANNEL).catch((error: unknown) => console.error('subscribe failed', error));

export function watch(handlers: { status: (up: boolean) => void; event: (event: BusEvent) => void }): void {
  onStatus = handlers.status;
  onEvent = handlers.event;
}

export function setBusOutage(down: boolean): void {
  flaggedDown = down;
  refresh();
}

export function requireBus(): void {
  if (!isUp()) throw new Refusal(503, BUS_PAUSED);
}

async function run<T>(work: (client: Redis) => Promise<T>): Promise<T> {
  requireBus();
  try {
    return await work(commands);
  } catch {
    throw new Refusal(503, BUS_PAUSED);
  }
}

/** Publishes a change on the bus; every instance, this one included, pushes it to its pages. */
export async function announce(sessionId: string, event: BusEvent['event'], extra: Omit<BusEvent, 'sessionId' | 'event'> = {}): Promise<void> {
  const body: BusEvent = { sessionId, event, ...extra };
  await run((client) => client.publish(CHANNEL, JSON.stringify(body)));
}

// ---- seats ----

const CLAIM_SEAT = `
local current = redis.call('HGET', KEYS[2], ARGV[1])
if current == ARGV[2] then return 'same' end
local holder = redis.call('HGET', KEYS[1], ARGV[2])
if holder then return 'taken' end
if current then redis.call('HDEL', KEYS[1], current) end
redis.call('HSET', KEYS[1], ARGV[2], ARGV[1])
redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
return 'ok'`;

const FREE_SEAT = `
local seat = redis.call('HGET', KEYS[2], ARGV[1])
if seat then
  redis.call('HDEL', KEYS[1], seat)
  redis.call('HDEL', KEYS[2], ARGV[1])
end
redis.call('LREM', KEYS[3], 0, ARGV[1])
redis.call('HDEL', KEYS[4], ARGV[1])
return seat or ''`;

/** The one atomic decision of who holds a contested seat. */
export async function claimSeat(sessionId: string, learnerId: string, seatId: string): Promise<'ok' | 'same' | 'taken'> {
  const answer = await run((client) =>
    client.eval(CLAIM_SEAT, 2, key.seats(sessionId), key.seatOf(sessionId), learnerId, seatId),
  );
  return answer === 'taken' ? 'taken' : answer === 'same' ? 'same' : 'ok';
}

/** Frees a learner's seat and drops their hand and breakout place. */
export async function freeSeat(sessionId: string, learnerId: string): Promise<void> {
  await run((client) =>
    client.eval(FREE_SEAT, 4, key.seats(sessionId), key.seatOf(sessionId), key.hands(sessionId), key.members(sessionId), learnerId),
  );
}

export async function seatsOf(sessionId: string): Promise<Record<string, string>> {
  return run((client) => client.hgetall(key.seats(sessionId)));
}

// ---- slide, flags ----

export async function setSlide(sessionId: string, slide: number): Promise<void> {
  await run((client) => client.set(key.slide(sessionId), String(slide)));
}

export async function setLocked(sessionId: string, locked: boolean): Promise<void> {
  await run((client) => client.hset(key.flags(sessionId), 'locked', locked ? '1' : '0'));
}

export async function setSpotlight(sessionId: string, learnerId: string | null): Promise<void> {
  await run((client) => client.hset(key.flags(sessionId), 'spotlight', learnerId ?? ''));
}

const CLEAR_SPOTLIGHT = `
if redis.call('HGET', KEYS[1], 'spotlight') == ARGV[1] then redis.call('HSET', KEYS[1], 'spotlight', '') end
return 1`;

/** Clears the spotlight only while it is still on this learner. */
export async function clearSpotlightOf(sessionId: string, learnerId: string): Promise<void> {
  await run((client) => client.eval(CLEAR_SPOTLIGHT, 1, key.flags(sessionId), learnerId));
}

export async function isOnline(sessionId: string, learnerId: string): Promise<boolean> {
  return (await run((client) => client.sismember(key.online(sessionId), learnerId))) === 1;
}

// ---- hands ----

const RAISE_HAND = `
if redis.call('HEXISTS', KEYS[2], ARGV[1]) == 0 then return 'noseat' end
if redis.call('LPOS', KEYS[1], ARGV[1]) then return 'same' end
redis.call('RPUSH', KEYS[1], ARGV[1])
return 'added'`;

export async function raiseHand(sessionId: string, learnerId: string): Promise<'added' | 'same' | 'noseat'> {
  const answer = await run((client) => client.eval(RAISE_HAND, 2, key.hands(sessionId), key.seatOf(sessionId), learnerId));
  return answer === 'noseat' ? 'noseat' : answer === 'same' ? 'same' : 'added';
}

export async function lowerHand(sessionId: string, learnerId: string): Promise<boolean> {
  return (await run((client) => client.lrem(key.hands(sessionId), 0, learnerId))) > 0;
}

export async function takeHand(sessionId: string): Promise<string | null> {
  return run((client) => client.lpop(key.hands(sessionId)));
}

// ---- polls ----

const ANSWER_POLL = `
local old = redis.call('HGET', KEYS[2], ARGV[1])
if old == ARGV[2] then return 0 end
if old then redis.call('HINCRBY', KEYS[1], old, -1) end
redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
redis.call('HINCRBY', KEYS[1], ARGV[2], 1)
return 1`;

export async function answerPoll(sessionId: string, pollId: string, learnerId: string, option: number): Promise<void> {
  await run((client) =>
    client.eval(ANSWER_POLL, 2, key.poll(sessionId, pollId), key.answers(sessionId, pollId), learnerId, String(option)),
  );
}

export async function pollTally(sessionId: string, pollId: string): Promise<{ counts: Record<string, string>; answers: Record<string, string> }> {
  const [counts, answers] = await run((client) =>
    Promise.all([client.hgetall(key.poll(sessionId, pollId)), client.hgetall(key.answers(sessionId, pollId))]),
  );
  return { counts, answers };
}

// ---- breakouts ----

interface BreakoutStart {
  roundId: string;
  deadlineMs: number;
  tables: number;
  lengthSeconds: number;
  members: Record<string, string>;
}

export async function startBreakout(sessionId: string, start: BreakoutStart): Promise<void> {
  await run(async (client) => {
    const members = key.members(sessionId);
    await client.del(members);
    if (Object.keys(start.members).length > 0) await client.hset(members, start.members);
    await client.hset(key.breakout(sessionId), {
      deadline: new Date(start.deadlineMs).toISOString(),
      tables: String(start.tables),
      warning: '0',
      length: String(start.lengthSeconds),
      round: start.roundId,
    });
  });
}

export async function updateBreakout(sessionId: string, fields: { deadlineMs?: number; lengthSeconds?: number; warning?: boolean }): Promise<void> {
  const hash: Record<string, string> = {};
  if (fields.deadlineMs !== undefined) hash.deadline = new Date(fields.deadlineMs).toISOString();
  if (fields.lengthSeconds !== undefined) hash.length = String(fields.lengthSeconds);
  if (fields.warning !== undefined) hash.warning = fields.warning ? '1' : '0';
  await run((client) => client.hset(key.breakout(sessionId), hash));
}

export async function clearBreakout(sessionId: string): Promise<void> {
  await run((client) => client.del(key.breakout(sessionId), key.members(sessionId)));
}

// ---- presence ----

export async function registerConnection(sessionId: string, learnerId: string, count: number): Promise<void> {
  await run(async (client) => {
    await client.hset(key.connections(sessionId), `${learnerId}|${config.instanceName}`, String(count));
    await client.sadd(key.online(sessionId), learnerId);
    await client.set(key.heartbeat(sessionId, config.instanceName), '1', 'EX', 30);
  });
}

/** Drops this instance's connection record; true when no other live instance holds one for the learner. */
export async function dropConnection(sessionId: string, learnerId: string): Promise<boolean> {
  return run(async (client) => {
    await client.hdel(key.connections(sessionId), `${learnerId}|${config.instanceName}`);
    const held = Object.keys(await client.hgetall(key.connections(sessionId))).filter((field) => field.startsWith(`${learnerId}|`));
    for (const field of held) {
      const instance = field.slice(learnerId.length + 1);
      if ((await client.exists(key.heartbeat(sessionId, instance))) === 1) return false;
    }
    return true;
  });
}

export async function refreshHeartbeat(sessionId: string): Promise<void> {
  await run((client) => client.set(key.heartbeat(sessionId, config.instanceName), '1', 'EX', 30));
}

export async function removeOnline(sessionId: string, learnerId: string): Promise<void> {
  await run((client) => client.srem(key.online(sessionId), learnerId));
}

// ---- reading the whole live state ----

export async function readLive(sessionId: string, pollId: string | null): Promise<LiveData> {
  const [seats, slide, hands, flags, breakout, members, pollCounts, answers] = await run((client) =>
    Promise.all([
      client.hgetall(key.seats(sessionId)),
      client.get(key.slide(sessionId)),
      client.lrange(key.hands(sessionId), 0, -1),
      client.hgetall(key.flags(sessionId)),
      client.hgetall(key.breakout(sessionId)),
      client.hgetall(key.members(sessionId)),
      pollId ? client.hgetall(key.poll(sessionId, pollId)) : Promise.resolve<Record<string, string>>({}),
      pollId ? client.hgetall(key.answers(sessionId, pollId)) : Promise.resolve<Record<string, string>>({}),
    ]),
  );
  const deadlineMs = breakout.deadline ? Date.parse(breakout.deadline) : Number.NaN;
  return {
    seats,
    slide: slide === null ? null : Number(slide),
    hands,
    locked: flags.locked === '1',
    spotlight: flags.spotlight ? flags.spotlight : null,
    breakout: Number.isFinite(deadlineMs)
      ? {
          deadlineMs,
          warning: breakout.warning === '1',
          lengthSeconds: Number(breakout.length ?? 0),
          tables: Number(breakout.tables ?? 0),
          members,
        }
      : null,
    pollCounts,
    answers,
  };
}

// ---- seeding (grading setup) and clean-up ----

interface SeedLive {
  seats: Record<string, string>;
  slide: number;
  locked: boolean;
  hands: string[];
  online: string[];
  poll: { pollId: string; counts: Record<string, number>; answers: Record<string, number> } | null;
}

export async function seedLive(sessionId: string, seed: SeedLive): Promise<void> {
  await run(async (client) => {
    await client.set(key.slide(sessionId), String(seed.slide));
    await client.hset(key.flags(sessionId), { locked: seed.locked ? '1' : '0', spotlight: '' });
    for (const [seatId, learnerId] of Object.entries(seed.seats)) {
      await client.hset(key.seats(sessionId), seatId, learnerId);
      await client.hset(key.seatOf(sessionId), learnerId, seatId);
    }
    if (seed.hands.length > 0) await client.rpush(key.hands(sessionId), ...seed.hands);
    if (seed.online.length > 0) await client.sadd(key.online(sessionId), ...seed.online);
    if (seed.poll) {
      const { pollId, counts, answers } = seed.poll;
      for (const [option, count] of Object.entries(counts)) await client.hset(key.poll(sessionId, pollId), option, String(count));
      for (const [learnerId, option] of Object.entries(answers)) await client.hset(key.answers(sessionId, pollId), learnerId, String(option));
    }
  });
}

/** Deletes every key of a session once Postgres has its final record. */
export async function deleteSessionKeys(sessionId: string): Promise<void> {
  await run(async (client) => {
    let cursor = '0';
    do {
      const [next, found] = await client.scan(cursor, 'MATCH', `sh:${sessionId}:*`, 'COUNT', 200);
      cursor = next;
      if (found.length > 0) await client.del(...found);
    } while (cursor !== '0');
  });
}
