CREATE TABLE IF NOT EXISTS members (
    id            bigserial PRIMARY KEY,
    email         text NOT NULL UNIQUE,
    name          text NOT NULL,
    password_hash text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
    token      text PRIMARY KEY,
    member_id  bigint NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calendars (
    id          bigserial PRIMARY KEY,
    slug        text NOT NULL UNIQUE,
    name        text NOT NULL,
    description text NOT NULL DEFAULT '',
    city        text NOT NULL,
    tint        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
    id                  bigserial PRIMARY KEY,
    slug                text NOT NULL UNIQUE,
    name                text NOT NULL,
    description         text NOT NULL DEFAULT '',
    start_at            timestamptz NOT NULL,
    end_at              timestamptz NOT NULL,
    timezone            text NOT NULL DEFAULT 'Asia/Kolkata',
    location_type       text NOT NULL DEFAULT 'offline',
    venue_name          text NOT NULL DEFAULT '',
    street_address      text NOT NULL DEFAULT '',
    city                text NOT NULL DEFAULT '',
    virtual_link        text NOT NULL DEFAULT '',
    visibility          text NOT NULL DEFAULT 'public',
    require_approval    boolean NOT NULL DEFAULT false,
    capacity            integer,
    waitlist            boolean NOT NULL DEFAULT false,
    registration_status text NOT NULL DEFAULT 'open',
    theme               text NOT NULL DEFAULT 'amber',
    categories          text[] NOT NULL DEFAULT '{}',
    calendar_id         bigint REFERENCES calendars (id),
    show_guest_list     boolean NOT NULL DEFAULT true,
    access_code         text,
    host_id             bigint NOT NULL REFERENCES members (id),
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_start_at_idx ON events (start_at);

CREATE TABLE IF NOT EXISTS registrations (
    id            bigserial PRIMARY KEY,
    event_id      bigint NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    member_id     bigint NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    status        text NOT NULL,
    requested_at  timestamptz NOT NULL DEFAULT now(),
    waitlisted_at timestamptz,
    promoted_from_waitlist boolean NOT NULL DEFAULT false,
    UNIQUE (event_id, member_id)
);

CREATE INDEX IF NOT EXISTS registrations_queue_idx
    ON registrations (event_id, status, waitlisted_at, id);

CREATE TABLE IF NOT EXISTS follows (
    id          bigserial PRIMARY KEY,
    member_id   bigint NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    calendar_id bigint NOT NULL REFERENCES calendars (id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (member_id, calendar_id)
);

CREATE TABLE IF NOT EXISTS host_messages (
    id              bigserial PRIMARY KEY,
    member_id       bigint NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    event_id        bigint NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    message         text NOT NULL,
    idempotency_key text,
    request_body    jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS host_messages_send_once_idx
    ON host_messages (member_id, event_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS event_reports (
    id              bigserial PRIMARY KEY,
    member_id       bigint NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    event_id        bigint NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    reason          text NOT NULL,
    details         text NOT NULL DEFAULT '',
    idempotency_key text,
    request_body    jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS event_reports_send_once_idx
    ON event_reports (member_id, event_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS access_code_attempts (
    event_id     bigint NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    member_id    bigint NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    failures     integer NOT NULL DEFAULT 0,
    window_start timestamptz NOT NULL DEFAULT now(),
    locked_until timestamptz,
    PRIMARY KEY (event_id, member_id)
);

CREATE TABLE IF NOT EXISTS app_meta (
    key   text PRIMARY KEY,
    value text NOT NULL
);
