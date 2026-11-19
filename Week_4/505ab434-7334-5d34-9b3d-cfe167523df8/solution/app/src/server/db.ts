// PostgreSQL access: one pool, one transaction helper. A transaction carries the app clock, queued audit records,
// outbox mail and live notifications, and writes them together at commit (brief: Engineering standards).
import pg from "pg";
import { createHash } from "node:crypto";
import { config } from "./config.ts";
import { SCHEMA } from "./schema.ts";
import type { AuditAction, Role } from "../shared/domain.ts";
import type { LiveMessage } from "../shared/api.ts";

// date -> 'YYYY-MM-DD', timestamptz -> ISO with milliseconds and Z, int8 -> number.
pg.types.setTypeParser(1082, (value) => value);
pg.types.setTypeParser(1184, (value) => new Date(value).toISOString());
pg.types.setTypeParser(20, (value) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });
pool.on("error", () => undefined);

/** A SQL row; each query names the row interface it returns. */
type Row = object;

export interface AuditDraft {
  actorId: string;
  actorRole: Role | "system";
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  requestId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  outcome?: "success" | "denied";
  /** Defaults to the transaction's app-clock instant; timers pass the instant they fired at. */
  occurredAt?: string;
}

/** Who hears a live message: everyone signed in, staff roles, or named principals. */
export interface Audience {
  all?: boolean;
  roles?: readonly Role[];
  principals?: readonly string[];
}

const ZERO_HASH = "0".repeat(64);
const AUDIT_LOCK = 7_301_001;

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, inner]) => [key, sortKeys(inner)]),
    );
  }
  return value;
}

/** The exact text that is hashed for one record (brief: Audit log / Hash). */
export function canonicalRecord(record: {
  sequence: number;
  occurredAt: string;
  actorId: string;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId: string;
  requestId: string | null;
  before: unknown;
  after: unknown;
  outcome: string;
}): string {
  const keys = ["sequence", "occurredAt", "actorId", "actorRole", "action", "resourceType", "resourceId", "requestId", "before", "after", "outcome"] as const;
  return `{${keys.map((key) => `${JSON.stringify(key)}:${JSON.stringify(sortKeys(record[key]))}`).join(",")}}`;
}

export const recordHash = (previousHash: string, canonical: string): string =>
  createHash("sha256").update(`${previousHash}\n${canonical}`, "utf8").digest("hex");

export class Tx {
  readonly auditQueue: AuditDraft[] = [];
  readonly liveQueue: { message: LiveMessage; audience: Audience }[] = [];
  mailQueued = false;

  constructor(
    private readonly client: pg.PoolClient,
    /** The app clock (ISO) read when the transaction began. */
    readonly now: string,
  ) {}

  async q<T extends Row = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.client.query(sql, params)).rows as T[];
  }

  async one<T extends Row = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return (await this.q<T>(sql, params))[0];
  }

  /** Next value of a named counter, for ids such as REQ-0005 (serialised by the row lock). */
  async next(counter: string): Promise<number> {
    const row = await this.one<{ value: number }>(
      `INSERT INTO counters (name, value) VALUES ($1, 1)
       ON CONFLICT (name) DO UPDATE SET value = counters.value + 1 RETURNING value`,
      [counter],
    );
    return row!.value;
  }

  audit(draft: AuditDraft): void {
    this.auditQueue.push({ ...draft, occurredAt: draft.occurredAt ?? this.now });
  }

  mail(to: string, subject: string, body: string): Promise<unknown> {
    this.mailQueued = true;
    return this.q("INSERT INTO mail_outbox (to_address, subject, body) VALUES ($1, $2, $3)", [to, subject, body]);
  }

  live(message: LiveMessage, audience: Audience): void {
    this.liveQueue.push({ message, audience });
  }

  async flush(): Promise<void> {
    if (this.auditQueue.length > 0) {
      await this.client.query("SELECT pg_advisory_xact_lock($1)", [AUDIT_LOCK]);
      const last = (await this.client.query("SELECT sequence, record_hash FROM audit ORDER BY sequence DESC LIMIT 1")).rows[0] as
        | { sequence: number; record_hash: string }
        | undefined;
      let sequence = last?.sequence ?? 0;
      let previous = last?.record_hash ?? ZERO_HASH;
      for (const draft of this.auditQueue) {
        sequence += 1;
        const record = {
          sequence,
          occurredAt: draft.occurredAt!,
          actorId: draft.actorId,
          actorRole: draft.actorRole,
          action: draft.action,
          resourceType: draft.resourceType,
          resourceId: draft.resourceId,
          requestId: draft.requestId,
          before: draft.before,
          after: draft.after,
          outcome: draft.outcome ?? "success",
        };
        const hash = recordHash(previous, canonicalRecord(record));
        await this.client.query(
          `INSERT INTO audit (sequence, occurred_at, actor_id, actor_role, action, resource_type, resource_id, request_id,
                              before, after, outcome, previous_hash, record_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [sequence, record.occurredAt, record.actorId, record.actorRole, record.action, record.resourceType,
            record.resourceId, record.requestId, JSON.stringify(record.before), JSON.stringify(record.after),
            record.outcome, previous, hash],
        );
        previous = hash;
      }
    }
    for (const { message, audience } of this.liveQueue) {
      await this.client.query("SELECT pg_notify('live', $1)", [JSON.stringify({ message, audience })]);
    }
  }
}

type AfterCommit = () => void;
const afterMail: AfterCommit[] = [];
/** The mail worker registers here so a committed notice goes out without waiting for the next poll. */
export const onMailCommitted = (fn: AfterCommit): void => void afterMail.push(fn);

export async function readClock(client: Pick<pg.PoolClient, "query"> | pg.Pool): Promise<string> {
  const result = await client.query("SELECT now FROM app_clock WHERE id = 1");
  const row = result.rows[0] as { now: string } | undefined;
  return row?.now ?? config.appStartAt;
}

export async function transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tx = new Tx(client, await readClock(client));
    const result = await work(tx);
    await tx.flush();
    await client.query("COMMIT");
    if (tx.mailQueued) for (const fn of afterMail) fn();
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** A read-only snapshot with the app clock; no audit, mail or live traffic. */
export async function read<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return transaction(work);
}

export async function applySchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(7301002)");
    await client.query(SCHEMA);
    await client.query("SELECT pg_advisory_unlock(7301002)");
  } finally {
    client.release();
  }
}
