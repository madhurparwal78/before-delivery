import { db } from './pool.js';

const statements = [
  `create table if not exists install (
     id int primary key,
     started_at timestamptz not null,
     constraint install_single check (id = 1)
   )`,

  `create table if not exists kitchens (
     id text primary key,
     name text not null,
     slug text not null,
     time_zone text not null,
     peak_windows jsonb not null,
     required_documents jsonb not null,
     rules_version int not null,
     first_start_date text not null,
     first_start_at timestamptz not null
   )`,

  `create table if not exists people (
     id text primary key,
     kitchen_id text not null references kitchens(id),
     email text not null unique,
     name text not null,
     role text not null,
     password_hash text not null
   )`,

  `create table if not exists members (
     id text primary key,
     kitchen_id text not null references kitchens(id),
     person_id text not null references people(id),
     business_name text not null,
     allowance_quarters int not null
   )`,

  `create table if not exists sessions (
     id text primary key,
     person_id text not null references people(id) on delete cascade,
     created_at timestamptz not null default now()
   )`,

  `create table if not exists signin_failures (
     id bigint generated always as identity primary key,
     email text not null,
     at timestamptz not null default now()
   )`,
  `create index if not exists signin_failures_email_at on signin_failures (email, at desc)`,

  `create table if not exists stations (
     id text primary key,
     kitchen_id text not null references kitchens(id),
     name text not null,
     kind text not null,
     capacity int,
     lane_order int not null
   )`,

  `create table if not exists rate_versions (
     id text primary key,
     station_id text not null references stations(id),
     effective_from text not null,
     effective_at timestamptz not null,
     off_peak_hourly_cents int,
     peak_hourly_cents int,
     shelf_day_cents int,
     created_at timestamptz not null default now(),
     unique (station_id, effective_at)
   )`,

  `create table if not exists bookings (
     id text primary key,
     kitchen_id text not null references kitchens(id),
     member_id text not null references members(id),
     station_id text not null references stations(id),
     kind text not null,
     local_date text not null,
     local_start text,
     local_end text,
     days int,
     start_at timestamptz not null,
     end_at timestamptz not null,
     month text not null,
     status text not null,
     quarter_hours int not null,
     peak_quarters int not null,
     charge_cents int not null,
     penalty_cents int not null default 0,
     penalty_waived boolean not null default false,
     conflict boolean not null default false,
     series_id text,
     notes text not null default '',
     hold_expires_at timestamptz,
     confirmed_at timestamptz,
     version int not null default 1,
     seq bigint generated always as identity,
     created_at timestamptz not null default now()
   )`,
  `create index if not exists bookings_station_status on bookings (station_id, status)`,
  `create index if not exists bookings_member_month on bookings (member_id, month)`,
  `create index if not exists bookings_kitchen_month on bookings (kitchen_id, month)`,
  `create index if not exists bookings_series on bookings (series_id)`,

  `create table if not exists hour_ledger (
     id bigint generated always as identity primary key,
     kitchen_id text not null,
     member_id text not null,
     month text not null,
     quarters int not null,
     booking_id text not null,
     reason text not null,
     created_at timestamptz not null default now()
   )`,
  `create index if not exists hour_ledger_member_month on hour_ledger (member_id, month)`,

  `create table if not exists billing_items (
     id text primary key,
     seq bigint generated always as identity,
     kitchen_id text not null,
     member_id text not null,
     month text not null,
     booking_id text not null,
     line_kind text not null,
     item_kind text not null,
     description text not null,
     amount_cents int not null,
     filed_date text not null,
     recorded_at timestamptz,
     kb_item_id text,
     attempts int not null default 0,
     created_at timestamptz not null default now()
   )`,
  `create index if not exists billing_items_member_month on billing_items (member_id, month, seq)`,
  `create index if not exists billing_items_pending on billing_items (recorded_at)`,

  `create table if not exists kb_accounts (
     member_id text primary key references members(id),
     account_id text
   )`,

  `create table if not exists kb_invoices (
     member_id text not null,
     month text not null,
     invoice_id text not null,
     committed boolean not null default false,
     primary key (member_id, month)
   )`,

  `create table if not exists kb_name_updates (
     seq bigint generated always as identity primary key,
     member_id text not null,
     name text not null,
     done_at timestamptz
   )`,

  `create table if not exists mail_outbox (
     seq bigint generated always as identity primary key,
     to_email text not null,
     subject text not null,
     body text not null,
     sent_at timestamptz,
     attempts int not null default 0
   )`,

  `create table if not exists documents (
     id text primary key,
     seq bigint generated always as identity,
     kitchen_id text not null references kitchens(id),
     member_id text not null references members(id),
     type text not null,
     expiry_date text not null,
     status text not null,
     file_name text not null,
     content_type text not null,
     size_bytes int not null,
     uploaded_at timestamptz not null,
     approved_at timestamptz,
     version int not null,
     object_pending boolean not null default false,
     seed_body text
   )`,
  `create index if not exists documents_member_type on documents (member_id, type)`,

  `create table if not exists document_notices (
     document_id text not null references documents(id),
     kind text not null,
     sent_at timestamptz not null default now(),
     primary key (document_id, kind)
   )`,

  `create table if not exists out_of_service (
     id text primary key,
     kitchen_id text not null references kitchens(id),
     station_id text not null references stations(id),
     start_at timestamptz not null,
     end_at timestamptz not null,
     local_date text not null,
     local_start text not null,
     local_end text not null,
     reason text not null,
     created_at timestamptz not null default now()
   )`,
  `create index if not exists out_of_service_station on out_of_service (station_id)`,

  `create table if not exists sanitation_entries (
     id text primary key,
     seq bigint generated always as identity,
     kitchen_id text not null references kitchens(id),
     area text not null,
     task text not null,
     sanitizer_ppm int,
     initials text not null,
     notes text not null default '',
     logged_at timestamptz not null,
     logged_by text not null
   )`,
  `create index if not exists sanitation_entries_kitchen on sanitation_entries (kitchen_id, logged_at desc)`,

  `create table if not exists sanitation_reports (
     kitchen_id text not null references kitchens(id),
     month text not null,
     status text not null,
     stored_at timestamptz,
     primary key (kitchen_id, month)
   )`,

  `create table if not exists inspector_links (
     id text primary key,
     seq bigint generated always as identity,
     kitchen_id text not null references kitchens(id),
     email text not null,
     token text not null unique,
     expires_at timestamptz not null,
     revoked_at timestamptz,
     created_at timestamptz not null default now()
   )`,

  `create table if not exists inspector_access (
     id text primary key,
     seq bigint generated always as identity,
     link_id text not null references inspector_links(id),
     at timestamptz not null,
     action text not null,
     target text
   )`,
  `create index if not exists inspector_access_link on inspector_access (link_id, seq desc)`,

  `create table if not exists closed_months (
     kitchen_id text not null references kitchens(id),
     month text not null,
     closed_at timestamptz not null,
     report text not null,
     csv text not null,
     close_names jsonb not null,
     primary key (kitchen_id, month)
   )`,

  `create table if not exists closed_month_invoices (
     kitchen_id text not null,
     month text not null,
     member_id text not null,
     body text not null,
     primary key (kitchen_id, month, member_id)
   )`,

  `create table if not exists idempotency_records (
     person_id text not null,
     key text not null,
     path text not null,
     body jsonb not null,
     status int,
     response text,
     done boolean not null default false,
     created_at timestamptz not null default now(),
     primary key (person_id, key)
   )`,
];

export async function applySchema(): Promise<void> {
  for (const statement of statements) {
    await db().query(statement);
  }
  await db().query(
    `delete from idempotency_records where created_at < now() - interval '24 hours'`,
  );
}
