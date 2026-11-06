import { query } from './db';

const statements: string[] = [
  `create table if not exists users (
     id text primary key,
     name text not null,
     email text not null,
     password_hash text not null,
     is_operator boolean not null default false,
     two_step_state text not null default 'off',
     two_step_secret_sealed text,
     two_step_setup_sealed text,
     two_step_enabled_at timestamptz,
     last_accepted_step bigint
   )`,
  `create unique index if not exists users_email_key on users (lower(email))`,
  `create table if not exists recovery_codes (
     user_id text not null references users(id) on delete cascade,
     code_hash text not null,
     used boolean not null default false,
     primary key (user_id, code_hash)
   )`,
  `create table if not exists signin_failures (
     id bigserial primary key,
     email text not null,
     at timestamptz not null default now()
   )`,
  `create index if not exists signin_failures_email_at on signin_failures (lower(email), at)`,
  `create table if not exists workspaces (
     slug text primary key,
     name text not null,
     plan_id text not null,
     status text not null default 'active',
     suspended_reason text,
     key_generation integer not null default 1,
     key_rotated_at timestamptz,
     rotation_running boolean not null default false,
     audit_seq bigint not null default 0,
     created_at timestamptz not null default now()
   )`,
  `create table if not exists memberships (
     workspace_slug text not null references workspaces(slug) on delete cascade,
     user_id text not null references users(id) on delete cascade,
     role text not null,
     primary key (workspace_slug, user_id)
   )`,
  `create table if not exists sessions (
     id text primary key,
     token_hash text not null unique,
     user_id text not null references users(id) on delete cascade,
     state text not null,
     device text not null,
     created_at timestamptz not null,
     last_seen_at timestamptz not null,
     pending_expires_at timestamptz,
     confirmed_until timestamptz,
     ended_at timestamptz
   )`,
  `create index if not exists sessions_user on sessions (user_id, state)`,
  `create table if not exists regions (
     id text primary key,
     name text not null,
     continent text not null,
     lon double precision not null,
     lat double precision not null,
     state text not null default 'online'
   )`,
  `create table if not exists buckets (
     name text primary key,
     workspace_slug text not null references workspaces(slug) on delete cascade,
     placement text[] not null,
     created_at timestamptz not null default now(),
     object_count integer not null default 0,
     stored_bytes bigint not null default 0,
     noncurrent_days integer,
     keep_newest_noncurrent integer not null default 0,
     abort_multipart_days integer,
     lifecycle_updated_at timestamptz
   )`,
  `create index if not exists buckets_workspace on buckets (workspace_slug, name)`,
  `create table if not exists object_versions (
     version_id text primary key,
     bucket text not null references buckets(name) on delete cascade,
     object_key text not null,
     size bigint not null,
     etag text not null,
     content_type text not null,
     metadata jsonb not null default '{}',
     tags jsonb not null default '{}',
     checksum_algorithm text,
     checksum_value text,
     part_md5s jsonb,
     part_sizes jsonb,
     created_at timestamptz not null,
     acknowledged_at timestamptz not null,
     is_current boolean not null default true,
     noncurrent_since timestamptz,
     retain_until timestamptz,
     legal_hold boolean not null default false,
     wrapped_data_key text not null,
     key_generation integer not null
   )`,
  `create unique index if not exists object_versions_current on object_versions (bucket, object_key) where is_current`,
  `create index if not exists object_versions_key on object_versions (bucket, object_key, created_at desc)`,
  `create index if not exists object_versions_noncurrent on object_versions (noncurrent_since) where not is_current`,
  `create table if not exists replicas (
     version_id text not null references object_versions(version_id) on delete cascade,
     region text not null,
     role text not null,
     state text not null,
     attempts integer not null default 0,
     settled_at timestamptz,
     settle_ms bigint,
     error text,
     position integer not null,
     primary key (version_id, region)
   )`,
  `create index if not exists replicas_pending on replicas (region, state)`,
  `create table if not exists multipart_uploads (
     upload_id text primary key,
     bucket text not null references buckets(name) on delete cascade,
     object_key text not null,
     workspace_slug text not null,
     content_type text not null,
     metadata jsonb not null default '{}',
     tags jsonb not null default '{}',
     checksum_algorithm text,
     wrapped_data_key text not null,
     key_generation integer not null,
     initiated_at timestamptz not null,
     state text not null default 'open',
     completed_part_list text,
     completed_response jsonb
   )`,
  `create table if not exists multipart_parts (
     upload_id text not null references multipart_uploads(upload_id) on delete cascade,
     part_number integer not null,
     size bigint not null,
     md5 text not null,
     checksum_algorithm text,
     checksum_value text,
     primary key (upload_id, part_number)
   )`,
  `create table if not exists quota_reservations (
     id text primary key,
     workspace_slug text not null,
     bytes bigint not null,
     ref text not null,
     created_at timestamptz not null default now()
   )`,
  `create index if not exists quota_reservations_workspace on quota_reservations (workspace_slug)`,
  `create table if not exists share_links (
     id text primary key,
     workspace_slug text not null,
     bucket text not null,
     object_key text not null,
     version_id text not null,
     token_hash text not null unique,
     created_by text not null,
     created_at timestamptz not null,
     expires_at timestamptz not null,
     state text not null default 'active'
   )`,
  `create table if not exists link_requests (
     id bigserial primary key,
     link_id text not null,
     at timestamptz not null default now()
   )`,
  `create index if not exists link_requests_link on link_requests (link_id, at)`,
  `create table if not exists invites (
     id text primary key,
     workspace_slug text not null references workspaces(slug) on delete cascade,
     email text not null,
     role text not null,
     token_hash text not null unique,
     created_at timestamptz not null,
     expires_at timestamptz not null,
     state text not null default 'pending'
   )`,
  `create table if not exists access_keys (
     key_id text primary key,
     workspace_slug text not null references workspaces(slug) on delete cascade,
     description text not null default '',
     permission text not null,
     buckets text[],
     prefix text,
     expires_at timestamptz,
     state text not null default 'active',
     created_at timestamptz not null,
     last_used_at timestamptz,
     secret_sealed text not null,
     previous_secret_sealed text,
     previous_secret_expires_at timestamptz,
     previous_secret_last_used_at timestamptz
   )`,
  `create table if not exists idempotency_records (
     workspace_slug text not null,
     idempotency_key text not null,
     endpoint text not null,
     bucket text not null,
     object_key text not null,
     body_sha text not null,
     status integer,
     response jsonb,
     completed boolean not null default false,
     created_at timestamptz not null default now(),
     primary key (workspace_slug, idempotency_key)
   )`,
  `create table if not exists delete_batches (
     id text primary key,
     workspace_slug text not null,
     bucket text not null,
     state text not null default 'open',
     undo_until timestamptz not null,
     created_at timestamptz not null,
     items jsonb not null
   )`,
  `create table if not exists webhook_endpoints (
     id text primary key,
     workspace_slug text not null references workspaces(slug) on delete cascade,
     url text not null,
     events text[] not null,
     buckets text[],
     description text not null default '',
     state text not null default 'active',
     secret_sealed text not null,
     next_sequence bigint not null default 1,
     created_at timestamptz not null
   )`,
  `create table if not exists events (
     id text primary key,
     workspace_slug text not null,
     event_type text not null,
     bucket text not null,
     object_key text not null,
     version_id text not null,
     etag text not null,
     size bigint not null,
     reason text,
     occurred_at timestamptz not null,
     fanned_out boolean not null default false
   )`,
  `create table if not exists deliveries (
     id text primary key,
     endpoint_id text not null references webhook_endpoints(id) on delete cascade,
     event_id text not null,
     event_type text not null,
     sequence bigint not null,
     state text not null default 'pending',
     attempts integer not null default 0,
     last_status integer,
     last_error text,
     next_attempt_at timestamptz,
     delivered_at timestamptz,
     body text not null,
     in_flight boolean not null default false,
     created_at timestamptz not null
   )`,
  `create index if not exists deliveries_endpoint on deliveries (endpoint_id, sequence)`,
  `create table if not exists audit_entries (
     workspace_slug text not null,
     seq bigint not null,
     at timestamptz not null,
     actor text not null,
     action text not null,
     target text not null,
     detail text not null,
     prev_hash text not null,
     hash text not null,
     primary key (workspace_slug, seq)
   )`,
  `create table if not exists usage_rows (
     id bigserial primary key,
     workspace_slug text not null,
     bucket text not null,
     unit text not null,
     window_start timestamptz not null,
     window_end timestamptz,
     raw_count bigint not null default 0,
     amount numeric,
     tracking_id text,
     billing_state text not null default 'open',
     sealed boolean not null default false
   )`,
  `create unique index if not exists usage_rows_tracking on usage_rows (tracking_id) where tracking_id is not null`,
  `create unique index if not exists usage_rows_open on usage_rows (workspace_slug, bucket, unit, window_start)`,
  `create table if not exists stored_bytes_log (
     id bigserial primary key,
     bucket text not null,
     workspace_slug text not null,
     at_second timestamptz not null,
     stored_bytes bigint not null
   )`,
  `create index if not exists stored_bytes_log_bucket on stored_bytes_log (bucket, at_second)`,
  `create table if not exists billing_status (
     id integer primary key,
     last_attempt_at timestamptz,
     last_error text,
     reachable boolean not null default true
   )`,
  `create table if not exists threshold_alerts (
     workspace_slug text not null,
     metric text not null,
     threshold integer not null,
     period text not null,
     primary key (workspace_slug, metric, threshold, period)
   )`,
  `create table if not exists mail_outbox (
     id text primary key,
     recipient text not null,
     subject text not null,
     body text not null,
     created_at timestamptz not null,
     sent_at timestamptz,
     attempts integer not null default 0
   )`,
  `create table if not exists pending_byte_removals (
     id bigserial primary key,
     storage_key text not null,
     created_at timestamptz not null default now()
   )`,
  `create table if not exists service_state (
     name text primary key,
     value text not null
   )`,
  `create table if not exists billing_accounts (
     workspace_slug text primary key,
     account_id text,
     subscription_id text,
     created_at timestamptz
   )`,
  `insert into billing_status (id, reachable) values (1, true) on conflict (id) do nothing`,
];

export async function applySchema(): Promise<void> {
  for (const statement of statements) await query(statement);
}
