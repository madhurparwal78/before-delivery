CREATE TABLE IF NOT EXISTS programme (
    id             serial PRIMARY KEY,
    name           text NOT NULL,
    slug           text NOT NULL UNIQUE,
    default_locale text NOT NULL
);

CREATE TABLE IF NOT EXISTS account (
    id            serial PRIMARY KEY,
    email         text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    role          text NOT NULL,
    programme_id  integer NOT NULL REFERENCES programme (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reference_entry (
    id              serial PRIMARY KEY,
    programme_id    integer NOT NULL REFERENCES programme (id) ON DELETE CASCADE,
    slug            text NOT NULL,
    ordinal         integer,
    sector          text NOT NULL,
    customer        text NOT NULL,
    title           text NOT NULL,
    summary         text NOT NULL,
    challenge       text NOT NULL,
    work            text NOT NULL,
    title_fi        text,
    body_fi         text,
    published       boolean NOT NULL DEFAULT false,
    retired_at      timestamptz,
    version         integer NOT NULL DEFAULT 1,
    clearance_from  date,
    clearance_until date,
    quote           text,
    quote_speaker   text,
    quote_role      text,
    UNIQUE (programme_id, slug)
);

CREATE TABLE IF NOT EXISTS figure (
    id           serial PRIMARY KEY,
    reference_id integer NOT NULL REFERENCES reference_entry (id) ON DELETE CASCADE,
    label        text NOT NULL,
    value        text NOT NULL,
    position     integer NOT NULL,
    UNIQUE (reference_id, position)
);

CREATE TABLE IF NOT EXISTS note (
    id           serial PRIMARY KEY,
    programme_id integer NOT NULL REFERENCES programme (id) ON DELETE CASCADE,
    slug         text NOT NULL,
    title        text NOT NULL,
    preview      text NOT NULL,
    body         text NOT NULL,
    published_on date,
    UNIQUE (programme_id, slug)
);

CREATE TABLE IF NOT EXISTS enquiry (
    id           serial PRIMARY KEY,
    programme_id integer NOT NULL REFERENCES programme (id) ON DELETE CASCADE,
    email        text NOT NULL,
    phone        text,
    reference    text,
    created_at   timestamptz NOT NULL,
    agreed       boolean NOT NULL,
    open         boolean NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX IF NOT EXISTS enquiry_one_open_per_address
    ON enquiry (programme_id, lower(btrim(email))) WHERE open;

CREATE TABLE IF NOT EXISTS preview_link (
    id           serial PRIMARY KEY,
    token        text NOT NULL UNIQUE,
    reference_id integer NOT NULL REFERENCES reference_entry (id) ON DELETE CASCADE,
    expires_at   timestamptz NOT NULL,
    retired      boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS slug_redirect (
    id           serial PRIMARY KEY,
    programme_id integer NOT NULL REFERENCES programme (id) ON DELETE CASCADE,
    slug         text NOT NULL,
    reference_id integer NOT NULL REFERENCES reference_entry (id) ON DELETE CASCADE,
    UNIQUE (programme_id, slug)
);

CREATE TABLE IF NOT EXISTS service_clock (
    id                  integer PRIMARY KEY DEFAULT 1,
    offset_seconds      integer NOT NULL,
    last_rollover_date  date,
    CONSTRAINT service_clock_single_row CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS desk_session (
    id         serial PRIMARY KEY,
    token      text NOT NULL UNIQUE,
    account_id integer NOT NULL REFERENCES account (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS seed_marker (
    id      integer PRIMARY KEY DEFAULT 1,
    applied boolean NOT NULL,
    CONSTRAINT seed_marker_single_row CHECK (id = 1)
);
