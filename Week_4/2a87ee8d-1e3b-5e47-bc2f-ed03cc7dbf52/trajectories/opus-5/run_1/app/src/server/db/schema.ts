import { pool, withClient } from './pool.js';

/** Applied idempotently on every start, under an advisory lock so instances do not race. */
const DDL = `
CREATE TABLE IF NOT EXISTS facilitators (
  id            text PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  time_zone     text NOT NULL,
  seed_plan     text NOT NULL,
  seed_term     text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing_mirror (
  facilitator_id          text PRIMARY KEY REFERENCES facilitators(id) ON DELETE CASCADE,
  plan                    text NOT NULL,
  term                    text NOT NULL,
  renews_on               date,
  pending_plan            text,
  pending_term            text,
  pending_effective_date  date,
  account_balance_cents   bigint NOT NULL DEFAULT 0,
  past_due_since          timestamptz,
  synced_at               timestamptz,
  kb_account_id           text,
  kb_subscription_id      text
);

CREATE TABLE IF NOT EXISTS facilitator_invoices (
  id             text PRIMARY KEY,
  facilitator_id text NOT NULL REFERENCES facilitators(id) ON DELETE CASCADE,
  number         text NOT NULL,
  invoice_date   date NOT NULL,
  amount         text NOT NULL,
  balance        text NOT NULL,
  currency       text NOT NULL,
  recorded_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS facilitator_invoices_by_owner
  ON facilitator_invoices (facilitator_id, invoice_date DESC, recorded_at DESC);

CREATE TABLE IF NOT EXISTS workshops (
  id              text PRIMARY KEY,
  facilitator_id  text NOT NULL REFERENCES facilitators(id) ON DELETE CASCADE,
  title           text NOT NULL,
  template        text NOT NULL,
  status          text NOT NULL,
  scheduled_start text NOT NULL,
  scheduled_end   text NOT NULL,
  start_at        timestamptz NOT NULL,
  end_at          timestamptz NOT NULL,
  sponsor_email   text NOT NULL,
  fee             text NOT NULL,
  version         bigint NOT NULL DEFAULT 1,
  round_number    integer NOT NULL DEFAULT 0,
  rounds_used     integer NOT NULL DEFAULT 0,
  round_ends_at   timestamptz,
  dot_budget      integer,
  voting_ends_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workshops_by_owner ON workshops (facilitator_id, start_at DESC);

CREATE TABLE IF NOT EXISTS join_links (
  id          text PRIMARY KEY,
  workshop_id text NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  token       text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS join_links_one_active
  ON join_links (workshop_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS participants (
  id            text PRIMARY KEY,
  workshop_id   text NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  join_link_id  text NOT NULL REFERENCES join_links(id) ON DELETE CASCADE,
  display_name  text NOT NULL,
  cursor_id     text NOT NULL,
  hue           integer NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS participants_by_workshop ON participants (workshop_id);

CREATE TABLE IF NOT EXISTS sessions (
  token          text PRIMARY KEY,
  kind           text NOT NULL,
  facilitator_id text REFERENCES facilitators(id) ON DELETE CASCADE,
  participant_id text REFERENCES participants(id) ON DELETE CASCADE,
  workshop_id    text REFERENCES workshops(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_by_participant ON sessions (participant_id);

CREATE TABLE IF NOT EXISTS frames (
  id          text PRIMARY KEY,
  workshop_id text NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  title       text NOT NULL,
  x           double precision NOT NULL,
  y           double precision NOT NULL,
  width       double precision NOT NULL,
  height      double precision NOT NULL,
  position    integer NOT NULL,
  trashed_at  timestamptz,
  purge_at    timestamptz,
  purged_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS frames_by_workshop ON frames (workshop_id, position);

CREATE TABLE IF NOT EXISTS clusters (
  id          text PRIMARY KEY,
  workshop_id text NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  frame_id    text NOT NULL REFERENCES frames(id) ON DELETE CASCADE,
  title       text NOT NULL,
  x           double precision NOT NULL,
  y           double precision NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clusters_by_workshop ON clusters (workshop_id);

CREATE TABLE IF NOT EXISTS notes (
  id                    text PRIMARY KEY,
  workshop_id           text NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  frame_id              text NOT NULL REFERENCES frames(id) ON DELETE CASCADE,
  cluster_id            text REFERENCES clusters(id) ON DELETE SET NULL,
  cluster_index         integer,
  kind                  text NOT NULL,
  text                  text,
  image_id              text,
  x                     double precision NOT NULL,
  y                     double precision NOT NULL,
  revealed              boolean NOT NULL,
  facilitator_only      boolean NOT NULL DEFAULT false,
  author_kind           text NOT NULL,
  author_participant_id text REFERENCES participants(id) ON DELETE SET NULL,
  author_name           text NOT NULL,
  round_number          integer NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_seq           bigserial
);
CREATE INDEX IF NOT EXISTS notes_by_workshop ON notes (workshop_id);
CREATE INDEX IF NOT EXISTS notes_by_frame ON notes (frame_id);
CREATE INDEX IF NOT EXISTS notes_by_cluster ON notes (cluster_id, cluster_index);
CREATE INDEX IF NOT EXISTS notes_text_search
  ON notes USING gin (to_tsvector('simple', coalesce(text, '')));

CREATE TABLE IF NOT EXISTS connectors (
  id           text PRIMARY KEY,
  workshop_id  text NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  from_note_id text NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  to_note_id   text NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS connectors_by_workshop ON connectors (workshop_id);

CREATE TABLE IF NOT EXISTS dot_entries (
  id               text PRIMARY KEY,
  workshop_id      text NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  cluster_id       text NOT NULL,
  participant_id   text NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  kind             text NOT NULL,
  cancels_entry_id text REFERENCES dot_entries(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_seq      bigserial
);
CREATE UNIQUE INDEX IF NOT EXISTS dot_entries_one_return_per_spend
  ON dot_entries (cancels_entry_id) WHERE cancels_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS dot_entries_by_workshop ON dot_entries (workshop_id);
CREATE INDEX IF NOT EXISTS dot_entries_by_cluster ON dot_entries (cluster_id);

CREATE TABLE IF NOT EXISTS images (
  id             text PRIMARY KEY,
  workshop_id    text NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  uploader_key   text NOT NULL,
  object_key     text NOT NULL,
  content_type   text NOT NULL,
  width          integer NOT NULL,
  height         integer NOT NULL,
  bound_note_id  text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS image_deletions (
  image_id    text PRIMARY KEY,
  object_key  text NOT NULL,
  queued_at   timestamptz NOT NULL DEFAULT now(),
  attempts    integer NOT NULL DEFAULT 0,
  lease_until timestamptz
);

CREATE TABLE IF NOT EXISTS operations (
  actor_key     text NOT NULL,
  client_op_id  text NOT NULL,
  method        text NOT NULL,
  path          text NOT NULL,
  body_hash     text NOT NULL,
  status        integer,
  response_body text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  PRIMARY KEY (actor_key, client_op_id)
);

CREATE TABLE IF NOT EXISTS board_versions (
  id          text PRIMARY KEY,
  workshop_id text NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  version     bigint NOT NULL,
  reason      text NOT NULL,
  snapshot    jsonb NOT NULL,
  note_count  integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS board_versions_by_workshop ON board_versions (workshop_id, version DESC);

CREATE TABLE IF NOT EXISTS invites (
  id           text PRIMARY KEY,
  workshop_id  text NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  email        text NOT NULL,
  status       text NOT NULL,
  attempts     integer NOT NULL DEFAULT 0,
  lease_until  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_seq  bigserial,
  sent_at      timestamptz
);
CREATE INDEX IF NOT EXISTS invites_by_workshop ON invites (workshop_id, created_seq);
CREATE INDEX IF NOT EXISTS invites_queued ON invites (status) WHERE status = 'queued';

CREATE TABLE IF NOT EXISTS invite_quota (
  facilitator_id text NOT NULL REFERENCES facilitators(id) ON DELETE CASCADE,
  local_day      date NOT NULL,
  used           integer NOT NULL DEFAULT 0,
  PRIMARY KEY (facilitator_id, local_day)
);

CREATE TABLE IF NOT EXISTS rate_limits (
  limit_class  text NOT NULL,
  limit_key    text NOT NULL,
  window_start bigint NOT NULL,
  count        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (limit_class, limit_key, window_start)
);

CREATE TABLE IF NOT EXISTS activity_entries (
  id             text PRIMARY KEY,
  seq            bigserial,
  facilitator_id text NOT NULL REFERENCES facilitators(id) ON DELETE CASCADE,
  actor          text NOT NULL,
  action         text NOT NULL,
  workshop_id    text,
  at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_by_owner ON activity_entries (facilitator_id, seq DESC);

CREATE TABLE IF NOT EXISTS recaps (
  workshop_id     text PRIMARY KEY REFERENCES workshops(id) ON DELETE CASCADE,
  status          text NOT NULL,
  reason          text,
  attempts        integer NOT NULL DEFAULT 0,
  files_stored_at timestamptz,
  email_sent_at   timestamptz,
  recap_token     text NOT NULL UNIQUE,
  scale           integer NOT NULL,
  invoice_id      text,
  invoice_number  text,
  invoice_amount  text,
  invoice_currency text,
  lease_until     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recap_emails (
  workshop_id text NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
  email       text NOT NULL,
  sent_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workshop_id, email)
);

CREATE TABLE IF NOT EXISTS singleton_tasks (
  name        text PRIMARY KEY,
  done_at     timestamptz,
  attempts    integer NOT NULL DEFAULT 0,
  lease_until timestamptz
);

CREATE TABLE IF NOT EXISTS sponsor_accounts (
  external_key text PRIMARY KEY,
  kb_account_id text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
`;

const SCHEMA_LOCK_KEY = 0x6c616e74;

export async function applySchema(): Promise<void> {
  await withClient(async (client) => {
    await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK_KEY]);
    try {
      await client.query(DDL);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK_KEY]);
    }
  });
}

/** Serialises the seed across instances so a concurrent start cannot double-insert. */
export async function withSeedLock<T>(run: () => Promise<T>): Promise<T> {
  return withClient(async (client) => {
    await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK_KEY + 1]);
    try {
      return await run();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK_KEY + 1]);
    }
  });
}
