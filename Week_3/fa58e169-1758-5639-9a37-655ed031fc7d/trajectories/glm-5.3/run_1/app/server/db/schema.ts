import { sql } from "../../common/env";

/**
 * Idempotent schema applied on serve. Cells are stored as a jsonb document
 * per pattern: the working chart plus each version's snapshot.
 */
export async function applySchema(): Promise<void> {
  await sql(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      verified BOOLEAN NOT NULL DEFAULT FALSE,
      reduce_motion BOOLEAN NOT NULL DEFAULT FALSE,
      verify_token TEXT,
      verify_expires TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await sql(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await sql(`
    CREATE TABLE IF NOT EXISTS patterns (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      craft TEXT NOT NULL,
      mode TEXT NOT NULL,
      terms TEXT,
      cast_on INT NOT NULL,
      width INT NOT NULL,
      height INT NOT NULL,
      chart JSONB NOT NULL,
      state TEXT NOT NULL DEFAULT 'draft',
      published_version INT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await sql(`
    CREATE TABLE IF NOT EXISTS co_designers (
      pattern_id TEXT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (pattern_id, user_id)
    )
  `);
  await sql(`
    CREATE TABLE IF NOT EXISTS versions (
      pattern_id TEXT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
      version INT NOT NULL,
      note TEXT NOT NULL,
      saved_on TEXT NOT NULL,
      stitches INT NOT NULL,
      chart JSONB NOT NULL,
      PRIMARY KEY (pattern_id, version)
    )
  `);
  await sql(`
    CREATE TABLE IF NOT EXISTS colours (
      pattern_id TEXT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
      letter TEXT NOT NULL,
      name TEXT NOT NULL,
      hex TEXT NOT NULL,
      PRIMARY KEY (pattern_id, letter)
    )
  `);
  await sql(`
    CREATE TABLE IF NOT EXISTS invites (
      token TEXT PRIMARY KEY,
      pattern_id TEXT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      status TEXT NOT NULL,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);
  await sql(`
    CREATE TABLE IF NOT EXISTS testers (
      pattern_id TEXT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      version INT NOT NULL,
      row INT NOT NULL DEFAULT 1,
      PRIMARY KEY (pattern_id, user_id)
    )
  `);
  await sql(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      pattern_id TEXT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      version INT NOT NULL,
      row INT NOT NULL,
      text TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await sql(`
    CREATE TABLE IF NOT EXISTS ops (
      op_id TEXT PRIMARY KEY,
      pattern_id TEXT NOT NULL,
      response JSONB NOT NULL
    )
  `);
  await sql(`
    CREATE TABLE IF NOT EXISTS steps (
      step_id TEXT PRIMARY KEY,
      pattern_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      response JSONB NOT NULL
    )
  `);
  await sql(`
    CREATE TABLE IF NOT EXISTS edit_rate (
      user_id TEXT NOT NULL,
      minute BIGINT NOT NULL,
      count INT NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, minute)
    )
  `);
  await sql(`CREATE INDEX IF NOT EXISTS notes_pattern_row ON notes (pattern_id, row)`);
  await sql(`CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id)`);
  await sql(`CREATE INDEX IF NOT EXISTS invites_pattern ON invites (pattern_id)`);
}
