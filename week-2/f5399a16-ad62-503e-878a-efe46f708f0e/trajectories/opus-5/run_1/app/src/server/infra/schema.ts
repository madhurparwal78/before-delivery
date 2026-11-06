export const SCHEMA = `
create table if not exists app_meta (
  key text primary key,
  value text not null
);

create table if not exists desks (
  id uuid primary key,
  name text not null,
  email text not null,
  email_folded text not null unique,
  password_hash text not null,
  created_at timestamptz not null
);

create table if not exists sessions (
  token text primary key,
  desk_id uuid not null references desks(id) on delete cascade,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  ended_at timestamptz
);

create table if not exists clients (
  id uuid primary key,
  desk_id uuid not null references desks(id) on delete cascade,
  name text not null,
  place text not null,
  state text not null,
  closes_at timestamptz,
  erased_at timestamptz,
  created_at timestamptz not null
);

create table if not exists producers (
  id uuid primary key,
  client_id uuid not null references clients(id) on delete cascade,
  name text not null,
  email text not null,
  town text not null,
  language text not null,
  created_at timestamptz not null
);

create table if not exists jobs (
  id uuid primary key,
  desk_id uuid not null references desks(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  title text not null,
  ad_id text not null,
  due_date date not null,
  target_seconds integer not null,
  frame_rate text not null,
  aspect text not null,
  state text not null,
  stamp text not null,
  next_frame_number integer not null default 1,
  next_cut_number integer not null default 1,
  created_at timestamptz not null
);

create table if not exists frames (
  id uuid primary key,
  job_id uuid not null references jobs(id) on delete cascade,
  number integer not null,
  position integer not null,
  duration_frames integer not null,
  action_note text not null default '',
  audio_note text not null default '',
  shot text not null default '',
  visual text not null default '',
  file_name text,
  width integer,
  height integer,
  sha256 text,
  drawing_kind text,
  removed_at timestamptz,
  created_at timestamptz not null,
  unique (job_id, number)
);

create table if not exists removals (
  id uuid primary key,
  job_id uuid not null references jobs(id) on delete cascade,
  frame_number integer not null,
  position integer not null,
  ends_at timestamptz not null,
  settled_at timestamptz,
  unique (job_id, frame_number)
);

create table if not exists lines (
  id uuid primary key,
  job_id uuid not null references jobs(id) on delete cascade,
  frame integer not null,
  market text not null,
  text text not null,
  x numeric(5,1) not null,
  y numeric(5,1) not null,
  width numeric(5,1) not null,
  height numeric(5,1) not null,
  clips integer not null,
  created_at timestamptz not null
);

create table if not exists cues (
  id uuid primary key,
  job_id uuid not null references jobs(id) on delete cascade,
  track_id text not null,
  title text not null,
  composer text not null,
  seconds integer not null,
  market text not null,
  from_date date not null,
  until_date date not null,
  fee text not null,
  licence_id text not null,
  created_at timestamptz not null
);

create table if not exists cuts (
  id uuid primary key,
  job_id uuid not null references jobs(id) on delete cascade,
  number integer not null,
  name text not null,
  frame_rate text not null,
  signed_off_at timestamptz,
  signed_off_by text,
  signed_off_producer_id uuid,
  created_at timestamptz not null,
  unique (job_id, number)
);

create table if not exists cut_frames (
  id uuid primary key,
  cut_id uuid not null references cuts(id) on delete cascade,
  number integer not null,
  position integer not null,
  duration_frames integer not null,
  action_note text not null default '',
  audio_note text not null default '',
  shot text not null default '',
  visual text not null default '',
  file_name text,
  width integer,
  height integer,
  sha256 text,
  drawing_kind text
);

create table if not exists renders (
  id uuid primary key,
  job_id uuid not null references jobs(id) on delete cascade,
  cut_number integer not null,
  width integer not null,
  burn_timecode boolean not null,
  state text not null,
  progress integer not null default 0,
  message text,
  size integer,
  sha256 text,
  provider_id text,
  polled_at timestamptz,
  created_at timestamptz not null
);

create table if not exists provider_busy (
  service text primary key,
  until timestamptz not null
);

create table if not exists cue_cache (
  cache_key text primary key,
  body jsonb not null,
  fetched_at timestamptz not null
);

create table if not exists review_pages (
  id uuid primary key,
  job_id uuid not null references jobs(id) on delete cascade,
  producer_id uuid not null references producers(id) on delete cascade,
  cut_number integer not null,
  token text not null unique,
  state text not null,
  ends_at timestamptz not null,
  reminder_at timestamptz,
  reminder_sent_at timestamptz,
  notes_sent_at timestamptz,
  typed_name text,
  created_at timestamptz not null
);

create table if not exists sign_off_pages (
  id uuid primary key,
  job_id uuid not null references jobs(id) on delete cascade,
  producer_id uuid not null references producers(id) on delete cascade,
  cut_number integer not null,
  token text not null unique,
  state text not null,
  ends_at timestamptz not null,
  created_at timestamptz not null
);

create table if not exists attachments (
  id uuid primary key,
  job_id uuid not null references jobs(id) on delete cascade,
  producer_id uuid not null references producers(id) on delete cascade,
  content_type text not null,
  size integer not null,
  created_at timestamptz not null
);

create table if not exists notes (
  id uuid primary key,
  job_id uuid not null references jobs(id) on delete cascade,
  producer_id uuid not null references producers(id) on delete cascade,
  review_page_id uuid,
  frame integer not null,
  x numeric(5,1) not null,
  y numeric(5,1) not null,
  typed_name text not null,
  state text not null,
  text text not null,
  suggested_seconds text,
  attachment_id uuid,
  created_at timestamptz not null
);

create table if not exists note_batches (
  review_page_id uuid not null references review_pages(id) on delete cascade,
  send_key text not null,
  answer jsonb not null,
  created_at timestamptz not null,
  primary key (review_page_id, send_key)
);

create table if not exists calls (
  id uuid primary key,
  desk_id uuid not null references desks(id) on delete cascade,
  producer_id uuid not null references producers(id) on delete cascade,
  date date not null,
  time text not null,
  minutes integer not null,
  note text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  uid text not null,
  sequence integer not null default 0,
  state text not null,
  created_at timestamptz not null
);

create table if not exists packages (
  id uuid primary key,
  job_id uuid not null references jobs(id) on delete cascade,
  cut_number integer not null,
  state text not null,
  created_at timestamptz not null
);

create table if not exists package_files (
  package_id uuid not null references packages(id) on delete cascade,
  kind text not null,
  file_name text not null,
  size integer not null,
  sha256 text not null,
  primary key (package_id, kind)
);

create table if not exists letters (
  id uuid primary key,
  job_id uuid not null references jobs(id) on delete cascade unique,
  currency text not null,
  scope text not null,
  fee_minor bigint not null,
  state text not null,
  stamp text not null,
  changed_at timestamptz not null,
  producer_id uuid references producers(id) on delete set null,
  token text unique,
  ends_at timestamptz,
  pdf_stored boolean not null default false,
  accepted_name text,
  accepted_at timestamptz,
  created_at timestamptz not null
);

create table if not exists job_events (
  id uuid primary key,
  job_id uuid not null references jobs(id) on delete cascade,
  at timestamptz not null,
  sequence bigserial,
  actor text not null,
  action text not null,
  text text not null
);

create table if not exists mail_queue (
  id uuid primary key,
  client_id uuid references clients(id) on delete cascade,
  recipient text not null,
  subject text not null,
  body text not null,
  attachments jsonb not null default '[]'::jsonb,
  send_after timestamptz not null,
  sent_at timestamptz,
  tries integer not null default 0,
  created_at timestamptz not null
);

create table if not exists rate_hits (
  id bigserial primary key,
  bucket text not null,
  at timestamptz not null
);

create index if not exists rate_hits_bucket on rate_hits (bucket, at);
create index if not exists frames_job on frames (job_id, position);
create index if not exists notes_job on notes (job_id, created_at);
create index if not exists calls_desk on calls (desk_id, starts_at);
create index if not exists events_job on job_events (job_id, sequence);
create index if not exists mail_pending on mail_queue (sent_at, send_after);
`;
