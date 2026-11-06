CREATE TABLE IF NOT EXISTS studio_users (
    id bigserial PRIMARY KEY,
    name text NOT NULL,
    email text NOT NULL UNIQUE CHECK (email = lower(email)),
    role text NOT NULL CHECK (role IN ('lead', 'associate')),
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES studio_users (id),
    token_hash text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz
);

CREATE TABLE IF NOT EXISTS sign_in_attempts (
    id bigserial PRIMARY KEY,
    email text NOT NULL,
    succeeded boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sign_in_attempts_email ON sign_in_attempts (email, created_at);

CREATE TABLE IF NOT EXISTS cases (
    slug text PRIMARY KEY,
    client text NOT NULL,
    industry text NOT NULL,
    theme text NOT NULL CHECK (theme IN ('orange', 'violet', 'lemon', 'clay', 'sand', 'ink', 'mist')),
    headline text NOT NULL,
    body jsonb NOT NULL,
    awards jsonb NOT NULL,
    testimonial_quote text NOT NULL,
    testimonial_name text NOT NULL,
    testimonial_role text NOT NULL,
    cover_seed integer NOT NULL,
    position integer NOT NULL UNIQUE CHECK (position BETWEEN 1 AND 8)
);

CREATE TABLE IF NOT EXISTS inquiries (
    id bigserial PRIMARY KEY,
    reference text NOT NULL UNIQUE,
    status_token text NOT NULL UNIQUE,
    name text NOT NULL,
    email text NOT NULL,
    company text,
    services text[] NOT NULL,
    budget text NOT NULL,
    timeline text NOT NULL,
    message text NOT NULL,
    status text NOT NULL CHECK (status IN ('new', 'in_review', 'call_booked', 'won', 'declined')),
    call_at timestamptz,
    decline_reason text,
    version integer NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS inquiries_email_created ON inquiries (lower(email), created_at);
CREATE INDEX IF NOT EXISTS inquiries_status ON inquiries (status);

CREATE TABLE IF NOT EXISTS status_events (
    id bigserial PRIMARY KEY,
    inquiry_id bigint NOT NULL REFERENCES inquiries (id),
    action text,
    from_status text,
    to_status text NOT NULL,
    call_at timestamptz,
    decline_reason text,
    actor_id bigint REFERENCES studio_users (id),
    created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS status_events_inquiry ON status_events (inquiry_id, id);

CREATE TABLE IF NOT EXISTS notes (
    id bigserial PRIMARY KEY,
    inquiry_id bigint NOT NULL REFERENCES inquiries (id),
    author_id bigint NOT NULL REFERENCES studio_users (id),
    body text NOT NULL,
    created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_inquiry ON notes (inquiry_id, id);

CREATE TABLE IF NOT EXISTS idempotency_keys (
    key text PRIMARY KEY,
    request_body text NOT NULL,
    response_body text NOT NULL,
    inquiry_id bigint NOT NULL REFERENCES inquiries (id),
    created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS transition_keys (
    user_id bigint NOT NULL REFERENCES studio_users (id),
    inquiry_id bigint NOT NULL REFERENCES inquiries (id),
    key text NOT NULL,
    request_body text NOT NULL,
    response_body text NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (user_id, inquiry_id, key)
);

CREATE TABLE IF NOT EXISTS outbox (
    id bigserial PRIMARY KEY,
    inquiry_id bigint NOT NULL REFERENCES inquiries (id),
    to_address text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    calendar text,
    created_at timestamptz NOT NULL,
    sent_at timestamptz,
    attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS outbox_pending ON outbox (inquiry_id, id) WHERE sent_at IS NULL;
