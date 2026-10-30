import { query } from './pool.js';

const statements = [
  `create table if not exists server_secrets (
     name text primary key,
     value text not null
   )`,
  `create table if not exists couriers (
     courier_id text primary key,
     email text unique,
     display_name text not null,
     role text not null,
     worn_satchel_id text not null,
     name_locked boolean not null default false,
     muted boolean not null default false,
     emote text,
     emote_at timestamptz,
     moderation_ref text not null unique,
     guest_claimed boolean not null default false,
     created_at timestamptz not null default now()
   )`,
  `create table if not exists satchels (
     satchel_id text primary key,
     name text not null,
     price integer not null,
     colour text not null,
     ordinal integer not null
   )`,
  `create table if not exists satchels_owned (
     courier_id text not null references couriers(courier_id) on delete cascade,
     satchel_id text not null references satchels(satchel_id),
     primary key (courier_id, satchel_id)
   )`,
  `create table if not exists residents (
     resident_id text primary key,
     name text not null,
     home text not null,
     door_lat double precision not null,
     door_lon double precision not null,
     ordinal integer not null
   )`,
  `create table if not exists sessions (
     session_id text primary key,
     courier_id text not null references couriers(courier_id) on delete cascade,
     created_at timestamptz not null default now(),
     ended_at timestamptz
   )`,
  `create index if not exists sessions_courier on sessions (courier_id) where ended_at is null`,
  `create table if not exists postbox_keys (
     token text primary key,
     email text not null,
     return_to text not null,
     created_at timestamptz not null,
     used_at timestamptz
   )`,
  `create table if not exists movements (
     movement_id text primary key,
     courier_id text not null references couriers(courier_id) on delete cascade,
     kind text not null,
     ref text not null,
     created_at timestamptz not null
   )`,
  `create index if not exists movements_history
     on movements (courier_id, created_at desc, movement_id desc)`,
  `create table if not exists ledger_entries (
     entry_id bigserial primary key,
     movement_id text not null references movements(movement_id) on delete cascade,
     account text not null,
     amount integer not null,
     ref text not null,
     ordinal smallint not null
   )`,
  `create index if not exists ledger_entries_movement on ledger_entries (movement_id)`,
  `create table if not exists missions (
     mission_id text primary key,
     kind text not null,
     status text not null,
     version integer not null,
     revision integer not null,
     rush_slots integer,
     live_at timestamptz,
     created_at timestamptz not null default now()
   )`,
  `create table if not exists mission_versions (
     mission_id text not null references missions(mission_id) on delete cascade,
     version integer not null,
     title text not null,
     resident_id text not null,
     reward_stamps integer not null,
     rush_slots integer,
     dialogue jsonb not null,
     primary key (mission_id, version)
   )`,
  `create table if not exists studio (
     only_row integer primary key default 1,
     time_zone text not null,
     check (only_row = 1)
   )`,
  `create table if not exists board_days (
     board_date date not null,
     mission_id text not null references missions(mission_id) on delete cascade,
     primary key (board_date, mission_id)
   )`,
  `create table if not exists rush_parcels (
     rush_id text primary key,
     board_date date not null,
     mission_id text not null references missions(mission_id) on delete cascade,
     slot integer not null,
     slots integer not null,
     status text not null,
     acceptance_id text,
     unique (board_date, mission_id, slot)
   )`,
  `create index if not exists rush_parcels_board on rush_parcels (board_date)`,
  `create table if not exists acceptances (
     acceptance_id text primary key,
     courier_id text not null references couriers(courier_id) on delete cascade,
     mission_id text not null,
     version integer not null,
     rush_id text,
     status text not null,
     hold_expires_at timestamptz,
     accepted_at timestamptz not null,
     door_lat double precision not null,
     door_lon double precision not null,
     answer json not null
   )`,
  `create index if not exists acceptances_open
     on acceptances (courier_id) where status = 'open'`,
  `create table if not exists deliveries (
     delivery_id text primary key,
     acceptance_id text not null unique references acceptances(acceptance_id) on delete cascade,
     courier_id text not null,
     mission_id text not null,
     version integer not null,
     stamps_awarded integer not null,
     movement_id text not null,
     created_at timestamptz not null
   )`,
  `create table if not exists tickets (
     courier_id text not null references couriers(courier_id) on delete cascade,
     namespace text not null,
     ticket text not null,
     fingerprint text not null,
     response json not null,
     created_at timestamptz not null,
     primary key (courier_id, namespace, ticket)
   )`,
  `create table if not exists heartbeats (
     session_id text not null references sessions(session_id) on delete cascade,
     stream text not null,
     courier_id text not null references couriers(courier_id) on delete cascade,
     seq bigint not null,
     lat double precision not null,
     lon double precision not null,
     heading_deg double precision not null,
     received_at timestamptz not null,
     accepted_at timestamptz not null,
     primary key (session_id, stream)
   )`,
  `create index if not exists heartbeats_fresh on heartbeats (accepted_at)`,
  `create table if not exists postcards (
     postcard_id text primary key,
     courier_id text not null references couriers(courier_id) on delete cascade,
     share_token text not null unique,
     width integer not null,
     height integer not null,
     bytes integer not null,
     created_at timestamptz not null,
     revoked_at timestamptz
   )`,
  `create index if not exists postcards_owner on postcards (courier_id, created_at desc)`,
  `create table if not exists mail_slots (
     slot_id bigserial primary key,
     courier_id text not null references couriers(courier_id) on delete cascade,
     reserved_at timestamptz not null
   )`,
  `create index if not exists mail_slots_window on mail_slots (courier_id, reserved_at desc)`,
  `create table if not exists moderation_audit (
     entry_id bigserial primary key,
     action text not null,
     actor_role text not null,
     actor_display_name text not null,
     moderation_ref text not null,
     target_name_before text not null,
     target_name_after text not null,
     at timestamptz not null
   )`,
  `create index if not exists moderation_audit_newest on moderation_audit (at desc, entry_id desc)`,
];

export async function applySchema(): Promise<void> {
  for (const statement of statements) {
    await query(statement);
  }
}
