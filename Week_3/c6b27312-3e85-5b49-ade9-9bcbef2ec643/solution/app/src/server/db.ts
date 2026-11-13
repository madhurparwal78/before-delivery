// PostgreSQL: a pool, a connect loop that survives the database being down, and transactions.
import pg, { type QueryResultRow } from "pg";
import { config } from "./config";
import { SCHEMA, SCHEMA_LOCK } from "./schema";

const { Client, Pool, types } = pg;

types.setTypeParser(20, (text) => Number(text));

const pool = new Pool({ connectionString: config.databaseUrl, max: 20 });
pool.on("error", (error) => console.error("postgres pool:", error.message));

interface Executor {
  query<R extends QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }>;
}

export class Queries {
  constructor(protected readonly executor: Executor) {}

  async rows<R extends QueryResultRow>(text: string, values?: unknown[]): Promise<R[]> {
    return (await this.executor.query<R>(text, values)).rows;
  }

  async row<R extends QueryResultRow>(text: string, values?: unknown[]): Promise<R | undefined> {
    return (await this.rows<R>(text, values))[0];
  }

  /** The only row a query must return. */
  async one<R extends QueryResultRow>(text: string, values?: unknown[]): Promise<R> {
    const row = await this.row<R>(text, values);
    if (row === undefined) throw new Error(`expected a row from: ${text}`);
    return row;
  }

  /** Runs a statement and returns how many rows it touched. */
  async run(text: string, values?: unknown[]): Promise<number> {
    return (await this.executor.query(text, values)).rowCount ?? 0;
  }
}

export class Tx extends Queries {
  private readonly after: (() => void)[] = [];

  /** Registers work to run once this transaction has committed. */
  onCommit(callback: () => void): void {
    this.after.push(callback);
  }

  flush(): void {
    for (const callback of this.after) callback();
  }
}

export const db = new Queries(pool);

export async function transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const tx = new Tx(client);
  try {
    await client.query("BEGIN");
    const result = await work(tx);
    await client.query("COMMIT");
    tx.flush();
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export const database = { ready: false };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Best effort: the application role may not be allowed to create databases. */
async function createDatabaseIfMissing(): Promise<void> {
  const url = new URL(config.databaseUrl);
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!/^\w+$/.test(name)) return;
  url.pathname = "/postgres";
  const admin = new Client({ connectionString: url.toString() });
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`);
  } catch {
    // The role lacks the privilege or the server is still down; the connect loop reports it.
  } finally {
    await admin.end().catch(() => undefined);
  }
}

async function applySchema(): Promise<void> {
  await transaction(async (tx) => {
    await tx.run("SELECT pg_advisory_xact_lock($1)", [SCHEMA_LOCK]);
    await tx.run(SCHEMA);
  });
}

/** Retries every 2 seconds until the database accepts the schema. */
export async function connectDatabase(): Promise<void> {
  for (;;) {
    try {
      await applySchema();
      database.ready = true;
      return;
    } catch (error) {
      if ((error as { code?: string }).code === "3D000") await createDatabaseIfMissing();
      console.error("postgres unavailable:", (error as Error).message);
      await sleep(2000);
    }
  }
}

/** Runs `work` while this process holds a session-level advisory lock, so that app copies take turns. */
export async function withAdvisoryLock<T>(id: number, work: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [id]);
    return await work();
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [id]).catch(() => undefined);
    client.release();
  }
}
