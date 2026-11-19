import pg from 'pg';
import { config } from './config.js';

pg.types.setTypeParser(1082, (value: string) => value);
pg.types.setTypeParser(20, (value: string) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });

export type QueryParam = string | number | boolean | null | Date | string[] | object;

export interface Queryable {
  query<Row extends pg.QueryResultRow>(text: string, params?: QueryParam[]): Promise<pg.QueryResult<Row>>;
}

export const db: Queryable = {
  query: (text, params) => pool.query(text, params as unknown[]),
};

export const LIVE_CHANNEL = 'rulehouse_live';

export async function withTransaction<T>(run: (tx: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await run({ query: (text, params) => client.query(text, params as unknown[]) });
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const SCHEMA = `
create table if not exists app_clock (id int primary key, now_at timestamptz not null);
create table if not exists counters (name text primary key, value bigint not null);
create table if not exists organisations (
  id text primary key, name text not null, kind text not null, territory text not null,
  engagement_starts_on date, engagement_ends_on date, territories text[] not null default '{}',
  sort int not null default 0);
create table if not exists principals (
  id text primary key, email text not null unique, display_name text not null, role text not null,
  password_hash text not null, organisation_id text not null references organisations(id), sort int not null default 0);
create table if not exists groups (id text primary key, name text not null);
create table if not exists group_members (
  group_id text not null references groups(id), principal_id text not null references principals(id),
  primary key (group_id, principal_id));
create table if not exists licences (
  id text primary key, name text not null, permitted_applications text[] not null, prohibited_applications text[] not null,
  audiences text[] not null, territories text[] not null, excluded_territories text[] not null,
  default_duration_days int not null, modification_permitted boolean not null, attribution_required boolean not null);
create table if not exists assets (
  id text primary key, name text not null, class text not null, state text not null,
  licence_id text not null references licences(id), successor_id text, sort int not null default 0);
create table if not exists variants (
  id text primary key, asset_id text not null references assets(id), key text not null, label text not null, sort int not null);
create table if not exists derivatives (
  id text primary key, asset_id text not null references assets(id), variant_id text references variants(id),
  file_name text not null, format text not null, width int not null, height int not null, byte_size int not null,
  object_key text not null, sort int not null);
create table if not exists sessions (
  id text primary key, principal_id text not null references principals(id), created_at timestamptz not null);
create table if not exists invitations (
  id text primary key, token text not null unique, email text not null, display_name text not null, role text not null,
  organisation_id text not null, created_at timestamptz not null, expires_at timestamptz not null, used_at timestamptz);
create table if not exists requests (
  id text primary key, requester_id text not null references principals(id), asset_id text not null, variant_id text,
  application_class text not null, territories text[] not null, campaign_starts_on date not null, campaign_ends_on date not null,
  cited_rules text[] not null, note text, state text not null, holder_id text not null,
  submitted_at timestamptz, deadline timestamptz, escalation text, submission_seq int not null default 0,
  cited_versions jsonb not null default '{}'::jsonb, grants_snapshot jsonb not null default '[]'::jsonb,
  created_at timestamptz not null, sort bigint not null);
create table if not exists request_stages (
  request_id text not null references requests(id), n int not null, kind text not null, assignee_id text,
  decision text, decided_by text, decided_at timestamptz, comment text,
  primary key (request_id, n));
create table if not exists conditions (
  id text primary key, request_id text, grant_id text, kind text not null, value text, text text not null,
  added_by text, sort bigint not null);
create table if not exists grants (
  id text primary key, holder_principal_id text, holder_group_id text, asset_id text not null, variant_id text,
  request_id text, not_before date, not_after date not null, status text not null, cap text, revoked_reason text,
  sort bigint not null);
create table if not exists proofs (
  id text primary key, grant_id text not null references grants(id), file_name text not null, status text not null,
  reason text, uploaded_at timestamptz not null, object_key text not null, content_type text not null, sort bigint not null);
create table if not exists chapters (slug text primary key, title text not null, sort int not null);
create table if not exists chapter_versions (
  id text primary key, slug text not null references chapters(slug), number int not null, state text not null,
  author_id text, published_at timestamptz, intro text not null, statements jsonb not null, asset_ids text[] not null,
  withdrawn jsonb not null, revision int not null default 1, review_comment text, unique (slug, number));
create table if not exists audit_log (
  sequence bigint primary key, occurred_at timestamptz not null, actor_id text not null, actor_role text not null,
  action text not null, resource_type text not null, resource_id text not null, request_id text,
  before jsonb, after jsonb, outcome text not null, previous_hash text not null, record_hash text not null);
create table if not exists outbox (
  id bigserial primary key, to_email text not null, subject text not null, body text not null,
  created_at timestamptz not null, sent_at timestamptz, attempts int not null default 0, last_attempt_at timestamptz);
create table if not exists timers (
  id bigserial primary key, request_id text not null, kind text not null, submission_seq int not null,
  due_at timestamptz not null, fired_at timestamptz, cancelled boolean not null default false);
create table if not exists idempotency (
  key text not null, principal_id text not null, body_hash text not null, response jsonb not null,
  created_at timestamptz not null, primary key (key, principal_id));
create index if not exists requests_state_idx on requests (state);
create index if not exists stages_assignee_idx on request_stages (assignee_id);
create index if not exists timers_due_idx on timers (due_at) where fired_at is null and cancelled = false;
`;

export const TABLES = [
  'audit_log',
  'idempotency',
  'timers',
  'outbox',
  'proofs',
  'conditions',
  'grants',
  'request_stages',
  'requests',
  'chapter_versions',
  'chapters',
  'derivatives',
  'variants',
  'assets',
  'licences',
  'group_members',
  'groups',
  'invitations',
  'sessions',
  'principals',
  'organisations',
  'counters',
] as const;

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA);
}

export async function waitForDatabase(): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await pool.query('select 1');
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

export async function nextCounter(tx: Queryable, name: string): Promise<number> {
  const result = await tx.query<{ value: number }>(
    `insert into counters (name, value) values ($1, 1)
     on conflict (name) do update set value = counters.value + 1
     returning value`,
    [name],
  );
  return result.rows[0]!.value;
}

export async function setCounter(tx: Queryable, name: string, value: number): Promise<void> {
  await tx.query(
    `insert into counters (name, value) values ($1, $2)
     on conflict (name) do update set value = greatest(counters.value, excluded.value)`,
    [name, value],
  );
}

export function paddedId(prefix: string, value: number): string {
  return `${prefix}-${String(value).padStart(4, '0')}`;
}
