import { pool } from "./db.ts";
import { writeSeed } from "./seed.ts";

/**
 * Schema, seed and the append-only rules on the audit log, declared once and applied idempotently
 * on every serve. Facts that can change are temporal rows (from_seq, to_seq): a row is in force at
 * seq k when from_seq <= k and (to_seq is null or to_seq > k). Seed rows start at seq 0.
 */
const SCHEMA = `
create table if not exists users (
  id text primary key,
  name text not null,
  email text not null unique,
  role text not null,
  password_hash text not null
);
create table if not exists sessions (
  token_hash text primary key,
  user_id text not null references users(id),
  created_at timestamptz not null default now()
);
create index if not exists sessions_user on sessions(user_id);
create table if not exists assets (
  id text primary key,
  kind text not null,
  description text not null,
  owner_id text not null references users(id),
  registered_seq bigint not null
);
create table if not exists columns (
  id text primary key,
  asset_id text not null references assets(id),
  name text not null,
  data_type text not null,
  samples jsonb not null,
  ord int not null
);
create index if not exists columns_asset on columns(asset_id);
create table if not exists edges (
  id text primary key,
  from_col text not null references columns(id),
  to_col text not null references columns(id),
  transform text not null,
  from_seq bigint not null,
  to_seq bigint
);
create unique index if not exists edges_live_pair on edges(from_col, to_col) where to_seq is null;
create table if not exists direct_tags (
  column_id text not null references columns(id),
  tag text not null,
  from_seq bigint not null,
  to_seq bigint
);
create index if not exists direct_tags_col on direct_tags(column_id);
create unique index if not exists direct_tags_live on direct_tags(column_id, tag) where to_seq is null;
create table if not exists suppressions (
  id text primary key,
  column_id text not null references columns(id),
  tag text not null,
  justification text not null,
  actor_id text not null,
  at text not null,
  from_seq bigint not null,
  to_seq bigint
);
create unique index if not exists suppressions_live on suppressions(column_id, tag) where to_seq is null;
create table if not exists column_tags (
  column_id text not null references columns(id),
  tag text not null,
  sources text[] not null,
  primary key (column_id, tag)
);
create table if not exists tag_batches (
  id text primary key,
  asset_id text not null,
  tag text not null,
  seq bigint not null,
  applied jsonb not null,
  undone_seq bigint
);
create table if not exists evidence (
  id text primary key,
  asset_id text not null,
  object_key text not null,
  filename text not null,
  content_type text not null,
  size_bytes bigint not null,
  sha256 text not null,
  uploaded_at text not null,
  uploaded_by text not null
);
create table if not exists deprecation_events (
  id text primary key,
  asset_id text not null,
  reason text not null,
  at text not null,
  by_id text not null
);
create table if not exists certifications (
  asset_id text not null references assets(id),
  state text not null,
  verified_at text,
  evidence_id text,
  deprecation_id text,
  from_seq bigint not null,
  to_seq bigint
);
create unique index if not exists certifications_live on certifications(asset_id) where to_seq is null;
create table if not exists notices (
  id text primary key,
  event_id text not null,
  asset_id text not null,
  owner_id text not null,
  to_header text not null,
  subject text not null,
  body text not null,
  state text not null,
  claimed_until timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notices_state on notices(state);
create table if not exists terms (
  id text primary key
);
create table if not exists term_revisions (
  term_id text not null references terms(id),
  name text not null,
  name_key text not null,
  definition text not null,
  revision int not null,
  from_seq bigint not null,
  to_seq bigint
);
create unique index if not exists term_revisions_live on term_revisions(term_id) where to_seq is null;
create unique index if not exists term_names_live on term_revisions(name_key) where to_seq is null;
create table if not exists term_links (
  asset_id text not null references assets(id),
  term_id text not null references terms(id),
  from_seq bigint not null,
  to_seq bigint
);
create unique index if not exists term_links_live on term_links(asset_id, term_id) where to_seq is null;
create table if not exists idempotency (
  user_id text not null,
  route text not null,
  asset_id text not null,
  key text not null,
  fingerprint text,
  state text not null,
  status int,
  body jsonb,
  primary key (user_id, route, asset_id, key)
);
create table if not exists audit_log (
  seq bigint primary key,
  id text not null unique,
  at text not null,
  actor_id text not null,
  actor_role text not null,
  action text not null,
  target_type text not null,
  target_id text not null,
  before json,
  after json,
  prev_hash text not null unique,
  hash text not null
);
create index if not exists audit_target on audit_log(target_id);
create or replace function audit_log_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'audit_log_no_change' and tgrelid = 'audit_log'::regclass) then
    create trigger audit_log_no_change before update or delete on audit_log
      for each row execute function audit_log_append_only();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'audit_log_no_truncate' and tgrelid = 'audit_log'::regclass) then
    create trigger audit_log_no_truncate before truncate on audit_log
      for each statement execute function audit_log_append_only();
  end if;
end;
$$;
create table if not exists strata_meta (
  key text primary key,
  value text not null
);
`;

const MIGRATION_LOCK = 7_410_001;

export async function migrateAndSeed(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await client.query(SCHEMA);
    const seeded = await client.query("select 1 from strata_meta where key = 'seeded'");
    if (!seeded.rowCount) {
      await client.query("BEGIN");
      try {
        await writeSeed(client);
        await client.query("insert into strata_meta(key, value) values ('seeded', 'true')");
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
}
