export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  display_name text NOT NULL,
  phone text,
  password_hash text NOT NULL,
  colour text NOT NULL,
  initials text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  parent_name text NOT NULL,
  time_zone text NOT NULL,
  last_colour text NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  user_id uuid NOT NULL REFERENCES users (id),
  role text NOT NULL CHECK (role IN ('admin', 'member')),
  seq bigserial,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS workspace_members_user ON workspace_members (user_id, seq);

CREATE TABLE IF NOT EXISTS boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  name text NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('workspace', 'private'))
);
CREATE INDEX IF NOT EXISTS boards_workspace ON boards (workspace_id);

CREATE TABLE IF NOT EXISTS board_members (
  board_id uuid NOT NULL REFERENCES boards (id),
  user_id uuid NOT NULL REFERENCES users (id),
  role text NOT NULL CHECK (role IN ('observer', 'member', 'admin', 'removed')),
  PRIMARY KEY (board_id, user_id)
);
CREATE INDEX IF NOT EXISTS board_members_user ON board_members (user_id);

CREATE TABLE IF NOT EXISTS lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES boards (id),
  name text NOT NULL,
  position integer NOT NULL
);
CREATE INDEX IF NOT EXISTS lists_board ON lists (board_id, position);

CREATE TABLE IF NOT EXISTS cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES boards (id),
  list_id uuid NOT NULL REFERENCES lists (id),
  title text NOT NULL,
  notes text NOT NULL DEFAULT '',
  due_date date,
  labels text[] NOT NULL DEFAULT '{}',
  owner_user_id uuid REFERENCES users (id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'archived')),
  version integer NOT NULL DEFAULT 1,
  rank integer,
  last_change_by uuid REFERENCES users (id),
  last_change text NOT NULL DEFAULT 'edited' CHECK (last_change IN ('moved', 'edited')),
  archived_at timestamptz
);
CREATE INDEX IF NOT EXISTS cards_board ON cards (board_id, status);
CREATE INDEX IF NOT EXISTS cards_list ON cards (list_id, rank);

CREATE TABLE IF NOT EXISTS card_private_members (
  card_id uuid NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id),
  PRIMARY KEY (card_id, user_id)
);

CREATE TABLE IF NOT EXISTS checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  text text NOT NULL,
  done boolean NOT NULL DEFAULT false,
  seq bigserial
);
CREATE INDEX IF NOT EXISTS checklist_items_card ON checklist_items (card_id, seq);

CREATE TABLE IF NOT EXISTS attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  filename text NOT NULL,
  content_type text NOT NULL,
  size integer NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by uuid NOT NULL REFERENCES users (id)
);
CREATE INDEX IF NOT EXISTS attachments_card ON attachments (card_id, uploaded_at);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id uuid NOT NULL REFERENCES users (id),
  key text NOT NULL,
  list_id uuid NOT NULL,
  title text NOT NULL,
  response jsonb NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS permission_log (
  seq bigserial PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  at timestamptz NOT NULL DEFAULT clock_timestamp(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  actor_id uuid NOT NULL REFERENCES users (id),
  action text NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('user', 'board', 'card')),
  target_id text NOT NULL,
  target_label text NOT NULL,
  board_id uuid,
  before jsonb,
  after jsonb
);
CREATE INDEX IF NOT EXISTS permission_log_workspace ON permission_log (workspace_id, seq DESC);
`;
