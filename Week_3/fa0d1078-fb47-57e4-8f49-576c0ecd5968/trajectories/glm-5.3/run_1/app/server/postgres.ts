import { Client } from 'pg';

// Postgres is the source of truth for players, sessions, tokens, games with
// their start boards and move logs, finished games, daily results and duel
// outcomes. The schema is applied idempotently every time the server starts.

export interface PostgresService {
  query<T extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  healthy(): Promise<boolean>;
  close(): Promise<void>;
}

export interface Tx {
  query<T extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS players (
    player_id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    email_lower TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    display_lower TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    player_id TEXT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS tokens (
    token TEXT PRIMARY KEY,
    player_id TEXT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    player_id TEXT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
    mode TEXT NOT NULL,
    level TEXT NOT NULL,
    puzzle_id TEXT NOT NULL,
    date TEXT,
    status TEXT NOT NULL,
    puzzle TEXT NOT NULL,
    solution TEXT NOT NULL,
    start_entries TEXT NOT NULL,
    start_notes TEXT NOT NULL,
    start_mistakes INT NOT NULL,
    start_hints INT NOT NULL,
    start_elapsed_ms BIGINT NOT NULL,
    second_chance_used BOOLEAN NOT NULL DEFAULT FALSE,
    move_log JSONB NOT NULL DEFAULT '[]'::jsonb,
    elapsed_ms BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS games_daily_one ON games (player_id, date) WHERE mode = 'daily'`,
  `CREATE TABLE IF NOT EXISTS finished_games (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    player_id TEXT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
    level TEXT NOT NULL,
    mode TEXT NOT NULL,
    result TEXT NOT NULL,
    seconds INT NOT NULL,
    mistakes INT NOT NULL,
    hints INT NOT NULL,
    score INT NOT NULL,
    finished_at TIMESTAMPTZ NOT NULL,
    daily_date TEXT,
    daily_state TEXT,
    finished_seq BIGSERIAL NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS duel_outcomes (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    player_id TEXT NOT NULL REFERENCES players(player_id) ON DELETE CASCADE,
    opponent_id TEXT REFERENCES players(player_id) ON DELETE SET NULL,
    outcome TEXT NOT NULL,
    seconds INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
];

export interface PostgresOptions {
  databaseUrl: string;
  onStateChange?(down: boolean): void;
}

export function createPostgres(options: PostgresOptions): PostgresService {
  let client: Client | null = null;
  let connecting: Promise<Client> | null = null;

  function tryConnect(): Promise<Client> {
    if (client) return Promise.resolve(client);
    if (connecting) return connecting;
    connecting = new Client({ connectionString: options.databaseUrl }).connect().then((c) => {
      client = c;
      connecting = null;
      options.onStateChange?.(false);
      return c;
    }).catch((err) => {
      connecting = null;
      options.onStateChange?.(true);
      throw err;
    });
    return connecting;
  }

  // The server starts and listens even when Postgres is unreachable, retrying
  // every few seconds.
  async function ensure(): Promise<Client> {
    for (;;) {
      try {
        return await tryConnect();
      } catch {
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  async function ready(): Promise<Client> {
    if (client) return client;
    return ensure();
  }

  // The health check answers promptly even while Postgres is unreachable;
  // the boot retry loop keeps running in the background.
  async function readyForHealth(timeoutMs: number): Promise<Client | null> {
    if (client) return client;
    const attempt = ensure();
    return new Promise<Client | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      attempt.then((c) => {
        clearTimeout(timer);
        resolve(c);
      }, () => {
        clearTimeout(timer);
        resolve(null);
      });
    });
  }

  return {
    async query<T extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      const c = await ready();
      const res = await c.query(sql, params);
      return res.rows as T[];
    },
    async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      const c = await ready();
      await c.query('BEGIN');
      try {
        const out = await fn({
          async query<U extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<U[]> {
            const res = await c.query(sql, params);
            return res.rows as U[];
          },
        });
        await c.query('COMMIT');
        return out;
      } catch (err) {
        await c.query('ROLLBACK');
        throw err;
      }
    },
    async healthy(): Promise<boolean> {
      try {
        const c = await readyForHealth(2000);
        if (c === null) return false;
        await c.query('SELECT 1');
        return true;
      } catch {
        return false;
      }
    },
    async close(): Promise<void> {
      if (client) await client.end();
      client = null;
    },
  };
}

// The schema is applied idempotently at boot, once the database is reachable.
export async function applySchema(db: PostgresService): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    await db.query(statement);
  }
}
