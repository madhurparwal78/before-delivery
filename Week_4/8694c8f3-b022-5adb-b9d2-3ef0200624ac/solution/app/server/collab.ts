import { Redis } from "ioredis";
import { LOCK_LEASE_MS, PRESENCE_TTL_SECONDS } from "../shared/collab.ts";
import type { LockEvent, OpDocument, PresenceMember } from "../shared/types.ts";

export class CollabOffline extends Error {}

export type RelayEvent =
  | { kind: "op"; data: OpDocument }
  | { kind: "lock"; data: LockEvent }
  | { kind: "presence"; data: { members: PresenceMember[] } }
  | { kind: "show"; data: { live_number: number | null } };

type RelayListener = (setId: string, event: RelayEvent) => void;

const lockKey = (setId: string, layerId: string): string => `afterglass:lock:${setId}:${layerId}`;
const presenceKey = (setId: string, userId: string): string => `afterglass:presence:${setId}:${userId}`;
const channel = (setId: string): string => `afterglass:set:${setId}`;

type AcquireOutcome =
  | { outcome: "granted" | "renewed"; holderId: string; leaseMs: number }
  | { outcome: "held"; holderId: string; leaseMs: number };

type LockCommands = {
  acquireLock(key: string, userId: string, lease: number): Promise<[number, string | null, number]>;
  renewLock(key: string, userId: string, lease: number): Promise<number>;
  releaseLock(key: string, userId: string, force: string): Promise<[number, string | null]>;
};

const SCRIPTS = {
  acquireLock: `
    if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) then return {1, ARGV[1], tonumber(ARGV[2])} end
    local holder = redis.call('GET', KEYS[1])
    if holder == ARGV[1] then redis.call('PEXPIRE', KEYS[1], ARGV[2]); return {2, holder, tonumber(ARGV[2])} end
    return {0, holder, redis.call('PTTL', KEYS[1])}`,
  renewLock: `
    if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('PEXPIRE', KEYS[1], ARGV[2]); return 1 end
    return 0`,
  releaseLock: `
    local holder = redis.call('GET', KEYS[1])
    if not holder then return {0, false} end
    if holder == ARGV[1] or ARGV[2] == 'force' then redis.call('DEL', KEYS[1]); return {1, holder} end
    return {2, holder}`,
} as const;

export class Collab {
  private client: (Redis & LockCommands) | null = null;
  private subscriber: Redis | null = null;
  private readonly wanted = new Set<string>();
  private listener: RelayListener = () => undefined;
  private readonly onOutcome: (reachable: boolean) => void;

  constructor(url: string, onOutcome: (reachable: boolean) => void) {
    this.onOutcome = onOutcome;
    const options = this.parse(url);
    if (!options) return;
    const client = new Redis({ ...options, enableOfflineQueue: false, maxRetriesPerRequest: 0, commandTimeout: 2000, retryStrategy: () => 1000 });
    client.defineCommand("acquireLock", { numberOfKeys: 1, lua: SCRIPTS.acquireLock });
    client.defineCommand("renewLock", { numberOfKeys: 1, lua: SCRIPTS.renewLock });
    client.defineCommand("releaseLock", { numberOfKeys: 1, lua: SCRIPTS.releaseLock });
    client.on("error", () => undefined);
    this.client = client as Redis & LockCommands;
    const subscriber = new Redis({ ...options, retryStrategy: () => 1000 });
    subscriber.on("error", () => undefined);
    subscriber.on("ready", () => {
      for (const name of this.wanted) void subscriber.subscribe(name).catch(() => undefined);
    });
    subscriber.on("message", (name: string, message: string) => this.relay(name, message));
    this.subscriber = subscriber;
  }

  private parse(url: string): { host: string; port: number; username?: string; password?: string; db: number; tls?: object } | null {
    try {
      const parsed = new URL(url);
      if (!["redis:", "rediss:", "valkey:", "valkeys:"].includes(parsed.protocol)) return null;
      return {
        tls: parsed.protocol === "rediss:" || parsed.protocol === "valkeys:" ? {} : undefined,
        host: parsed.hostname,
        port: Number(parsed.port || 6379),
        username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
        password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
        db: Number(parsed.pathname.replace("/", "") || 0),
      };
    } catch {
      return null;
    }
  }

  setListener(listener: RelayListener): void {
    this.listener = listener;
  }

  async probe(): Promise<boolean> {
    try {
      await this.run((client) => client.ping());
      return true;
    } catch {
      return false;
    }
  }

  private async run<T>(work: (client: Redis & LockCommands) => Promise<T>): Promise<T> {
    const client = this.client;
    if (!client || client.status !== "ready") {
      this.mark(false);
      throw new CollabOffline("collaboration is offline");
    }
    try {
      const result = await work(client);
      this.mark(true);
      return result;
    } catch {
      this.mark(false);
      throw new CollabOffline("collaboration is offline");
    }
  }

  private mark(reachable: boolean): void {
    this.onOutcome(reachable);
  }

  private relay(name: string, message: string): void {
    try {
      const parsed: unknown = JSON.parse(message);
      const setId = name.slice("afterglass:set:".length);
      if (typeof parsed === "object" && parsed !== null && "kind" in parsed && "data" in parsed) {
        this.listener(setId, parsed as RelayEvent);
      }
    } catch {
      return;
    }
  }

  async publish(setId: string, event: RelayEvent): Promise<boolean> {
    try {
      await this.run((client) => client.publish(channel(setId), JSON.stringify(event)));
      return true;
    } catch {
      return false;
    }
  }

  subscribe(setId: string): void {
    const name = channel(setId);
    this.wanted.add(name);
    if (this.subscriber?.status === "ready") void this.subscriber.subscribe(name).catch(() => undefined);
  }

  unsubscribe(setId: string): void {
    const name = channel(setId);
    this.wanted.delete(name);
    if (this.subscriber?.status === "ready") void this.subscriber.unsubscribe(name).catch(() => undefined);
  }

  async acquireLock(setId: string, layerId: string, userId: string): Promise<AcquireOutcome> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const [code, holder, ttl] = await this.run((client) => client.acquireLock(lockKey(setId, layerId), userId, LOCK_LEASE_MS));
      if (holder === null) continue;
      if (code === 1) return { outcome: "granted", holderId: holder, leaseMs: ttl };
      if (code === 2) return { outcome: "renewed", holderId: holder, leaseMs: ttl };
      return { outcome: "held", holderId: holder, leaseMs: ttl };
    }
    throw new CollabOffline("lock state kept changing");
  }

  async renewLock(setId: string, layerId: string, userId: string): Promise<{ renewed: boolean; leaseMs: number }> {
    const renewed = await this.run((client) => client.renewLock(lockKey(setId, layerId), userId, LOCK_LEASE_MS));
    return { renewed: renewed === 1, leaseMs: LOCK_LEASE_MS };
  }

  async releaseLock(setId: string, layerId: string, userId: string, force: boolean): Promise<{ result: "released" | "free" | "denied"; holderId: string | null }> {
    const [code, holder] = await this.run((client) => client.releaseLock(lockKey(setId, layerId), userId, force ? "force" : "own"));
    return { result: code === 1 ? "released" : code === 0 ? "free" : "denied", holderId: holder };
  }

  async lockState(setId: string, layerId: string): Promise<{ holderId: string; leaseMs: number } | null> {
    const key = lockKey(setId, layerId);
    const [holder, ttl] = await this.run(async (client) => [await client.get(key), await client.pttl(key)] as const);
    return holder === null || ttl < 0 ? null : { holderId: holder, leaseMs: ttl };
  }

  async locksOfSet(setId: string): Promise<{ layerId: string; holderId: string; leaseMs: number }[]> {
    return this.run(async (client) => {
      const prefix = `afterglass:lock:${setId}:`;
      const found: { layerId: string; holderId: string; leaseMs: number }[] = [];
      let cursor = "0";
      do {
        const [next, keys] = await client.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 500);
        cursor = next;
        for (const key of keys) {
          const [holder, ttl] = [await client.get(key), await client.pttl(key)];
          if (holder !== null && ttl > 0) found.push({ layerId: key.slice(prefix.length), holderId: holder, leaseMs: ttl });
        }
      } while (cursor !== "0");
      return found;
    });
  }

  async writePresence(setId: string, userId: string, value: { display_name: string; colour: string; selection: string | null }): Promise<void> {
    await this.run((client) => client.set(presenceKey(setId, userId), JSON.stringify(value), "EX", PRESENCE_TTL_SECONDS));
  }

  async readPresence(setId: string, userIds: string[]): Promise<(string | null)[]> {
    if (userIds.length === 0) return [];
    return this.run((client) => client.mget(userIds.map((id) => presenceKey(setId, id))));
  }
}
