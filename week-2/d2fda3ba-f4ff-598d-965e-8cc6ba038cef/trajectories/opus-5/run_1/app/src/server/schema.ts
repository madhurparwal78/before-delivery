export const SCHEMA_SQL = `
create table if not exists accounts (
  id uuid primary key,
  email text not null,
  display_name text not null,
  password_hash text not null,
  time_zone text not null,
  operator boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists accounts_email_key on accounts (lower(email));

create table if not exists devices (
  id uuid primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  name text not null,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists devices_account_idx on devices (account_id);

create table if not exists device_approvals (
  token_hash text primary key,
  device_id uuid not null references devices(id) on delete cascade,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  used_at timestamptz
);

create table if not exists sessions (
  token_hash text primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  device_id uuid not null references devices(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists vaults (
  id uuid primary key,
  owner_account_id uuid not null references accounts(id) on delete cascade,
  name text not null,
  key_envelope jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists vault_members (
  vault_id uuid not null references vaults(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  primary key (vault_id, account_id)
);

create table if not exists vault_invites (
  id uuid primary key,
  vault_id uuid not null references vaults(id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  used_at timestamptz
);

create table if not exists revisions (
  vault_id uuid not null references vaults(id) on delete cascade,
  rev integer not null,
  note_id uuid not null,
  base_revision integer,
  ciphertext_sha256 text not null,
  byte_length integer not null,
  device_id uuid not null references devices(id) on delete cascade,
  restored_from integer,
  created_at timestamptz not null default now(),
  primary key (vault_id, rev)
);
create index if not exists revisions_note_idx on revisions (vault_id, note_id, rev desc);

create table if not exists device_cursors (
  vault_id uuid not null references vaults(id) on delete cascade,
  device_id uuid not null references devices(id) on delete cascade,
  cursor integer not null default 0,
  primary key (vault_id, device_id)
);

create table if not exists idempotency_keys (
  device_id uuid not null references devices(id) on delete cascade,
  endpoint text not null,
  key text not null,
  body_sha256 text not null,
  status integer not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (device_id, endpoint, key)
);

create table if not exists dossiers (
  id uuid primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  slug text not null unique,
  root_note_id uuid not null,
  state text not null,
  radius integer,
  public_count integer,
  severed_count integer,
  published_at timestamptz,
  live_publish_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists dossiers_account_idx on dossiers (account_id);

create table if not exists publish_manifests (
  publish_id uuid primary key,
  dossier_id uuid not null references dossiers(id) on delete cascade,
  radius integer not null,
  public_count integer not null,
  severed_count integer not null,
  pages jsonb not null,
  object_keys jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists publish_manifests_dossier_idx on publish_manifests (dossier_id);

create table if not exists preview_links (
  id uuid primary key,
  dossier_id uuid not null references dossiers(id) on delete cascade,
  token_hash text not null unique,
  state text not null,
  pages jsonb not null,
  object_keys jsonb not null,
  created_at timestamptz not null,
  expires_at timestamptz not null
);
create index if not exists preview_links_dossier_idx on preview_links (dossier_id);

create table if not exists entitlement_cache (
  account_id uuid not null references accounts(id) on delete cascade,
  addon text not null,
  subscribed boolean not null,
  billing_end_date date,
  checked_at timestamptz not null,
  primary key (account_id, addon)
);

create table if not exists killbill_accounts (
  account_id uuid primary key references accounts(id) on delete cascade,
  kb_account_id text not null
);

create table if not exists email_outbox (
  id uuid primary key,
  to_email text not null,
  subject text not null,
  text_body text not null,
  html_body text not null,
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts integer not null default 0,
  last_error text
);

create table if not exists publish_warnings (
  account_id uuid not null references accounts(id) on delete cascade,
  lapse_key text not null,
  sent_at timestamptz not null,
  primary key (account_id, lapse_key)
);
`;
