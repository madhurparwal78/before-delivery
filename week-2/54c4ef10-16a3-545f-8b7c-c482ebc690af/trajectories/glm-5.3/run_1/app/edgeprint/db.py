"""PostgreSQL schema, applied idempotently on every start."""
from __future__ import annotations

import psycopg

SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS rolls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    stock TEXT NOT NULL,
    format TEXT NOT NULL,
    ei INT NOT NULL,
    push_pull INT NOT NULL DEFAULT 0,
    reciprocity_p NUMERIC(5,2) NOT NULL DEFAULT 1.00,
    development_note TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'normal',
    curve_roll_id UUID NULL,
    proposed_offset INT NULL,
    proposed_slip_after INT NULL,
    align_offset INT NULL,
    align_slip_after INT NULL,
    align_source TEXT NULL,
    align_version INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    roll_id UUID NOT NULL REFERENCES rolls(id) ON DELETE CASCADE,
    counter INT NOT NULL,
    aperture TEXT NOT NULL,
    shutter TEXT NOT NULL,
    metered_ev NUMERIC(6,2) NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    misfire BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (roll_id, counter)
);

CREATE TABLE IF NOT EXISTS scans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    roll_id UUID NOT NULL REFERENCES rolls(id) ON DELETE CASCADE,
    position INT NOT NULL,
    filename TEXT NOT NULL,
    format TEXT NOT NULL,
    size BIGINT NOT NULL,
    sha256 TEXT NOT NULL,
    width INT NOT NULL,
    height INT NOT NULL,
    dpi INT NOT NULL,
    first_edge INT NOT NULL,
    transfer TEXT NOT NULL,
    gamma NUMERIC(10,5) NULL,
    state TEXT NOT NULL DEFAULT 'stored',
    base_fog NUMERIC(6,3) NULL,
    preview_slices INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calibrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_id UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
    method TEXT NOT NULL,
    area_x INT NOT NULL,
    area_y INT NOT NULL,
    area_w INT NOT NULL,
    area_h INT NOT NULL,
    reference DOUBLE PRECISION NULL,
    steps JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS frames (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_id UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
    number INT NOT NULL,
    edge_number INT NOT NULL,
    x0 INT NOT NULL,
    x1 INT NOT NULL,
    width_mm NUMERIC(6,1) NOT NULL,
    flag TEXT NOT NULL DEFAULT 'ok',
    blank_slot BOOLEAN NOT NULL DEFAULT FALSE,
    mean_density NUMERIC(6,3) NULL,
    net_density NUMERIC(6,3) NULL,
    unexposed BOOLEAN NOT NULL DEFAULT FALSE,
    title TEXT NOT NULL DEFAULT '',
    UNIQUE (scan_id, number)
);

CREATE TABLE IF NOT EXISTS alignment_overrides (
    roll_id UUID NOT NULL REFERENCES rolls(id) ON DELETE CASCADE,
    entry_id UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    frame_id UUID NULL REFERENCES frames(id) ON DELETE CASCADE,
    PRIMARY KEY (roll_id, entry_id)
);

CREATE TABLE IF NOT EXISTS readings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_id UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
    frame_id UUID NULL REFERENCES frames(id) ON DELETE SET NULL,
    entry_id UUID NULL REFERENCES entries(id) ON DELETE SET NULL,
    x INT NOT NULL,
    y INT NOT NULL,
    gross NUMERIC(6,3) NOT NULL,
    net NUMERIC(6,3) NOT NULL,
    calibration_id UUID NOT NULL REFERENCES calibrations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rolls_account_idx ON rolls (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS scans_roll_idx ON scans (roll_id, position);
CREATE INDEX IF NOT EXISTS frames_scan_idx ON frames (scan_id, number);
CREATE INDEX IF NOT EXISTS entries_roll_idx ON entries (roll_id, counter);
CREATE INDEX IF NOT EXISTS readings_scan_idx ON readings (scan_id);
"""


def apply_schema(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute(SCHEMA)
    conn.commit()
