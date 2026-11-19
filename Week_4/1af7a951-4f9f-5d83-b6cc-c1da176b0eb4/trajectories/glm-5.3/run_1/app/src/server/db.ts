import { Pool, type PoolClient, type QueryResultRow } from 'pg';

export interface CohortRow {
  id: string;
  coach_id: string;
  name: string;
  starts_on: string;
  price_cents: number;
  seats: number;
  published: boolean;
  closed_by_coach: boolean;
}

export interface CoachRow {
  id: string;
  name: string;
  email: string;
  time_zone: string;
  access_code: string;
}

export interface EnrolmentRow {
  id: string;
  cohort_id: string;
  name: string;
  email: string;
  status: 'pending_payment' | 'active' | 'refunded';
  price_cents: number;
  home_tz: string;
  bedtime: string;
  first_night: string | null;
  receipt_status: 'none' | 'pending' | 'sent';
  access_code: string;
  paid_via_killbill: boolean;
}

export interface EntryRow {
  id: string;
  enrollment_id: string;
  cohort_id: string;
  night_key: string;
  title: string;
  text: string;
  dreams_recalled: number;
  lucid: boolean;
  wbtb: boolean;
  technique: string;
  technique_minutes: number;
  late_recall: boolean;
  shared: boolean;
  created_at: string;
  body_hash: string;
}

export interface SignRow {
  id: string;
  entry_id: string;
  enrollment_id: string;
  start_offset: number;
  end_offset: number;
  phrase: string;
  category: string;
  night_key: string;
  created_at: string;
}

export class Db {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 20,
      idleTimeoutMillis: 30_000,
    });
  }

  async query<T extends QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    const result = await this.pool.query<T>(sql, params as never[]);
    return result.rows;
  }

  async exec(sql: string, params: readonly unknown[] = []): Promise<number> {
    const result = await this.pool.query(sql, params as never[]);
    return result.rowCount ?? 0;
  }

  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const value = await fn(client);
      await client.query('COMMIT');
      return value;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async transactionRetry<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.transaction(fn);
      } catch (err) {
        if (isRetryable(err) && attempt < 4) continue;
        throw err;
      }
    }
  }

  close(): void {
    void this.pool.end();
  }
}

function isRetryable(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  return code === '40001' || code === '40P01';
}
