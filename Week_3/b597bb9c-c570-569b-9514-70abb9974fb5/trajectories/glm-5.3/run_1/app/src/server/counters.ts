import { createClient, type RedisClientType } from 'redis';

/**
 * Valkey: allowance counters, waveform peaks, read-token rate windows.
 * One atomic Lua script takes an allowance, so parallel requests can never
 * pass the limit.
 */
export class Counters {
  private client: RedisClientType;
  private connected = false;
  private workspaceId = '';

  constructor(url: string) {
    this.client = createClient({ url });
    this.client.on('error', () => {
      this.connected = false;
    });
    this.client.on('end', () => {
      this.connected = false;
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
    this.connected = true;
  }

  async ensure(): Promise<void> {
    if (!this.connected) {
      await this.client.connect();
      this.connected = true;
    }
  }

  setWorkspace(id: string): void {
    this.workspaceId = id;
  }

  // ---- export minutes ----

  private minutesKey(month: string): string {
    return `gatecut:${this.workspaceId}:export-minutes:${month}`;
  }

  async getExportMinutes(month: string): Promise<number | null> {
    try {
      const v = await this.client.get(this.minutesKey(month));
      return v === null ? null : Number(v);
    } catch {
      return null;
    }
  }

  async setExportMinutes(month: string, value: number): Promise<void> {
    try {
      await this.client.set(this.minutesKey(month), String(value), { EX: 40 * 24 * 3600 });
    } catch {
      /* counters are best-effort reads; allowance changes still push */
    }
  }

  /**
   * Take minutes atomically. The counter is rebuilt from Postgres first when
   * it is missing, so a fresh month never starts from zero. Returns the used
   * value after taking, or null when taking would pass the allowance.
   */
  async takeExportMinutes(
    month: string,
    minutes: number,
    allowance: number,
    rebuild: () => Promise<number>,
  ): Promise<number | null> {
    await this.ensure();
    const key = this.minutesKey(month);
    let current = await this.client.get(key).catch(() => null);
    if (current === null) {
      const baseline = await rebuild();
      await this.client.set(key, String(baseline), { EX: 40 * 24 * 3600 });
      current = String(baseline);
    }
    const script = `local cur = redis.call('GET', KEYS[1])
      local n = 0
      if cur then n = tonumber(cur) else n = 0 end
      if n + tonumber(ARGV[1]) > tonumber(ARGV[2]) then return false end
      redis.call('SET', KEYS[1], tostring(n + tonumber(ARGV[1])), 'EX', tonumber(ARGV[3]))
      return n + tonumber(ARGV[1])`;
    const result = (await this.client.eval(script, {
      keys: [key],
      arguments: [String(minutes), String(allowance), String(40 * 24 * 3600)],
    })) as boolean | number;
    if (result === false || result === null) return null;
    return Number(result);
  }

  async giveBackExportMinutes(month: string, minutes: number): Promise<void> {
    try {
      const script = `local cur = redis.call('GET', KEYS[1])
      local n = 0
      if cur then n = math.max(0, tonumber(cur) - tonumber(ARGV[1])) else n = 0 end
      redis.call('SET', KEYS[1], tostring(n), 'EX', tonumber(ARGV[2]))
      return n`;
      await this.client.eval(script, {
        keys: [this.minutesKey(month)],
        arguments: [String(minutes), String(40 * 24 * 3600)],
      });
    } catch {
      /* best effort */
    }
  }

  // ---- storage bytes ----

  private storageKey(): string {
    return `gatecut:${this.workspaceId}:storage-bytes`;
  }

  async getStorageBytes(): Promise<number | null> {
    try {
      const v = await this.client.get(this.storageKey());
      return v === null ? null : Number(v);
    } catch {
      return null;
    }
  }

  async setStorageBytes(value: number): Promise<void> {
    try {
      await this.client.set(this.storageKey(), String(value));
    } catch {
      /* best effort */
    }
  }

  /** Take storage bytes atomically; null when it would pass the allowance. */
  async takeStorageBytes(bytes: number, allowance: number): Promise<number | null> {
    await this.ensure();
    const script = `local cur = redis.call('GET', KEYS[1])
      local n = 0
      if cur then n = tonumber(cur) else n = 0 end
      if n + tonumber(ARGV[1]) > tonumber(ARGV[2]) then return false end
      redis.call('SET', KEYS[1], tostring(n + tonumber(ARGV[1])))
      return n + tonumber(ARGV[1])`;
    const result = (await this.client.eval(script, {
      keys: [this.storageKey()],
      arguments: [String(bytes), String(allowance)],
    })) as boolean | number;
    if (result === false || result === null) return null;
    return Number(result);
  }

  async giveBackStorageBytes(bytes: number): Promise<void> {
    try {
      const script = `local cur = redis.call('GET', KEYS[1])
      local n = 0
      if cur then n = math.max(0, tonumber(cur) - tonumber(ARGV[1])) else n = 0 end
      redis.call('SET', KEYS[1], tostring(n))
      return n`;
      await this.client.eval(script, { keys: [this.storageKey()], arguments: [String(bytes)] });
    } catch {
      /* best effort */
    }
  }

  // ---- waveform peaks ----

  async getPeaks(sha256: string): Promise<number[] | null> {
    try {
      const raw = await this.client.get(`gatecut:peaks:${sha256}`);
      return raw === null ? null : (JSON.parse(raw) as number[]);
    } catch {
      return null;
    }
  }

  async setPeaks(sha256: string, peaks: number[]): Promise<void> {
    try {
      await this.client.set(`gatecut:peaks:${sha256}`, JSON.stringify(peaks));
    } catch {
      /* best effort */
    }
  }

  async deletePeaks(sha256: string): Promise<void> {
    try {
      await this.client.del(`gatecut:peaks:${sha256}`);
    } catch {
      /* best effort */
    }
  }

  // ---- read-token rate windows ----

  async countTokenRequest(tokenId: string, window: number): Promise<number> {
    await this.ensure();
    const key = `gatecut:rate:${tokenId}:${window}`;
    const script = `local n = redis.call('INCR', KEYS[1])
      if n == 1 then redis.call('EXPIRE', KEYS[1], 20) end
      return n`;
    const result = (await this.client.eval(script, { keys: [key] })) as number;
    return Number(result);
  }

  async peekTokenWindow(tokenId: string, window: number): Promise<number> {
    try {
      const v = await this.client.get(`gatecut:rate:${tokenId}:${window}`);
      return v === null ? 0 : Number(v);
    } catch {
      return 0;
    }
  }
}
