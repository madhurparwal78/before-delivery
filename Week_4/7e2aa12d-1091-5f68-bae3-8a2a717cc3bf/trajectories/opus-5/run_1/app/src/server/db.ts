import { Pool, type PoolClient } from 'pg';
import { config } from './config.js';

const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

let ready = false;

export function postgresReady(): boolean {
  return ready;
}

const SCHEMA = `
create sequence if not exists library_order;

create table if not exists designers (
  id uuid primary key,
  username text not null unique,
  password_hash text not null
);

create table if not exists sessions (
  token text primary key,
  designer_id uuid not null references designers(id) on delete cascade
);

create table if not exists layouts (
  id uuid primary key,
  owner_id uuid not null references designers(id) on delete cascade,
  name text not null,
  revision integer not null,
  state jsonb not null,
  entered_seq bigint not null default nextval('library_order')
);

create table if not exists collaborators (
  layout_id uuid not null references layouts(id) on delete cascade,
  designer_id uuid not null references designers(id) on delete cascade,
  entered_seq bigint not null default nextval('library_order'),
  primary key (layout_id, designer_id)
);

create table if not exists layout_changes (
  layout_id uuid not null references layouts(id) on delete cascade,
  revision integer not null,
  author_id uuid not null references designers(id) on delete cascade,
  change jsonb not null,
  target jsonb not null,
  primary key (layout_id, revision)
);

create table if not exists versions (
  layout_id uuid not null references layouts(id) on delete cascade,
  number integer not null,
  name text not null,
  revision integer not null,
  state jsonb not null,
  primary key (layout_id, number)
);

create table if not exists links (
  token text primary key,
  layout_id uuid not null references layouts(id) on delete cascade,
  kind text not null,
  active boolean not null
);

create index if not exists links_active on links (layout_id, kind, active);
`;

export async function applySchema(): Promise<void> {
  for (;;) {
    try {
      await pool.query(SCHEMA);
      ready = true;
      return;
    } catch {
      ready = false;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

export async function query<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const result = await pool.query(text, values);
  return result.rows as T[];
}

export async function one<T>(text: string, values: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}

/** Changes to a layout are serialised so revisions never repeat or skip. */
export async function transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await run(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
