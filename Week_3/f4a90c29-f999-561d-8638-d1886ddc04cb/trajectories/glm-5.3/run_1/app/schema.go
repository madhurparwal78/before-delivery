package main

// schema.go — Postgres holds all state. The schema applies idempotently on
// every serve.

const schemaSQL = `
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  passcode TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('office_manager','member','guest')),
  office TEXT NOT NULL,
  zone TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS person_settings (
  person_id TEXT PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL DEFAULT 'monday' CHECK (week_start IN ('monday','sunday','saturday')),
  hide_weekends BOOLEAN NOT NULL DEFAULT false,
  custom_days INT NOT NULL DEFAULT 4 CHECK (custom_days BETWEEN 2 AND 7),
  second_zone TEXT
);

CREATE TABLE IF NOT EXISTS calendars (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT REFERENCES people(id),
  colour TEXT NOT NULL DEFAULT 'plum',
  readonly BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS calendar_default_reminders (
  calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  minutes INT NOT NULL,
  PRIMARY KEY (calendar_id, minutes)
);

CREATE TABLE IF NOT EXISTS shares (
  calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('free_busy','details','edit','manage')),
  PRIMARY KEY (calendar_id, person_id)
);

CREATE TABLE IF NOT EXISTS office_hours (
  zone TEXT PRIMARY KEY,
  open TEXT NOT NULL,
  close TEXT NOT NULL,
  days INT[] NOT NULL
);

CREATE TABLE IF NOT EXISTS guest_defaults (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  modify_event BOOLEAN NOT NULL,
  invite_others BOOLEAN NOT NULL,
  see_guest_list BOOLEAN NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  series_id TEXT,
  split_from TEXT,
  organiser_id TEXT NOT NULL REFERENCES people(id),
  title TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'event' CHECK (kind IN ('event','focus','out_of_office')),
  colour TEXT NOT NULL DEFAULT 'calendar',
  all_day BOOLEAN NOT NULL DEFAULT false,
  start_date TEXT NOT NULL,
  start_minutes INT NOT NULL DEFAULT 0,
  end_date TEXT NOT NULL,
  end_minutes INT NOT NULL DEFAULT 0,
  zone TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'default' CHECK (visibility IN ('default','private')),
  rrule TEXT,
  decline_mode TEXT,
  decline_message TEXT,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  saved_date TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'live' CHECK (state IN ('live','trashed','restored','purged')),
  moved_rules TEXT[] NOT NULL DEFAULT '{}',
  last_save_person TEXT
);

CREATE TABLE IF NOT EXISTS event_reminders (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  minutes INT NOT NULL,
  PRIMARY KEY (event_id, minutes)
);

CREATE TABLE IF NOT EXISTS switches (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  modify_event BOOLEAN NOT NULL DEFAULT false,
  invite_others BOOLEAN NOT NULL DEFAULT false,
  see_guest_list BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS guests (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  series_answer TEXT NOT NULL DEFAULT 'invited' CHECK (series_answer IN ('invited','yes','no','maybe')),
  PRIMARY KEY (event_id, person_id)
);

CREATE TABLE IF NOT EXISTS replies (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  occurrence_id TEXT NOT NULL,
  answer TEXT NOT NULL CHECK (answer IN ('invited','yes','no','maybe')),
  message TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (event_id, person_id, occurrence_id)
);

CREATE TABLE IF NOT EXISTS exceptions (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  occurrence_id TEXT NOT NULL,
  deleted BOOLEAN NOT NULL DEFAULT false,
  start_date TEXT,
  start_minutes INT,
  end_date TEXT,
  end_minutes INT,
  title TEXT,
  location TEXT,
  notes TEXT,
  PRIMARY KEY (event_id, occurrence_id)
);

CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  occurrence_id TEXT NOT NULL,
  proposer_id TEXT NOT NULL REFERENCES people(id),
  start_local TEXT NOT NULL,
  end_local TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','accepted','declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS share_links (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS zone_rules (
  id TEXT PRIMARY KEY,
  zone TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  new_offset_minutes INT NOT NULL,
  note TEXT NOT NULL,
  recorded_by TEXT NOT NULL REFERENCES people(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (zone, effective_date)
);

CREATE TABLE IF NOT EXISTS zone_moves (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL REFERENCES zone_rules(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, rule_id)
);

CREATE TABLE IF NOT EXISTS trash (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('event','series','occurrence')),
  event_id TEXT NOT NULL REFERENCES events(id),
  occurrence_id TEXT,
  title TEXT NOT NULL,
  trashed_at TIMESTAMPTZ NOT NULL,
  purge_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS notices (
  id BIGSERIAL PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  decision_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS drafts (
  person_id TEXT PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reminders (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  occurrence_id TEXT NOT NULL,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  minutes INT NOT NULL DEFAULT 0,
  due_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','fired','snoozed','cancelled')),
  fired_at TIMESTAMPTZ,
  all_day BOOLEAN NOT NULL DEFAULT false,
  fire_token TEXT
);

CREATE TABLE IF NOT EXISTS print_jobs (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id),
  week_start TEXT NOT NULL,
  calendars TEXT[] NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','rendered','stored','failed')),
  waiting_on TEXT,
  object_key TEXT NOT NULL,
  size_bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stored_at TIMESTAMPTZ,
  last_attempt TIMESTAMPTZ,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id),
  object_key TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'export',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS imports (
  id TEXT PRIMARY KEY,
  calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id),
  object_key TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency (
  person_id TEXT NOT NULL,
  key TEXT NOT NULL,
  body TEXT NOT NULL,
  status INT NOT NULL,
  response TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, key)
);

CREATE TABLE IF NOT EXISTS change_log (
  seq BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  person_ids TEXT[] NOT NULL DEFAULT '{}',
  data JSONB NOT NULL,
  decision_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_calendar ON events(calendar_id);
CREATE INDEX IF NOT EXISTS idx_guests_person ON guests(person_id);
CREATE INDEX IF NOT EXISTS idx_replies_event ON replies(event_id);
CREATE INDEX IF NOT EXISTS idx_notices_person ON notices(person_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reminders_person ON reminders(person_id, due_at);
CREATE INDEX IF NOT EXISTS idx_change_log ON change_log(created_at);
`
