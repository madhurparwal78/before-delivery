import { randomBytes } from "node:crypto";
import { tx } from "./db.ts";
import { CLUBS, LAST_GAMEWEEK, PLAYERS } from "./seed.ts";

// Applied idempotently at every start, under an advisory lock so concurrent copies agree.
// Every money column is an integer count of tenths of a million.
const DDL = `
CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value text NOT NULL
);
CREATE TABLE IF NOT EXISTS clubs (
  code text PRIMARY KEY,
  name text NOT NULL,
  tier text NOT NULL,
  sort_order integer NOT NULL
);
CREATE TABLE IF NOT EXISTS players (
  id text PRIMARY KEY,
  name text NOT NULL,
  club text NOT NULL REFERENCES clubs(code),
  position text NOT NULL CHECK (position IN ('GK', 'DEF', 'MID', 'FWD')),
  price_tenths integer NOT NULL
);
CREATE TABLE IF NOT EXISTS gameweeks (
  number integer PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('upcoming', 'open', 'locked', 'live', 'closed')),
  deadline timestamptz,
  first_kickoff timestamptz,
  locked_at timestamptz,
  closed_at timestamptz
);
CREATE TABLE IF NOT EXISTS fixtures (
  id text PRIMARY KEY,
  gameweek integer NOT NULL REFERENCES gameweeks(number),
  home text NOT NULL REFERENCES clubs(code),
  away text NOT NULL REFERENCES clubs(code),
  kickoff timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS managers (
  id text PRIMARY KEY,
  email text NOT NULL,
  team_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('manager', 'operator')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  manager_id text NOT NULL REFERENCES managers(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS squads (
  manager_id text PRIMARY KEY REFERENCES managers(id),
  captain text NOT NULL REFERENCES players(id),
  vice_captain text NOT NULL REFERENCES players(id),
  free_transfers integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS squad_players (
  manager_id text NOT NULL REFERENCES squads(manager_id),
  player_id text NOT NULL REFERENCES players(id),
  purchase_price_tenths integer NOT NULL,
  eleven_index integer,
  bench_order integer,
  PRIMARY KEY (manager_id, player_id)
);
CREATE TABLE IF NOT EXISTS manager_gameweeks (
  manager_id text NOT NULL REFERENCES managers(id),
  gameweek integer NOT NULL REFERENCES gameweeks(number),
  transfers_made integer NOT NULL DEFAULT 0,
  hit_points integer NOT NULL DEFAULT 0,
  chip text CHECK (chip IN ('wildcard', 'free_hit', 'bench_boost', 'triple_captain')),
  free_hit_backup jsonb,
  PRIMARY KEY (manager_id, gameweek)
);
CREATE TABLE IF NOT EXISTS transfers (
  id bigserial PRIMARY KEY,
  manager_id text NOT NULL REFERENCES managers(id),
  gameweek integer NOT NULL,
  made_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  out_player_id text NOT NULL REFERENCES players(id),
  sell_price_tenths integer NOT NULL,
  in_player_id text NOT NULL REFERENCES players(id),
  price_tenths integer NOT NULL,
  free_hit boolean NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger_entries (
  id bigserial PRIMARY KEY,
  manager_id text NOT NULL REFERENCES managers(id),
  kind text NOT NULL CHECK (kind IN ('opening_budget', 'purchase', 'sale', 'reversal')),
  amount_tenths integer NOT NULL,
  player_id text REFERENCES players(id),
  transfer_id bigint REFERENCES transfers(id),
  reverses bigint REFERENCES ledger_entries(id),
  gameweek integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ledger_entries_manager ON ledger_entries (manager_id);
CREATE TABLE IF NOT EXISTS drafts (
  manager_id text PRIMARY KEY REFERENCES managers(id),
  gameweek integer NOT NULL,
  state text NOT NULL CHECK (state IN ('clean', 'drafting', 'confirmed', 'refused')),
  out_ids jsonb NOT NULL,
  in_ids jsonb NOT NULL,
  refusal jsonb
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  manager_id text NOT NULL REFERENCES managers(id),
  key text NOT NULL,
  fingerprint text NOT NULL,
  status integer NOT NULL,
  response text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (manager_id, key)
);
CREATE TABLE IF NOT EXISTS locked_teams (
  manager_id text NOT NULL REFERENCES managers(id),
  gameweek integer NOT NULL REFERENCES gameweeks(number),
  locked_at timestamptz NOT NULL,
  starting jsonb NOT NULL,
  bench jsonb NOT NULL,
  captain text NOT NULL,
  vice_captain text NOT NULL,
  chip text,
  bank_tenths integer NOT NULL,
  transfers_made integer NOT NULL,
  hit_points integer NOT NULL,
  snapshot_body text NOT NULL,
  receipt text NOT NULL CHECK (receipt IN ('pending', 'stored')),
  points integer,
  net_points integer,
  PRIMARY KEY (manager_id, gameweek)
);
CREATE INDEX IF NOT EXISTS locked_teams_pending ON locked_teams (receipt) WHERE receipt = 'pending';
CREATE TABLE IF NOT EXISTS match_events (
  event_id text PRIMARY KEY,
  seq bigserial UNIQUE,
  gameweek integer NOT NULL REFERENCES gameweeks(number),
  fixture_id text NOT NULL REFERENCES fixtures(id),
  player_id text NOT NULL REFERENCES players(id),
  type text NOT NULL,
  value integer,
  points_delta integer NOT NULL,
  voided boolean NOT NULL DEFAULT false,
  recorded_at timestamptz NOT NULL,
  fingerprint text NOT NULL,
  response text NOT NULL
);
CREATE TABLE IF NOT EXISTS price_runs (
  run_date date PRIMARY KEY,
  gameweek integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS price_moves (
  run_date date NOT NULL REFERENCES price_runs(run_date),
  player_id text NOT NULL REFERENCES players(id),
  delta_tenths integer NOT NULL,
  gameweek integer NOT NULL,
  applied boolean NOT NULL,
  price_tenths integer NOT NULL,
  PRIMARY KEY (run_date, player_id)
);
CREATE TABLE IF NOT EXISTS leagues (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  admin_manager_id text NOT NULL REFERENCES managers(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS league_members (
  league_id bigint NOT NULL REFERENCES leagues(id),
  manager_id text NOT NULL REFERENCES managers(id),
  joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_rank integer,
  PRIMARY KEY (league_id, manager_id)
);
CREATE TABLE IF NOT EXISTS notice_outbox (
  id bigserial PRIMARY KEY,
  manager_id text NOT NULL,
  kind text NOT NULL,
  gameweek integer NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS notice_outbox_pending ON notice_outbox (id) WHERE delivered_at IS NULL;
`;

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export async function migrate(): Promise<string> {
  return tx(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(7311001)");
    await db.query(DDL);
    await db.query(
      `INSERT INTO clubs (code, name, tier, sort_order)
       SELECT * FROM jsonb_to_recordset($1::jsonb) AS c(code text, name text, tier text, sort_order integer)
       ON CONFLICT (code) DO NOTHING`,
      [JSON.stringify(CLUBS.map((club, index) => ({ ...club, sort_order: index })))],
    );
    await db.query(
      `INSERT INTO players (id, name, club, position, price_tenths)
       SELECT * FROM jsonb_to_recordset($1::jsonb) AS p(id text, name text, club text, position text, price_tenths integer)
       ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify(PLAYERS)],
    );
    await db.query(
      `INSERT INTO gameweeks (number, status)
       SELECT n, CASE WHEN n = 1 THEN 'open' ELSE 'upcoming' END FROM generate_series(1, $1::integer) AS n
       ON CONFLICT (number) DO NOTHING`,
      [LAST_GAMEWEEK],
    );
    // A short id of this database, so notice records written to the shared PocketBase never collide.
    const id = Array.from(randomBytes(5), (byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join("");
    await db.query("INSERT INTO settings (key, value) VALUES ('install_id', $1) ON CONFLICT (key) DO NOTHING", [id]);
    const row = await db.query<{ value: string }>("SELECT value FROM settings WHERE key = 'install_id'");
    return row.rows[0]?.value ?? id;
  });
}
