CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS app_user (
    username text PRIMARY KEY,
    name text NOT NULL,
    email text NOT NULL,
    roles text[] NOT NULL DEFAULT '{}',
    level numeric(2,1),
    coach_id text UNIQUE,
    coach_level_min numeric(2,1),
    coach_level_max numeric(2,1),
    coach_line text,
    push_topic text UNIQUE
);
CREATE INDEX IF NOT EXISTS app_user_email ON app_user (lower(email));

CREATE TABLE IF NOT EXISTS pricing_version (
    version int PRIMARY KEY,
    effective_from date NOT NULL,
    offpeak_cents_per_minute int NOT NULL,
    peak_cents_per_minute int NOT NULL,
    peak_start text NOT NULL,
    peak_end text NOT NULL,
    peak_days text[] NOT NULL,
    saved_by text REFERENCES app_user,
    saved_by_name text,
    saved_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cancellation_rule (
    version int PRIMARY KEY,
    late_fee_percent int NOT NULL CHECK (late_fee_percent BETWEEN 0 AND 100),
    description text NOT NULL,
    saved_by text REFERENCES app_user,
    saved_by_name text,
    saved_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION saved_version_is_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'saved versions never change';
END $$;
DROP TRIGGER IF EXISTS pricing_version_immutable ON pricing_version;
CREATE TRIGGER pricing_version_immutable BEFORE UPDATE OR DELETE ON pricing_version
    FOR EACH ROW EXECUTE FUNCTION saved_version_is_immutable();
DROP TRIGGER IF EXISTS cancellation_rule_immutable ON cancellation_rule;
CREATE TRIGGER cancellation_rule_immutable BEFORE UPDATE OR DELETE ON cancellation_rule
    FOR EACH ROW EXECUTE FUNCTION saved_version_is_immutable();

CREATE TABLE IF NOT EXISTS court_claim (
    owner text PRIMARY KEY,
    court int NOT NULL,
    during tstzrange NOT NULL,
    EXCLUDE USING gist (court WITH =, during WITH &&)
);

CREATE TABLE IF NOT EXISTS booking (
    id text PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('booking', 'match')),
    status text NOT NULL CHECK (status IN ('held', 'paid', 'released', 'checked-in', 'no-show', 'cancelled')),
    court int NOT NULL CHECK (court BETWEEN 1 AND 7),
    start_utc timestamptz NOT NULL,
    minutes int NOT NULL,
    note text NOT NULL DEFAULT '',
    total_cents int NOT NULL,
    organiser text NOT NULL REFERENCES app_user,
    pricing_version int NOT NULL,
    split boolean NOT NULL,
    settle_at timestamptz,
    match_id text,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    paid_at timestamptz,
    covered_noticed boolean NOT NULL DEFAULT false,
    settle_next_at timestamptz,
    refresh_next_at timestamptz
);
CREATE INDEX IF NOT EXISTS booking_start ON booking (start_utc, court, id);
CREATE INDEX IF NOT EXISTS booking_organiser ON booking (organiser, start_utc);
CREATE INDEX IF NOT EXISTS booking_held ON booking (expires_at) WHERE status = 'held';

CREATE TABLE IF NOT EXISTS lesson_series (
    id text PRIMARY KEY,
    coach_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lesson (
    id text PRIMARY KEY,
    series_id text NOT NULL REFERENCES lesson_series,
    coach_id text NOT NULL,
    court int NOT NULL,
    start_utc timestamptz NOT NULL,
    minutes int NOT NULL,
    total_cents int NOT NULL,
    pricing_version int NOT NULL
);
CREATE INDEX IF NOT EXISTS lesson_coach ON lesson (coach_id, start_utc);
CREATE INDEX IF NOT EXISTS lesson_start ON lesson (start_utc);

CREATE TABLE IF NOT EXISTS share (
    id bigserial PRIMARY KEY,
    booking_id text REFERENCES booking,
    lesson_id text REFERENCES lesson,
    position int NOT NULL,
    player text NOT NULL REFERENCES app_user,
    amount_cents int NOT NULL,
    status text NOT NULL CHECK (status IN ('due', 'paid', 'covered', 'void')),
    token text NOT NULL UNIQUE,
    provider_id text,
    CHECK ((booking_id IS NULL) <> (lesson_id IS NULL)),
    UNIQUE (booking_id, position),
    UNIQUE (lesson_id, position)
);
CREATE INDEX IF NOT EXISTS share_player ON share (player);

CREATE TABLE IF NOT EXISTS guarantee (
    id bigserial PRIMARY KEY,
    booking_id text NOT NULL,
    seq int NOT NULL,
    reference text NOT NULL,
    provider_id text NOT NULL,
    amount_cents int NOT NULL,
    status text NOT NULL CHECK (status IN ('authorized', 'superseded', 'voided', 'captured')),
    authorized_at timestamptz NOT NULL DEFAULT now(),
    void_state text NOT NULL DEFAULT 'none' CHECK (void_state IN ('none', 'owed', 'sent')),
    void_next_at timestamptz,
    UNIQUE (booking_id, seq)
);
CREATE INDEX IF NOT EXISTS guarantee_owed ON guarantee (void_next_at) WHERE void_state = 'owed';

CREATE TABLE IF NOT EXISTS match (
    id text PRIMARY KEY,
    court int NOT NULL,
    start_utc timestamptz NOT NULL,
    minutes int NOT NULL,
    level_min numeric(2,1) NOT NULL,
    level_max numeric(2,1) NOT NULL,
    status text NOT NULL CHECK (status IN ('open', 'full', 'cancelled')),
    total_cents int NOT NULL,
    share_cents int NOT NULL,
    creator text NOT NULL REFERENCES app_user,
    cutoff_at timestamptz NOT NULL,
    booking_id text,
    pricing_version int NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS match_start ON match (start_utc);

CREATE TABLE IF NOT EXISTS match_place (
    seq bigserial,
    match_id text NOT NULL REFERENCES match,
    player text NOT NULL REFERENCES app_user,
    status text NOT NULL CHECK (status IN ('reserved', 'paid')),
    amount_cents int NOT NULL,
    provider_id text,
    PRIMARY KEY (match_id, player)
);

CREATE TABLE IF NOT EXISTS credit (
    id bigserial PRIMARY KEY,
    username text NOT NULL REFERENCES app_user,
    amount_cents int NOT NULL,
    reason text NOT NULL CHECK (reason IN ('booking_cancelled', 'match_cancelled', 'late_capture')),
    booking_id text,
    match_id text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credit_user ON credit (username, created_at);

CREATE TABLE IF NOT EXISTS idempotency_key (
    username text NOT NULL,
    route text NOT NULL,
    key text NOT NULL,
    body_hash text NOT NULL,
    state text NOT NULL CHECK (state IN ('running', 'stored')),
    status int,
    response bytea,
    started_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (username, route, key)
);

CREATE TABLE IF NOT EXISTS join_attempt (
    id bigserial PRIMARY KEY,
    username text NOT NULL,
    at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS join_attempt_user ON join_attempt (username, at);

CREATE TABLE IF NOT EXISTS web_session (
    id text PRIMARY KEY,
    username text NOT NULL,
    access_token text NOT NULL,
    refresh_token text NOT NULL,
    id_token text NOT NULL,
    access_expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pre_login (
    id text PRIMARY KEY,
    state text NOT NULL,
    code_verifier text NOT NULL,
    return_path text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notice (
    id bigserial PRIMARY KEY,
    event text NOT NULL,
    channel text NOT NULL CHECK (channel IN ('email', 'push')),
    recipient text NOT NULL,
    address text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
    attempts int NOT NULL DEFAULT 0,
    next_attempt_at timestamptz,
    in_flight boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notice_queue ON notice (channel, recipient, id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS notice_due ON notice (next_attempt_at) WHERE status = 'pending';

DROP VIEW IF EXISTS share_now;
DROP VIEW IF EXISTS booking_now;
DROP VIEW IF EXISTS match_now;

CREATE VIEW booking_now AS
SELECT b.*,
       CASE WHEN b.status = 'held' AND b.expires_at <= now() THEN 'released' ELSE b.status END AS state,
       b.start_utc + make_interval(mins => b.minutes) AS end_utc
FROM booking b;

CREATE VIEW share_now AS
SELECT s.*,
       CASE WHEN s.status = 'due' AND s.booking_id IS NOT NULL
                 AND (b.state IN ('released', 'cancelled') OR b.start_utc <= now())
            THEN 'void' ELSE s.status END AS state
FROM share s LEFT JOIN booking_now b ON b.id = s.booking_id;

CREATE VIEW match_now AS
SELECT m.*, p.players, p.paid_players,
       CASE WHEN m.status = 'open' AND now() >= m.cutoff_at AND p.players < 4 THEN 'cancelled' ELSE m.status END AS state
FROM match m
CROSS JOIN LATERAL (
    SELECT count(*)::int AS players, (count(*) FILTER (WHERE mp.status = 'paid'))::int AS paid_players
    FROM match_place mp WHERE mp.match_id = m.id
) p;
