export const SCHEMA = `
create table if not exists games (
  id text primary key,
  slug text not null unique,
  name text not null,
  launcher_origin text not null,
  widget_secret text not null,
  server_secret text not null,
  previous_server_secret text,
  previous_valid_until timestamptz
);

create table if not exists signing_key (
  id integer primary key check (id = 1),
  key text not null
);

create table if not exists staff (
  id text primary key,
  game_id text not null references games(id),
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null check (role in ('developer', 'moderator'))
);

create table if not exists rules (
  seq bigserial primary key,
  id text not null unique,
  moderator_id text not null references staff(id),
  effect text not null check (effect in ('grant', 'deny')),
  action text not null check (action in ('read', 'reply', 'close', 'receipts')),
  topic text not null check (topic in ('bug', 'account', 'purchase', 'other', '*'))
);
create index if not exists rules_moderator on rules (moderator_id, seq);

create table if not exists refresh_families (
  id text primary key,
  user_id text not null references staff(id),
  change_token text not null,
  revoked boolean not null default false,
  expires_at timestamptz not null
);

create table if not exists refresh_tokens (
  token_hash text primary key,
  family_id text not null references refresh_families(id),
  state text not null check (state in ('active', 'rotated'))
);

create table if not exists revoked_jtis (
  jti text primary key,
  expires_at timestamptz not null
);

create table if not exists players (
  game_id text not null references games(id),
  id text not null,
  name text not null,
  primary key (game_id, id)
);

create table if not exists buckets (
  game_id text not null,
  player_id text not null,
  credit_ms integer not null,
  refilled_at timestamptz not null,
  primary key (game_id, player_id),
  foreign key (game_id, player_id) references players(game_id, id)
);

create table if not exists threads (
  id text primary key,
  game_id text not null,
  player_id text not null,
  topic text not null check (topic in ('bug', 'account', 'purchase', 'other')),
  status text not null check (status in ('waiting', 'answered', 'closed')),
  waiting_since timestamptz,
  last_player_message_at timestamptz not null,
  unique (game_id, player_id),
  foreign key (game_id, player_id) references players(game_id, id)
);
create index if not exists threads_inbox on threads (game_id, status, last_player_message_at, id);

create table if not exists thread_closes (
  seq bigserial primary key,
  thread_id text not null references threads(id),
  closed_at timestamptz not null
);

create table if not exists messages (
  seq bigserial primary key,
  id text not null unique,
  game_id text not null,
  player_id text not null,
  kind text not null check (kind in ('player', 'reply', 'event')),
  author_id text,
  body text,
  reopened boolean not null default false,
  created_at timestamptz not null,
  foreign key (game_id, player_id) references players(game_id, id)
);
create index if not exists messages_player on messages (game_id, player_id, created_at, seq);

create table if not exists verdicts (
  message_id text not null references messages(id),
  stage text not null check (stage in ('signature', 'bucket', 'sanitiser', 'link')),
  line jsonb not null,
  primary key (message_id, stage)
);

create table if not exists link_previews (
  message_id text primary key references messages(id),
  url text not null,
  title text not null,
  description text
);

create table if not exists events (
  message_id text primary key references messages(id),
  game_id text not null,
  type text not null check (type in ('purchase.receipt', 'purchase.refunded', 'match.finished')),
  verdict text not null check (verdict in ('accepted', 'refused')),
  occurred_at timestamptz,
  receipt_id text,
  refund_id text,
  item text,
  amount_minor integer,
  currency text,
  match_id text,
  mode text,
  result text,
  duration_seconds integer
);
create unique index if not exists events_receipt_once on events (game_id, receipt_id)
  where verdict = 'accepted' and type = 'purchase.receipt';
create unique index if not exists events_refund_once on events (game_id, refund_id)
  where verdict = 'accepted' and type = 'purchase.refunded';

create table if not exists nonces (
  game_id text not null,
  nonce text not null,
  expires_at timestamptz not null,
  primary key (game_id, nonce)
);

create table if not exists idempotency_keys (
  scope text not null,
  route text not null,
  key text not null,
  fingerprint text not null,
  status text not null check (status in ('in_progress', 'completed')),
  response_status integer,
  response_body jsonb,
  expires_at timestamptz,
  primary key (scope, route, key)
);

create table if not exists attachments (
  seq bigserial primary key,
  id text not null unique,
  game_id text not null,
  player_id text not null,
  message_id text not null references messages(id),
  filename text not null,
  content_type text not null,
  size integer not null,
  status text not null check (status in ('uploading', 'attached', 'failed'))
);
create index if not exists attachments_message on attachments (message_id, seq);
`;
