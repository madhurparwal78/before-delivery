// The one decision on Valkey: publish live updates, keep presence keys, answer PING.
import { createClient } from 'redis';
import type { LiveMessage } from './live.js';

const CHANNEL_PREFIX = 'layout:';
const CALL_TIMEOUT_MS = 800;

export class Valkey {
  private client: ReturnType<typeof createClient> | null = null;
  private connecting: Promise<void> | null = null;
  private retryTimer: NodeJS.Timeout | null = null;

  constructor(private url: string) {}

  get answered(): boolean {
    return this.client !== null && this.client.isReady;
  }

  async ping(): Promise<boolean> {
    try {
      if (!this.client || !this.client.isReady) return false;
      await withTimeout(this.client.ping(), CALL_TIMEOUT_MS);
      return true;
    } catch {
      return false;
    }
  }

  private async ensure(): Promise<void> {
    if (this.answered) return;
    if (!this.client) {
      const client = createClient({ url: this.url });
      client.on('error', () => {});
      this.client = client;
      this.connecting = client.connect().then(() => undefined, () => {
        this.client = null;
        throw new Error('valkey offline');
      });
    }
    try {
      await this.connecting;
    } catch {
      throw new Error('valkey offline');
    }
    if (!this.answered) throw new Error('valkey offline');
  }

  async setPresence(layoutId: string, username: string, seconds: number): Promise<void> {
    try {
      await this.ensure();
      await withTimeout(this.client!.set(`presence:${layoutId}:${username}`, '1', { EX: seconds }), CALL_TIMEOUT_MS);
    } catch {}
  }

  async delPresence(layoutId: string, username: string): Promise<void> {
    try {
      await this.ensure();
      await withTimeout(this.client!.del(`presence:${layoutId}:${username}`), CALL_TIMEOUT_MS);
    } catch {}
  }

  async listPresence(layoutId: string): Promise<string[]> {
    try {
      await this.ensure();
      const keys = await withTimeout(this.client!.keys(`presence:${layoutId}:*`), CALL_TIMEOUT_MS);
      return (keys ?? []).map((k) => k.split(':')[2] ?? '').filter(Boolean);
    } catch {
      return [];
    }
  }

  async publish(layoutId: string, message: LiveMessage): Promise<void> {
    try {
      await this.ensure();
      await withTimeout(this.client!.publish(CHANNEL_PREFIX + layoutId, JSON.stringify(message)), CALL_TIMEOUT_MS);
    } catch {}
  }

  // Subscriptions get their own connection so the main one stays free for publish.
  async subscribe(layoutId: string, onMessage: (m: LiveMessage) => void): Promise<() => void> {
    try {
      await this.ensure();
    } catch {
      return () => {};
    }
    const sub = this.client!.duplicate();
    sub.on('error', () => {});
    try {
      await sub.connect();
    } catch {
      return () => {};
    }
    const channel = CHANNEL_PREFIX + layoutId;
    await sub.subscribe(channel, (text) => {
      try { onMessage(JSON.parse(String(text)) as LiveMessage); } catch {}
    });
    return () => { void sub.unsubscribe(channel).then(() => sub.quit(), () => {}); };
  }

  startRetry(): void {
    if (this.retryTimer) return;
    this.retryTimer = setInterval(() => { void this.ensure().catch(() => {}); }, 3000);
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}
