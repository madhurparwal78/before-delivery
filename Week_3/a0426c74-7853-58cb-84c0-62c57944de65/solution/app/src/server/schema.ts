import { db, type Queryable } from './db.ts';
import { applyExtraSchema } from './registry.ts';

const SCHEMA_LOCK_KEY = 71036001;

// Folders and drawings are listed in creation order, so their `created_at` is the time of the insert, not of the transaction.
// Entities live in their own table keyed by (drawing, handle); the small collections of a drawing are jsonb columns.
// `op_groups` is the operation log in server order (keyed by the revision after the group); `group_targets` lists what each
// group changed, for the entity history and the conflict checks; `undo_entries` holds each person's undo and redo stacks.
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    username text PRIMARY KEY,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash text PRIMARY KEY,
    username text NOT NULL REFERENCES users(username),
    created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS folders (
    id text PRIMARY KEY,
    name text NOT NULL,
    parent_id text REFERENCES folders(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp())`,
  `CREATE INDEX IF NOT EXISTS folders_parent ON folders (parent_id)`,
  `CREATE TABLE IF NOT EXISTS folder_roles (
    folder_id text NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    username text NOT NULL REFERENCES users(username),
    role text NOT NULL,
    PRIMARY KEY (folder_id, username))`,
  `CREATE INDEX IF NOT EXISTS folder_roles_username ON folder_roles (username)`,
  `CREATE TABLE IF NOT EXISTS drawings (
    id text PRIMARY KEY,
    folder_id text NOT NULL REFERENCES folders(id),
    name text NOT NULL,
    revision integer NOT NULL DEFAULT 0,
    next_handle integer NOT NULL DEFAULT 1,
    layers jsonb NOT NULL,
    blocks jsonb NOT NULL,
    dim_styles jsonb NOT NULL,
    parameters jsonb NOT NULL,
    constraints jsonb NOT NULL,
    xrefs jsonb NOT NULL,
    layer_states jsonb NOT NULL,
    underlays jsonb NOT NULL,
    xref_sources text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (folder_id, name))`,
  `CREATE INDEX IF NOT EXISTS drawings_xref_sources ON drawings USING gin (xref_sources)`,
  `CREATE TABLE IF NOT EXISTS entities (
    drawing_id text NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
    handle text NOT NULL,
    data jsonb NOT NULL,
    PRIMARY KEY (drawing_id, handle))`,
  `CREATE TABLE IF NOT EXISTS op_groups (
    drawing_id text NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
    revision integer NOT NULL,
    base_revision integer NOT NULL,
    group_id text NOT NULL,
    username text NOT NULL,
    command text NOT NULL,
    at timestamptz NOT NULL,
    ops jsonb NOT NULL,
    results jsonb NOT NULL,
    changes jsonb NOT NULL,
    PRIMARY KEY (drawing_id, revision))`,
  `CREATE TABLE IF NOT EXISTS op_ids (
    drawing_id text NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
    op_id text NOT NULL,
    revision integer NOT NULL,
    PRIMARY KEY (drawing_id, op_id))`,
  `CREATE TABLE IF NOT EXISTS group_targets (
    drawing_id text NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
    kind text NOT NULL,
    key text NOT NULL,
    revision integer NOT NULL,
    derived boolean NOT NULL,
    PRIMARY KEY (drawing_id, kind, key, revision))`,
  `CREATE TABLE IF NOT EXISTS undo_entries (
    id bigserial PRIMARY KEY,
    drawing_id text NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
    username text NOT NULL,
    direction text NOT NULL CHECK (direction IN ('undo', 'redo')),
    revision integer NOT NULL,
    command text NOT NULL,
    changes jsonb NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS undo_entries_stack ON undo_entries (drawing_id, username, direction, id)`,
  `CREATE TABLE IF NOT EXISTS drawing_views (
    token_hash text NOT NULL,
    drawing_id text NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
    zoom double precision NOT NULL,
    pan_x double precision NOT NULL,
    pan_y double precision NOT NULL,
    PRIMARY KEY (token_hash, drawing_id))`,
];

/** Applies every table and index this server needs, idempotently, while holding the schema lock (two copies may share a database). */
export function applySchema(): Promise<void> {
  return db.withAdvisoryLock(SCHEMA_LOCK_KEY, async (q: Queryable) => {
    for (const sql of STATEMENTS) await q.query(sql);
    await applyExtraSchema(q);
  });
}
