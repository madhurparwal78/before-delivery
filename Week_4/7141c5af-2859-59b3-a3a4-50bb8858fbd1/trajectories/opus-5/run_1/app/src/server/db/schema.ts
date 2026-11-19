/**
 * The schema, applied idempotently on start. Several copies may start together,
 * so the work runs under one advisory lock.
 */
import type { Pool } from 'pg';

const STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS desks (
     id            BIGSERIAL PRIMARY KEY,
     name          TEXT NOT NULL,
     email         TEXT NOT NULL UNIQUE,
     password_hash TEXT NOT NULL,
     created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS sessions (
     id         TEXT PRIMARY KEY,
     desk_id    BIGINT NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     ends_at    TIMESTAMPTZ NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS sessions_desk ON sessions(desk_id)`,

  `CREATE TABLE IF NOT EXISTS clients (
     id         BIGSERIAL PRIMARY KEY,
     desk_id    BIGINT NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
     name       TEXT NOT NULL,
     town       TEXT NOT NULL,
     language   TEXT NOT NULL,
     email      TEXT,
     state      TEXT NOT NULL DEFAULT 'active',
     closes_at  TIMESTAMPTZ,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS clients_desk ON clients(desk_id)`,

  `CREATE TABLE IF NOT EXISTS pieces (
     id            BIGSERIAL PRIMARY KEY,
     desk_id       BIGINT NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
     client_id     BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
     title         TEXT NOT NULL,
     maker         TEXT,
     year          TEXT,
     stamp_number  TEXT,
     width_cm      TEXT,
     depth_cm      TEXT,
     height_cm     TEXT,
     weight_kg     TEXT,
     due_date      DATE,
     notes         TEXT,
     state         TEXT NOT NULL DEFAULT 'received',
     pin_high      INTEGER NOT NULL DEFAULT 0,
     photo_high    INTEGER NOT NULL DEFAULT 0,
     created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS pieces_desk ON pieces(desk_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS pieces_stamp ON pieces(desk_id, stamp_number)
     WHERE stamp_number IS NOT NULL`,

  `CREATE TABLE IF NOT EXISTS pins (
     id         BIGSERIAL PRIMARY KEY,
     piece_id   BIGINT NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
     number     INTEGER NOT NULL,
     x          TEXT NOT NULL,
     y          TEXT NOT NULL,
     kind       TEXT NOT NULL,
     note       TEXT NOT NULL DEFAULT '',
     signed     BOOLEAN NOT NULL DEFAULT false,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS pins_piece ON pins(piece_id)`,

  `CREATE TABLE IF NOT EXISTS photographs (
     id         BIGSERIAL PRIMARY KEY,
     piece_id   BIGINT NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
     number     INTEGER NOT NULL,
     side       TEXT NOT NULL,
     sha256     TEXT NOT NULL,
     bytes      BIGINT NOT NULL,
     state      TEXT NOT NULL DEFAULT 'stored',
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS photographs_piece ON photographs(piece_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS photographs_sha ON photographs(piece_id, sha256)`,

  `CREATE TABLE IF NOT EXISTS materials (
     desk_id  BIGINT NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
     code     TEXT NOT NULL,
     name     TEXT NOT NULL,
     family   TEXT NOT NULL,
     unit     TEXT NOT NULL,
     prices   JSONB NOT NULL,
     position INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (desk_id, code)
   )`,

  `CREATE TABLE IF NOT EXISTS layouts (
     piece_id   BIGINT PRIMARY KEY REFERENCES pieces(id) ON DELETE CASCADE,
     version    INTEGER NOT NULL DEFAULT 1,
     placements JSONB NOT NULL,
     changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS holds (
     id         BIGSERIAL PRIMARY KEY,
     piece_id   BIGINT NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
     code       TEXT NOT NULL,
     lot        TEXT NOT NULL,
     quantity   TEXT NOT NULL,
     hold_id    TEXT NOT NULL,
     state      TEXT NOT NULL DEFAULT 'held',
     ends_on    DATE NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS holds_one ON holds(piece_id, code, lot)`,

  `CREATE TABLE IF NOT EXISTS estimates (
     id                BIGSERIAL PRIMARY KEY,
     desk_id           BIGINT NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
     piece_id          BIGINT NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
     version           INTEGER NOT NULL,
     state             TEXT NOT NULL DEFAULT 'open',
     currency          TEXT NOT NULL,
     material_code     TEXT,
     lot               TEXT,
     pattern_area      TEXT,
     hides             INTEGER,
     metres            TEXT,
     labour_hours      TEXT NOT NULL,
     labour_rate_minor BIGINT NOT NULL,
     material_minor    BIGINT NOT NULL,
     labour_minor      BIGINT NOT NULL,
     subtotal_minor    BIGINT NOT NULL,
     tax_percent       INTEGER NOT NULL,
     tax_minor         BIGINT NOT NULL,
     total_minor       BIGINT NOT NULL,
     signed_by         TEXT,
     signed_at         TIMESTAMPTZ,
     created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS estimates_piece ON estimates(piece_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS estimates_version ON estimates(piece_id, version)`,

  `CREATE TABLE IF NOT EXISTS rates (
     id              BIGSERIAL PRIMARY KEY,
     desk_id         BIGINT NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
     takes_effect_on DATE NOT NULL,
     eur TEXT NOT NULL, gbp TEXT NOT NULL, usd TEXT NOT NULL,
     jpy TEXT NOT NULL, aed TEXT NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS rates_day ON rates(desk_id, takes_effect_on)`,

  `CREATE TABLE IF NOT EXISTS client_pages (
     id                BIGSERIAL PRIMARY KEY,
     piece_id          BIGINT NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
     token             TEXT NOT NULL UNIQUE,
     state             TEXT NOT NULL DEFAULT 'live',
     sent_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
     ends_at           TIMESTAMPTZ NOT NULL,
     reminder_at       TIMESTAMPTZ,
     seat_height       TEXT,
     seat_height_text  TEXT,
     answered_at       TIMESTAMPTZ
   )`,
  `CREATE INDEX IF NOT EXISTS client_pages_piece ON client_pages(piece_id)`,

  `CREATE TABLE IF NOT EXISTS bench_jobs (
     id           BIGSERIAL PRIMARY KEY,
     desk_id      BIGINT NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
     piece_id     BIGINT NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
     bench        TEXT NOT NULL,
     day          DATE NOT NULL,
     glue_laid_at TIMESTAMPTZ,
     created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS bench_one ON bench_jobs(desk_id, bench, day)`,

  `CREATE TABLE IF NOT EXISTS quotes (
     id         BIGSERIAL PRIMARY KEY,
     desk_id    BIGINT NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
     piece_id   BIGINT NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
     quote_id   TEXT NOT NULL,
     amount     TEXT NOT NULL,
     currency   TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS collections (
     id            BIGSERIAL PRIMARY KEY,
     desk_id       BIGINT NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
     piece_id      BIGINT NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
     quote_id      TEXT NOT NULL,
     courier_id    TEXT,
     state         TEXT NOT NULL DEFAULT 'booked',
     collect_at    TIMESTAMPTZ NOT NULL,
     local_date    DATE NOT NULL,
     local_time    TEXT NOT NULL,
     town          TEXT NOT NULL,
     label_sha256  TEXT,
     repeat_key    TEXT NOT NULL,
     read_at       TIMESTAMPTZ,
     created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS collections_repeat ON collections(repeat_key)`,
  `CREATE INDEX IF NOT EXISTS collections_piece ON collections(piece_id)`,

  `CREATE TABLE IF NOT EXISTS dossiers (
     id          BIGSERIAL PRIMARY KEY,
     desk_id     BIGINT NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
     piece_id    BIGINT NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
     state       TEXT NOT NULL DEFAULT 'waiting',
     message     TEXT,
     estimate_id BIGINT,
     signed_by   TEXT,
     signed_at   TIMESTAMPTZ,
     created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS dossiers_piece ON dossiers(piece_id)`,

  `CREATE TABLE IF NOT EXISTS dossier_history (
     id         BIGSERIAL PRIMARY KEY,
     dossier_id BIGINT NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
     at         TIMESTAMPTZ NOT NULL DEFAULT now(),
     who        TEXT NOT NULL,
     what       TEXT NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS dossier_downloads (
     id      BIGSERIAL PRIMARY KEY,
     desk_id BIGINT NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
     at      TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS dossier_downloads_desk ON dossier_downloads(desk_id, at)`,

  `CREATE TABLE IF NOT EXISTS workbook_files (
     desk_id    BIGINT NOT NULL REFERENCES desks(id) ON DELETE CASCADE,
     sha256     TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (desk_id, sha256)
   )`,

  `CREATE TABLE IF NOT EXISTS enquiries (
     id          BIGSERIAL PRIMARY KEY,
     email_lower TEXT NOT NULL,
     at          TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS enquiries_email ON enquiries(email_lower, at)`,

  `CREATE TABLE IF NOT EXISTS stock_reads (
     code       TEXT PRIMARY KEY,
     lots       JSONB NOT NULL,
     fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS provider_backoff (
     provider TEXT PRIMARY KEY,
     retry_at TIMESTAMPTZ NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS outbox (
     id         BIGSERIAL PRIMARY KEY,
     client_id  BIGINT REFERENCES clients(id) ON DELETE CASCADE,
     recipient  TEXT NOT NULL,
     subject    TEXT NOT NULL,
     body       TEXT NOT NULL,
     reply_to   TEXT,
     state      TEXT NOT NULL DEFAULT 'pending',
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS outbox_pending ON outbox(state)`,

  `CREATE TABLE IF NOT EXISTS seed_state (
     key        TEXT PRIMARY KEY,
     value      TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
];

const SCHEMA_LOCK = 8_421_577;
const SEED_LOCK = 8_421_578;

export async function applySchema(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK]);
    for (const statement of STATEMENTS) await client.query(statement);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK]).catch(() => undefined);
    client.release();
  }
}

/** Runs the seed under its own lock, so copies starting together seed once. */
export async function withSeedLock<T>(pool: Pool, work: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [SEED_LOCK]);
    return await work();
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [SEED_LOCK]).catch(() => undefined);
    client.release();
  }
}
