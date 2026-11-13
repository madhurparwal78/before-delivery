// Postgres access: a pool, transactions that carry live messages and after-commit hooks, and the idempotent schema.
import pg from "pg";
import { config } from "./config.ts";
import { now } from "./clock.ts";
import { SCHEMA_SQL } from "./schema.ts";

pg.types.setTypeParser(20, (value: string) => Number(value));

type Row = object;
export type Param = string | number | boolean | null | readonly string[] | readonly number[] | Buffer | object;

export interface Say {
  readonly text: string;
  readonly to?: string;
  readonly pages?: readonly string[];
}

export interface LiveEmit {
  readonly projectId: number;
  readonly seq: number;
  readonly type: string;
  readonly data: Record<string, unknown>;
  readonly restrictUser: number | null;
  readonly restrictIssue: number | null;
}

interface EmitOptions {
  readonly say?: readonly Say[];
  readonly restrictUser?: number;
  readonly restrictIssue?: number;
}

type Broadcaster = (messages: readonly LiveEmit[]) => void;
let broadcaster: Broadcaster = () => undefined;

export function setBroadcaster(fn: Broadcaster): void {
  broadcaster = fn;
}

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20, idleTimeoutMillis: 30000 });
pool.on("error", () => undefined);

async function run<T extends Row>(client: pg.Pool | pg.PoolClient, sql: string, params: readonly Param[] = []): Promise<T[]> {
  const result = await client.query(sql, [...params]);
  // The one boundary where untyped driver rows take the caller's declared row type.
  return result.rows;
}

export class Reader {
  private readonly client: pg.Pool | pg.PoolClient;

  constructor(client: pg.Pool | pg.PoolClient) {
    this.client = client;
  }

  q<T extends Row = Row>(sql: string, params?: readonly Param[]): Promise<T[]> {
    return run<T>(this.client, sql, params);
  }

  async one<T extends Row = Row>(sql: string, params?: readonly Param[]): Promise<T> {
    const rows = await this.q<T>(sql, params);
    const first = rows[0];
    if (first === undefined) throw new Error(`Expected one row from: ${sql}`);
    return first;
  }

  async maybe<T extends Row = Row>(sql: string, params?: readonly Param[]): Promise<T | undefined> {
    return (await this.q<T>(sql, params))[0];
  }
}

export class Tx extends Reader {
  readonly messages: LiveEmit[] = [];
  private readonly hooks: Array<() => void | Promise<void>> = [];

  constructor(client: pg.PoolClient) {
    super(client);
  }

  // Every write of a project starts here: it serialises the project's writers and keeps `seq` gap-free.
  async lockProject(projectId: number): Promise<void> {
    await this.q("SELECT 1 FROM projects WHERE id = $1 FOR UPDATE", [projectId]);
  }

  async currentSeq(projectId: number): Promise<number> {
    return (await this.one<{ seq: number }>("SELECT seq FROM projects WHERE id = $1", [projectId])).seq;
  }

  // One live message per state change. Returns its per-project sequence number.
  async emit(projectId: number, type: string, data: Record<string, unknown>, options: EmitOptions = {}): Promise<number> {
    const { seq } = await this.one<{ seq: number }>("UPDATE projects SET seq = seq + 1 WHERE id = $1 RETURNING seq", [projectId]);
    const payload = options.say === undefined ? data : { ...data, say: options.say };
    const restrictUser = options.restrictUser ?? null;
    const restrictIssue = options.restrictIssue ?? null;
    await this.q(
      "INSERT INTO live_messages (project_id, seq, type, data, restrict_user, restrict_issue, at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [projectId, seq, type, payload, restrictUser, restrictIssue, now()],
    );
    this.messages.push({ projectId, seq, type, data: payload, restrictUser, restrictIssue });
    return seq;
  }

  afterCommit(hook: () => void | Promise<void>): void {
    this.hooks.push(hook);
  }

  async runHooks(): Promise<void> {
    if (this.messages.length > 0) broadcaster(this.messages);
    for (const hook of this.hooks) {
      try {
        await hook();
      } catch (error) {
        console.error("after-commit hook failed", error);
      }
    }
  }
}

// What reads take: the pool or a transaction.
export type Queryable = Reader;

export const db: Queryable = new Reader(pool);

export async function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const tx = new Tx(client);
  try {
    await client.query("BEGIN");
    const result = await fn(tx);
    await client.query("COMMIT");
    client.release();
    await tx.runHooks();
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    throw error;
  }
}

const SCHEMA_LOCK = 727001;

export async function applySchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK]);
    for (const sql of SCHEMA_SQL) await client.query(sql);
    await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK]);
  } finally {
    client.release();
  }
}

export async function withAdvisoryLock<T>(key: number, fn: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [key]);
    try {
      return await fn();
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [key]);
    }
  } finally {
    client.release();
  }
}

// Resolves once the demo instance is seeded or known to need no seed, so a health check can hold until sign-in works.
let demoSettled!: () => void;
const demoSettledPromise = new Promise<void>((resolve) => {
  demoSettled = resolve;
});

export function markDemoSettled(): void {
  demoSettled();
}

export async function waitForDemo(ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([demoSettledPromise, new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)))]);
  clearTimeout(timer);
}

export async function postgresReachable(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
