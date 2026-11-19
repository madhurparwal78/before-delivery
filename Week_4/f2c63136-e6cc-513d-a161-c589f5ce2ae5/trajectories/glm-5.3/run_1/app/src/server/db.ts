import pg from 'pg';
import type { AppConfig } from './config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  confirmed BOOLEAN NOT NULL DEFAULT false,
  created_at_ms BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS confirm_tokens (
  token TEXT PRIMARY KEY,
  user_id INT NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INT NOT NULL,
  created_at_ms BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS orgs (
  id SERIAL PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS org_owners (
  org_id INT NOT NULL,
  user_id INT NOT NULL,
  PRIMARY KEY (org_id, user_id)
);
CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY,
  org_id INT NOT NULL,
  name TEXT NOT NULL,
  UNIQUE (org_id, name)
);
CREATE TABLE IF NOT EXISTS team_members (
  org_id INT NOT NULL,
  team_name TEXT NOT NULL,
  user_id INT NOT NULL,
  PRIMARY KEY (org_id, team_name, user_id)
);
CREATE TABLE IF NOT EXISTS repos (
  id SERIAL PRIMARY KEY,
  org_id INT NOT NULL,
  name TEXT NOT NULL,
  visibility TEXT NOT NULL,
  required_approvals INT NOT NULL DEFAULT 1,
  required_checks TEXT[] NOT NULL DEFAULT '{}',
  queue BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (org_id, name)
);
CREATE TABLE IF NOT EXISTS repo_roles (
  repo_id INT NOT NULL,
  subject TEXT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (repo_id, subject)
);
CREATE TABLE IF NOT EXISTS tokens (
  id SERIAL PRIMARY KEY,
  repo_id INT NOT NULL,
  name TEXT NOT NULL,
  access TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at_ms BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS objects (
  key TEXT PRIMARY KEY,
  size INT NOT NULL
);
CREATE TABLE IF NOT EXISTS revisions (
  repo_id INT NOT NULL,
  id TEXT NOT NULL,
  message TEXT NOT NULL,
  author_username TEXT NOT NULL,
  author_name TEXT NOT NULL,
  parent1 TEXT,
  parent2 TEXT,
  created_at_ms BIGINT NOT NULL,
  PRIMARY KEY (repo_id, id)
);
CREATE TABLE IF NOT EXISTS revision_files (
  repo_id INT NOT NULL,
  revision_id TEXT NOT NULL,
  path TEXT NOT NULL,
  key TEXT NOT NULL,
  size INT NOT NULL,
  PRIMARY KEY (repo_id, revision_id, path)
);
CREATE TABLE IF NOT EXISTS branches (
  repo_id INT NOT NULL,
  name TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  PRIMARY KEY (repo_id, name)
);
CREATE TABLE IF NOT EXISTS changes (
  repo_id INT NOT NULL,
  number INT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  head_branch TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  base_revision TEXT NOT NULL,
  state TEXT NOT NULL,
  draft BOOLEAN NOT NULL,
  author_id INT NOT NULL,
  created_at_ms BIGINT NOT NULL,
  removal_reason TEXT,
  merged_revision TEXT,
  restack_result TEXT,
  restack_dismissed INT,
  restack_notice TEXT,
  restack_notice_type TEXT,
  queue_revision_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (repo_id, number)
);
CREATE TABLE IF NOT EXISTS threads (
  id SERIAL PRIMARY KEY,
  repo_id INT NOT NULL,
  change_number INT NOT NULL,
  path TEXT NOT NULL,
  side TEXT NOT NULL,
  line INT NOT NULL,
  end_line INT NOT NULL,
  state TEXT NOT NULL,
  outdated BOOLEAN NOT NULL DEFAULT false,
  revision TEXT NOT NULL,
  created_at_ms BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  thread_id INT NOT NULL,
  author_id INT NOT NULL,
  body TEXT NOT NULL,
  created_at_ms BIGINT NOT NULL,
  suggestion_lines TEXT,
  suggestion_state TEXT,
  suggestion_line INT,
  suggestion_end_line INT
);
CREATE TABLE IF NOT EXISTS reviews (
  id SERIAL PRIMARY KEY,
  repo_id INT NOT NULL,
  change_number INT NOT NULL,
  reviewer_id INT NOT NULL,
  type TEXT NOT NULL,
  state TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  reason TEXT,
  dismissed_by INT,
  diff_signature TEXT NOT NULL,
  created_at_ms BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS review_requests (
  id SERIAL PRIMARY KEY,
  repo_id INT NOT NULL,
  change_number INT NOT NULL,
  user_id INT NOT NULL,
  pending BOOLEAN NOT NULL DEFAULT true,
  created_at_ms BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS viewed_marks (
  repo_id INT NOT NULL,
  change_number INT NOT NULL,
  path TEXT NOT NULL,
  user_id INT NOT NULL,
  PRIMARY KEY (repo_id, change_number, path, user_id)
);
CREATE TABLE IF NOT EXISTS checks (
  id SERIAL PRIMARY KEY,
  repo_id INT NOT NULL,
  revision TEXT NOT NULL,
  name TEXT NOT NULL,
  state TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  created_at_ms BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS queue_entries (
  id SERIAL PRIMARY KEY,
  repo_id INT NOT NULL,
  change_number INT NOT NULL,
  state TEXT NOT NULL,
  position INT NOT NULL,
  revision TEXT NOT NULL,
  reason TEXT,
  vcount INT NOT NULL DEFAULT 1,
  created_at_ms BIGINT NOT NULL,
  ended_at_ms BIGINT
);
CREATE TABLE IF NOT EXISTS queue_state (
  repo_id INT PRIMARY KEY,
  next_step_at_ms BIGINT
);
CREATE TABLE IF NOT EXISTS clock_state (
  id INT PRIMARY KEY,
  offset_seconds BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS outbox (
  id SERIAL PRIMARY KEY,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  headers TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  created_at_ms BIGINT NOT NULL
);
`;

export class Database {
  pool: pg.Pool;
  private cfg: AppConfig;

  constructor(cfg: AppConfig) {
    this.cfg = cfg;
    // BIGINT columns (times, counts) read as exact numbers.
    pg.types.setTypeParser(20, (v: string) => Number(v));
    this.pool = new pg.Pool({ connectionString: cfg.databaseUrl, max: 8 });
  }

  async init(): Promise<void> {
    for (;;) {
      try {
        const client = await this.pool.connect();
        try {
          await client.query(SCHEMA);
          await client.query('INSERT INTO clock_state (id, offset_seconds) VALUES (1, 0) ON CONFLICT (id) DO NOTHING');
        } finally {
          client.release();
        }
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  async healthy(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async withTransaction<T>(fn: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
}
