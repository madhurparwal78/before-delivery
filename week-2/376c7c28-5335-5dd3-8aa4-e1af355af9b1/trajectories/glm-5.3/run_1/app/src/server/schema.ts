import { pool, tx } from "./db";

// Idempotent schema. Applied on every serve under an advisory lock so several
// instances can start against one database at the same time.

const DDL = `
CREATE TABLE IF NOT EXISTS studios (
  id text PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  time_zone text NOT NULL,
  pickup_window_days int NOT NULL DEFAULT 14,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS storage_fee_history (
  studio_id text NOT NULL REFERENCES studios(id),
  effective_from date NOT NULL,
  cents int NOT NULL,
  PRIMARY KEY (studio_id, effective_from)
);

CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY,
  studio_id text NOT NULL REFERENCES studios(id),
  email text NOT NULL,
  name text NOT NULL,
  handle text NOT NULL,
  role text NOT NULL,
  membership text,
  card_status text NOT NULL DEFAULT 'none',
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  UNIQUE (studio_id, email),
  UNIQUE (studio_id, handle)
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  studio_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS signin_failures (
  studio_slug text NOT NULL,
  email text NOT NULL,
  failures int NOT NULL DEFAULT 0,
  lock_until timestamptz,
  last_failure_at timestamptz,
  PRIMARY KEY (studio_slug, email)
);

CREATE TABLE IF NOT EXISTS invites (
  id text PRIMARY KEY,
  studio_id text NOT NULL REFERENCES studios(id),
  email text NOT NULL,
  role text NOT NULL,
  membership text,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS invites_studio_email ON invites (studio_id, email);

CREATE TABLE IF NOT EXISTS clay_bodies (
  id text PRIMARY KEY,
  studio_id text NOT NULL REFERENCES studios(id),
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS kilns (
  id text PRIMARY KEY,
  studio_id text NOT NULL REFERENCES studios(id),
  name text NOT NULL,
  stack_height_in double precision NOT NULL DEFAULT 27,
  shelf_area_sq_in double precision NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_schedules (
  id text PRIMARY KEY,
  studio_id text NOT NULL REFERENCES studios(id),
  effective_from date NOT NULL,
  member_bisque_cents int NOT NULL,
  member_glaze_cents int NOT NULL,
  dropoff_bisque_cents int NOT NULL,
  dropoff_glaze_cents int NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (studio_id, effective_from)
);

CREATE TABLE IF NOT EXISTS credit_packs (
  id text PRIMARY KEY,
  studio_id text NOT NULL REFERENCES studios(id),
  name text NOT NULL,
  amount_cents int NOT NULL
);

CREATE TABLE IF NOT EXISTS pieces (
  id text PRIMARY KEY,
  studio_id text NOT NULL REFERENCES studios(id),
  owner_id text NOT NULL REFERENCES people(id),
  title text NOT NULL,
  clay_body_id text NOT NULL,
  status text NOT NULL,
  length_in double precision NOT NULL,
  width_in double precision NOT NULL,
  height_in double precision NOT NULL,
  rounded_l_half int NOT NULL,
  rounded_w_half int NOT NULL,
  rounded_h_half int NOT NULL,
  cubic_eighths int NOT NULL,
  membership text,
  bisque_rate_cents int NOT NULL,
  glaze_rate_cents int NOT NULL,
  rates_effective_from date NOT NULL,
  quoted_at timestamptz NOT NULL,
  waiting_since timestamptz,
  pickup_deadline date,
  bisque_outcome text,
  glaze_outcome text,
  photo_key text,
  photo_content_type text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS pieces_studio_status ON pieces (studio_id, status);
CREATE INDEX IF NOT EXISTS pieces_owner ON pieces (owner_id);

CREATE TABLE IF NOT EXISTS piece_history (
  id text PRIMARY KEY,
  piece_id text NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  status text NOT NULL,
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS piece_history_piece ON piece_history (piece_id, at);

CREATE TABLE IF NOT EXISTS loads (
  id text PRIMARY KEY,
  studio_id text NOT NULL REFERENCES studios(id),
  kiln_id text NOT NULL REFERENCES kilns(id),
  firing text NOT NULL,
  status text NOT NULL DEFAULT 'planning',
  created_at timestamptz NOT NULL,
  unloaded_at timestamptz
);
CREATE INDEX IF NOT EXISTS loads_studio ON loads (studio_id, created_at);
CREATE INDEX IF NOT EXISTS loads_kiln ON loads (kiln_id, status);

CREATE TABLE IF NOT EXISTS load_decks (
  load_id text NOT NULL REFERENCES loads(id) ON DELETE CASCADE,
  number int NOT NULL,
  PRIMARY KEY (load_id, number)
);

CREATE TABLE IF NOT EXISTS placements (
  id text PRIMARY KEY,
  load_id text NOT NULL REFERENCES loads(id) ON DELETE CASCADE,
  piece_id text NOT NULL REFERENCES pieces(id),
  deck int NOT NULL,
  position int NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (load_id, piece_id)
);
CREATE INDEX IF NOT EXISTS placements_piece ON placements (piece_id);
CREATE INDEX IF NOT EXISTS placements_load ON placements (load_id, deck, position);

CREATE TABLE IF NOT EXISTS movements (
  id text PRIMARY KEY,
  studio_id text NOT NULL,
  member_id text NOT NULL,
  kind text NOT NULL,
  amount_cents int NOT NULL,
  charge_id text,
  purchase_id text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS movements_member ON movements (member_id, created_at);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id text PRIMARY KEY,
  movement_id text NOT NULL REFERENCES movements(id),
  account text NOT NULL,
  amount_cents int NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_entries_movement ON ledger_entries (movement_id);
CREATE INDEX IF NOT EXISTS ledger_entries_member_credit ON ledger_entries (account);

CREATE TABLE IF NOT EXISTS charges (
  id text PRIMARY KEY,
  studio_id text NOT NULL,
  member_id text NOT NULL,
  piece_id text NOT NULL,
  firing text NOT NULL,
  storage_day date,
  cubic_eighths int,
  rate_cents int NOT NULL,
  fee_cents int NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  funding text,
  created_at timestamptz NOT NULL,
  settled_at timestamptz,
  refunded_at timestamptz,
  last_kb_call_ms bigint
);
CREATE UNIQUE INDEX IF NOT EXISTS charges_firing_once ON charges (piece_id, firing) WHERE storage_day IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS charges_storage_once ON charges (piece_id, storage_day) WHERE storage_day IS NOT NULL;
CREATE INDEX IF NOT EXISTS charges_pending ON charges (status, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS charges_refund_pending ON charges (id) WHERE status = 'refund_pending';
CREATE INDEX IF NOT EXISTS charges_member ON charges (member_id, created_at);

CREATE TABLE IF NOT EXISTS pack_attempts (
  id text PRIMARY KEY,
  studio_id text NOT NULL,
  member_id text NOT NULL,
  idempotency_key text NOT NULL,
  pack_id text NOT NULL,
  amount_cents int NOT NULL,
  studio_day date NOT NULL,
  state text NOT NULL,
  created_at timestamptz NOT NULL,
  last_kb_call_ms bigint,
  UNIQUE (studio_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS pack_attempts_member_day ON pack_attempts (member_id, studio_day);

CREATE TABLE IF NOT EXISTS idempotency (
  studio_id text NOT NULL,
  endpoint text NOT NULL,
  key text NOT NULL,
  body_hash text NOT NULL,
  status_code int NOT NULL,
  response_body text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (studio_id, endpoint, key)
);

CREATE TABLE IF NOT EXISTS month_closes (
  studio_id text NOT NULL,
  month text NOT NULL,
  closed_at timestamptz NOT NULL,
  fees_cents int NOT NULL,
  refunds_cents int NOT NULL,
  net_cents int NOT NULL,
  charge_count int NOT NULL,
  statement text NOT NULL,
  PRIMARY KEY (studio_id, month)
);

CREATE TABLE IF NOT EXISTS sent_reminders (
  piece_id text PRIMARY KEY,
  sent_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sent_ready_emails (
  load_id text NOT NULL,
  member_id text NOT NULL,
  sent_at timestamptz NOT NULL,
  PRIMARY KEY (load_id, member_id)
);
`;

export async function applySchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(918273645)");
    await client.query(DDL);
    await client.query("COMMIT");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* already gone */
    }
    throw e;
  } finally {
    client.release();
  }
}

export const ensureReady = tx;
