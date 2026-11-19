import pg from 'pg';
import { config } from './config.ts';
import type { LiveEvent } from '../shared/types.ts';

pg.types.setTypeParser(20, (value) => Number.parseInt(value, 10));
pg.types.setTypeParser(1700, (value) => Number.parseFloat(value));

export type Row = Record<string, any>;

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });
pool.on('error', () => undefined);

/** Subscribers set by the live hub and outbox, called after a transaction commits. */
export const afterCommit = {
  publish: (_repoId: number, _event: LiveEvent): void => undefined,
  mail: (): void => undefined,
};

export interface Db {
  q<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
}

export const db: Db = {
  async q<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await pool.query(sql, params)).rows as T[];
  },
};

export class Tx implements Db {
  readonly events: { repoId: number; event: LiveEvent }[] = [];
  mailQueued = false;

  constructor(private readonly client: pg.PoolClient) {}

  async q<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.client.query(sql, params)).rows as T[];
  }

  emit(repoId: number, event: LiveEvent): void {
    this.events.push({ repoId, event });
  }

  lockRepo(repoId: number): Promise<unknown> {
    return this.q('SELECT pg_advisory_xact_lock($1)', [repoId]);
  }
}

export async function transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const tx = new Tx(client);
  try {
    await client.query('BEGIN');
    const result = await work(tx);
    await client.query('COMMIT');
    for (const { repoId, event } of tx.events) afterCommit.publish(repoId, event);
    if (tx.mailQueued) afterCommit.mail();
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const SCHEMA = `
CREATE SEQUENCE IF NOT EXISTS global_id_seq;
CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY, email text UNIQUE NOT NULL, username text UNIQUE NOT NULL, name text NOT NULL,
  password_hash text NOT NULL, confirmed boolean NOT NULL DEFAULT false, confirm_token text UNIQUE);
CREATE TABLE IF NOT EXISTS sessions (token_hash text PRIMARY KEY, user_id int NOT NULL REFERENCES users(id));
CREATE TABLE IF NOT EXISTS orgs (id serial PRIMARY KEY, slug text UNIQUE NOT NULL, name text NOT NULL);
CREATE TABLE IF NOT EXISTS org_members (
  org_id int NOT NULL REFERENCES orgs(id), user_id int NOT NULL REFERENCES users(id),
  owner boolean NOT NULL DEFAULT false, PRIMARY KEY (org_id, user_id));
CREATE TABLE IF NOT EXISTS teams (
  id serial PRIMARY KEY, org_id int NOT NULL REFERENCES orgs(id), name text NOT NULL, UNIQUE (org_id, name));
CREATE TABLE IF NOT EXISTS team_members (
  team_id int NOT NULL REFERENCES teams(id), user_id int NOT NULL REFERENCES users(id), PRIMARY KEY (team_id, user_id));
CREATE TABLE IF NOT EXISTS repos (
  id bigint PRIMARY KEY DEFAULT nextval('global_id_seq'), org_id int NOT NULL REFERENCES orgs(id), name text NOT NULL,
  visibility text NOT NULL, required_approvals int NOT NULL DEFAULT 1, required_checks jsonb NOT NULL DEFAULT '[]',
  queue boolean NOT NULL DEFAULT false, queue_next_step timestamptz, UNIQUE (org_id, name));
CREATE TABLE IF NOT EXISTS roles (
  repo_id bigint NOT NULL REFERENCES repos(id), subject_kind text NOT NULL, subject_id int NOT NULL, role text NOT NULL,
  PRIMARY KEY (repo_id, subject_kind, subject_id));
CREATE TABLE IF NOT EXISTS tokens (
  id bigint PRIMARY KEY DEFAULT nextval('global_id_seq'), repo_id bigint NOT NULL REFERENCES repos(id), name text NOT NULL,
  access text NOT NULL, token_hash text UNIQUE NOT NULL, revoked boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS revisions (
  repo_id bigint NOT NULL REFERENCES repos(id), id char(12) NOT NULL, parents jsonb NOT NULL, message text NOT NULL,
  author_username text NOT NULL, author_name text NOT NULL, created_at timestamptz NOT NULL, PRIMARY KEY (repo_id, id));
CREATE TABLE IF NOT EXISTS revision_files (
  repo_id bigint NOT NULL, revision_id char(12) NOT NULL, path text NOT NULL COLLATE "C", sha char(64) NOT NULL, size int NOT NULL,
  PRIMARY KEY (repo_id, revision_id, path), FOREIGN KEY (repo_id, revision_id) REFERENCES revisions(repo_id, id));
CREATE TABLE IF NOT EXISTS branches (
  repo_id bigint NOT NULL REFERENCES repos(id), name text NOT NULL, revision char(12) NOT NULL, PRIMARY KEY (repo_id, name));
CREATE TABLE IF NOT EXISTS changes (
  id serial PRIMARY KEY, repo_id bigint NOT NULL REFERENCES repos(id), number int NOT NULL, title text NOT NULL,
  description text NOT NULL DEFAULT '', author_id int NOT NULL REFERENCES users(id), head text NOT NULL, base text NOT NULL,
  base_revision char(12) NOT NULL, head_revision char(12) NOT NULL, state text NOT NULL, removal_reason text, merge_revision char(12),
  restack_result text, restack_dismissed int NOT NULL DEFAULT 0, restack_notice text, restack_notice_kind text,
  queue_revisions int NOT NULL DEFAULT 0, checks_settled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL, UNIQUE (repo_id, number));
CREATE UNIQUE INDEX IF NOT EXISTS changes_one_open_per_head ON changes (repo_id, head) WHERE state <> 'merged';
CREATE TABLE IF NOT EXISTS review_requests (
  id serial PRIMARY KEY, change_id int NOT NULL REFERENCES changes(id), user_id int NOT NULL REFERENCES users(id),
  pending boolean NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS reviews (
  id bigint PRIMARY KEY DEFAULT nextval('global_id_seq'), change_id int NOT NULL REFERENCES changes(id),
  reviewer_id int NOT NULL REFERENCES users(id), type text NOT NULL, state text NOT NULL, summary text NOT NULL DEFAULT '',
  reason text, dismissed_by int REFERENCES users(id), diff_hash text NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS threads (
  id bigint PRIMARY KEY DEFAULT nextval('global_id_seq'), change_id int NOT NULL REFERENCES changes(id), path text NOT NULL,
  side text NOT NULL, line int NOT NULL, end_line int NOT NULL, state text NOT NULL DEFAULT 'unresolved',
  outdated boolean NOT NULL DEFAULT false, revision char(12) NOT NULL, anchor_line int NOT NULL, anchor_end_line int NOT NULL,
  created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS comments (
  id bigint PRIMARY KEY DEFAULT nextval('global_id_seq'), thread_id bigint NOT NULL REFERENCES threads(id),
  author_id int NOT NULL REFERENCES users(id), body text NOT NULL, suggestion jsonb, suggestion_state text,
  created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS viewed (
  change_id int NOT NULL REFERENCES changes(id), user_id int NOT NULL REFERENCES users(id), path text NOT NULL,
  PRIMARY KEY (change_id, user_id, path));
CREATE TABLE IF NOT EXISTS check_reports (
  id bigserial PRIMARY KEY, repo_id bigint NOT NULL REFERENCES repos(id), revision char(12) NOT NULL, name text NOT NULL,
  state text NOT NULL, summary text NOT NULL DEFAULT '', created_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS check_reports_lookup ON check_reports (repo_id, revision, name, id);
CREATE TABLE IF NOT EXISTS queue_entries (
  id bigint PRIMARY KEY DEFAULT nextval('global_id_seq'), repo_id bigint NOT NULL REFERENCES repos(id),
  change_id int NOT NULL REFERENCES changes(id), status text NOT NULL, position int, revision char(12) NOT NULL,
  reason text, checks_settled boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL, finished_at timestamptz);
CREATE TABLE IF NOT EXISTS server_clock (id int PRIMARY KEY CHECK (id = 1), offset_ms bigint NOT NULL);
INSERT INTO server_clock (id, offset_ms) VALUES (1, 0) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY, recipient text NOT NULL, subject text NOT NULL, body text NOT NULL, change_id text,
  created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz);
`;

const SCHEMA_LOCK = 7120001;

/** Keeps trying until Postgres answers; the server is up (health says unavailable) meanwhile. */
export async function ensureSchema(onWait: () => void): Promise<void> {
  for (;;) {
    try {
      const client = await pool.connect();
      try {
        await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK]);
        await client.query(SCHEMA);
        await client.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK]);
      } finally {
        client.release();
      }
      return;
    } catch {
      onWait();
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

export async function postgresReachable(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/** Runs `work` while holding a session-level advisory lock on its own connection. */
export async function withAdvisoryLock<T>(key: number, work: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [key]);
    return await work();
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [key]).catch(() => undefined);
    client.release();
  }
}
