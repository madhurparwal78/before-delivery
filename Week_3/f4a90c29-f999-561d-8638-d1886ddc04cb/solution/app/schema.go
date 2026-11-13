package main

const schemaSQL = `
CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, passcode_hash text NOT NULL,
  zone text NOT NULL, role text NOT NULL, week_start text NOT NULL DEFAULT 'monday',
  hide_weekends boolean NOT NULL DEFAULT false, custom_days integer NOT NULL DEFAULT 4, second_zone text
);
CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY, person_id text NOT NULL REFERENCES people ON DELETE CASCADE, created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS calendars (
  id text PRIMARY KEY, name text NOT NULL, owner_id text REFERENCES people, colour text NOT NULL,
  default_reminders integer[] NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS shares (
  calendar_id text NOT NULL REFERENCES calendars ON DELETE CASCADE,
  person_id text NOT NULL REFERENCES people ON DELETE CASCADE,
  level text NOT NULL CHECK (level IN ('free_busy','details','edit','manage')),
  PRIMARY KEY (calendar_id, person_id)
);
CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS zone_rules (
  id text PRIMARY KEY, zone text NOT NULL, effective_date text NOT NULL, new_offset text NOT NULL,
  note text NOT NULL, recorded_by text NOT NULL, UNIQUE (zone, effective_date)
);
CREATE TABLE IF NOT EXISTS events (
  id text PRIMARY KEY, calendar_id text NOT NULL REFERENCES calendars, series_id text NOT NULL, split_from text,
  title text NOT NULL, location text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '',
  kind text NOT NULL, colour text NOT NULL DEFAULT 'calendar', all_day boolean NOT NULL,
  start_local text NOT NULL, end_local text NOT NULL, zone text NOT NULL, visibility text NOT NULL DEFAULT 'default',
  rrule text, decline_mode text, decline_message text, reminders integer[] NOT NULL DEFAULT '{}',
  modify_event boolean NOT NULL, invite_others boolean NOT NULL, see_guest_list boolean NOT NULL,
  version integer NOT NULL DEFAULT 1, saved_at timestamptz NOT NULL, created_at timestamptz NOT NULL,
  trashed boolean NOT NULL DEFAULT false, moved_rules text[] NOT NULL DEFAULT '{}', ical_uid text,
  saved_by text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS events_calendar ON events (calendar_id);
CREATE INDEX IF NOT EXISTS events_series ON events (series_id);
CREATE TABLE IF NOT EXISTS exceptions (
  event_id text NOT NULL REFERENCES events ON DELETE CASCADE, key text NOT NULL,
  deleted boolean NOT NULL DEFAULT false, over jsonb NOT NULL DEFAULT '{}', PRIMARY KEY (event_id, key)
);
CREATE TABLE IF NOT EXISTS guests (
  event_id text NOT NULL REFERENCES events ON DELETE CASCADE, person_id text NOT NULL REFERENCES people,
  PRIMARY KEY (event_id, person_id)
);
CREATE INDEX IF NOT EXISTS guests_person ON guests (person_id);
CREATE TABLE IF NOT EXISTS replies (
  event_id text NOT NULL REFERENCES events ON DELETE CASCADE, person_id text NOT NULL REFERENCES people,
  key text NOT NULL DEFAULT '', status text NOT NULL CHECK (status IN ('invited','yes','no','maybe')), message text,
  PRIMARY KEY (event_id, person_id, key)
);
CREATE TABLE IF NOT EXISTS proposals (
  id text PRIMARY KEY, event_id text NOT NULL REFERENCES events ON DELETE CASCADE, occurrence_key text NOT NULL DEFAULT '',
  proposer_id text NOT NULL REFERENCES people, start_local text NOT NULL, end_local text NOT NULL,
  note text NOT NULL DEFAULT '', status text NOT NULL CHECK (status IN ('proposed','accepted','declined')), created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS proposals_open ON proposals (event_id, proposer_id, occurrence_key) WHERE status = 'proposed';
CREATE TABLE IF NOT EXISTS share_links (
  event_id text PRIMARY KEY REFERENCES events ON DELETE CASCADE, token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS trash_items (
  id text PRIMARY KEY, kind text NOT NULL, event_id text NOT NULL REFERENCES events ON DELETE CASCADE,
  occurrence_key text NOT NULL DEFAULT '', title text NOT NULL, trashed_at timestamptz NOT NULL,
  purge_at timestamptz NOT NULL, state text NOT NULL CHECK (state IN ('trashed','restored'))
);
CREATE TABLE IF NOT EXISTS reminder_states (
  event_id text NOT NULL REFERENCES events ON DELETE CASCADE, occurrence_key text NOT NULL,
  person_id text NOT NULL REFERENCES people, minutes integer NOT NULL, status text NOT NULL,
  due timestamptz, fired_at timestamptz, PRIMARY KEY (event_id, occurrence_key, person_id, minutes)
);
CREATE TABLE IF NOT EXISTS notices (
  id bigserial PRIMARY KEY, person_id text NOT NULL REFERENCES people, kind text NOT NULL, text text NOT NULL,
  event_id text, created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS notices_person ON notices (person_id);
CREATE TABLE IF NOT EXISTS prints (
  id text PRIMARY KEY, person_id text NOT NULL REFERENCES people, idem_key text NOT NULL, body_hash text NOT NULL,
  week_start text NOT NULL, calendars text[] NOT NULL, status text NOT NULL CHECK (status IN ('pending','rendered','stored','failed')),
  waiting_on text, object_key text NOT NULL,
  size_bytes bigint, created_at timestamptz NOT NULL, stored_at timestamptz, attempt_until timestamptz,
  UNIQUE (person_id, idem_key)
);
CREATE TABLE IF NOT EXISTS ical_files (
  id text PRIMARY KEY, kind text NOT NULL, calendar_id text NOT NULL REFERENCES calendars,
  person_id text NOT NULL REFERENCES people, object_key text NOT NULL, size_bytes bigint NOT NULL, created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS drafts (person_id text PRIMARY KEY REFERENCES people ON DELETE CASCADE, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS change_log (
  seq bigserial PRIMARY KEY, type text NOT NULL, event_id text, calendar_id text, person_id text,
  audience text[], data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS change_log_event ON change_log (event_id);
CREATE TABLE IF NOT EXISTS undo_snapshots (
  event_id text PRIMARY KEY REFERENCES events ON DELETE CASCADE, after_version integer NOT NULL, snapshot jsonb NOT NULL
);
`
