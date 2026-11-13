import pg from "pg";
import type { Config } from "./config.js";

/**
 * The PostgreSQL system of record. The schema is applied idempotently, and a
 * failed connection never crashes the app: the pool retries on each query.
 */
export class Db {
  private pool: pg.Pool | null = null;

  constructor(private readonly config: Config) {}

  private connect(): pg.Pool {
    if (this.pool === null) {
      const pool = new pg.Pool({
        connectionString: this.config.databaseUrl,
        max: 10,
        connectionTimeoutMillis: 3000,
        idleTimeoutMillis: 30000,
      });
      // A dead client is the pool's own business: drop the pool and retry later.
      pool.on("error", () => {
        if (this.pool === pool) this.pool = null;
      });
      this.pool = pool;
    }
    return this.pool;
  }

  /** Whether the database answered within the last outage check. */
  async healthy(): Promise<boolean> {
    try {
      await this.query("select 1");
      return true;
    } catch {
      return false;
    }
  }

  async query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params: unknown[] = []
  ): Promise<pg.QueryResult<T>> {
    const pool = this.connect();
    try {
      return await pool.query<T>(text, params as never[]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isConnectionError(message)) {
        this.pool = null;
      }
      throw err;
    }
  }

  /** Runs a callable inside one transaction. */
  async tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const pool = this.connect();
    const client = await pool.connect();
    try {
      await client.query("begin");
      const result = await fn(client);
      await client.query("commit");
      return result;
    } catch (err) {
      await client.query("rollback").catch(() => {
        if (this.pool === pool) this.pool = null;
      });
      const message = err instanceof Error ? err.message : String(err);
      if (isConnectionError(message) && this.pool === pool) this.pool = null;
      throw err;
    } finally {
      client.release();
    }
  }

  /** Idempotent schema, applied every time the app serves. */
  async applySchema(): Promise<void> {
    await this.query(`
      create table if not exists players (
        id text primary key,
        name text not null,
        name_lower text not null unique,
        avatar integer not null default 1,
        chosen boolean not null default false,
        email text,
        rating double precision not null default 1500,
        rd double precision not null default 350,
        volatility double precision not null default 0.06,
        ranked_games integer not null default 0,
        created_at timestamptz not null default now()
      );
      create table if not exists sessions (
        token text primary key,
        player_id text not null references players(id),
        created_at timestamptz not null default now()
      );
      create table if not exists link_tokens (
        token text primary key,
        email text not null,
        player_id text references players(id),
        email_player_id text references players(id),
        used boolean not null default false,
        expires_at timestamptz not null
      );
      create table if not exists matches (
        id text primary key,
        mode text not null,
        format text not null,
        status text not null,
        board integer not null default 1,
        turn integer not null default 0,
        phase text not null default 'aim',
        shot_seq integer not null default 0,
        break_attempt integer,
        queen_state text not null default 'board',
        queen_seat integer,
        scores text not null default '[0,0]',
        dues text not null default '[0,0]',
        timeouts text not null default '[0,0]',
        white_seat integer not null default 0,
        turn_deadline timestamptz,
        winner_seat integer,
        end_reason text,
        room_code text,
        rematch_offer_seat integer,
        rematch_deadline timestamptz,
        first_breaker integer,
        created_at timestamptz not null default now()
      );
      create table if not exists match_seats (
        match_id text not null references matches(id),
        seat integer not null,
        player_id text not null references players(id),
        primary key (match_id, seat)
      );
      create table if not exists boards (
        match_id text not null references matches(id),
        board_number integer not null,
        pieces text not null,
        primary key (match_id, board_number)
      );
      create table if not exists shots (
        id text primary key,
        match_id text not null references matches(id),
        shot_seq integer not null,
        seat integer not null,
        request text not null,
        result text not null,
        created_at timestamptz not null default now()
      );
      create unique index if not exists shots_match_seq on shots (match_id, shot_seq);
      create table if not exists queue_entries (
        player_id text primary key references players(id),
        mode text not null,
        near integer not null,
        band integer not null,
        waited_from timestamptz not null default now(),
        match_id text
      );
      create table if not exists rooms (
        code text primary key,
        format text not null,
        status text not null default 'open',
        host_player_id text not null references players(id),
        guest_player_id text,
        match_id text,
        rematch_match_id text,
        expires_at timestamptz not null,
        created_at timestamptz not null default now()
      );
      create table if not exists rating_changes (
        id text primary key,
        player_id text not null references players(id),
        match_id text not null,
        rating double precision not null,
        rd double precision not null,
        delta double precision not null
      );
      create table if not exists history_rows (
        id text primary key,
        player_id text not null references players(id),
        match_id text not null,
        mode text not null,
        format text not null,
        opponent text not null,
        result text not null,
        your_score integer not null,
        their_score integer not null,
        rating_delta double precision,
        end_reason text not null,
        ended_at timestamptz not null default now()
      );
      create index if not exists history_player on history_rows (player_id, ended_at desc);
      create table if not exists ledger (
        movement_id text not null,
        account text not null,
        player_id text,
        delta integer not null,
        reason text not null,
        item_id text,
        created_at timestamptz not null default now(),
        primary key (movement_id, account)
      );
      create table if not exists owned_items (
        player_id text not null references players(id),
        item_id text not null,
        primary key (player_id, item_id)
      );
      create table if not exists equipped (
        player_id text primary key references players(id),
        striker text not null,
        board text not null,
        coins text not null
      );
      create table if not exists idempotency (
        key text primary key,
        response text not null,
        created_at timestamptz not null default now()
      );
      create table if not exists chalk_days (
        player_id text not null,
        day text not null,
        kind text not null,
        primary key (player_id, day, kind)
      );
      create table if not exists local_days (
        player_id text not null,
        day text not null,
        count integer not null default 0,
        primary key (player_id, day)
      );
    `);
  }
}

function isConnectionError(message: string): boolean {
  return (
    message.includes("ECONNREFUSED") ||
    message.includes("ETIMEDOUT") ||
    message.includes("ENOTFOUND") ||
    message.includes("connection terminated") ||
    message.includes("terminating connection") ||
    message.includes("ECONNRESET")
  );
}

export function dbUnavailable(): { status: number; body: Record<string, string> } {
  return { status: 503, body: { error: "DATABASE_UNAVAILABLE" } };
}
