// A minimal pool over the wire-protocol client. All shared state (sessions, hold
// attempts, idempotency keys, rate-limit counts, pending index updates) lives in
// Postgres so every app instance behaves identically (DP-86).
import { Client, type QueryResult } from './client.js';

export interface PoolOptions {
  databaseUrl: string;
  max?: number;
}

interface Entry {
  client: Client;
}

export class Pool {
  private readonly clients: Client[] = [];
  private idle: Entry[] = [];
  private waiters: ((entry: Entry) => void)[] = [];
  private readonly max: number;

  constructor(private readonly options: PoolOptions) {
    this.max = options.max ?? 10;
  }

  async connect(): Promise<Client> {
    const free = this.idle.pop();
    if (free) return free.client;
    if (this.clients.length < this.max) {
      const client = new Client(this.options.databaseUrl);
      await client.connect();
      this.clients.push(client);
      return client;
    }
    const entry = await new Promise<Entry>((resolve) => {
      this.waiters.push(resolve);
    });
    return entry.client;
  }

  release(client: Client): void {
    const entry: Entry = { client };
    const waiter = this.waiters.shift();
    if (waiter) waiter(entry);
    else this.idle.push(entry);
  }

  async with<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const client = await this.connect();
    try {
      return await fn(client);
    } finally {
      this.release(client);
    }
  }

  async end(): Promise<void> {
    const all = [...this.clients];
    this.clients.length = 0;
    this.idle = [];
    await Promise.all(all.map((c) => c.end().catch(() => undefined)));
  }
}

export type { QueryResult };
export { Client } from './client.js';
