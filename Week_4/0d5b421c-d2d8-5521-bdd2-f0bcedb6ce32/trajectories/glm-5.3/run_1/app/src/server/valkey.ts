import Redis from "ioredis";
import type { Config } from "./config.js";
import { coveredSlots } from "./floor.js";

/** A claim key for one covered slot of one table: <prefix>hold:<table>:<date>T<HH:MM> */
export function claimKey(prefix: string, tableId: string, date: string, time: string): string {
  return `${prefix}hold:${tableId}:${date}T${time}`;
}

export class Valkey {
  client: Redis;
  /** A separate connection for blocking stream reads, without a command timeout. */
  private url: string;
  private prefix: string;
  private healthy = true;

  constructor(cfg: Config) {
    this.url = cfg.valkeyUrl;
    this.prefix = cfg.valkeyKeyPrefix;
    this.client = new Redis(cfg.valkeyUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      commandTimeout: 2000,
      enableOfflineQueue: false,
      retryStrategy: (times) => Math.min(500 * times, 2000),
    });
    this.client.on("error", () => {
      this.healthy = false;
    });
    this.client.on("end", () => { this.healthy = false; });
    this.client.on("ready", () => { this.healthy = true; });
    this.client.on("connect", () => { this.healthy = true; });
  }

  /** A dedicated connection for one event stream, without a command timeout. */
  streamConnection(): Redis {
    return new Redis(this.url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      // Retry forever but slowly, so a stream survives a Valkey outage.
      retryStrategy: (times) => Math.min(1000 * times, 5000),
    });
  }

  /**
   * Read new events after lastId on a dedicated connection, waiting up to
   * timeoutMs. Returns an empty list on timeout or when Valkey is unreachable,
   * after which the caller should wait before trying again.
   */
  async readOn(
    conn: Redis, date: string, lastId: string, timeoutMs: number,
  ): Promise<{ id: string; fields: Record<string, string> }[]> {
    const key = `${this.prefix}events:${date}`;
    try {
      const res = await conn.xread("BLOCK", timeoutMs, "STREAMS", key, lastId);
      if (!res) return [];
      const [, entries] = res[0];
      return entries.map(([id, fields]) => ({ id, fields: pairsToMap(fields) }));
    } catch {
      // Back off so a Valkey outage does not spin the loop.
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return [];
    }
  }

  async ping(): Promise<boolean> {
    try {
      const r = await this.client.ping();
      this.healthy = r === "PONG";
      return this.healthy;
    } catch {
      this.healthy = false;
      return false;
    }
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  /** Claim all covered slots of a window atomically: all or none. */
  async claimWindow(
    tables: string[], start: Date, partySize: number, ownerId: string, ttlMs: number,
  ): Promise<boolean> {
    const slots = coveredSlots(start, partySize);
    const keys: string[] = [];
    for (const t of tables) {
      for (const s of slots) {
        keys.push(claimKey(this.prefix, t, s.date, s.time));
      }
    }
    const script = `
local claimed = {}
for i, key in ipairs(KEYS) do
  if redis.call('EXISTS', key) == 1 then
    return 0
  end
end
for i, key in ipairs(KEYS) do
  redis.call('SET', key, ARGV[1], 'PX', ARGV[2])
end
return 1
`;
    try {
      const r = await this.client.eval(script, keys.length, ...keys, ownerId, String(ttlMs));
      if (r === 1) { this.healthy = true; return true; }
      return false;
    } catch {
      this.healthy = false;
      throw new Error("valkey_unavailable");
    }
  }

  /** Release the claims a hold/offer/walk-in owns. */
  async releaseWindow(tables: string[], start: Date, partySize: number): Promise<void> {
    const slots = coveredSlots(start, partySize);
    const keys: string[] = [];
    for (const t of tables) {
      for (const s of slots) keys.push(claimKey(this.prefix, t, s.date, s.time));
    }
    try {
      if (keys.length) await this.client.unlink(...keys);
      this.healthy = true;
    } catch {
      this.healthy = false;
      throw new Error("valkey_unavailable");
    }
  }

  /** Release only the claims owned by the given owner. */
  async releaseOwned(tables: string[], start: Date, partySize: number, ownerId: string): Promise<void> {
    const slots = coveredSlots(start, partySize);
    const keys: string[] = [];
    for (const t of tables) {
      for (const s of slots) keys.push(claimKey(this.prefix, t, s.date, s.time));
    }
    try {
      if (keys.length) {
        const script = `
local removed = {}
for i, key in ipairs(KEYS) do
  if redis.call('GET', key) == ARGV[1] then
    table.insert(removed, key)
  end
end
if #removed > 0 then
  redis.call('UNLINK', unpack(removed))
end
return 1
`;
        await this.client.eval(script, keys.length, ...keys, ownerId);
      }
      this.healthy = true;
    } catch {
      this.healthy = false;
      throw new Error("valkey_unavailable");
    }
  }

  /** Append an event to the date's stream. */
  async publish(date: string, type: string, payload: Record<string, unknown>): Promise<string> {
    const key = `${this.prefix}events:${date}`;
    const flat: string[] = [];
    for (const [k, v] of Object.entries({ ...payload, __type: type })) {
      flat.push(k, String(v));
    }
    const id = await this.client.xadd(key, "*", ...flat);
    return id as string;
  }

  async trim(date: string, keepMs = 10 * 60 * 1000): Promise<void> {
    const key = `${this.prefix}events:${date}`;
    const minId = `${Date.now() - keepMs}-0`;
    await new Promise<void>((resolve) => {
      this.client.call("XTRIM", key, "MINID", "~", minId).catch(() => undefined).then(() => resolve());
    });
  }

  async readRange(date: string, afterId: string | null): Promise<{ id: string; fields: Record<string, string> }[]> {
    const key = `${this.prefix}events:${date}`;
    if (afterId) {
      const res = await this.client.xrange(key, `(${afterId}`, "+");
      return res.map(([id, fields]) => ({ id, fields: pairsToMap(fields) }));
    }
    const res = await this.client.xrange(key, "-", "+");
    return res.map(([id, fields]) => ({ id, fields: pairsToMap(fields) }));
  }

  offerKey(offerId: string): string {
    return `${this.prefix}offer:${offerId}`;
  }

  async setOffer(offerId: string, ttlMs: number): Promise<boolean> {
    try {
      const key = this.offerKey(offerId);
      const r = await this.client.set(key, offerId, "PX", ttlMs, "NX");
      return r === "OK";
    } catch {
      throw new Error("valkey_unavailable");
    }
  }

  async delOffer(offerId: string): Promise<void> {
    try { await this.client.unlink(this.offerKey(offerId)); } catch {
      throw new Error("valkey_unavailable");
    }
  }

  async close(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }
}

function pairsToMap(fields: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) out[fields[i]] = fields[i + 1];
  return out;
}

