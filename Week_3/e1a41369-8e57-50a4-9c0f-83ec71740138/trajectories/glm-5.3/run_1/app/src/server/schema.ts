import type { Pool } from 'pg';

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  password_hash text NOT NULL,
  level integer NOT NULL DEFAULT 1,
  experience integer NOT NULL DEFAULT 0,
  health numeric(5,1) NOT NULL DEFAULT 50.0,
  gold_cents integer NOT NULL DEFAULT 0,
  time_zone text NOT NULL DEFAULT 'UTC',
  day_start_hour smallint NOT NULL DEFAULT 0,
  resting boolean NOT NULL DEFAULT false,
  open_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_key;
CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users (username);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  leader_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS party_members (
  party_id uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (party_id, user_id)
);

CREATE TABLE IF NOT EXISTS party_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (party_id, user_id)
);

CREATE TABLE IF NOT EXISTS quests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  name text NOT NULL,
  boss text NOT NULL,
  max_health numeric(6,1) NOT NULL,
  boss_health numeric(6,1) NOT NULL,
  power numeric(4,1) NOT NULL,
  reward_gold_cents integer NOT NULL,
  reward_experience integer NOT NULL,
  state text NOT NULL,
  invited_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  started_at timestamptz,
  ended_at timestamptz,
  defeated_by text,
  event_seq integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS quests_party_state ON quests (party_id, state);

CREATE TABLE IF NOT EXISTS quest_accepts (
  quest_id uuid NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  username text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (quest_id, username)
);

CREATE TABLE IF NOT EXISTS quest_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quest_id uuid NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  kind text NOT NULL,
  username text NOT NULL,
  amount numeric(5,1) NOT NULL,
  missed integer,
  boss_health_after numeric(6,1) NOT NULL,
  task_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quest_id, seq)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  username text NOT NULL,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_party_time ON chat_messages (party_id, created_at);

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  difficulty text NOT NULL DEFAULT 'easy',
  value integer NOT NULL DEFAULT 0,
  streak integer NOT NULL DEFAULT 0,
  done boolean NOT NULL DEFAULT false,
  done_at timestamptz,
  position integer,
  weekdays text[],
  price_cents integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_owner_pos ON tasks (owner_id, type, position);
CREATE INDEX IF NOT EXISTS tasks_owner ON tasks (owner_id, type, position);

CREATE TABLE IF NOT EXISTS checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  position integer NOT NULL,
  text text NOT NULL,
  checked boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS checklist_task ON checklist_items (task_id, position);

CREATE TABLE IF NOT EXISTS ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  amount_cents integer NOT NULL,
  task_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_user ON ledger (user_id, created_at);

CREATE TABLE IF NOT EXISTS notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  level integer NOT NULL,
  gold_lost_cents integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notices_user ON notices (user_id, created_at);

CREATE TABLE IF NOT EXISTS undo_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL,
  user_id uuid NOT NULL,
  experience integer NOT NULL,
  gold_cents integer NOT NULL,
  damage numeric(5,1) NOT NULL DEFAULT 0,
  quest_id uuid,
  event_id uuid,
  old_level integer NOT NULL,
  old_experience integer NOT NULL,
  old_health numeric(5,1) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency (
  user_id uuid NOT NULL,
  key text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  body text,
  status integer NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS closed_days (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date date NOT NULL,
  missed integer NOT NULL DEFAULT 0,
  health_lost numeric(5,1) NOT NULL DEFAULT 0,
  strike_back numeric(5,1) NOT NULL DEFAULT 0,
  closed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, local_date)
);

CREATE TABLE IF NOT EXISTS quest_participants (
  quest_id uuid NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  username text NOT NULL,
  PRIMARY KEY (quest_id, username)
);

CREATE TABLE IF NOT EXISTS banner_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  key text NOT NULL,
  content_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS banner_party_latest ON banner_uploads (party_id, created_at);

CREATE TABLE IF NOT EXISTS imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename text NOT NULL,
  size integer NOT NULL,
  status text NOT NULL,
  object_key text NOT NULL,
  task_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS import_lines (
  import_id uuid NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  line integer NOT NULL,
  task_id uuid,
  type text,
  title text,
  error text
);

CREATE TABLE IF NOT EXISTS app_meta (
  key text PRIMARY KEY,
  value text NOT NULL
);
`;

export async function applySchema(pool: Pool): Promise<void> {
  const exists = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'app_meta'`
  );
  if (exists.rowCount) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const stmt of SCHEMA.split(/;\s*\n/)) {
      const s = stmt.trim();
      if (s) await client.query(s);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
