import pg from 'pg';
import { config } from './config.js';

pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value));
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });

export type Db = pg.PoolClient | pg.Pool;

const SCHEMA = `
create table if not exists users (
  id uuid primary key,
  email text not null unique,
  password_hash text not null,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  token text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists sets (
  id uuid primary key,
  name text not null,
  bpm numeric(5,1) not null,
  owner_id uuid not null references users(id) on delete cascade,
  head bigint not null default 0,
  settings_version integer not null default 1,
  graph_version integer not null default 1,
  active_camera_id uuid,
  show_token text not null unique,
  live_number integer,
  created_at timestamptz not null default now()
);

create table if not exists set_members (
  set_id uuid not null references sets(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner','editor','viewer')),
  join_order integer not null,
  joined_at timestamptz not null default now(),
  primary key (set_id, user_id)
);

create table if not exists invites (
  token text primary key,
  set_id uuid not null references sets(id) on delete cascade,
  role text not null check (role in ('editor','viewer')),
  created_by uuid not null references users(id) on delete cascade,
  accepted_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists layers (
  id uuid primary key,
  set_id uuid not null references sets(id) on delete cascade,
  parent_id uuid references layers(id) on delete cascade,
  idx integer not null,
  name text not null,
  kind text not null,
  version integer not null default 1,
  visible boolean not null default true,
  position double precision[] not null,
  rotation double precision[] not null,
  scale double precision[] not null,
  props jsonb not null default '{}'::jsonb,
  material jsonb,
  model_asset_id uuid,
  output_buses text[] not null default '{}'::text[],
  shader_version integer
);
create index if not exists layers_set_idx on layers (set_id);

create table if not exists keys (
  set_id uuid not null references sets(id) on delete cascade,
  layer_id uuid not null references layers(id) on delete cascade,
  property text not null,
  tick integer not null,
  value double precision not null,
  primary key (layer_id, property, tick)
);
create index if not exists keys_set_idx on keys (set_id);

create table if not exists graph_nodes (
  set_id uuid not null references sets(id) on delete cascade,
  node_id text not null,
  type text not null,
  params jsonb not null default '{}'::jsonb,
  x double precision not null,
  y double precision not null,
  primary key (set_id, node_id)
);

create table if not exists graph_wires (
  set_id uuid not null references sets(id) on delete cascade,
  wire_id text not null,
  from_node text not null,
  from_port text not null,
  to_node text not null,
  to_port text not null,
  primary key (set_id, wire_id)
);

create table if not exists scripts (
  id uuid primary key,
  set_id uuid not null references sets(id) on delete cascade,
  name text not null,
  version integer not null default 1,
  source text not null,
  asset_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now()
);

create table if not exists ops (
  set_id uuid not null references sets(id) on delete cascade,
  seq bigint not null,
  client_op_id text not null,
  actor_id uuid not null references users(id) on delete cascade,
  target text not null,
  type text not null,
  payload jsonb not null,
  base_version integer,
  response jsonb not null,
  committed_at timestamptz not null default now(),
  primary key (set_id, seq),
  unique (set_id, client_op_id)
);
create index if not exists ops_target_idx on ops (set_id, target, seq desc);

create table if not exists shader_versions (
  set_id uuid not null references sets(id) on delete cascade,
  layer_id uuid not null references layers(id) on delete cascade,
  number integer not null,
  source text not null,
  sha256 text not null,
  size integer not null,
  author_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  restored_from integer,
  primary key (layer_id, number)
);

create table if not exists assets (
  id uuid primary key,
  set_id uuid not null references sets(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('model','texture')),
  content_type text not null,
  size bigint not null,
  sha256 text not null,
  status text not null check (status in ('uploading','ready','upload failed')),
  uploaded_by uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists assets_set_idx on assets (set_id);

create table if not exists show_versions (
  set_id uuid not null references sets(id) on delete cascade,
  number integer not null,
  status text not null check (status in ('storing','published','store failed')),
  sha256 text,
  size bigint,
  note text not null default '',
  asset_ids uuid[] not null default '{}'::uuid[],
  published_by uuid not null references users(id) on delete cascade,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (set_id, number)
);

create table if not exists exports (
  id uuid primary key,
  set_id uuid not null references sets(id) on delete cascade,
  sha256 text not null,
  size bigint not null,
  created_by uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists activity (
  id bigserial primary key,
  set_id uuid not null references sets(id) on delete cascade,
  at timestamptz not null default now(),
  actor_id uuid not null references users(id) on delete cascade,
  action text not null,
  target text not null,
  summary text not null
);
create index if not exists activity_set_idx on activity (set_id, id desc);
`;

export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      const client = await pool.connect();
      try {
        await client.query('select 1');
      } finally {
        client.release();
      }
      return;
    } catch {
      console.log('PostgreSQL unreachable, retrying in 2 seconds');
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA);
}

/** Runs a unit of work in one transaction. */
export async function withTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
