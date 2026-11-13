export const schema = `
CREATE TABLE IF NOT EXISTS parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  leader_id uuid,
  deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  time_zone text NOT NULL,
  day_start_hour integer NOT NULL,
  resting boolean NOT NULL DEFAULT false,
  level integer NOT NULL DEFAULT 1,
  experience integer NOT NULL DEFAULT 0,
  health_tenths integer NOT NULL DEFAULT 500,
  open_date date NOT NULL,
  next_close_at timestamptz NOT NULL,
  party_id uuid REFERENCES parties(id),
  joined_party_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_next_close ON users (next_close_at, username);
CREATE INDEX IF NOT EXISTS users_party ON users (party_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  type text NOT NULL,
  title text NOT NULL,
  difficulty text,
  value integer,
  streak integer,
  done boolean,
  weekdays text[],
  price_cents integer,
  position integer NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_owner ON tasks (user_id, type, position);

CREATE TABLE IF NOT EXISTS checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  text text NOT NULL,
  checked boolean NOT NULL DEFAULT false,
  position integer NOT NULL
);
CREATE INDEX IF NOT EXISTS checklist_task ON checklist_items (task_id, position);

CREATE TABLE IF NOT EXISTS ledger (
  seq bigserial PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL,
  amount_cents integer NOT NULL,
  task_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_owner ON ledger (user_id, seq);

CREATE TABLE IF NOT EXISTS notices (
  seq bigserial PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL,
  level integer NOT NULL,
  gold_lost_cents integer NOT NULL DEFAULT 0,
  tick_id uuid,
  acknowledged boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS notices_owner ON notices (user_id, acknowledged, seq);

CREATE TABLE IF NOT EXISTS closed_days (
  user_id uuid NOT NULL REFERENCES users(id),
  local_date date NOT NULL,
  closed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, local_date)
);

CREATE TABLE IF NOT EXISTS party_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES parties(id),
  invitee_id uuid NOT NULL REFERENCES users(id),
  inviter_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (party_id, invitee_id)
);

CREATE TABLE IF NOT EXISTS party_banners (
  upload_id uuid PRIMARY KEY,
  party_id uuid NOT NULL REFERENCES parties(id),
  extension text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS banners_party ON party_banners (party_id, created_at);

CREATE TABLE IF NOT EXISTS quests (
  seq bigserial PRIMARY KEY,
  id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES parties(id),
  name text NOT NULL,
  state text NOT NULL,
  boss_health_tenths integer NOT NULL,
  invited_at timestamptz NOT NULL,
  started_at timestamptz,
  ended_at timestamptz,
  defeated_by uuid REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS quests_party ON quests (party_id, seq);

CREATE TABLE IF NOT EXISTS quest_responses (
  quest_id uuid NOT NULL REFERENCES quests(id),
  user_id uuid NOT NULL REFERENCES users(id),
  accepted boolean NOT NULL,
  responded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (quest_id, user_id)
);

CREATE TABLE IF NOT EXISTS quest_participants (
  quest_id uuid NOT NULL REFERENCES quests(id),
  user_id uuid NOT NULL REFERENCES users(id),
  PRIMARY KEY (quest_id, user_id)
);

CREATE TABLE IF NOT EXISTS quest_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quest_id uuid NOT NULL REFERENCES quests(id),
  seq integer NOT NULL,
  kind text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  amount_tenths integer NOT NULL,
  missed integer,
  boss_health_after_tenths integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quest_id, seq)
);

CREATE TABLE IF NOT EXISTS ticks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  undone boolean NOT NULL DEFAULT false,
  experience integer NOT NULL,
  gold_cents integer NOT NULL,
  value_before integer NOT NULL,
  health_before_tenths integer NOT NULL,
  levelled boolean NOT NULL,
  strike_event_id uuid REFERENCES quest_events(id) ON DELETE SET NULL,
  strike_tenths integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ticks_task ON ticks (task_id, created_at);

CREATE TABLE IF NOT EXISTS chat_messages (
  seq bigserial PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES parties(id),
  user_id uuid NOT NULL REFERENCES users(id),
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_party ON chat_messages (party_id, seq);
CREATE INDEX IF NOT EXISTS chat_sender ON chat_messages (user_id, created_at);

CREATE TABLE IF NOT EXISTS imports (
  seq bigserial PRIMARY KEY,
  id uuid NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id),
  filename text NOT NULL,
  size integer NOT NULL,
  status text NOT NULL,
  task_count integer NOT NULL,
  error_count integer NOT NULL,
  lines jsonb NOT NULL,
  errors jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS imports_owner ON imports (user_id, seq);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id uuid NOT NULL REFERENCES users(id),
  key text NOT NULL,
  fingerprint text NOT NULL,
  status integer NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
`;
