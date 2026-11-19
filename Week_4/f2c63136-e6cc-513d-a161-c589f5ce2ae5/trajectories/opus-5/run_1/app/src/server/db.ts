import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from './config.js';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

let databaseReady = false;

export function isDatabaseReady(): boolean {
  return databaseReady;
}

export interface Db {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]>;
}

export const db: Db = {
  async query<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await pool.query<T>(sql, params);
    return result.rows;
  },
};

export function clientDb(client: PoolClient): Db {
  return {
    async query<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
      const result = await client.query<T>(sql, params);
      return result.rows;
    },
  };
}

export async function withTx<T>(run: (tx: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await run(clientDb(client));
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const SCHEMA = `
CREATE SEQUENCE IF NOT EXISTS rs_global_id_seq AS bigint START 1;

CREATE TABLE IF NOT EXISTS rs_users (
  id bigint PRIMARY KEY DEFAULT nextval('rs_global_id_seq'),
  username text NOT NULL UNIQUE,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  confirmed boolean NOT NULL DEFAULT false,
  confirm_token text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rs_sessions (
  token text PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES rs_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rs_orgs (
  id bigint PRIMARY KEY DEFAULT nextval('rs_global_id_seq'),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  owner_user_id bigint NOT NULL REFERENCES rs_users(id)
);

CREATE TABLE IF NOT EXISTS rs_teams (
  id bigint PRIMARY KEY DEFAULT nextval('rs_global_id_seq'),
  org_id bigint NOT NULL REFERENCES rs_orgs(id) ON DELETE CASCADE,
  name text NOT NULL,
  UNIQUE (org_id, name)
);

CREATE TABLE IF NOT EXISTS rs_team_members (
  team_id bigint NOT NULL REFERENCES rs_teams(id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES rs_users(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS rs_repos (
  id bigint PRIMARY KEY DEFAULT nextval('rs_global_id_seq'),
  org_id bigint NOT NULL REFERENCES rs_orgs(id) ON DELETE CASCADE,
  name text NOT NULL,
  visibility text NOT NULL,
  default_branch text NOT NULL DEFAULT 'main',
  required_approvals integer NOT NULL DEFAULT 1,
  required_checks text[] NOT NULL DEFAULT '{}',
  queue_on boolean NOT NULL DEFAULT false,
  next_change_number integer NOT NULL DEFAULT 1,
  queue_next_step_at timestamptz,
  UNIQUE (org_id, name)
);

CREATE TABLE IF NOT EXISTS rs_roles (
  id bigint PRIMARY KEY DEFAULT nextval('rs_global_id_seq'),
  repo_id bigint NOT NULL REFERENCES rs_repos(id) ON DELETE CASCADE,
  subject_type text NOT NULL,
  subject_id bigint NOT NULL,
  role text NOT NULL,
  UNIQUE (repo_id, subject_type, subject_id)
);

CREATE TABLE IF NOT EXISTS rs_tokens (
  id bigint PRIMARY KEY DEFAULT nextval('rs_global_id_seq'),
  repo_id bigint NOT NULL REFERENCES rs_repos(id) ON DELETE CASCADE,
  name text NOT NULL,
  access text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rs_revisions (
  repo_id bigint NOT NULL REFERENCES rs_repos(id) ON DELETE CASCADE,
  id text NOT NULL,
  parents text[] NOT NULL DEFAULT '{}',
  message text NOT NULL,
  author_username text NOT NULL,
  author_name text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (repo_id, id)
);

CREATE TABLE IF NOT EXISTS rs_revision_files (
  repo_id bigint NOT NULL,
  revision_id text NOT NULL,
  path text NOT NULL,
  content_key text NOT NULL,
  size integer NOT NULL,
  PRIMARY KEY (repo_id, revision_id, path)
);

CREATE TABLE IF NOT EXISTS rs_objects (
  content_key text PRIMARY KEY,
  size integer NOT NULL
);

CREATE TABLE IF NOT EXISTS rs_branches (
  repo_id bigint NOT NULL REFERENCES rs_repos(id) ON DELETE CASCADE,
  name text NOT NULL,
  revision_id text NOT NULL,
  PRIMARY KEY (repo_id, name)
);

CREATE TABLE IF NOT EXISTS rs_changes (
  id bigint PRIMARY KEY DEFAULT nextval('rs_global_id_seq'),
  repo_id bigint NOT NULL REFERENCES rs_repos(id) ON DELETE CASCADE,
  number integer NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  author_user_id bigint NOT NULL REFERENCES rs_users(id),
  head_branch text NOT NULL,
  base_branch text NOT NULL,
  base_revision text NOT NULL,
  state text NOT NULL,
  merge_revision text,
  removal_reason text,
  restack_result text,
  restack_notice text,
  restack_notice_kind text,
  restack_dismissed_count integer,
  created_at timestamptz NOT NULL,
  UNIQUE (repo_id, number)
);

CREATE TABLE IF NOT EXISTS rs_threads (
  id bigint PRIMARY KEY DEFAULT nextval('rs_global_id_seq'),
  change_id bigint NOT NULL REFERENCES rs_changes(id) ON DELETE CASCADE,
  path text NOT NULL,
  side text NOT NULL,
  line integer NOT NULL,
  end_line integer NOT NULL,
  state text NOT NULL DEFAULT 'unresolved',
  outdated boolean NOT NULL DEFAULT false,
  revision_id text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS rs_comments (
  id bigint PRIMARY KEY DEFAULT nextval('rs_global_id_seq'),
  thread_id bigint NOT NULL REFERENCES rs_threads(id) ON DELETE CASCADE,
  author_user_id bigint NOT NULL REFERENCES rs_users(id),
  body text NOT NULL,
  created_at timestamptz NOT NULL,
  suggestion_lines jsonb,
  suggestion_state text,
  suggestion_line integer,
  suggestion_end_line integer,
  suggestion_revision text
);

CREATE TABLE IF NOT EXISTS rs_reviews (
  id bigint PRIMARY KEY DEFAULT nextval('rs_global_id_seq'),
  change_id bigint NOT NULL REFERENCES rs_changes(id) ON DELETE CASCADE,
  reviewer_user_id bigint NOT NULL REFERENCES rs_users(id),
  type text NOT NULL,
  state text NOT NULL,
  summary text NOT NULL DEFAULT '',
  reason text,
  dismissal_kind text,
  dismissed_by_user_id bigint,
  diff_fingerprint text,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS rs_review_requests (
  id bigint PRIMARY KEY DEFAULT nextval('rs_global_id_seq'),
  change_id bigint NOT NULL REFERENCES rs_changes(id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES rs_users(id) ON DELETE CASCADE,
  pending boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS rs_viewed (
  change_id bigint NOT NULL REFERENCES rs_changes(id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES rs_users(id) ON DELETE CASCADE,
  path text NOT NULL,
  content_key text NOT NULL,
  PRIMARY KEY (change_id, user_id, path)
);

CREATE TABLE IF NOT EXISTS rs_check_reports (
  id bigint PRIMARY KEY DEFAULT nextval('rs_global_id_seq'),
  repo_id bigint NOT NULL REFERENCES rs_repos(id) ON DELETE CASCADE,
  revision_id text NOT NULL,
  name text NOT NULL,
  state text NOT NULL,
  summary text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS rs_check_timeouts (
  repo_id bigint NOT NULL REFERENCES rs_repos(id) ON DELETE CASCADE,
  revision_id text NOT NULL,
  name text NOT NULL,
  timed_out_at timestamptz NOT NULL,
  PRIMARY KEY (repo_id, revision_id, name)
);

CREATE TABLE IF NOT EXISTS rs_queue_entries (
  id bigint PRIMARY KEY DEFAULT nextval('rs_global_id_seq'),
  repo_id bigint NOT NULL REFERENCES rs_repos(id) ON DELETE CASCADE,
  change_id bigint NOT NULL REFERENCES rs_changes(id) ON DELETE CASCADE,
  position integer,
  state text NOT NULL,
  revision_id text,
  revision_counter integer NOT NULL DEFAULT 1,
  revision_set_at timestamptz NOT NULL,
  reason text,
  created_at timestamptz NOT NULL,
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS rs_mail_outbox (
  id bigint PRIMARY KEY DEFAULT nextval('rs_global_id_seq'),
  to_address text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  change_header text,
  state text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  sent_at timestamptz
);

CREATE TABLE IF NOT EXISTS rs_clock (
  id integer PRIMARY KEY,
  offset_seconds bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rs_meta (
  key text PRIMARY KEY,
  value text NOT NULL
);

INSERT INTO rs_clock (id, offset_seconds) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
`;

export async function initSchema(): Promise<void> {
  await pool.query(SCHEMA);
  databaseReady = true;
}

export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await initSchema();
      return;
    } catch (error) {
      databaseReady = false;
      console.error('[db] not ready:', (error as Error).message);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

export async function nextId(tx: Db): Promise<number> {
  const rows = await tx.query<{ id: string }>(`SELECT nextval('rs_global_id_seq')::bigint AS id`);
  return Number(rows[0].id);
}
