import { createClient } from 'redis';
import type { Db } from './db';

/**
 * Valkey service: streams for live delivery, the tick lease and the health
 * probe. The app runs with Valkey unreachable: reads work, writes wait in the
 * outbox and running sessions hold.
 */
export interface OutboxRow {
  stream: string;
  seq: number;
  type: string;
  payload: unknown;
}

export class Valkey {
  private client: ReturnType<typeof createClient> | null = null;
  private connected = false;
  private downSince = 0;
  private lastProbe = 0;
  private lastProbeOk = false;
  private publisher: ReturnType<typeof createClient> | null = null;

  constructor(private url: string) {}

  async start(): Promise<void> {
    await this.connectLoop();
  }

  private async ensureClient(): Promise<ReturnType<typeof createClient>> {
    if (this.client && this.connected && this.client.isReady) return this.client;
    if (!this.client) {
      this.client = createClient({ url: this.url, socket: { connectTimeout: 1000, reconnectStrategy: () => 1000 } });
      this.client.on('error', () => {
        this.connected = false;
      });
      this.client.on('ready', () => {
        this.connected = true;
      });
      this.client.on('end', () => {
        this.connected = false;
      });
    }
    if (!this.client.isOpen) {
      await this.client.connect();
    }
    this.connected = this.client.isReady;
    return this.client;
  }

  private async connectLoop(): Promise<void> {
    try {
      await this.ensureClient();
      this.connected = true;
      this.lastProbeOk = true;
      this.lastProbe = Date.now();
    } catch {
      this.connected = false;
      this.lastProbeOk = false;
      this.lastProbe = Date.now();
    }
  }

  async probe(): Promise<boolean> {
    const now = Date.now();
    if (now - this.lastProbe < 1000) return this.lastProbeOk;
    this.lastProbe = now;
    try {
      const c = await this.ensureClient();
      // Ping with a hard deadline: the shared client queues commands while it
      // reconnects, so a plain ping would hang for the whole outage.
      const pong = await Promise.race([
        c.ping(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
      ]);
      this.lastProbeOk = pong === 'PONG';
      this.connected = this.lastProbeOk;
      if (!this.lastProbeOk && this.downSince === 0) this.downSince = now;
    } catch {
      this.lastProbeOk = false;
      this.connected = false;
      if (this.downSince === 0) this.downSince = now;
    }
    return this.lastProbeOk;
  }

  isUp(): boolean {
    return this.connected && this.lastProbeOk;
  }

  /** Publish outbox rows in commit order, trimming each stream to about 2000. */
  async publish(rows: OutboxRow[]): Promise<boolean> {
    if (rows.length === 0) return true;
    try {
      const c = await this.ensureClient();
      if (!c.isReady) return false;
      for (const row of rows) {
        const added = await Promise.race([
          c.xAdd(row.stream, `${row.seq}-0`, {
            type: row.type,
            payload: JSON.stringify(row.payload),
          }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
        ]);
        if (added === null) return false;
        await c.xTrim(row.stream, 'MAXLEN', 2100);
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Acquire or renew the tick lease for a session. */
  async acquireLease(sessionId: string, instanceId: string): Promise<boolean> {
    try {
      const c = await this.ensureClient();
      if (!c.isReady) return false;
      const key = `gandyboard:session:${sessionId}:tick-lease`;
      const got = await Promise.race([
        (async () => {
          const current = await c.get(key);
          if (current === null || current === instanceId) {
            await c.set(key, instanceId, { PX: 3000 });
            return true;
          }
          return false;
        })(),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 1500)),
      ]);
      return got;
    } catch {
      return false;
    }
  }

  async releaseLease(sessionId: string, instanceId: string): Promise<void> {
    try {
      const c = await this.ensureClient();
      const key = `gandyboard:session:${sessionId}:tick-lease`;
      const current = await c.get(key);
      if (current === instanceId) await c.del(key);
    } catch {
      // ignore
    }
  }

  /** Read events after a cursor without blocking; SSE polls this at a short interval. */
  async readStream(stream: string, cursor: string, count: number): Promise<{ id: string; type: string; payload: string }[] | null> {
    try {
      const c = await this.ensureClient();
      if (!c.isReady) return null;
      const res = await Promise.race([
        c.xRead([{ key: stream, id: cursor }], { COUNT: count }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
      ]);
      if (!res) return [];
      const out: { id: string; type: string; payload: string }[] = [];
      for (const streamRes of res) {
        for (const entry of streamRes.messages) {
          out.push({
            id: entry.id,
            type: entry.message.type ?? '',
            payload: entry.message.payload ?? '',
          });
        }
      }
      return out;
    } catch {
      return null;
    }
  }

  /** Earliest seq available in the stream (as a number), or null when unreachable or empty. */
  async streamStart(stream: string): Promise<number | null> {
    try {
      const c = await this.ensureClient();
      if (!c.isReady) return null;
      const res = await Promise.race([
        c.xRange(stream, '-', '+', { COUNT: 1 }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
      ]);
      if (!res || res.length === 0) return null;
      const first = res[0];
      if (!first) return null;
      return Number(first.id.split('-')[0]);
    } catch {
      return null;
    }
  }
}

export class Gotenberg {
  private lastProbe = 0;
  private lastProbeOk = false;
  private probePromise: Promise<boolean> | null = null;

  constructor(private url: string) {}

  async probe(): Promise<boolean> {
    const now = Date.now();
    if (now - this.lastProbe < 5000) return this.lastProbeOk;
    this.lastProbe = now;
    this.probePromise = (async () => {
      try {
        const res = await fetch(`${this.url.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(2000) });
        this.lastProbeOk = res.ok;
      } catch {
        this.lastProbeOk = false;
      }
      return this.lastProbeOk;
    })();
    return this.probePromise;
  }

  isUp(): boolean {
    return this.lastProbeOk;
  }

  /** Render an HTML document to PDF bytes. Throws when the service does not answer. */
  async renderPdf(html: string): Promise<Buffer> {
    const form = new FormData();
    form.append('files', new Blob([html], { type: 'text/html' }), 'document.html');
    const res = await fetch(`${this.url.replace(/\/$/, '')}/forms/chromium/convert/html`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`gotenberg ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
}
