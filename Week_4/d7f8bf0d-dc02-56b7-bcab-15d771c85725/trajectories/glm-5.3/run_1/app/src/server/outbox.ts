import type { Db } from './db';
import type { Valkey } from './services';

/**
 * Publishes outbox rows to Valkey streams in commit order. A batch is claimed
 * with FOR UPDATE SKIP LOCKED, published to Valkey, then marked published in
 * the same transaction; when Valkey is down the claim rolls back and rows wait
 * in the outbox.
 */
export class OutboxPublisher {
  private running = false;

  constructor(private db: Db, private valkey: Valkey, private instanceId: string) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = async () => {
      while (this.running) {
        const published = await this.publishBatch();
        const delay = published > 0 ? 10 : published === 0 ? 100 : 500;
        await new Promise((r) => setTimeout(r, delay));
      }
    };
    void loop();
  }

  stop(): void {
    this.running = false;
  }

  /** Publishes one batch; returns the count, or -1 when Valkey is down. */
  private async publishBatch(): Promise<number> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const claimed = await client.query(
        `SELECT stream, seq, type, payload FROM event_outbox
         WHERE published_at IS NULL
         ORDER BY stream, seq
         LIMIT 100
         FOR UPDATE SKIP LOCKED`,
      );
      if (claimed.rows.length === 0) {
        await client.query('COMMIT');
        return 0;
      }
      const rows = claimed.rows as { stream: string; seq: string; type: string; payload: unknown }[];
      const ok = await this.valkey.publish(
        rows.map((r) => ({ stream: r.stream, seq: Number(r.seq), type: r.type, payload: r.payload })),
      );
      if (!ok) {
        await client.query('ROLLBACK');
        return -1;
      }
      for (const r of rows) {
        await client.query(
          `UPDATE event_outbox SET published_at = now() WHERE stream = $1 AND seq = $2`,
          [r.stream, r.seq],
        );
      }
      await client.query('COMMIT');
      return rows.length;
    } catch {
      await client.query('ROLLBACK').catch(() => {});
      return -1;
    } finally {
      client.release();
    }
  }
}
