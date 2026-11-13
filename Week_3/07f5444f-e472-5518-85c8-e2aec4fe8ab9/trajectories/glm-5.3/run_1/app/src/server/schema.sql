-- Quirewell Stand Desk schema. Applied idempotently on every start.

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  passcode TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('principal_librarian','assistant_librarian','section_principal','player')),
  chair_key TEXT NOT NULL,
  chair_section TEXT,
  chair_number INT,
  chair_label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id),
  last_seen TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS catalogue_works (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  composer TEXT NOT NULL,
  bars INT NOT NULL,
  running_time_ms BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS catalogue_bar_map (
  catalogue_work_id TEXT NOT NULL REFERENCES catalogue_works(id),
  from_bar INT NOT NULL,
  to_bar INT NOT NULL,
  bar_ms INT NOT NULL,
  PRIMARY KEY (catalogue_work_id, from_bar)
);

CREATE TABLE IF NOT EXISTS catalogue_parts (
  catalogue_work_id TEXT NOT NULL REFERENCES catalogue_works(id),
  name TEXT NOT NULL,
  chair_key TEXT NOT NULL,
  bars_from INT NOT NULL,
  bars_to INT NOT NULL,
  PRIMARY KEY (catalogue_work_id, chair_key)
);

CREATE TABLE IF NOT EXISTS catalogue_letters (
  catalogue_work_id TEXT NOT NULL REFERENCES catalogue_works(id),
  letter TEXT NOT NULL,
  bar INT NOT NULL,
  PRIMARY KEY (catalogue_work_id, letter)
);

CREATE TABLE IF NOT EXISTS programmes (
  id TEXT PRIMARY KEY,
  number INT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','in_preparation','published','in_performance','closed')),
  first_rehearsal TIMESTAMPTZ NOT NULL,
  violin_1 INT NOT NULL CHECK (violin_1 BETWEEN 0 AND 10),
  violin_2 INT NOT NULL CHECK (violin_2 BETWEEN 0 AND 8),
  viola INT NOT NULL CHECK (viola BETWEEN 0 AND 6),
  cello INT NOT NULL CHECK (cello BETWEEN 0 AND 5),
  bass INT NOT NULL CHECK (bass BETWEEN 0 AND 4)
);

CREATE TABLE IF NOT EXISTS performances (
  programme_id TEXT NOT NULL REFERENCES programmes(id),
  at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (programme_id, at)
);

CREATE TABLE IF NOT EXISTS works (
  id TEXT PRIMARY KEY,
  programme_id TEXT NOT NULL REFERENCES programmes(id),
  catalogue_work_id TEXT NOT NULL REFERENCES catalogue_works(id),
  position INT NOT NULL,
  bars INT NOT NULL,
  UNIQUE (programme_id, catalogue_work_id)
);

CREATE TABLE IF NOT EXISTS bar_map (
  work_id TEXT NOT NULL REFERENCES works(id),
  from_bar INT NOT NULL,
  to_bar INT NOT NULL,
  bar_ms INT NOT NULL,
  PRIMARY KEY (work_id, from_bar)
);

CREATE TABLE IF NOT EXISTS rehearsal_letters (
  work_id TEXT NOT NULL REFERENCES works(id),
  letter TEXT NOT NULL,
  bar INT NOT NULL,
  PRIMARY KEY (work_id, letter)
);

CREATE TABLE IF NOT EXISTS parts (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES works(id),
  name TEXT NOT NULL,
  chair_key TEXT NOT NULL,
  bars_from INT NOT NULL,
  bars_to INT NOT NULL,
  copies_on_hand INT NOT NULL CHECK (copies_on_hand BETWEEN 0 AND 99)
);

CREATE TABLE IF NOT EXISTS cuts (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES works(id),
  from_bar INT NOT NULL,
  to_bar INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (work_id, from_bar)
);

-- One cut per bar: an exclusion constraint over the integer range.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE cuts DROP CONSTRAINT IF EXISTS cuts_one_per_bar;
ALTER TABLE cuts ADD CONSTRAINT cuts_one_per_bar EXCLUDE USING gist (
  work_id WITH =,
  int4range(from_bar, to_bar, '[]') WITH &&
) WHERE (true);

CREATE TABLE IF NOT EXISTS marks (
  part_id TEXT NOT NULL REFERENCES parts(id),
  cut_id TEXT NOT NULL REFERENCES cuts(id) ON DELETE CASCADE,
  marked_by TEXT NOT NULL REFERENCES people(id),
  marked_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (part_id, cut_id)
);

CREATE TABLE IF NOT EXISTS scans (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id),
  kind TEXT NOT NULL CHECK (kind IN ('marked_part','bowing_master')),
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  object_key TEXT NOT NULL,
  filed_at TIMESTAMPTZ NOT NULL,
  uploaded_by TEXT NOT NULL REFERENCES people(id)
);

CREATE TABLE IF NOT EXISTS notices (
  programme_id TEXT NOT NULL REFERENCES programmes(id),
  player_id TEXT NOT NULL REFERENCES people(id),
  status TEXT NOT NULL CHECK (status IN ('queued','sent')),
  sent_at TIMESTAMPTZ,
  PRIMARY KEY (programme_id, player_id)
);

CREATE TABLE IF NOT EXISTS rental_sets (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES works(id),
  publisher TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('requested','received','in_use','returned','checked_in')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  returned_at TIMESTAMPTZ,
  reminder_status TEXT NOT NULL DEFAULT 'none' CHECK (reminder_status IN ('none','queued','sent')),
  reminder_sent_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS rental_slip (
  rental_set_id TEXT NOT NULL REFERENCES rental_sets(id),
  part_id TEXT NOT NULL REFERENCES parts(id),
  position INT NOT NULL,
  copies INT NOT NULL CHECK (copies BETWEEN 1 AND 99),
  checked_in INT NOT NULL CHECK (checked_in BETWEEN 0 AND 99),
  PRIMARY KEY (rental_set_id, part_id),
  UNIQUE (rental_set_id, position)
);

CREATE TABLE IF NOT EXISTS idempotency (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status INT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);

CREATE INDEX IF NOT EXISTS works_by_programme ON works (programme_id, position);
CREATE INDEX IF NOT EXISTS parts_by_work ON parts (work_id);
CREATE INDEX IF NOT EXISTS scans_by_part ON scans (part_id, kind, filed_at DESC);
CREATE INDEX IF NOT EXISTS rental_sets_by_work ON rental_sets (work_id);
