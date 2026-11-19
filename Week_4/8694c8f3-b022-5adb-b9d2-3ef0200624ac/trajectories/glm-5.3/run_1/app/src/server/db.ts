import { Client } from 'pg';
import type { Pool } from 'pg';

export type DbPool = Pool;

export async function createDbPool (databaseUrl: string): Promise<DbPool> {
  const { Pool: PgPool } = await import('pg');
  const pool = new PgPool({ connectionString: databaseUrl, max: 10, idleTimeoutMillis: 30_000 });
  const client = await pool.connect();
  client.release();
  return pool;
}

export async function withTransaction<T> (pool: DbPool, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function applySchema (pool: DbPool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id text PRIMARY KEY,
        email text NOT NULL UNIQUE,
        password_hash text NOT NULL,
        display_name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS sets (
        id text PRIMARY KEY,
        owner_id text NOT NULL REFERENCES users(id),
        name text NOT NULL,
        bpm numeric(6,1) NOT NULL DEFAULT 120.0,
        settings_version int NOT NULL DEFAULT 1,
        graph_version int NOT NULL DEFAULT 1,
        active_camera_id text,
        show_token text UNIQUE,
        head bigint NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS members (
        set_id text NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
        user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role text NOT NULL,
        joined_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (set_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS invites (
        token text PRIMARY KEY,
        set_id text NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
        role text NOT NULL,
        used_by text REFERENCES users(id),
        used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS layers (
        id text NOT NULL,
        set_id text NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
        parent_id text,
        index int NOT NULL,
        name text NOT NULL,
        kind text NOT NULL,
        version int NOT NULL DEFAULT 1,
        visible boolean NOT NULL DEFAULT true,
        position jsonb NOT NULL,
        rotation jsonb NOT NULL,
        scale jsonb NOT NULL,
        props jsonb NOT NULL,
        material jsonb,
        model_asset_id text,
        output_buses jsonb NOT NULL DEFAULT '[]'::jsonb,
        shader_version int,
        removed boolean NOT NULL DEFAULT false,
        PRIMARY KEY (set_id, id)
      );
      CREATE INDEX IF NOT EXISTS layers_set_idx ON layers (set_id) WHERE NOT removed;
      CREATE TABLE IF NOT EXISTS keys (
        set_id text NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
        layer_id text NOT NULL,
        property text NOT NULL,
        tick bigint NOT NULL,
        value jsonb NOT NULL,
        PRIMARY KEY (set_id, layer_id, property, tick)
      );
      CREATE TABLE IF NOT EXISTS graph_nodes (
        set_id text NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
        node_id text NOT NULL,
        type text NOT NULL,
        params jsonb NOT NULL,
        x double precision NOT NULL,
        y double precision NOT NULL,
        PRIMARY KEY (set_id, node_id)
      );
      CREATE TABLE IF NOT EXISTS graph_wires (
        set_id text NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
        wire_id text NOT NULL,
        from_node_id text NOT NULL,
        from_port text NOT NULL,
        to_node_id text NOT NULL,
        to_port text NOT NULL,
        PRIMARY KEY (set_id, wire_id)
      );
      CREATE TABLE IF NOT EXISTS scripts (
        id text NOT NULL,
        set_id text NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
        name text NOT NULL,
        version int NOT NULL DEFAULT 1,
        source text NOT NULL,
        asset_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        PRIMARY KEY (set_id, id)
      );
      CREATE TABLE IF NOT EXISTS ops (
        set_id text NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
        seq bigint NOT NULL,
        client_op_id text NOT NULL,
        actor_id text NOT NULL,
        target text NOT NULL,
        type text NOT NULL,
        payload jsonb NOT NULL,
        base_version int,
        version int NOT NULL,
        committed_at timestamptz NOT NULL DEFAULT now(),
        response jsonb NOT NULL,
        PRIMARY KEY (set_id, client_op_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS ops_set_seq_idx ON ops (set_id, seq);
      CREATE TABLE IF NOT EXISTS shader_versions (
        set_id text NOT NULL,
        layer_id text NOT NULL,
        number int NOT NULL,
        sha256 text NOT NULL,
        size int NOT NULL,
        source text NOT NULL,
        author_id text NOT NULL,
        restored_from int,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (set_id, layer_id, number)
      );
      CREATE TABLE IF NOT EXISTS assets (
        id text PRIMARY KEY,
        set_id text NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
        name text NOT NULL,
        kind text NOT NULL,
        size bigint NOT NULL,
        sha256 text NOT NULL,
        status text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS assets_set_idx ON assets (set_id);
      CREATE TABLE IF NOT EXISTS show_versions (
        set_id text NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
        number int NOT NULL,
        status text NOT NULL,
        sha256 text,
        size bigint,
        note text,
        published_at timestamptz,
        published_by text,
        PRIMARY KEY (set_id, number)
      );
      CREATE TABLE IF NOT EXISTS live_pointer (
        set_id text PRIMARY KEY REFERENCES sets(id) ON DELETE CASCADE,
        live_number int
      );
      CREATE TABLE IF NOT EXISTS show_assets (
        set_id text NOT NULL,
        version_number int NOT NULL,
        asset_id text NOT NULL,
        PRIMARY KEY (set_id, version_number, asset_id)
      );
      CREATE TABLE IF NOT EXISTS exports (
        id text PRIMARY KEY,
        set_id text NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
        sha256 text NOT NULL,
        size bigint NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS activity (
        id text PRIMARY KEY,
        set_id text NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
        at timestamptz NOT NULL DEFAULT now(),
        actor_id text NOT NULL,
        action text NOT NULL,
        target text NOT NULL,
        summary text NOT NULL
      );
      CREATE INDEX IF NOT EXISTS activity_set_idx ON activity (set_id, at DESC);
      CREATE TABLE IF NOT EXISTS imports (
        id text PRIMARY KEY,
        set_id text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
  } finally {
    client.release();
  }
}
