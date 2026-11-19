import { EventEmitter } from 'node:events';
import type { Pool, PoolClient } from 'pg';
import { applySchema, seedData } from './db';

/** Version counters for live-update channels, backed by the streams table. */
export class Streams {
  constructor(private readonly db: Pool) {}

  async bump(channels: string[]): Promise<void> {
    if (channels.length === 0) return;
    const unique = [...new Set(channels)];
    await this.db.query(
      `INSERT INTO streams (channel, version, updated_at) VALUES ${unique
        .map((_, i) => `($${i + 1}, 1, now())`)
        .join(', ')}
       ON CONFLICT (channel) DO UPDATE SET version = streams.version + 1, updated_at = now()`,
      unique,
    );
  }

  async versions(): Promise<Map<string, number>> {
    const result = await this.db.query<{ channel: string; version: string }>('SELECT channel, version FROM streams');
    return new Map(result.rows.map((row) => [row.channel, Number(row.version)]));
  }
}

export const eventBus = new EventEmitter();
eventBus.setMaxListeners(200);

export async function ensureSchema(db: Pool): Promise<void> {
  await applySchema(db);
  await seedData(db);
}

export async function withTransaction<T>(client: PoolClient, work: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    const result = await work();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection already failed; nothing to roll back */
    }
    throw error;
  }
}
