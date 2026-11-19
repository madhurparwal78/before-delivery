import Redis from 'ioredis';
import { config } from '../config.js';
import type { Plan } from '../domain/types.js';

/** Requests per second for each builder plan. */
export const PLAN_RATES: Record<Plan, number> = { sandbox: 2, builder: 20, desk: 100 };

const options = { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false } as const;

const commands = new Redis(config.valkeyUrl, options);
const subscriber = new Redis(config.valkeyUrl, options);

commands.on('error', () => undefined);
subscriber.on('error', () => undefined);

export async function connect(): Promise<void> {
  await Promise.all([commands.connect().catch(() => undefined), subscriber.connect().catch(() => undefined)]);
}

const rateLimitKey = (keyId: string): string => `ratelimit:${keyId}`;

/** A bucket that holds up to its rate and refills at its rate per second. */
const TAKE_TOKEN = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local rate = tonumber(redis.call('HGET', key, 'rate'))
if not rate then return {-1, 0} end
local tokens = tonumber(redis.call('HGET', key, 'tokens')) or rate
local updated = tonumber(redis.call('HGET', key, 'updated_ms')) or now
local refill = (now - updated) * rate / 1000
tokens = math.min(rate, tokens + refill)
if tokens < 1 then
  redis.call('HSET', key, 'tokens', tokens, 'updated_ms', now)
  return {0, math.ceil((1 - tokens) * 1000 / rate)}
end
redis.call('HSET', key, 'tokens', tokens - 1, 'updated_ms', now)
return {1, 0}
`;

export async function setKeyRate(keyId: string, rate: number): Promise<void> {
  await commands.hset(rateLimitKey(keyId), { rate, tokens: rate, updated_ms: Date.now() });
}

export async function deleteKeyRate(keyId: string): Promise<void> {
  await commands.del(rateLimitKey(keyId));
}

export interface RateDecision {
  allowed: boolean;
  retryAfterMs: number;
}

export async function takeToken(keyId: string, fallbackRate: number): Promise<RateDecision> {
  const result = (await commands.eval(TAKE_TOKEN, 1, rateLimitKey(keyId), Date.now())) as [number, number];
  if (result[0] === -1) {
    await setKeyRate(keyId, fallbackRate);
    return { allowed: true, retryAfterMs: 0 };
  }
  return { allowed: result[0] === 1, retryAfterMs: result[1] };
}

export type StreamEvent = { event: string; data: unknown };

const marketChannel = (marketId: string): string => `market:${marketId}`;
const memberChannel = (memberId: string): string => `member:${memberId}`;

type Listener = (event: StreamEvent) => void;
const listeners = new Map<string, Set<Listener>>();
let subscribed = false;

function ensureSubscriberWired(): void {
  if (subscribed) return;
  subscribed = true;
  subscriber.on('message', (channel: string, payload: string) => {
    const set = listeners.get(channel);
    if (set === undefined) return;
    const event = JSON.parse(payload) as StreamEvent;
    for (const listener of set) listener(event);
  });
}

async function subscribe(channel: string, listener: Listener): Promise<() => void> {
  ensureSubscriberWired();
  let set = listeners.get(channel);
  if (set === undefined) {
    set = new Set();
    listeners.set(channel, set);
    await subscriber.subscribe(channel).catch(() => undefined);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set?.size === 0) {
      listeners.delete(channel);
      void subscriber.unsubscribe(channel).catch(() => undefined);
    }
  };
}

export async function subscribeMarket(marketId: string, listener: Listener): Promise<() => void> {
  return subscribe(marketChannel(marketId), listener);
}

export async function subscribeMember(memberId: string, listener: Listener): Promise<() => void> {
  return subscribe(memberChannel(memberId), listener);
}

async function publish(channel: string, event: StreamEvent): Promise<void> {
  await commands.publish(channel, JSON.stringify(event)).catch(() => undefined);
}

export async function publishMarket(marketId: string, event: StreamEvent): Promise<void> {
  await publish(marketChannel(marketId), event);
}

export async function publishMember(memberId: string, event: StreamEvent): Promise<void> {
  await publish(memberChannel(memberId), event);
}

export async function up(): Promise<boolean> {
  try {
    const reply = await commands.ping();
    return reply === 'PONG';
  } catch {
    return false;
  }
}
