import pg from "pg";
import { AI_DRIVERS, CARS, LAYOUTS, STAGE_PRICES } from "../shared/model.js";
import { EVENTS } from "./championship.js";
import { COUNTER_ACCOUNTS } from "./ledger.js";

type Row = Record<string, unknown>;

// One open transaction on one connection.
export class Transaction {
  constructor(private readonly client: pg.PoolClient) {}

  async query<T extends Row>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    return (await this.client.query<T>(sql, params as unknown[])).rows;
  }

  // The per-player serialisation point: every change to one player's balance, stages or
  // championship standing holds that player's row lock until its commit.
  async lockPlayer(playerId: string): Promise<void> {
    await this.client.query("SELECT id FROM players WHERE id = $1 FOR UPDATE", [playerId]);
  }
}

export class Database {
  constructor(readonly pool: pg.Pool) {}

  async query<T extends Row>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    return (await this.pool.query<T>(sql, params as unknown[])).rows;
  }

  async transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(new Transaction(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  withPlayer<T>(playerId: string, work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.transaction(async (tx) => {
      await tx.lockPlayer(playerId);
      return work(tx);
    });
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cars (
  car_id text PRIMARY KEY, name text NOT NULL, class text NOT NULL, pi int NOT NULL, price int,
  accel numeric NOT NULL, brake numeric NOT NULL, top numeric NOT NULL, grip int NOT NULL, lane_change int NOT NULL);
CREATE TABLE IF NOT EXISTS layouts (layout_id text PRIMARY KEY, name text NOT NULL, length int NOT NULL);
CREATE TABLE IF NOT EXISTS upgrade_prices (class text NOT NULL, stage int NOT NULL, price int NOT NULL, PRIMARY KEY (class, stage));
CREATE TABLE IF NOT EXISTS events (event_id text PRIMARY KEY, name text NOT NULL, league text, mode text NOT NULL,
  layout_id text NOT NULL REFERENCES layouts(layout_id), class text);
CREATE TABLE IF NOT EXISTS ai_drivers (name text PRIMARY KEY, pace_percent int NOT NULL);
CREATE TABLE IF NOT EXISTS accounts (account text PRIMARY KEY);
CREATE TABLE IF NOT EXISTS players (
  id text PRIMARY KEY, name text NOT NULL, guest boolean NOT NULL, email text UNIQUE, units text NOT NULL DEFAULT 'kmh',
  selected_car_id text, retired boolean NOT NULL DEFAULT false, rookie_complete boolean NOT NULL DEFAULT false,
  club_complete boolean NOT NULL DEFAULT false, trophy boolean NOT NULL DEFAULT false,
  guided_paid boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sessions (token text PRIMARY KEY, player_id text NOT NULL REFERENCES players(id),
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS owned_cars (
  player_id text NOT NULL REFERENCES players(id), car_id text NOT NULL REFERENCES cars(car_id),
  engine int NOT NULL DEFAULT 0, tires int NOT NULL DEFAULT 0, brakes int NOT NULL DEFAULT 0, suspension int NOT NULL DEFAULT 0,
  paid_engine int NOT NULL DEFAULT 0, paid_tires int NOT NULL DEFAULT 0, paid_brakes int NOT NULL DEFAULT 0,
  paid_suspension int NOT NULL DEFAULT 0, latest_reference jsonb, acquired_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (player_id, car_id));
CREATE TABLE IF NOT EXISTS movements (
  id text PRIMARY KEY, seq bigserial UNIQUE, player_id text NOT NULL REFERENCES players(id), kind text NOT NULL,
  run_id text, purchase_id text, created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE IF NOT EXISTS entries (
  movement_id text NOT NULL REFERENCES movements(id), account text NOT NULL REFERENCES accounts(account),
  amount int NOT NULL, PRIMARY KEY (movement_id, account));
CREATE INDEX IF NOT EXISTS entries_account ON entries (account);
CREATE TABLE IF NOT EXISTS idempotency (
  player_id text NOT NULL REFERENCES players(id), key text NOT NULL, fingerprint text NOT NULL,
  status int NOT NULL, body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (player_id, key));
CREATE TABLE IF NOT EXISTS purchases (
  id text PRIMARY KEY, player_id text NOT NULL REFERENCES players(id), car_id text NOT NULL, system text NOT NULL,
  stage int NOT NULL, price int NOT NULL, reference jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS runs (
  id text PRIMARY KEY, player_id text NOT NULL REFERENCES players(id), seed text NOT NULL,
  layout_id text NOT NULL REFERENCES layouts(layout_id), mode text NOT NULL, car_id text NOT NULL REFERENCES cars(car_id),
  event_id text REFERENCES events(event_id), laps int NOT NULL, step_limit int NOT NULL, loaner boolean NOT NULL,
  car_stats jsonb NOT NULL, car_stages jsonb NOT NULL, ai jsonb NOT NULL,
  status text NOT NULL, reason text, pending_bytes bytea, body_sha256 text, result jsonb, payout int,
  created_at timestamptz NOT NULL DEFAULT now(), stored_at timestamptz, verified_at timestamptz);
CREATE INDEX IF NOT EXISTS runs_status ON runs (status);
CREATE TABLE IF NOT EXISTS board_rows (
  layout_id text NOT NULL, mode text NOT NULL, class text NOT NULL, player_id text NOT NULL REFERENCES players(id),
  run_id text NOT NULL REFERENCES runs(id), value int NOT NULL, top_speed double precision NOT NULL,
  replay_sha256 text NOT NULL, car_id text NOT NULL, verified_at timestamptz NOT NULL,
  PRIMARY KEY (layout_id, mode, class, player_id));
CREATE TABLE IF NOT EXISTS time_trial_bests (
  player_id text NOT NULL REFERENCES players(id), layout_id text NOT NULL, best_ms int NOT NULL,
  PRIMARY KEY (player_id, layout_id));
CREATE TABLE IF NOT EXISTS event_points (
  player_id text NOT NULL REFERENCES players(id), event_id text NOT NULL REFERENCES events(event_id),
  points int NOT NULL, PRIMARY KEY (player_id, event_id));
CREATE TABLE IF NOT EXISTS lobbies (
  id text PRIMARY KEY, host_id text NOT NULL REFERENCES players(id), ai_count int NOT NULL, state text NOT NULL,
  players jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS signin_tokens (
  token text PRIMARY KEY, email text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, used_at timestamptz);
`;

async function seed(client: pg.PoolClient): Promise<void> {
  for (const car of CARS) {
    await client.query(
      `INSERT INTO cars (car_id, name, class, pi, price, accel, brake, top, grip, lane_change)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (car_id) DO NOTHING`,
      [car.carId, car.name, car.class, car.pi, car.price, car.stats.accelMps2, car.stats.brakeMps2,
        car.stats.topMps, car.stats.gripPct, car.stats.laneChangeSteps]);
  }
  for (const layout of Object.values(LAYOUTS)) {
    await client.query("INSERT INTO layouts VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [layout.id, layout.name, layout.length]);
  }
  for (const [carClass, prices] of Object.entries(STAGE_PRICES)) {
    for (const [index, price] of prices.entries()) {
      await client.query("INSERT INTO upgrade_prices VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [carClass, index + 1, price]);
    }
  }
  for (const event of EVENTS) {
    await client.query("INSERT INTO events VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
      [event.eventId, event.name, event.league, event.mode, event.layoutId, event.class]);
  }
  for (const driver of AI_DRIVERS) {
    await client.query("INSERT INTO ai_drivers VALUES ($1,$2) ON CONFLICT DO NOTHING", [driver.name, driver.pacePercent]);
  }
  for (const account of COUNTER_ACCOUNTS) {
    await client.query("INSERT INTO accounts VALUES ($1) ON CONFLICT DO NOTHING", [account]);
  }
}

async function migrate(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(727411)");
    await client.query(SCHEMA);
    await seed(client);
  } finally {
    await client.query("SELECT pg_advisory_unlock(727411)").catch(() => undefined);
    client.release();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retries every second until Postgres answers and the schema is applied.
export async function connect(url: string): Promise<Database> {
  const pool = new pg.Pool({ connectionString: url, max: 20 });
  pool.on("error", () => undefined);
  for (;;) {
    try {
      await migrate(pool);
      return new Database(pool);
    } catch (error) {
      console.error(`postgres not ready: ${(error as Error).message}`);
      await sleep(1000);
    }
  }
}
