import { Redis } from 'ioredis';
import { config } from './config.js';
import { ApiError, liveUnavailable } from './errors.js';

const PROBE_MS = 2000;

type MessageHandler = (channel: string, event: string, data: unknown) => void;

const TAKE_LOCK = `
local current = redis.call('GET', KEYS[1])
if current == false then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2]); return {1, ARGV[1], tonumber(ARGV[2])}
elseif current == ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], ARGV[2]); return {3, current, tonumber(ARGV[2])}
elseif ARGV[3] == '1' then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2]); return {2, current, tonumber(ARGV[2])}
end
return {0, current, redis.call('PTTL', KEYS[1])}`;

const RELEASE_LOCK = `
local current = redis.call('GET', KEYS[1])
if current == false then return {1, ''} end
if current == ARGV[1] then redis.call('DEL', KEYS[1]); return {1, current} end
return {0, current}`;

type LockAttempt =
  | { outcome: 'taken' | 'refreshed'; ttlMs: number }
  | { outcome: 'taken_over'; ttlMs: number; from: string }
  | { outcome: 'held'; holderId: string; ttlMs: number };

/** The one Valkey client: commands, a pub/sub subscriber, and an availability flag. */
class Valkey {
  private commands: Redis | null = null;
  private subscriber: Redis | null = null;
  private up = false;
  private handler: MessageHandler | null = null;
  private onChange: ((available: boolean) => void) | null = null;

  get available(): boolean {
    return this.up;
  }

  start(onMessage: MessageHandler, onAvailability: (available: boolean) => void): void {
    this.handler = onMessage;
    this.onChange = onAvailability;
    if (!config.valkeyUrl) return;
    const options = { retryStrategy: () => 1000, enableOfflineQueue: false, maxRetriesPerRequest: 1, connectTimeout: 3000 } as const;
    this.commands = new Redis(config.valkeyUrl, options);
    this.subscriber = new Redis(config.valkeyUrl, { ...options, enableOfflineQueue: true });
    this.commands.on('ready', () => this.set(true));
    this.commands.on('error', () => this.set(false));
    this.commands.on('end', () => this.set(false));
    this.subscriber.on('error', () => undefined);
    this.subscriber.on('ready', () => {
      void this.subscriber!.psubscribe('room:*', 'playtest:*').catch(() => undefined);
    });
    this.subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
      const parsed = JSON.parse(message) as { event: string; data: unknown };
      this.handler?.(channel, parsed.event, parsed.data);
    });
    void this.watch();
  }

  private set(up: boolean): void {
    if (this.up === up) return;
    this.up = up;
    this.onChange?.(up);
  }

  private async watch(): Promise<void> {
    for (;;) {
      try {
        await this.commands!.ping();
        this.set(true);
      } catch {
        this.set(false);
      }
      await new Promise((resolve) => setTimeout(resolve, PROBE_MS));
    }
  }

  private client(): Redis {
    if (!this.up || !this.commands) throw liveUnavailable();
    return this.commands;
  }

  private async run<T>(work: (client: Redis) => Promise<T>): Promise<T> {
    try {
      return await work(this.client());
    } catch (error) {
      if (error instanceof ApiError) throw error;
      this.set(false);
      throw liveUnavailable();
    }
  }

  async publish(channel: string, event: string, data: unknown): Promise<void> {
    await this.run((client) => client.publish(channel, JSON.stringify({ event, data })));
  }

  async takeLock(key: string, userId: string, ttlMs: number, takeOver: boolean): Promise<LockAttempt> {
    const [code, holder, ttl] = (await this.run((client) => client.eval(TAKE_LOCK, 1, key, userId, ttlMs, takeOver ? '1' : '0'))) as [number, string, number];
    if (code === 1) return { outcome: 'taken', ttlMs: ttl };
    if (code === 3) return { outcome: 'refreshed', ttlMs: ttl };
    if (code === 2) return { outcome: 'taken_over', ttlMs: ttl, from: holder };
    return { outcome: 'held', holderId: holder, ttlMs: ttl };
  }

  /** Releases the lock when this user holds it (or nobody does); returns the other holder otherwise. */
  async releaseLock(key: string, userId: string): Promise<string | null> {
    const [code, holder] = (await this.run((client) => client.eval(RELEASE_LOCK, 1, key, userId))) as [number, string];
    return code === 1 ? null : holder;
  }

  async lockHolder(key: string): Promise<{ holderId: string; ttlMs: number } | null> {
    return this.run(async (client) => {
      const holderId = await client.get(key);
      if (holderId === null) return null;
      return { holderId, ttlMs: Math.max(0, await client.pttl(key)) };
    });
  }

  async keys(pattern: string): Promise<string[]> {
    return this.run(async (client) => {
      const found: string[] = [];
      let cursor = '0';
      do {
        const [next, batch] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
        cursor = next;
        found.push(...batch);
      } while (cursor !== '0');
      return found;
    });
  }

  async setWithTtl(key: string, value: string, seconds: number): Promise<void> {
    await this.run((client) => client.set(key, value, 'EX', seconds));
  }

  async remove(key: string): Promise<void> {
    await this.run((client) => client.del(key));
  }

  async values(keys: string[]): Promise<(string | null)[]> {
    if (keys.length === 0) return [];
    return this.run((client) => client.mget(...keys));
  }
}

export const valkey = new Valkey();
