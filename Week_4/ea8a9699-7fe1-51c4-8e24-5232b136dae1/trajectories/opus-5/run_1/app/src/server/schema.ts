export const schemaSql = `
create table if not exists app_secrets (
  name text primary key,
  value text not null
);

create table if not exists groups (
  id uuid primary key,
  name text not null unique
);

create table if not exists workspaces (
  id uuid primary key,
  group_id uuid not null references groups(id),
  slug text not null unique,
  name text not null,
  time_zone text not null,
  plan text not null,
  seat_cap integer not null,
  seeded_plan text not null,
  kb_synced boolean not null default false,
  sort_order integer not null
);

create table if not exists accounts (
  id uuid primary key,
  email text not null unique,
  display_name text not null,
  handle text not null unique,
  role text not null,
  password_hash text not null,
  group_id uuid references groups(id),
  workspace_id uuid references workspaces(id),
  created_at timestamptz not null default now()
);

create table if not exists seats (
  workspace_id uuid not null references workspaces(id),
  account_id uuid not null references accounts(id),
  primary key (workspace_id, account_id)
);

create table if not exists sessions (
  token text primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists invites (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  email text not null,
  display_name text not null,
  token text not null unique,
  invited_by uuid not null references accounts(id),
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists invites_email_idx on invites (lower(email));

create table if not exists refs (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  kind text not null,
  title text not null,
  object_key text not null,
  content_type text not null,
  created_by uuid not null references accounts(id),
  created_at timestamptz not null default now(),
  frame_rate integer,
  duration_ms integer,
  total_frames integer,
  source_clip_id uuid,
  source_clip_title text,
  frame_index integer,
  timecode text
);
create index if not exists refs_workspace_idx on refs (workspace_id, created_at desc, id desc);

create table if not exists clusters (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  title text not null,
  public_description text not null default '',
  internal_note text not null default '',
  status text not null,
  owner_id uuid not null references accounts(id),
  version integer not null default 1,
  lift_local text,
  lifts_at timestamptz,
  published_at timestamptz,
  digests_created_at timestamptz,
  seed_entries_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists clusters_workspace_idx on clusters (workspace_id, updated_at desc);
create index if not exists clusters_owner_idx on clusters (owner_id);

create table if not exists cluster_entries (
  id uuid primary key,
  cluster_id uuid not null references clusters(id) on delete cascade,
  reference_id uuid not null references refs(id) on delete cascade,
  position integer not null,
  is_private boolean not null default false,
  added_by uuid not null references accounts(id),
  added_at timestamptz not null default now(),
  unique (cluster_id, reference_id)
);
create index if not exists cluster_entries_order_idx on cluster_entries (cluster_id, position);
create index if not exists cluster_entries_reference_idx on cluster_entries (reference_id);

create table if not exists comments (
  id uuid primary key,
  cluster_id uuid not null references clusters(id) on delete cascade,
  author_name text not null,
  author_account_id uuid references accounts(id),
  author_email text,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists comments_cluster_idx on comments (cluster_id, created_at);
create index if not exists comments_rate_idx on comments (cluster_id, lower(author_email), created_at desc);

create table if not exists review_links (
  id uuid primary key,
  cluster_id uuid not null references clusters(id) on delete cascade,
  email text not null,
  token text not null unique,
  expires_at timestamptz not null,
  can_comment boolean not null,
  revoked_at timestamptz,
  inactive_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists review_links_cluster_idx on review_links (cluster_id, created_at);

create table if not exists follows (
  follower_id uuid not null references accounts(id) on delete cascade,
  curator_id uuid not null references accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, curator_id)
);
create index if not exists follows_curator_idx on follows (curator_id);

create table if not exists digests (
  cluster_id uuid not null references clusters(id) on delete cascade,
  follower_id uuid not null references accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  primary key (cluster_id, follower_id)
);
create index if not exists digests_pending_idx on digests (sent_at) where sent_at is null;

create table if not exists upgrade_requests (
  workspace_id uuid not null references workspaces(id),
  idempotency_key text not null,
  request_hash text not null,
  state text not null,
  response text,
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key)
);
`;
