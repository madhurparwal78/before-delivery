import type { PoolClient } from "pg";
import { pool, type Row } from "./pool";
import { dispatchNew } from "../services/liveHub";
import { sendDueMail } from "../services/outbox";
import { flushSearchSync, type SyncKey } from "../services/searchSync";
import type { IndexName } from "../services/search";

type LiveEmit = { type: string; audience: string[]; exclude?: string; data: Record<string, unknown> };

/**
 * One committed change. Live events, outbox rows and search-sync entries are written in the same
 * transaction as the change that causes them; Meilisearch is applied after the commit.
 */
export class Unit {
  private readonly events: LiveEmit[] = [];
  readonly searchKeys: SyncKey[] = [];
  mailQueued = false;

  constructor(private readonly client: PoolClient) {}

  async query<T extends Row>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    return this.client.query<T>(sql, params);
  }

  async rows<T extends Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.client.query<T>(sql, params)).rows;
  }

  async first<T extends Row>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return (await this.rows<T>(sql, params))[0];
  }

  async now(): Promise<Date> {
    const row = await this.first<{ now: Date }>("SELECT app_now() AS now");
    return row ? row.now : new Date();
  }

  emit(event: LiveEmit): void {
    this.events.push(event);
  }

  async mail(to: string, subject: string, body: string): Promise<void> {
    await this.client.query(
      "INSERT INTO outbox (to_address, subject, body, created_at, next_attempt_at) VALUES ($1, $2, $3, app_now(), app_now())",
      [to, subject, body],
    );
    this.mailQueued = true;
  }

  async syncSearch(index: IndexName, id: string): Promise<void> {
    await this.client.query(
      `INSERT INTO search_sync (index_name, doc_id, next_attempt_at) VALUES ($1, $2, app_now())
       ON CONFLICT (index_name, doc_id) DO UPDATE SET seq = nextval('search_sync_seq'), next_attempt_at = app_now()`,
      [index, id],
    );
    this.searchKeys.push({ index, id });
  }

  async audit(action: string, subjectId: string, actorId: string | null, detail: Record<string, unknown>): Promise<void> {
    await this.client.query("INSERT INTO audit (at, actor_id, action, subject_id, detail) VALUES (app_now(), $1, $2, $3, $4)", [
      actorId,
      action,
      subjectId,
      JSON.stringify(detail),
    ]);
  }

  /** Allocates the next live event ids last in the transaction, so ids commit in order. */
  async flushEvents(): Promise<void> {
    if (this.events.length === 0) return;
    const counter = await this.client.query<{ last: number }>(
      "UPDATE live_counter SET last = last + $1 WHERE id = 1 RETURNING last",
      [this.events.length],
    );
    const last = counter.rows[0]?.last ?? 0;
    let id = last - this.events.length;
    for (const event of this.events) {
      id += 1;
      await this.client.query(
        "INSERT INTO live_events (id, type, audience, exclude_user, data) VALUES ($1, $2, $3, $4, $5)",
        [id, event.type, event.audience, event.exclude ?? null, JSON.stringify(event.data)],
      );
    }
    await this.client.query("SELECT pg_notify('live', $1)", [String(last)]);
  }
}

export async function inUnit<T>(work: (unit: Unit) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const unit = new Unit(client);
  let result: T;
  try {
    await client.query("BEGIN");
    result = await work(unit);
    await unit.flushEvents();
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  void dispatchNew();
  if (unit.mailQueued) void sendDueMail().catch(() => undefined);
  await flushSearchSync(unit.searchKeys);
  return result;
}
