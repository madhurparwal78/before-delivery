CREATE TABLE IF NOT EXISTS firms (
    id text PRIMARY KEY,
    name text NOT NULL
);

CREATE TABLE IF NOT EXISTS firm_keys (
    key_id text PRIMARY KEY,
    firm_id text NOT NULL REFERENCES firms(id),
    private_key bytea NOT NULL,
    public_key bytea NOT NULL,
    created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id text PRIMARY KEY,
    email text NOT NULL UNIQUE,
    name text NOT NULL,
    role text NOT NULL,
    firm_id text REFERENCES firms(id),
    password_hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sites (
    id text PRIMARY KEY,
    name text NOT NULL,
    code text NOT NULL,
    zone text NOT NULL,
    time_zone text NOT NULL,
    meter_id text NOT NULL,
    target_grain text NOT NULL,
    target_bp integer NOT NULL
);

CREATE TABLE IF NOT EXISTS windows (
    id text PRIMARY KEY,
    base_id text NOT NULL,
    site_id text NOT NULL REFERENCES sites(id),
    month text NOT NULL,
    state text NOT NULL,
    revision integer NOT NULL,
    opens_at timestamptz NOT NULL,
    start_utc timestamptz NOT NULL,
    end_utc timestamptz NOT NULL,
    verifier_firm_id text REFERENCES firms(id),
    submitted_at timestamptz,
    returned_reason text,
    frozen_target_grain text,
    frozen_target_bp integer,
    frozen_opinion text,
    registry_reachable boolean NOT NULL DEFAULT true,
    seal_status text,
    predecessor_id text,
    successor_id text,
    last_writer_name text,
    wrote_at timestamptz,
    created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS window_hours (
    window_id text NOT NULL REFERENCES windows(id),
    hour_utc timestamptz NOT NULL,
    consumed_wh bigint,
    quality text NOT NULL,
    substitution_reason text,
    correction_version integer NOT NULL DEFAULT 0,
    PRIMARY KEY (window_id, hour_utc)
);

CREATE TABLE IF NOT EXISTS lots (
    window_id text NOT NULL REFERENCES windows(id),
    lot_id text NOT NULL,
    name text NOT NULL,
    technology text NOT NULL,
    zone text NOT NULL,
    rank integer NOT NULL,
    excluded boolean NOT NULL DEFAULT false,
    battery_shifted boolean NOT NULL DEFAULT false,
    production_month text NOT NULL,
    cancel_by timestamptz NOT NULL,
    PRIMARY KEY (window_id, lot_id)
);

CREATE TABLE IF NOT EXISTS bundles (
    window_id text NOT NULL REFERENCES windows(id),
    bundle_id text NOT NULL,
    lot_id text NOT NULL,
    battery_shifted boolean NOT NULL DEFAULT false,
    production_hour timestamptz NOT NULL,
    discharge_hour timestamptz,
    range_start_wh bigint NOT NULL,
    range_end_wh bigint NOT NULL,
    PRIMARY KEY (window_id, bundle_id)
);

CREATE TABLE IF NOT EXISTS bundle_claims (
    bundle_id text PRIMARY KEY,
    base_id text NOT NULL,
    window_id text NOT NULL
);

CREATE TABLE IF NOT EXISTS lines (
    line_id text PRIMARY KEY,
    window_id text NOT NULL REFERENCES windows(id),
    hour_utc timestamptz NOT NULL,
    lot_id text NOT NULL,
    bundle_id text NOT NULL,
    range_start_wh bigint NOT NULL,
    range_end_wh bigint NOT NULL,
    wh bigint NOT NULL,
    status text NOT NULL,
    reason text,
    submitted_at timestamptz,
    confirmed_at timestamptz
);

CREATE INDEX IF NOT EXISTS lines_window_idx ON lines (window_id);

CREATE SEQUENCE IF NOT EXISTS movement_seq;

CREATE TABLE IF NOT EXISTS ledger_entries (
    movement_id text NOT NULL,
    kind text NOT NULL,
    account text NOT NULL,
    wh bigint NOT NULL,
    window_id text NOT NULL,
    lot_id text,
    bundle_id text,
    line_id text,
    at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS ledger_window_idx ON ledger_entries (window_id);

CREATE TABLE IF NOT EXISTS grid_factors (
    zone text NOT NULL,
    hour_utc timestamptz NOT NULL,
    factor_e4 bigint NOT NULL,
    PRIMARY KEY (zone, hour_utc)
);

CREATE TABLE IF NOT EXISTS sample_hours (
    window_id text NOT NULL REFERENCES windows(id),
    hour_utc timestamptz NOT NULL,
    draw_index integer NOT NULL,
    allocation_digest text NOT NULL,
    result text,
    note text,
    PRIMARY KEY (window_id, hour_utc)
);

CREATE TABLE IF NOT EXISTS signatures (
    statement_code text PRIMARY KEY,
    window_id text NOT NULL REFERENCES windows(id),
    firm_id text NOT NULL REFERENCES firms(id),
    key_id text NOT NULL REFERENCES firm_keys(key_id),
    signed_by text NOT NULL,
    signed_at timestamptz NOT NULL,
    attestation_payload text NOT NULL,
    attestation_signature bytea NOT NULL,
    pdf_object_key text NOT NULL,
    pdf_sha256 text,
    pdf_signature bytea,
    sealed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS signatures_window_idx ON signatures (window_id);

CREATE TABLE IF NOT EXISTS meta (
    key text PRIMARY KEY,
    value text NOT NULL
);
