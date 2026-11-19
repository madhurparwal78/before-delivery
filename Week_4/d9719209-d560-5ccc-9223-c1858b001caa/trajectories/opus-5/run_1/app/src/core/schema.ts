export const SCHEMA_SQL = `
create table if not exists members (
  id bigserial primary key,
  username text not null,
  username_ci text not null unique,
  email text not null,
  email_ci text not null unique,
  password_hash text not null,
  email_verified boolean not null default false,
  totp_secret text,
  totp_enabled boolean not null default false,
  role text not null default 'user' check (role in ('user', 'admin')),
  suspended_at timestamptz,
  suspension_reason text,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists login_failures (
  id bigserial primary key,
  member_id bigint not null references members(id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists login_failures_member_idx on login_failures (member_id, at desc);

create table if not exists sessions (
  token_hash text primary key,
  member_id bigint not null references members(id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists sessions_member_idx on sessions (member_id);

create table if not exists email_tokens (
  token_hash text primary key,
  member_id bigint not null references members(id) on delete cascade,
  kind text not null check (kind in ('verify', 'reset')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists email_tokens_member_idx on email_tokens (member_id, kind);

create table if not exists verification_sends (
  id bigserial primary key,
  member_id bigint not null references members(id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists verification_sends_member_idx on verification_sends (member_id, at desc);

create table if not exists communities (
  id bigserial primary key,
  name text not null,
  name_ci text not null unique,
  title text not null,
  description text not null default '',
  type text not null check (type in ('public', 'restricted')),
  owner_id bigint not null references members(id),
  member_count integer not null default 0,
  show_mod_names boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists community_rules (
  id bigserial primary key,
  community_id bigint not null references communities(id) on delete cascade,
  position integer not null,
  title text not null,
  description text not null default ''
);
create index if not exists community_rules_community_idx on community_rules (community_id, position);

create table if not exists memberships (
  community_id bigint not null references communities(id) on delete cascade,
  member_id bigint not null references members(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (community_id, member_id)
);
create index if not exists memberships_member_idx on memberships (member_id);

create table if not exists moderators (
  community_id bigint not null references communities(id) on delete cascade,
  member_id bigint not null references members(id) on delete cascade,
  is_owner boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (community_id, member_id)
);
create index if not exists moderators_member_idx on moderators (member_id);

create table if not exists approved_posters (
  community_id bigint not null references communities(id) on delete cascade,
  member_id bigint not null references members(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (community_id, member_id)
);

create table if not exists posts (
  id bigserial primary key,
  community_id bigint not null references communities(id) on delete cascade,
  author_id bigint not null references members(id),
  title text not null,
  body_md text not null default '',
  body_html text not null default '',
  spoiler boolean not null default false,
  score integer not null default 0,
  comment_count integer not null default 0,
  hot_rank double precision not null default 0,
  state text not null default 'published' check (state in ('published', 'removed', 'deleted')),
  removal_reason text,
  removal_at timestamptz,
  locked_at timestamptz,
  locked_until timestamptz,
  pinned_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index if not exists posts_hot_idx on posts (hot_rank desc, id desc) where state = 'published';
create index if not exists posts_new_idx on posts (created_at desc, id desc) where state = 'published';
create index if not exists posts_top_idx on posts (score desc, id desc) where state = 'published';
create index if not exists posts_community_idx on posts (community_id, state);
create index if not exists posts_author_idx on posts (author_id, state);
create index if not exists posts_lock_sweep_idx on posts (locked_until) where locked_until is not null;

create table if not exists images (
  id bigserial primary key,
  uploader_id bigint not null references members(id) on delete cascade,
  sha256 text not null,
  width integer not null,
  height integer not null,
  w320 integer not null,
  w640 integer not null,
  w1080 integer not null,
  alt text,
  post_id bigint references posts(id) on delete cascade,
  position integer,
  created_at timestamptz not null default now()
);
create index if not exists images_post_idx on images (post_id, position);

create table if not exists comments (
  id bigserial primary key,
  post_id bigint not null references posts(id) on delete cascade,
  parent_id bigint references comments(id) on delete cascade,
  author_id bigint not null references members(id),
  body_md text not null,
  body_html text not null,
  score integer not null default 0,
  descendant_count integer not null default 0,
  depth integer not null,
  path bigint[] not null default '{}',
  state text not null default 'published' check (state in ('published', 'deleted', 'removed')),
  removal_reason text,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index if not exists comments_post_idx on comments (post_id, parent_id);
create index if not exists comments_top_idx on comments (post_id, score desc, id desc);
create index if not exists comments_new_idx on comments (post_id, created_at desc, id desc);

create table if not exists votes (
  member_id bigint not null references members(id) on delete cascade,
  target_type text not null check (target_type in ('post', 'comment')),
  target_id bigint not null,
  value smallint not null check (value in (1, -1)),
  created_at timestamptz not null default now(),
  constraint votes_member_target_key unique (member_id, target_type, target_id)
);
create index if not exists votes_target_idx on votes (target_type, target_id);

create table if not exists idempotency_keys (
  member_id bigint not null references members(id) on delete cascade,
  endpoint text not null,
  key text not null,
  body_hash text not null,
  status integer,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (member_id, endpoint, key)
);

create table if not exists mod_log (
  id bigserial primary key,
  community_id bigint not null references communities(id) on delete cascade,
  moderator_id bigint not null references members(id),
  action text not null check (action in (
    'remove_post', 'restore_post', 'remove_comment', 'lock', 'unlock', 'pin', 'unpin',
    'add_moderator', 'remove_moderator', 'approve_poster', 'unapprove_poster'
  )),
  target_type text not null check (target_type in ('post', 'comment', 'user')),
  target_id text not null,
  public_reason text,
  private_note text,
  at timestamptz not null default now()
);
create index if not exists mod_log_community_idx on mod_log (community_id, id desc);

create table if not exists reports (
  id bigserial primary key,
  reference text not null unique,
  target_type text not null check (target_type in ('post', 'comment')),
  target_id bigint not null,
  category text not null check (category in ('hate', 'terrorism', 'csam', 'ip', 'privacy', 'other')),
  explanation text not null,
  reporter_email text not null,
  reporter_member_id bigint references members(id) on delete set null,
  created_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed'))
);
create index if not exists reports_queue_idx on reports (status, deadline_at);
`;

/**
 * Hot rank for a post row, in terms of a score expression and the row's own created_at, so a vote
 * stores the new score and the new rank in the same statement.
 */
export function hotRankSql(scoreExpression: string): string {
  return (
    `sign(${scoreExpression})::double precision * log(greatest(abs(${scoreExpression}), 1)::double precision)` +
    ' + (extract(epoch from created_at) - 1704067200) / 45000'
  );
}
