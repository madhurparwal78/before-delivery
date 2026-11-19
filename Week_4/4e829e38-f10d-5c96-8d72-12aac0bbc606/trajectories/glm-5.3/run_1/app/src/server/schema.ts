import { query } from './db';

export const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  verify_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teams (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL,
  join_code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  PRIMARY KEY (team_id, person_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sections (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  position int NOT NULL,
  UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS fields (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL,
  options jsonb,
  formula text,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS tasks (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  section_id text NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  position int NOT NULL,
  parent_id text REFERENCES tasks(id) ON DELETE CASCADE,
  assignee_id text REFERENCES people(id) ON DELETE SET NULL,
  start_date text,
  due_date text,
  effort numeric,
  completed boolean NOT NULL DEFAULT false,
  version int NOT NULL DEFAULT 1,
  recurrence text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_project_idx ON tasks(project_id);
CREATE INDEX IF NOT EXISTS tasks_section_idx ON tasks(section_id, position);

CREATE TABLE IF NOT EXISTS field_values (
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  field_id text NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  value jsonb,
  PRIMARY KEY (task_id, field_id)
);

CREATE TABLE IF NOT EXISTS dependencies (
  blocker_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  waiter_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (blocker_id, waiter_id)
);

CREATE TABLE IF NOT EXISTS rules (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  trigger jsonb NOT NULL,
  condition jsonb,
  action jsonb NOT NULL,
  position int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rule_runs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  depth int NOT NULL,
  summary text NOT NULL,
  detail text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  run_no int NOT NULL,
  origin_task_id text
);
CREATE INDEX IF NOT EXISTS rule_runs_task_idx ON rule_runs(task_id, run_no);

CREATE TABLE IF NOT EXISTS claims (
  key text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS goals (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name text NOT NULL,
  parent_id text REFERENCES goals(id) ON DELETE CASCADE,
  weight int NOT NULL DEFAULT 1,
  manual_value numeric NOT NULL DEFAULT 0,
  owner_id text REFERENCES people(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS goal_projects (
  goal_id text NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  weight int NOT NULL DEFAULT 1,
  PRIMARY KEY (goal_id, project_id)
);

CREATE TABLE IF NOT EXISTS capacities (
  person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  weekday text NOT NULL,
  hours numeric NOT NULL DEFAULT 8,
  PRIMARY KEY (person_id, weekday)
);

CREATE TABLE IF NOT EXISTS forms (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  slug text NOT NULL UNIQUE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  section_id text NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reference_counters (
  team_id text PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  next_number int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS approvals (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  approver_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  requester_id text REFERENCES people(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'requested',
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE INDEX IF NOT EXISTS approvals_task_idx ON approvals(task_id, created_at);

CREATE TABLE IF NOT EXISTS inbox_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  text text NOT NULL,
  task_id text REFERENCES tasks(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'info',
  read boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inbox_person_idx ON inbox_items(person_id, created_at);

CREATE TABLE IF NOT EXISTS task_history (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_history_idx ON task_history(task_id, created_at);

CREATE TABLE IF NOT EXISTS holds (
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  field text NOT NULL,
  holder_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (task_id, field)
);

CREATE TABLE IF NOT EXISTS presence (
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  view_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (task_id, view_id)
);

CREATE TABLE IF NOT EXISTS attachments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  name text NOT NULL,
  size int NOT NULL,
  content_type text NOT NULL,
  object_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_files (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  format text NOT NULL,
  status text NOT NULL DEFAULT 'preparing',
  object_key text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS digest_claims (
  person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  PRIMARY KEY (person_id, window_start)
);

CREATE TABLE IF NOT EXISTS app_clock (
  id int PRIMARY KEY,
  fixed_at timestamptz,
  prev_at timestamptz
);

INSERT INTO app_clock (id, fixed_at, prev_at) VALUES (1, NULL, NULL) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS schema_version (
  id int PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_version (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'start_date' AND data_type = 'date') THEN
    ALTER TABLE tasks ALTER COLUMN start_date TYPE text USING to_char(start_date, 'YYYY-MM-DD');
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'due_date' AND data_type = 'date') THEN
    ALTER TABLE tasks ALTER COLUMN due_date TYPE text USING to_char(due_date, 'YYYY-MM-DD');
  END IF;
END $$;
`;

export async function applySchema(): Promise<void> {
  await query(SCHEMA_SQL);
}
