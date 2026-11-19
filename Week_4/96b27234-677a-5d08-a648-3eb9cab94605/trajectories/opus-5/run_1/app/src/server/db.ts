import { Pool } from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';
import { config } from './config.js';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const result = await pool.query<T>(text, values);
  return result.rows;
}

export async function one<T extends QueryResultRow>(text: string, values: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}

export async function transact<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const SCHEMA = `
create table if not exists app_meta (
  key text primary key,
  value text not null
);
create table if not exists worlds (
  id text primary key,
  held_now timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists people (
  id text primary key,
  world_id text not null references worlds(id),
  email text not null unique,
  password_hash text not null,
  display_name text not null,
  time_zone text not null,
  site_role text not null,
  confirmed boolean not null default false,
  suspended boolean not null default false,
  avatar_asset_id text,
  hide_above text,
  created_at timestamptz not null default now()
);
create table if not exists confirm_tokens (
  token text primary key,
  person_id text not null references people(id) on delete cascade,
  used boolean not null default false
);
create table if not exists auth_tokens (
  token text primary key,
  person_id text not null references people(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists friendships (
  person_a text not null references people(id) on delete cascade,
  person_b text not null references people(id) on delete cascade,
  primary key (person_a, person_b)
);
create table if not exists friend_invites (
  id text primary key,
  token text not null unique,
  from_id text not null references people(id) on delete cascade,
  email text not null,
  state text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null
);
create table if not exists blocks (
  blocker_id text not null references people(id) on delete cascade,
  blocked_id text not null references people(id) on delete cascade,
  primary key (blocker_id, blocked_id)
);
create table if not exists mutes (
  muter_id text not null references people(id) on delete cascade,
  muted_id text not null references people(id) on delete cascade,
  primary key (muter_id, muted_id)
);
create table if not exists communities (
  id text primary key,
  world_id text not null references worlds(id),
  name text not null,
  time_zone text not null,
  created_at timestamptz not null default now()
);
create table if not exists community_members (
  community_id text not null references communities(id) on delete cascade,
  person_id text not null references people(id) on delete cascade,
  role text not null,
  joined_at timestamptz not null,
  primary key (community_id, person_id)
);
create table if not exists assets (
  id text primary key,
  world_id text not null references worlds(id),
  kind text not null,
  name text not null,
  owner_id text not null references people(id) on delete cascade,
  last_version integer not null default 0,
  removed boolean not null default false,
  created_at timestamptz not null
);
create table if not exists asset_versions (
  asset_id text not null references assets(id) on delete cascade,
  version integer not null,
  status text not null,
  rank text not null,
  worst_measure text not null,
  measures jsonb not null,
  layout jsonb,
  created_at timestamptz not null,
  primary key (asset_id, version)
);
create table if not exists sessions (
  id text primary key,
  world_id text not null references worlds(id),
  room_asset_id text not null references assets(id),
  host_id text not null references people(id),
  visibility text not null,
  capacity integer not null,
  community_id text references communities(id),
  status text not null,
  created_at timestamptz not null,
  ended_at timestamptz
);
create table if not exists session_members (
  session_id text not null references sessions(id) on delete cascade,
  person_id text not null references people(id) on delete cascade,
  joined_at timestamptz not null,
  room_version integer not null,
  x integer not null,
  y integer not null,
  facing text not null,
  seated boolean not null default false,
  seat_id text,
  sat_from_x integer,
  sat_from_y integer,
  last_action_at timestamptz,
  drop_deadline timestamptz,
  active boolean not null default true,
  primary key (session_id, person_id)
);
create table if not exists session_invitees (
  session_id text not null references sessions(id) on delete cascade,
  person_id text not null references people(id) on delete cascade,
  primary key (session_id, person_id)
);
create table if not exists session_bans (
  session_id text not null references sessions(id) on delete cascade,
  person_id text not null references people(id) on delete cascade,
  primary key (session_id, person_id)
);
create table if not exists chat_messages (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  from_id text not null references people(id) on delete cascade,
  text text not null,
  sent_at timestamptz not null
);
create table if not exists chat_recipients (
  message_id text not null references chat_messages(id) on delete cascade,
  person_id text not null references people(id) on delete cascade,
  primary key (message_id, person_id)
);
create table if not exists votes (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  target_id text not null references people(id) on delete cascade,
  status text not null,
  eligible integer not null,
  needed integer not null,
  started_at timestamptz not null,
  closes_at timestamptz not null
);
create table if not exists vote_voters (
  vote_id text not null references votes(id) on delete cascade,
  person_id text not null references people(id) on delete cascade,
  primary key (vote_id, person_id)
);
create table if not exists ballots (
  vote_id text not null references votes(id) on delete cascade,
  person_id text not null references people(id) on delete cascade,
  choice text not null,
  primary key (vote_id, person_id)
);
create table if not exists reports (
  id text primary key,
  world_id text not null references worlds(id),
  filer_id text not null references people(id) on delete cascade,
  person_id text not null references people(id) on delete cascade,
  session_id text not null references sessions(id) on delete cascade,
  category text not null,
  details text not null,
  state text not null,
  action text,
  created_at timestamptz not null
);
create table if not exists gatherings (
  id text primary key,
  community_id text not null references communities(id) on delete cascade,
  title text not null,
  starts_local text not null,
  duration_minutes integer not null,
  recurrence text not null,
  attend_limit integer not null,
  created_at timestamptz not null
);
create table if not exists gathering_attendees (
  gathering_id text not null references gatherings(id) on delete cascade,
  person_id text not null references people(id) on delete cascade,
  primary key (gathering_id, person_id)
);
create table if not exists reminders_sent (
  gathering_id text not null references gatherings(id) on delete cascade,
  person_id text not null references people(id) on delete cascade,
  occurrence_starts_at timestamptz not null,
  primary key (gathering_id, person_id, occurrence_starts_at)
);
create table if not exists mail_outbox (
  id text primary key,
  to_email text not null,
  subject text not null,
  body text not null,
  sent boolean not null default false,
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists pending_notices (
  id text primary key,
  person_id text not null references people(id) on delete cascade,
  kind text not null,
  created_at timestamptz not null default now()
);
insert into worlds (id) values ('default') on conflict do nothing;
`;

export async function applySchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('select pg_advisory_xact_lock(718231)');
    await client.query(SCHEMA);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query('select 1');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
