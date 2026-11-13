import { query } from './db.js';

const MIGRATIONS: string[] = [
  `create table if not exists accounts (
     id uuid primary key,
     email text not null unique,
     password_hash text not null,
     display_name text not null unique,
     locale text not null default 'en',
     email_verified boolean not null default false,
     verification_email text not null default 'not_sent',
     storage_notice text,
     created_at timestamptz not null default now()
   )`,
  `create table if not exists sessions (
     token text primary key,
     account_id uuid not null references accounts(id) on delete cascade,
     created_at timestamptz not null default now(),
     expires_at timestamptz not null
   )`,
  `create table if not exists email_tokens (
     token text primary key,
     account_id uuid not null references accounts(id) on delete cascade,
     kind text not null,
     used_at timestamptz,
     cancelled_at timestamptz,
     expires_at timestamptz not null,
     created_at timestamptz not null default now()
   )`,
  `create index if not exists email_tokens_account_idx on email_tokens(account_id, kind)`,
  `create table if not exists characters (
     id uuid primary key,
     account_id uuid not null references accounts(id) on delete cascade,
     slot int not null,
     revision int not null default 0,
     name text not null,
     parts jsonb not null,
     proportions jsonb not null,
     pose jsonb not null,
     material text not null,
     accessories jsonb not null,
     model_id uuid,
     weapon_id uuid,
     equipped boolean not null default false,
     created_at timestamptz not null default now(),
     updated_at timestamptz not null default now(),
     unique (account_id, slot)
   )`,
  `create table if not exists weapons (
     id uuid primary key,
     account_id uuid not null references accounts(id) on delete cascade,
     number int not null,
     strokes jsonb not null,
     stats jsonb not null,
     vertices int not null,
     created_at timestamptz not null default now()
   )`,
  `create table if not exists weapon_numbers (
     account_id uuid primary key,
     next_number int not null default 1
   )`,
  `create table if not exists models (
     id uuid primary key,
     account_id uuid not null references accounts(id) on delete cascade,
     filename text not null,
     size_bytes bigint not null,
     sha256 text not null,
     status text not null,
     rulebook_version text,
     report jsonb,
     created_at timestamptz not null default now()
   )`,
  `create index if not exists models_account_idx on models(account_id)`,
  `create table if not exists friendships (
     account_id uuid not null references accounts(id) on delete cascade,
     friend_id uuid not null references accounts(id) on delete cascade,
     created_at timestamptz not null default now(),
     primary key (account_id, friend_id)
   )`,
  `create table if not exists friend_requests (
     id uuid primary key,
     from_account uuid not null references accounts(id) on delete cascade,
     to_account uuid not null references accounts(id) on delete cascade,
     status text not null default 'pending',
     client_request_id text,
     created_at timestamptz not null default now()
   )`,
  `create unique index if not exists friend_requests_open_pair
     on friend_requests (from_account, to_account) where status = 'pending'`,
  `create table if not exists parties (
     id uuid primary key,
     status text not null default 'forming',
     leader_id uuid not null,
     story_id text not null,
     ready_check jsonb,
     session_id uuid,
     created_at timestamptz not null default now()
   )`,
  `create table if not exists party_members (
     party_id uuid not null references parties(id) on delete cascade,
     account_id uuid not null references accounts(id) on delete cascade,
     joined_at timestamptz not null default now(),
     primary key (party_id, account_id)
   )`,
  `create table if not exists invites (
     id uuid primary key,
     token text not null unique,
     party_id uuid not null references parties(id) on delete cascade,
     to_account uuid not null references accounts(id) on delete cascade,
     status text not null default 'open',
     created_at timestamptz not null default now()
   )`,
  `create index if not exists invites_to_idx on invites(to_account, status)`,
  `create table if not exists party_invites (
     id uuid primary key,
     token text not null unique,
     party_id uuid not null references parties(id) on delete cascade,
     to_account uuid not null references accounts(id) on delete cascade,
     status text not null default 'open',
     created_at timestamptz not null default now()
   )`,
  `create table if not exists chat_channels (
     channel text primary key,
     last_seq bigint not null default 0
   )`,
  `create table if not exists chat_messages (
     id uuid primary key,
     channel text not null,
     seq bigint not null,
     kind text not null,
     author uuid references accounts(id) on delete set null,
     body text,
     code text,
     params jsonb,
     client_message_id text,
     created_at timestamptz not null default now(),
     unique (channel, client_message_id)
   )`,
  `create index if not exists chat_messages_channel_seq_idx on chat_messages(channel, seq)`,
  `create table if not exists streams (
     stream text primary key,
     last_seq bigint not null default 0
   )`,
  `create table if not exists events (
     event_id uuid primary key,
     stream text not null,
     seq bigint not null,
     event jsonb not null,
     created_at timestamptz not null default now()
   )`,
  `create index if not exists events_stream_seq_idx on events(stream, seq)`,
  `create table if not exists intents (
     session_id uuid not null,
     account_id uuid not null,
     intent_id text not null,
     created_at timestamptz not null default now(),
     primary key (session_id, account_id, intent_id)
   )`,
  `create table if not exists progress (
     owner_kind text not null,
     owner_id uuid not null,
     story_id text not null,
     unlocked_chapter int not null default 1,
     completed_chapters jsonb not null default '[]',
     checkpoint jsonb,
     primary key (owner_kind, owner_id, story_id)
   )`,
  `create table if not exists sessions_world (
     id uuid primary key,
     story_id text not null,
     chapter int not null,
     mode text not null,
     owner_id uuid not null,
     party_id uuid,
     status text not null default 'running',
     tick bigint not null default 0,
     state jsonb not null,
     stepper text,
     stepped_at timestamptz,
     resumed_from_checkpoint boolean not null default false,
     created_at timestamptz not null default now()
   )`,
  `create table if not exists chat_rate (
     account_id uuid not null,
     channel text not null,
     window_start bigint not null,
     window_count int not null default 0,
     primary key (account_id, channel)
   )`,
  `create table if not exists presence (
     account_id uuid primary key,
     last_heartbeat timestamptz,
     open_connections int not null default 0
   )`,
];

export async function runMigrations(): Promise<void> {
  for (const sql of MIGRATIONS) {
    await query(sql);
  }
}
