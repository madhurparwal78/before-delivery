// The store: one place that talks to Postgres for claims and shared state.
// Shared state (sessions, locks, rate windows, idempotency records, the
// notice queue) lives here and nowhere else.
import { Pool, type PoolClient } from 'pg';
import type { DeskConfig } from './config.js';

export class RecordsUnavailable extends Error {
  constructor() { super('database_unavailable'); this.name = 'RecordsUnavailable'; }
}

export interface ClaimRow {
  reference: string;
  state: string;
  createdAt: Date;
  confirmedAt: Date | null;
  erasedAt: Date | null;
  ownerName: string | null;
  ownerEmail: string | null;
  ownerPostcode: string | null;
  postcodeArea: string | null;
  purchaseDate: string | null;
  clubMember: boolean;
  modelSlug: string | null;
  bookletNumber: number | null;
  quantity: number | null;
  description: string | null;
  language: string;
  confirmToken: string | null;
  confirmBy: Date | null;
  confirmUsedAt: Date | null;
  dispatchedAt: Date | null;
  closedAt: Date | null;
}

export interface RulingRow {
  reference: string;
  inside: boolean;
  editionCode: string;
  coverEndsAt: Date;
  coverEndsOn: string;
  termMonths: number | null;
  decidedAt: Date;
}

export interface QuoteRow {
  reference: string;
  revision: number;
  status: string;
  source: string;
  partLineMinor: number;
  carriageMinor: number;
  totalMinor: number;
  band: string;
  carriageValidUntil: Date | null;
  promiseKind: string;
  promiseDate: string;
  killbillInvoiceId: string | null;
  killbillInvoiceNumber: string | null;
  binReturned: boolean;
  quotedAt: Date;
}

export interface ModelRow {
  slug: string;
  name: string;
  axis: string | null;
}

export interface PartRow {
  modelSlug: string;
  bookletNumber: number;
  partNumber: string;
  name: string;
  priceMinor: number;
  weightG: number;
  longestSideMm: number;
  binCount: number;
  status: string;
}

export interface EditionRecord {
  code: string;
  title: string;
  starts_on: string;
  standard_months: number;
  club_months: number;
  owner_contribution_percent: number;
}

export interface NoticeRow {
  id: number;
  reference: string;
  kind: string;
  payload: string;
  created_at: Date;
}

const NULLABLE_OVERRIDES = { purchase_date: true };
void NULLABLE_OVERRIDES;

function snakeToCamel(name: string): string {
  return name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

const DATE_COLUMNS = new Set(['purchase_date', 'cover_ends_on', 'promise_date', 'starts_on']);

function camelizeRow<T extends object>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const key = snakeToCamel(k);
    if (DATE_COLUMNS.has(k) && v instanceof Date) {
      out[key] = (v as Date).toISOString().slice(0, 10);
    } else {
      out[key] = v;
    }
  }
  return out;
}

export class Store {
  constructor(private readonly pool: Pool, private readonly config: DeskConfig) {}

  /** Runs fn against Postgres; maps connection failure to RecordsUnavailable. */
  async withRecords<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    let client: PoolClient;
    try {
      client = await this.pool.connect();
    } catch {
      throw new RecordsUnavailable();
    }
    try {
      return await fn(client);
    } catch (e) {
      if (e instanceof Error && e.name === 'RecordsUnavailable') throw e;
      const msg = String(e);
      if (msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT') || msg.includes('ENOTFOUND') || msg.includes('ECONNRESET') || msg.includes('connection terminated')) {
        throw new RecordsUnavailable();
      }
      throw e;
    } finally {
      client.release();
    }
  }

  async query<T extends import('pg').QueryResultRow>(sql: string, params: readonly unknown[]): Promise<import('pg').QueryResult<T>> {
    return this.withRecords((client) => client.query<T>(sql, [...params]));
  }

  async ping(): Promise<boolean> {
    try {
      await this.query('SELECT 1', []);
      return true;
    } catch {
      return false;
    }
  }

  async getClaim(reference: string): Promise<ClaimRow | null> {
    const res = await this.query<Record<string, unknown>>(
      'SELECT * FROM claims WHERE reference = $1', [reference],
    );
    if (!res.rows[0]) return null;
    return camelizeRow(res.rows[0]) as unknown as ClaimRow;
  }

  async getRuling(reference: string): Promise<RulingRow | null> {
    const res = await this.query<Record<string, unknown>>(
      'SELECT * FROM rulings WHERE reference = $1', [reference],
    );
    if (!res.rows[0]) return null;
    return camelizeRow(res.rows[0]) as unknown as RulingRow;
  }

  async listQuotes(reference: string): Promise<QuoteRow[]> {
    const res = await this.query<Record<string, unknown>>(
      'SELECT * FROM quote_revisions WHERE reference = $1 ORDER BY revision DESC', [reference],
    );
    return res.rows.map((r) => camelizeRow(r) as unknown as QuoteRow);
  }

  async getCurrentQuote(reference: string): Promise<QuoteRow | null> {
    const res = await this.query<Record<string, unknown>>(
      'SELECT * FROM quote_revisions WHERE reference = $1 AND status = $2', [reference, 'current'],
    );
    if (!res.rows[0]) return null;
    return camelizeRow(res.rows[0]) as unknown as QuoteRow;
  }

  async getPayment(reference: string): Promise<{ reference: string; paidMinor: number; killbillPaymentId: string | null; paidAt: Date } | null> {
    const res = await this.query<Record<string, unknown>>(
      'SELECT * FROM payments WHERE reference = $1', [reference],
    );
    if (!res.rows[0]) return null;
    return camelizeRow(res.rows[0]) as unknown as { reference: string; paidMinor: number; killbillPaymentId: string | null; paidAt: Date };
  }

  async getDecline(reference: string): Promise<{ reference: string; reason: string; chargedMinor: number; refundedMinor: number; declinedAt: Date } | null> {
    const res = await this.query<Record<string, unknown>>(
      'SELECT * FROM declines WHERE reference = $1', [reference],
    );
    if (!res.rows[0]) return null;
    return camelizeRow(res.rows[0]) as unknown as { reference: string; reason: string; chargedMinor: number; refundedMinor: number; declinedAt: Date };
  }

  async getHistory(reference: string): Promise<Array<{ state: string; at: Date }>> {
    const res = await this.query<{ state: string; at: Date }>(
      'SELECT state, at FROM claim_history WHERE reference = $1 ORDER BY id ASC', [reference],
    );
    return res.rows.map((r) => ({ state: r.state, at: r.at }));
  }

  async listPhotos(reference: string): Promise<Array<{ index: number; content_type: string; bytes: number }>> {
    const res = await this.query<{ index: number; content_type: string; bytes: number }>(
      'SELECT index, content_type, bytes FROM claim_photos WHERE reference = $1 ORDER BY index ASC', [reference],
    );
    return res.rows;
  }

  async getShareToken(token: string): Promise<{ token: string; reference: string; state: string; endedAt: Date | null } | null> {
    const res = await this.query<Record<string, unknown>>(
      'SELECT * FROM share_tokens WHERE token = $1', [token],
    );
    if (!res.rows[0]) return null;
    return camelizeRow(res.rows[0]) as unknown as { token: string; reference: string; state: string; endedAt: Date | null };
  }

  async getActiveShareToken(reference: string): Promise<{ token: string; reference: string; state: string; endedAt: Date | null } | null> {
    const res = await this.query<Record<string, unknown>>(
      "SELECT * FROM share_tokens WHERE reference = $1 AND state = 'active' LIMIT 1", [reference],
    );
    if (!res.rows[0]) return null;
    return camelizeRow(res.rows[0]) as unknown as { token: string; reference: string; state: string; endedAt: Date | null };
  }

  async getShareTokenForRef(reference: string): Promise<{ token: string; reference: string; state: string; endedAt: Date | null } | null> {
    const res = await this.query<Record<string, unknown>>(
      'SELECT * FROM share_tokens WHERE reference = $1 ORDER BY (state = $2) DESC, ended_at DESC NULLS LAST LIMIT 1',
      [reference, 'active'],
    );
    if (!res.rows[0]) return null;
    return camelizeRow(res.rows[0]) as unknown as { token: string; reference: string; state: string; endedAt: Date | null };
  }

  async listShareTokens(reference: string): Promise<Array<{ token: string; reference: string; state: string; endedAt: Date | null }>> {
    const res = await this.query<Record<string, unknown>>(
      'SELECT * FROM share_tokens WHERE reference = $1', [reference],
    );
    return res.rows.map((r) => camelizeRow(r) as unknown as { token: string; reference: string; state: string; endedAt: Date | null });
  }

  async listModels(): Promise<ModelRow[]> {
    const res = await this.query<ModelRow>(
      'SELECT slug, name, axis FROM models ORDER BY display_order, slug', [],
    );
    return res.rows;
  }

  async getModel(slug: string): Promise<ModelRow | null> {
    const res = await this.query<ModelRow>('SELECT slug, name, axis FROM models WHERE slug = $1', [slug]);
    return res.rows[0] ?? null;
  }

  async listRetiredNames(): Promise<Array<{ slug: string; name: string }>> {
    const res = await this.query<{ slug: string; name: string }>('SELECT slug, name FROM model_retired_names', []);
    return res.rows;
  }

  async listParts(modelSlug: string): Promise<PartRow[]> {
    const res = await this.query<Record<string, unknown>>(
      'SELECT * FROM parts WHERE model_slug = $1 ORDER BY booklet_number ASC', [modelSlug],
    );
    return res.rows.map((r) => camelizeRow(r) as unknown as PartRow);
  }

  async getPart(modelSlug: string, bookletNumber: number): Promise<PartRow | null> {
    const res = await this.query<Record<string, unknown>>(
      'SELECT * FROM parts WHERE model_slug = $1 AND booklet_number = $2', [modelSlug, bookletNumber],
    );
    if (!res.rows[0]) return null;
    return camelizeRow(res.rows[0]) as unknown as PartRow;
  }

  async listEditions(): Promise<EditionRecord[]> {
    const res = await this.query<EditionRecord>(
      'SELECT code, title, starts_on::text AS starts_on, standard_months, club_months, owner_contribution_percent FROM editions ORDER BY starts_on ASC',
      [],
    );
    return res.rows;
  }

  async listBankHolidays(): Promise<Set<string>> {
    const res = await this.query<{ date: string }>('SELECT date::text AS date FROM bank_holidays', []);
    return new Set(res.rows.map((r) => r.date));
  }

  async getClubJoinDate(email: string): Promise<string | null> {
    const res = await this.query<{ joined_on: string }>(
      'SELECT joined_on::text AS joined_on FROM club_roster WHERE lower(email) = lower($1)', [email],
    );
    return res.rows[0]?.joined_on ?? null;
  }

  async getOperator(email: string): Promise<{ email: string; password_hash: string } | null> {
    const res = await this.query<{ email: string; password_hash: string }>(
      'SELECT email, password_hash FROM operator_account WHERE lower(email) = lower($1)', [email],
    );
    return res.rows[0] ?? null;
  }

  async pendingNotices(reference: string): Promise<number> {
    const res = await this.query<{ c: string }>(
      'SELECT count(*)::text AS c FROM notice_queue WHERE reference = $1', [reference],
    );
    return Number(res.rows[0]?.c ?? 0);
  }

  async stats(): Promise<{ decided_claims: number; decided_inside: number; decided_outside: number }> {
    const res = await this.query<{ decided_claims: number; decided_inside: number; decided_outside: number }>(
      'SELECT decided_claims, decided_inside, decided_outside FROM decided_counts WHERE id = 1',
      [],
    );
    return res.rows[0] ?? { decided_claims: 0, decided_inside: 0, decided_outside: 0 };
  }
}
