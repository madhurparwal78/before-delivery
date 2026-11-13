CREATE TABLE IF NOT EXISTS people (
    id            text PRIMARY KEY,
    name          text NOT NULL,
    email         text NOT NULL UNIQUE,
    passcode      text NOT NULL,
    zone          text NOT NULL,
    role          text NOT NULL,
    week_start    text NOT NULL DEFAULT 'monday',
    hide_weekends boolean NOT NULL DEFAULT false,
    custom_days   integer NOT NULL DEFAULT 4,
    second_zone   text
);

CREATE TABLE IF NOT EXISTS sessions (
    token      text PRIMARY KEY,
    person_id  text NOT NULL REFERENCES people(id),
    created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS calendars (
    id                text PRIMARY KEY,
    name              text NOT NULL,
    owner_id          text REFERENCES people(id),
    colour            text NOT NULL,
    default_reminders integer[] NOT NULL DEFAULT '{}',
    read_only         boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS shares (
    calendar_id text NOT NULL REFERENCES calendars(id),
    person_id   text NOT NULL REFERENCES people(id),
    level       text NOT NULL,
    PRIMARY KEY (calendar_id, person_id)
);

CREATE TABLE IF NOT EXISTS events (
    id              text PRIMARY KEY,
    calendar_id     text NOT NULL REFERENCES calendars(id),
    series_id       text NOT NULL,
    split_from      text,
    organiser_id    text REFERENCES people(id),
    title           text NOT NULL,
    location        text NOT NULL DEFAULT '',
    notes           text NOT NULL DEFAULT '',
    kind            text NOT NULL,
    colour          text NOT NULL DEFAULT 'Calendar colour',
    reminders       integer[] NOT NULL DEFAULT '{}',
    all_day         boolean NOT NULL,
    start_local     text NOT NULL,
    end_local       text NOT NULL,
    zone            text NOT NULL,
    visibility      text NOT NULL DEFAULT 'default',
    rrule           text NOT NULL DEFAULT '',
    series_until    text,
    decline_mode    text NOT NULL DEFAULT '',
    decline_message text NOT NULL DEFAULT '',
    switches        jsonb NOT NULL,
    version         integer NOT NULL DEFAULT 1,
    saved_at        timestamptz NOT NULL,
    saved_by        text REFERENCES people(id),
    trashed_at      timestamptz
);
CREATE INDEX IF NOT EXISTS events_calendar_idx ON events (calendar_id);

CREATE TABLE IF NOT EXISTS guests (
    event_id  text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    person_id text NOT NULL REFERENCES people(id),
    answer    text NOT NULL DEFAULT 'invited',
    message   text NOT NULL DEFAULT '',
    PRIMARY KEY (event_id, person_id)
);

CREATE TABLE IF NOT EXISTS replies (
    event_id       text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    occurrence_key text NOT NULL,
    person_id      text NOT NULL REFERENCES people(id),
    answer         text NOT NULL,
    message        text NOT NULL DEFAULT '',
    PRIMARY KEY (event_id, occurrence_key, person_id)
);

CREATE TABLE IF NOT EXISTS exceptions (
    event_id       text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    occurrence_key text NOT NULL,
    deleted        boolean NOT NULL DEFAULT false,
    start_local    text,
    end_local      text,
    title          text,
    location       text,
    notes          text,
    PRIMARY KEY (event_id, occurrence_key)
);

CREATE TABLE IF NOT EXISTS proposals (
    id             text PRIMARY KEY,
    event_id       text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    occurrence_key text NOT NULL DEFAULT '',
    proposer_id    text NOT NULL REFERENCES people(id),
    start_local    text NOT NULL,
    end_local      text NOT NULL,
    note           text NOT NULL DEFAULT '',
    status         text NOT NULL,
    created_at     timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS share_links (
    event_id   text PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
    token      text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS firm_settings (
    id             integer PRIMARY KEY DEFAULT 1,
    guest_defaults jsonb NOT NULL,
    office_hours   jsonb NOT NULL,
    CONSTRAINT firm_settings_single CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS zone_rules (
    id             text PRIMARY KEY,
    zone           text NOT NULL,
    effective_date text NOT NULL,
    new_offset     text NOT NULL,
    note           text NOT NULL,
    recorded_by    text NOT NULL REFERENCES people(id),
    created_at     timestamptz NOT NULL,
    UNIQUE (zone, effective_date)
);

CREATE TABLE IF NOT EXISTS zone_moves (
    event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    rule_id  text NOT NULL REFERENCES zone_rules(id),
    PRIMARY KEY (event_id, rule_id)
);

CREATE TABLE IF NOT EXISTS trash_items (
    id             text PRIMARY KEY,
    kind           text NOT NULL,
    event_id       text NOT NULL,
    occurrence_key text NOT NULL DEFAULT '',
    title          text NOT NULL,
    calendar_id    text NOT NULL,
    trashed_at     timestamptz NOT NULL,
    purge_at       timestamptz NOT NULL,
    state          text NOT NULL DEFAULT 'trashed'
);

CREATE TABLE IF NOT EXISTS reminders (
    id             text PRIMARY KEY,
    event_id       text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    occurrence_key text NOT NULL DEFAULT '',
    person_id      text NOT NULL REFERENCES people(id),
    minutes        integer NOT NULL,
    all_day        boolean NOT NULL DEFAULT false,
    due_utc        timestamptz NOT NULL,
    status         text NOT NULL DEFAULT 'scheduled',
    fired_at       timestamptz
);
CREATE INDEX IF NOT EXISTS reminders_due_idx ON reminders (status, due_utc);

CREATE TABLE IF NOT EXISTS notices (
    id          text PRIMARY KEY,
    person_id   text NOT NULL REFERENCES people(id),
    kind        text NOT NULL,
    text        text NOT NULL,
    event_id    text,
    decision_id text,
    created_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS notices_person_idx ON notices (person_id, created_at DESC);

CREATE TABLE IF NOT EXISTS prints (
    id              text PRIMARY KEY,
    person_id       text NOT NULL REFERENCES people(id),
    week_start      text NOT NULL,
    calendars       text[] NOT NULL,
    status          text NOT NULL,
    waiting_on      text,
    object_key      text NOT NULL,
    size_bytes      bigint,
    created_at      timestamptz NOT NULL,
    stored_at       timestamptz,
    idempotency_key text NOT NULL,
    body_hash       text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS prints_idempotency_idx ON prints (person_id, idempotency_key);

CREATE TABLE IF NOT EXISTS ics_files (
    id          text PRIMARY KEY,
    kind        text NOT NULL,
    calendar_id text NOT NULL REFERENCES calendars(id),
    object_key  text NOT NULL,
    size_bytes  bigint NOT NULL,
    created_at  timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS change_log (
    seq         bigserial PRIMARY KEY,
    type        text NOT NULL,
    event_id    text,
    calendar_id text,
    person_id   text,
    decision_id text,
    payload     jsonb NOT NULL,
    created_at  timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS drafts (
    person_id text PRIMARY KEY REFERENCES people(id),
    data      jsonb NOT NULL,
    saved_at  timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS imported_uids (
    calendar_id text NOT NULL REFERENCES calendars(id),
    uid         text NOT NULL,
    event_id    text NOT NULL,
    PRIMARY KEY (calendar_id, uid)
);
