import { query } from './db.js';

const statements = [
  `create table if not exists app_secrets (
     name text primary key,
     value text not null
   )`,
  `create table if not exists workspaces (
     id text primary key,
     name text not null,
     created_at timestamptz not null default now()
   )`,
  `create table if not exists users (
     id text primary key,
     workspace_id text not null references workspaces(id) on delete cascade,
     email text not null,
     email_lower text not null unique,
     password_hash text not null,
     display_name text not null,
     role text not null,
     created_at timestamptz not null default now()
   )`,
  `create table if not exists rooms (
     id text primary key,
     workspace_id text not null references workspaces(id) on delete cascade,
     name text not null,
     name_lower text not null,
     starter boolean not null default false,
     width_mm integer not null,
     depth_mm integer not null,
     height_mm integer not null,
     version integer not null default 1,
     revision integer not null default 0,
     has_thumbnail boolean not null default false,
     created_at timestamptz not null default now()
   )`,
  `create unique index if not exists rooms_workspace_name on rooms (workspace_id, name_lower)`,
  `create table if not exists placements (
     id text primary key,
     room_id text not null references rooms(id) on delete cascade,
     kind text not null,
     label text not null,
     prop_id text,
     entry boolean not null default false,
     x_mm integer not null,
     y_mm integer not null,
     z_mm integer not null,
     rotation_deg integer not null default 0,
     width_mm integer not null,
     depth_mm integer not null,
     height_mm integer not null,
     version integer not null default 1,
     created_seq bigserial,
     scene_pos integer not null default 0,
     deleted_at timestamptz,
     deleted_by text
   )`,
  `create index if not exists placements_room on placements (room_id)`,
  `create table if not exists trigger_nodes (
     id text primary key,
     room_id text not null references rooms(id) on delete cascade,
     title text not null,
     kind text not null,
     placement_id text,
     answer text,
     prerequisites jsonb not null default '[]'::jsonb,
     version integer not null default 1,
     created_seq bigserial
   )`,
  `create index if not exists trigger_nodes_room on trigger_nodes (room_id)`,
  `create table if not exists props (
     id text primary key,
     workspace_id text not null references workspaces(id) on delete cascade,
     name text not null,
     width_mm integer not null,
     depth_mm integer not null,
     height_mm integer not null,
     content_type text not null,
     bytes integer not null,
     sha256 text not null,
     created_at timestamptz not null default now(),
     created_seq bigserial
   )`,
  `create table if not exists room_versions (
     id text primary key,
     room_id text not null references rooms(id) on delete cascade,
     number integer not null,
     label text not null,
     state text not null,
     superseded_by integer,
     frozen_at timestamptz not null,
     stats jsonb not null,
     link_token text,
     snapshot_key text not null,
     room_snapshot jsonb not null,
     placements jsonb not null,
     nodes jsonb not null,
     props jsonb not null,
     scene_order jsonb not null
   )`,
  `create unique index if not exists room_versions_number on room_versions (room_id, number)`,
  `create unique index if not exists room_versions_token on room_versions (link_token)`,
  `create table if not exists playtests (
     id text primary key,
     room_id text not null references rooms(id) on delete cascade,
     kind text not null,
     state text not null,
     host_user_id text not null,
     starts_at timestamptz not null,
     started_at timestamptz,
     ended_at timestamptz,
     outcome text,
     duration_seconds integer not null,
     created_at timestamptz not null default now()
   )`,
  `create index if not exists playtests_room on playtests (room_id)`,
  `create unique index if not exists playtests_one_active on playtests (room_id)
     where state in ('lobby','running')`,
  `create table if not exists solves (
     id text primary key,
     session_id text not null references playtests(id) on delete cascade,
     node_id text not null,
     title text not null,
     elapsed_seconds integer not null,
     solved_by text,
     created_at timestamptz not null default now(),
     created_seq bigserial
   )`,
  `create unique index if not exists solves_session_node on solves (session_id, node_id)`,
  `create table if not exists hints (
     id text primary key,
     session_id text not null references playtests(id) on delete cascade,
     text text not null,
     sent_at timestamptz not null
   )`,
  `create table if not exists invites (
     id text primary key,
     session_id text not null references playtests(id) on delete cascade,
     email text not null,
     token text not null unique,
     display_name text,
     joined boolean not null default false,
     revoked boolean not null default false,
     x_mm integer,
     z_mm integer,
     heading_deg integer,
     created_at timestamptz not null default now(),
     created_seq bigserial
   )`,
  `create table if not exists mail_messages (
     id text primary key,
     kind text not null,
     recipient text not null,
     subject text not null,
     body text not null,
     status text not null,
     attempts integer not null default 0,
     invite_id text,
     session_id text,
     created_at timestamptz not null default now(),
     next_attempt_at timestamptz not null default now()
   )`,
  `create table if not exists idempotency_keys (
     id text primary key,
     workspace_id text not null references workspaces(id) on delete cascade,
     key text not null,
     room_id text not null,
     body_hash text not null,
     response_status integer,
     response jsonb,
     created_at timestamptz not null default now()
   )`,
  `create unique index if not exists idempotency_keys_unique on idempotency_keys (workspace_id, key)`,
  `create table if not exists room_changes (
     id text primary key,
     workspace_id text not null references workspaces(id) on delete cascade,
     room_id text not null references rooms(id) on delete cascade,
     revision integer not null,
     op_id text,
     kind text not null,
     placement_id text,
     user_id text not null,
     response_status integer not null,
     response jsonb not null,
     created_at timestamptz not null default now()
   )`,
  `create unique index if not exists room_changes_op on room_changes (workspace_id, op_id)`,
  `create index if not exists room_changes_room on room_changes (room_id, revision)`,
  `create table if not exists undo_entries (
     id text primary key,
     room_id text not null references rooms(id) on delete cascade,
     user_id text not null,
     placement_id text not null,
     before_fields jsonb not null,
     created_seq bigserial
   )`,
];

export async function applySchema(): Promise<void> {
  await query('select pg_advisory_lock(728341)');
  try {
    for (const statement of statements) {
      await query(statement);
    }
  } finally {
    await query('select pg_advisory_unlock(728341)');
  }
}
