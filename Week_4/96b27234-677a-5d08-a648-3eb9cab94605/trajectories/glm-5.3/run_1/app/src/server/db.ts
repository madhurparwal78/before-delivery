// Postgres access. The schema is applied idempotently on serve, safely from
// several instances starting together.
import { Pool, PoolClient, type QueryResultRow } from 'pg';
import { config } from './config';

export const pool = new Pool({ connectionString: config.databaseUrl });

let schemaPromise: Promise<void> | null = null;

export async function applySchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`
          CREATE TABLE IF NOT EXISTS worlds (
            id text PRIMARY KEY,
            clock_mode text NOT NULL DEFAULT 'real',
            clock_at timestamptz,
            seeded boolean NOT NULL DEFAULT false
          );
          CREATE TABLE IF NOT EXISTS people (
            id text PRIMARY KEY,
            world_id text NOT NULL,
            email text NOT NULL,
            password_hash text NOT NULL,
            display_name text NOT NULL,
            time_zone text NOT NULL,
            site_role text NOT NULL,
            avatar_id text,
            hide_above text,
            confirmed boolean NOT NULL DEFAULT false,
            confirm_token text,
            suspended boolean NOT NULL DEFAULT false,
            warned boolean NOT NULL DEFAULT false,
            last_step_at bigint,
            created_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (email)
          );
          CREATE TABLE IF NOT EXISTS sessions_table (
            id text PRIMARY KEY,
            world_id text NOT NULL,
            room_id text NOT NULL,
            host_id text NOT NULL,
            visibility text NOT NULL,
            capacity int NOT NULL,
            community_id text,
            status text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
          );
          CREATE TABLE IF NOT EXISTS session_members (
            session_id text NOT NULL,
            person_id text NOT NULL,
            room_version int NOT NULL,
            joined_at timestamptz NOT NULL DEFAULT now(),
            left_at timestamptz,
            removed boolean NOT NULL DEFAULT false,
            PRIMARY KEY (session_id, person_id)
          );
          CREATE TABLE IF NOT EXISTS invitations (
            session_id text NOT NULL,
            person_id text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (session_id, person_id)
          );
          CREATE TABLE IF NOT EXISTS friendships (
            person_id text NOT NULL,
            friend_id text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (person_id, friend_id)
          );
          CREATE TABLE IF NOT EXISTS blocks (
            person_id text NOT NULL,
            blocked_id text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (person_id, blocked_id)
          );
          CREATE TABLE IF NOT EXISTS mutes (
            person_id text NOT NULL,
            muted_id text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (person_id, muted_id)
          );
          CREATE TABLE IF NOT EXISTS assets (
            id text PRIMARY KEY,
            world_id text NOT NULL,
            kind text NOT NULL,
            name text NOT NULL,
            owner_id text NOT NULL,
            current_version int
          );
          CREATE TABLE IF NOT EXISTS versions (
            asset_id text NOT NULL,
            version int NOT NULL,
            status text NOT NULL,
            rank text NOT NULL,
            worst_measure text NOT NULL,
            measures jsonb NOT NULL,
            layout jsonb,
            created_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (asset_id, version)
          );
          CREATE TABLE IF NOT EXISTS communities (
            id text PRIMARY KEY,
            world_id text NOT NULL,
            name text NOT NULL,
            time_zone text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
          );
          CREATE TABLE IF NOT EXISTS community_members (
            community_id text NOT NULL,
            person_id text NOT NULL,
            role text NOT NULL,
            joined_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (community_id, person_id)
          );
          CREATE TABLE IF NOT EXISTS gatherings (
            id text PRIMARY KEY,
            community_id text NOT NULL,
            title text NOT NULL,
            starts_local text NOT NULL,
            duration_minutes int NOT NULL,
            recurrence text NOT NULL,
            limit_count int NOT NULL
          );
          CREATE TABLE IF NOT EXISTS gathering_attendees (
            gathering_id text NOT NULL,
            person_id text NOT NULL,
            PRIMARY KEY (gathering_id, person_id)
          );
          CREATE TABLE IF NOT EXISTS reminders_sent (
            gathering_id text NOT NULL,
            person_id text NOT NULL,
            occurrence_start timestamptz NOT NULL,
            PRIMARY KEY (gathering_id, person_id, occurrence_start)
          );
          CREATE TABLE IF NOT EXISTS votes (
            id text PRIMARY KEY,
            session_id text NOT NULL,
            target_id text NOT NULL,
            starter_id text NOT NULL,
            status text NOT NULL,
            eligible jsonb NOT NULL,
            needed int NOT NULL,
            yes int NOT NULL,
            no int NOT NULL,
            closes_at timestamptz NOT NULL
          );
          CREATE TABLE IF NOT EXISTS ballots (
            vote_id text NOT NULL,
            person_id text NOT NULL,
            choice text NOT NULL,
            PRIMARY KEY (vote_id, person_id)
          );
          CREATE TABLE IF NOT EXISTS reports (
            id text PRIMARY KEY,
            world_id text NOT NULL,
            person_id text NOT NULL,
            session_id text NOT NULL,
            category text NOT NULL,
            details text NOT NULL,
            state text NOT NULL,
            action text,
            created_at timestamptz NOT NULL DEFAULT now()
          );
          CREATE TABLE IF NOT EXISTS friend_invites (
            id text PRIMARY KEY,
            world_id text NOT NULL,
            from_id text NOT NULL,
            email text NOT NULL,
            state text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            expires_at timestamptz NOT NULL
          );
          CREATE TABLE IF NOT EXISTS mail_outbox (
            id text PRIMARY KEY,
            world_id text NOT NULL,
            to_email text NOT NULL,
            subject text NOT NULL,
            body text NOT NULL,
            sent boolean NOT NULL DEFAULT false,
            created_at timestamptz NOT NULL DEFAULT now()
          );
          CREATE TABLE IF NOT EXISTS app_meta (
            key text PRIMARY KEY,
            value text NOT NULL
          );
          CREATE TABLE IF NOT EXISTS chat_messages (
            id text PRIMARY KEY,
            session_id text NOT NULL,
            from_id text NOT NULL,
            text text NOT NULL,
            sent_at timestamptz NOT NULL,
            to_ids jsonb NOT NULL
          );
          ALTER TABLE friend_invites ADD COLUMN IF NOT EXISTS token text;
        `);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        schemaPromise = null;
        throw e;
      } finally {
        client.release();
      }
    })();
  }
  return schemaPromise;
}

export async function query<T extends QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]> {
  return (await pool.query(sql, params)).rows as T[];
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
