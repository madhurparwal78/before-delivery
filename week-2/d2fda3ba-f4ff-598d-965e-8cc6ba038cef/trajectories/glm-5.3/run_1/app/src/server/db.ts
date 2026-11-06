import pg from 'pg';

const createStatements = [
  `create extension if not exists pgcrypto`,
  `create table if not exists accounts(
    id uuid primary key default gen_random_uuid(),
    email text unique not null,
    password_hash text not null,
    display_name text not null,
    time_zone text not null,
    operator boolean not null default false,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists devices(
    id uuid primary key default gen_random_uuid(),
    account_id uuid not null references accounts(id) on delete cascade,
    name text not null,
    approved boolean not null default false,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists device_approvals(
    token text primary key,
    device_id uuid not null references devices(id) on delete cascade,
    account_id uuid not null references accounts(id) on delete cascade,
    used boolean not null default false,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null
  )`,
  `create table if not exists sessions(
    token text primary key,
    account_id uuid not null references accounts(id) on delete cascade,
    device_id uuid not null references devices(id) on delete cascade,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists vaults(
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references accounts(id) on delete cascade,
    name text not null,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists invites(
    id uuid primary key default gen_random_uuid(),
    token text not null unique,
    vault_id uuid not null references vaults(id) on delete cascade,
    email text not null,
    used boolean not null default false,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null
  )`,
  `create table if not exists vault_members(
    vault_id uuid not null references vaults(id) on delete cascade,
    account_id uuid not null references accounts(id) on delete cascade,
    role text not null,
    primary key (vault_id, account_id)
  )`,
  `create table if not exists key_envelopes(
    vault_id uuid primary key references vaults(id) on delete cascade,
    salt text not null,
    iterations int not null,
    iv text not null,
    wrapped_key text not null
  )`,
  `create table if not exists device_cursors(
    vault_id uuid not null references vaults(id) on delete cascade,
    device_id uuid not null references devices(id) on delete cascade,
    cursor int not null default 0,
    primary key (vault_id, device_id)
  )`,
  `create table if not exists revisions(
    vault_id uuid not null references vaults(id) on delete cascade,
    rev int not null,
    note_id uuid not null,
    base_revision int,
    ciphertext_sha256 text not null,
    byte_length int not null,
    device_id uuid not null,
    device_name text not null,
    restored_from int,
    created_at timestamptz not null default now(),
    primary key (vault_id, rev)
  )`,
  `create table if not exists idempotency(
    device_id uuid not null,
    endpoint text not null,
    key text not null,
    request_hash text not null,
    status int not null,
    body jsonb not null,
    extra jsonb,
    created_at timestamptz not null default now(),
    primary key (device_id, endpoint, key)
  )`,
  `create table if not exists dossiers(
    id uuid primary key default gen_random_uuid(),
    account_id uuid not null references accounts(id) on delete cascade,
    slug text not null,
    root_note_id uuid not null,
    state text not null default 'draft',
    radius int,
    publish_id text,
    created_at timestamptz not null default now(),
    published_at timestamptz,
    unpublished_at timestamptz
  )`,
  `create table if not exists publishes(
    id uuid primary key default gen_random_uuid(),
    dossier_id uuid not null references dossiers(id) on delete cascade,
    publish_key text not null,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists preview_links(
    id uuid primary key default gen_random_uuid(),
    dossier_id uuid not null references dossiers(id) on delete cascade,
    state text not null default 'active',
    token_hash text not null,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
  )`,
  `create index if not exists preview_links_dossier on preview_links(dossier_id, created_at desc)`,
  `create table if not exists seed_addons(
    account_id uuid not null references accounts(id) on delete cascade,
    addon text not null,
    primary key (account_id, addon)
  )`,
  `create table if not exists warns(
    account_id uuid primary key,
    sent_at timestamptz not null default now(),
    sent boolean not null default false
  )`,
  `create table if not exists emails(
    id uuid primary key default gen_random_uuid(),
    to_addr text not null,
    subject text not null,
    text text not null,
    html text not null,
    sent boolean not null default false,
    tries int not null default 0,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists billing(
    account_id uuid primary key,
    sync_state text not null default 'none',
    sync_period_end timestamptz,
    sync_checked timestamptz,
    publish_state text not null default 'none',
    publish_period_end timestamptz,
    publish_checked timestamptz
  )`,
];

let pool: pg.Pool | undefined;
let ready: Promise<pg.Pool> | undefined;

export async function poolGet(): Promise<pg.Pool> {
  if (pool) return pool;
  if (!ready) {
    ready = (async () => {
      const p = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 20, idleTimeoutMillis: 30000 });
      // retry until postgres reachable
      for (;;) {
        try {
          const c = await p.connect();
          c.release();
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      const client = await p.connect();
      try {
        for (const s of createStatements) await client.query(s);
      } finally {
        client.release();
      }
      return p;
    })();
  }
  return ready;
}

export async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  const p = await poolGet();
  return p.query<T>(text, params as never[]);
}

export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const p = await poolGet();
  const client = await p.connect();
  try {
    await client.query('begin');
    const r = await fn(client);
    await client.query('commit');
    return r;
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
