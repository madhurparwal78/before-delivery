import pg from "pg";
import { config } from "./config.js";

pg.types.setTypeParser(1082, (value: string) => value);
pg.types.setTypeParser(1700, (value: string) => Number(value));
pg.types.setTypeParser(20, (value: string) => Number(value));

export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
}

export type Tx = pg.PoolClient;

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });
pool.on("error", () => undefined);

export async function transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Claims a unit of work in the database; true only for the one caller that gets it. */
export async function claim(db: Queryable, key: string): Promise<boolean> {
  const { rowCount } = await db.query("INSERT INTO claims (key) VALUES ($1) ON CONFLICT DO NOTHING", [key]);
  return rowCount === 1;
}

export async function lockProject(tx: Tx, projectId: string): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`project:${projectId}`]);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clock (id int PRIMARY KEY CHECK (id = 1), now timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL, password_hash text NOT NULL,
  verified boolean NOT NULL DEFAULT false, code text, created_at timestamptz NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS people_email ON people (lower(email));
CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY, person_id text NOT NULL REFERENCES people ON DELETE CASCADE,
  created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS teams (
  id text PRIMARY KEY, name text NOT NULL, join_code text NOT NULL UNIQUE, request_counter int NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS memberships (
  team_id text NOT NULL REFERENCES teams ON DELETE CASCADE, person_id text NOT NULL REFERENCES people ON DELETE CASCADE,
  role text NOT NULL, PRIMARY KEY (team_id, person_id));
CREATE TABLE IF NOT EXISTS capacities (
  team_id text NOT NULL REFERENCES teams ON DELETE CASCADE, person_id text NOT NULL REFERENCES people ON DELETE CASCADE,
  weekday text NOT NULL, hours numeric NOT NULL, PRIMARY KEY (team_id, person_id, weekday));
CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY, team_id text NOT NULL REFERENCES teams ON DELETE CASCADE, name text NOT NULL,
  trace jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS sections (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects ON DELETE CASCADE, name text NOT NULL, position int NOT NULL);
CREATE TABLE IF NOT EXISTS fields (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects ON DELETE CASCADE, name text NOT NULL, type text NOT NULL,
  options jsonb NOT NULL DEFAULT '[]', formula text, position int NOT NULL);
CREATE TABLE IF NOT EXISTS tasks (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects ON DELETE CASCADE,
  name text NOT NULL, description text NOT NULL DEFAULT '',
  section_id text NOT NULL REFERENCES sections ON DELETE CASCADE, position int NOT NULL,
  parent_id text REFERENCES tasks ON DELETE CASCADE, assignee_id text REFERENCES people ON DELETE SET NULL,
  start_date date, due_date date, effort numeric, completed boolean NOT NULL DEFAULT false,
  version int NOT NULL DEFAULT 1, recurrence text, values jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL, seq bigserial);
CREATE INDEX IF NOT EXISTS tasks_project ON tasks (project_id);
CREATE INDEX IF NOT EXISTS tasks_parent ON tasks (parent_id);
CREATE TABLE IF NOT EXISTS dependencies (
  from_task text NOT NULL REFERENCES tasks ON DELETE CASCADE, to_task text NOT NULL REFERENCES tasks ON DELETE CASCADE,
  PRIMARY KEY (from_task, to_task));
CREATE TABLE IF NOT EXISTS holds (
  task_id text NOT NULL REFERENCES tasks ON DELETE CASCADE, field text NOT NULL,
  holder_id text NOT NULL REFERENCES people ON DELETE CASCADE, expires_at timestamptz NOT NULL,
  PRIMARY KEY (task_id, field));
CREATE TABLE IF NOT EXISTS presence (
  connection text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks ON DELETE CASCADE,
  person_id text NOT NULL REFERENCES people ON DELETE CASCADE, joined_at timestamptz NOT NULL, left_at timestamptz);
CREATE TABLE IF NOT EXISTS history (
  id bigserial PRIMARY KEY, task_id text NOT NULL REFERENCES tasks ON DELETE CASCADE, text text NOT NULL,
  created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS rules (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects ON DELETE CASCADE, name text NOT NULL,
  position int NOT NULL, trigger jsonb NOT NULL, condition jsonb, action jsonb NOT NULL,
  created_at timestamptz NOT NULL, seq bigserial);
CREATE TABLE IF NOT EXISTS rule_runs (
  id bigserial PRIMARY KEY, project_id text NOT NULL REFERENCES projects ON DELETE CASCADE,
  task_id text NOT NULL REFERENCES tasks ON DELETE CASCADE, depth int NOT NULL, summary text NOT NULL,
  detail text NOT NULL, counted boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS rule_runs_project ON rule_runs (project_id, created_at);
CREATE TABLE IF NOT EXISTS claims (key text PRIMARY KEY);
CREATE TABLE IF NOT EXISTS goals (
  id text PRIMARY KEY, team_id text NOT NULL REFERENCES teams ON DELETE CASCADE, name text NOT NULL,
  parent_id text REFERENCES goals ON DELETE CASCADE, weight int NOT NULL DEFAULT 1,
  manual_value numeric NOT NULL DEFAULT 0, owner_id text REFERENCES people ON DELETE SET NULL);
CREATE TABLE IF NOT EXISTS goal_projects (
  goal_id text NOT NULL REFERENCES goals ON DELETE CASCADE, project_id text NOT NULL REFERENCES projects ON DELETE CASCADE,
  weight int NOT NULL DEFAULT 1, PRIMARY KEY (goal_id, project_id));
CREATE TABLE IF NOT EXISTS forms (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects ON DELETE CASCADE, slug text NOT NULL UNIQUE,
  section_id text NOT NULL REFERENCES sections ON DELETE CASCADE, title text NOT NULL);
CREATE TABLE IF NOT EXISTS approvals (
  id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks ON DELETE CASCADE,
  approver_id text NOT NULL REFERENCES people ON DELETE CASCADE, requester_id text NOT NULL REFERENCES people ON DELETE CASCADE,
  status text NOT NULL, comment text, created_at timestamptz NOT NULL, seq bigserial);
CREATE TABLE IF NOT EXISTS inbox (
  id text PRIMARY KEY, person_id text NOT NULL REFERENCES people ON DELETE CASCADE, text text NOT NULL,
  task_id text REFERENCES tasks ON DELETE CASCADE, kind text NOT NULL DEFAULT 'note', approval_id text,
  read boolean NOT NULL DEFAULT false, archived boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL,
  seq bigserial);
CREATE INDEX IF NOT EXISTS inbox_person ON inbox (person_id);
CREATE TABLE IF NOT EXISTS attachments (
  id text PRIMARY KEY, task_id text NOT NULL REFERENCES tasks ON DELETE CASCADE, name text NOT NULL,
  size int NOT NULL, content_type text NOT NULL, object_key text NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS files (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects ON DELETE CASCADE, format text NOT NULL,
  status text NOT NULL, object_key text, error text, requested_by text, created_at timestamptz NOT NULL);
`;

export async function applySchema(): Promise<void> {
  await transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(7001)");
    await tx.query(SCHEMA);
  });
}
