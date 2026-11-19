import pg from 'pg';
import { config } from './config.js';
import { randomUUID } from 'node:crypto';

/** `date` columns stay ISO strings so no code has to reformat them. */
pg.types.setTypeParser(1082, (value: string) => value);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export type Row = Record<string, any>;

export async function query<T extends Row = Row>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query(text, params as any[]);
  return result.rows as T[];
}

export async function one<T extends Row = Row>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows.length > 0 ? rows[0] : null;
}

export function newId(): string {
  return randomUUID();
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  verify_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS teams (
  id text PRIMARY KEY,
  name text NOT NULL,
  join_code text NOT NULL UNIQUE,
  reference_counter integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS memberships (
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role text NOT NULL,
  PRIMARY KEY (team_id, person_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS capacities (
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  weekday text NOT NULL,
  hours numeric NOT NULL,
  PRIMARY KEY (team_id, person_id, weekday)
);
CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sections (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  position integer NOT NULL
);
CREATE TABLE IF NOT EXISTS fields (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  formula text,
  position integer NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  section_id text NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  parent_id text REFERENCES tasks(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  position integer NOT NULL,
  assignee_id text REFERENCES people(id) ON DELETE SET NULL,
  start_date date,
  due_date date,
  effort numeric,
  completed boolean NOT NULL DEFAULT false,
  completed_on date,
  version integer NOT NULL DEFAULT 1,
  recurrence text,
  successor_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS task_values (
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  field_id text NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  value jsonb,
  PRIMARY KEY (task_id, field_id)
);
CREATE TABLE IF NOT EXISTS dependencies (
  from_task text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  to_task text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (from_task, to_task)
);
CREATE TABLE IF NOT EXISTS rules (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  position integer NOT NULL,
  trigger jsonb NOT NULL,
  condition jsonb,
  action jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rule_runs (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rule_id text,
  depth integer NOT NULL,
  summary text NOT NULL,
  detail text NOT NULL,
  counted boolean NOT NULL DEFAULT false,
  seq bigserial,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS claims (
  key text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS goals (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name text NOT NULL,
  parent_id text REFERENCES goals(id) ON DELETE CASCADE,
  weight integer NOT NULL DEFAULT 1,
  manual_value numeric NOT NULL DEFAULT 0,
  owner_id text REFERENCES people(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS goal_projects (
  goal_id text NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  weight integer NOT NULL DEFAULT 1,
  PRIMARY KEY (goal_id, project_id)
);
CREATE TABLE IF NOT EXISTS forms (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  section_id text NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE,
  title text NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  approver_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  requester_id text REFERENCES people(id) ON DELETE SET NULL,
  status text NOT NULL,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE TABLE IF NOT EXISTS inbox_items (
  id text PRIMARY KEY,
  person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  team_id text REFERENCES teams(id) ON DELETE CASCADE,
  text text NOT NULL,
  task_id text REFERENCES tasks(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'note',
  read boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS task_history (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS holds (
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  field text NOT NULL,
  person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (task_id, field)
);
CREATE TABLE IF NOT EXISTS presence (
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (task_id, person_id)
);
CREATE TABLE IF NOT EXISTS attachments (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  name text NOT NULL,
  size integer NOT NULL,
  content_type text NOT NULL,
  object_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS project_files (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  format text NOT NULL,
  status text NOT NULL,
  object_key text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS events (
  id bigserial PRIMARY KEY,
  team_id text,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS server_clock (
  id integer PRIMARY KEY,
  now timestamptz,
  calls integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS tasks_project_idx ON tasks(project_id);
CREATE INDEX IF NOT EXISTS rule_runs_task_idx ON rule_runs(task_id);
CREATE INDEX IF NOT EXISTS inbox_person_idx ON inbox_items(person_id);
CREATE INDEX IF NOT EXISTS events_created_idx ON events(id);
`;

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA);
  await pool.query(
    `INSERT INTO server_clock (id, now, calls) VALUES (1, NULL, 0) ON CONFLICT (id) DO NOTHING`,
  );
}

/** Returns true when the claim was taken by this caller. */
export async function claim(key: string): Promise<boolean> {
  const rows = await query(
    `INSERT INTO claims (key) VALUES ($1) ON CONFLICT (key) DO NOTHING RETURNING key`,
    [key],
  );
  return rows.length === 1;
}
