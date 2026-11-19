CREATE TABLE IF NOT EXISTS people (
    id          text PRIMARY KEY,
    sub         text UNIQUE NOT NULL,
    username    text NOT NULL,
    full_name   text NOT NULL,
    email       text NOT NULL,
    staff_roles text[] NOT NULL DEFAULT '{}',
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS people_username_idx ON people (username);

CREATE TABLE IF NOT EXISTS registrations (
    id             text PRIMARY KEY,
    person_id      text NOT NULL UNIQUE REFERENCES people (id),
    role           text NOT NULL,
    status         text NOT NULL,
    paddle         integer UNIQUE,
    spending_limit integer,
    full_name      text NOT NULL,
    phone          text NOT NULL,
    address        text NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
    id         text PRIMARY KEY,
    person_id  text NOT NULL REFERENCES people (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    ended_at   timestamptz
);

CREATE TABLE IF NOT EXISTS signin_attempts (
    state         text PRIMARY KEY,
    verifier      text NOT NULL,
    nonce         text NOT NULL,
    next_path     text NOT NULL,
    browser_token text NOT NULL,
    used_at       timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales (
    id               text PRIMARY KEY,
    title            text NOT NULL,
    ends_at          timestamptz NOT NULL,
    state            text NOT NULL,
    first_lot_number integer NOT NULL,
    published_at     timestamptz,
    closed_at        timestamptz,
    last_close_at    timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lots (
    id                    text PRIMARY KEY,
    consignor_id          text NOT NULL REFERENCES people (id),
    sale_id               text REFERENCES sales (id),
    lot_number            integer,
    catalogue_position    integer,
    title                 text NOT NULL,
    category              text NOT NULL,
    description           text NOT NULL,
    condition             text NOT NULL DEFAULT '',
    portrait              text,
    estimate_low          integer,
    estimate_high         integer,
    opening_bid           integer,
    reserve               integer,
    state                 text NOT NULL,
    closes_at             timestamptz,
    closed_at             timestamptz,
    sold_at_hammer        boolean NOT NULL DEFAULT false,
    hammer                integer,
    second_chance_decided boolean NOT NULL DEFAULT false,
    created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lots_sale_idx ON lots (sale_id, catalogue_position);
CREATE INDEX IF NOT EXISTS lots_due_idx ON lots (state, closes_at);

CREATE TABLE IF NOT EXISTS bids (
    id             text PRIMARY KEY,
    lot_id         text NOT NULL REFERENCES lots (id),
    bidder_id      text NOT NULL REFERENCES people (id),
    max_amount     integer NOT NULL,
    accepted_at    timestamptz NOT NULL,
    ordinal        bigserial,
    removed_at     timestamptz,
    removed_reason text
);

CREATE INDEX IF NOT EXISTS bids_lot_idx ON bids (lot_id, ordinal);

CREATE TABLE IF NOT EXISTS watches (
    lot_id              text NOT NULL REFERENCES lots (id),
    person_id           text NOT NULL REFERENCES people (id),
    closing_notice_sent boolean NOT NULL DEFAULT false,
    created_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (lot_id, person_id)
);

CREATE TABLE IF NOT EXISTS offers (
    id          text PRIMARY KEY,
    lot_id      text NOT NULL REFERENCES lots (id),
    person_id   text NOT NULL REFERENCES people (id),
    kind        text NOT NULL,
    amount      integer NOT NULL,
    expires_at  timestamptz NOT NULL,
    status      text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    answered_at timestamptz
);

CREATE INDEX IF NOT EXISTS offers_due_idx ON offers (status, expires_at);

CREATE TABLE IF NOT EXISTS invoices (
    id           text PRIMARY KEY,
    number       text UNIQUE NOT NULL,
    sale_id      text NOT NULL REFERENCES sales (id),
    person_id    text NOT NULL REFERENCES people (id),
    status       text NOT NULL,
    issued_at    timestamptz NOT NULL,
    due_at       timestamptz NOT NULL,
    paid_at      timestamptz,
    defaulted_at timestamptz
);

CREATE INDEX IF NOT EXISTS invoices_due_idx ON invoices (status, due_at);

CREATE TABLE IF NOT EXISTS invoice_lines (
    invoice_id    text NOT NULL REFERENCES invoices (id),
    lot_id        text NOT NULL REFERENCES lots (id),
    source        text NOT NULL,
    hammer_cents  bigint NOT NULL,
    premium_cents bigint NOT NULL,
    vat_cents     bigint NOT NULL,
    PRIMARY KEY (invoice_id, lot_id)
);

CREATE TABLE IF NOT EXISTS payments (
    id           text PRIMARY KEY,
    invoice_id   text NOT NULL REFERENCES invoices (id),
    amount_cents bigint NOT NULL,
    method       text NOT NULL,
    recorded_at  timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS statements (
    id                     text PRIMARY KEY,
    number                 text UNIQUE NOT NULL,
    sale_id                text NOT NULL REFERENCES sales (id),
    consignor_id           text NOT NULL REFERENCES people (id),
    version                integer NOT NULL,
    status                 text NOT NULL,
    issued_at              timestamptz,
    supersedes_id          text,
    superseded_by_id       text,
    note                   text,
    hammer_total_cents     bigint,
    commission_total_cents bigint,
    net_total_cents        bigint,
    created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS statement_lines (
    statement_id     text NOT NULL REFERENCES statements (id),
    lot_id           text NOT NULL REFERENCES lots (id),
    position         integer NOT NULL,
    lot_number       integer NOT NULL,
    title            text NOT NULL,
    result           text NOT NULL,
    hammer_cents     bigint,
    commission_cents bigint,
    net_cents        bigint,
    PRIMARY KEY (statement_id, lot_id)
);

CREATE TABLE IF NOT EXISTS notices (
    id         text PRIMARY KEY,
    person_id  text NOT NULL REFERENCES people (id),
    kind       text NOT NULL,
    body       text NOT NULL,
    lot_id     text,
    created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS notices_person_idx ON notices (person_id, created_at DESC);

CREATE TABLE IF NOT EXISTS events (
    seq        bigserial PRIMARY KEY,
    type       text NOT NULL,
    cause      text,
    lot_id     text,
    person_id  text,
    notice_id  text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
    person_id  text NOT NULL,
    key        text NOT NULL,
    body_hash  text NOT NULL,
    status     integer NOT NULL,
    response   jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (person_id, key)
);

CREATE TABLE IF NOT EXISTS counters (
    name  text PRIMARY KEY,
    value bigint NOT NULL
);

INSERT INTO counters (name, value) VALUES ('paddle', 100) ON CONFLICT (name) DO NOTHING;
INSERT INTO counters (name, value) VALUES ('invoice', 0) ON CONFLICT (name) DO NOTHING;
INSERT INTO counters (name, value) VALUES ('statement', 0) ON CONFLICT (name) DO NOTHING;
