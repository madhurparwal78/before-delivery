import { pool, withAdvisoryLock } from './db.js';

const SCHEMA_LOCK = 814_001;

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS offices (
    id text PRIMARY KEY,
    city text NOT NULL,
    time_zone text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS office_closures (
    office_id text NOT NULL REFERENCES offices(id),
    closure_date date NOT NULL,
    PRIMARY KEY (office_id, closure_date)
  )`,
  `CREATE TABLE IF NOT EXISTS talent (
    id text PRIMARY KEY,
    slug text NOT NULL UNIQUE,
    display_name text NOT NULL,
    state text NOT NULL,
    office_id text NOT NULL REFERENCES offices(id),
    board text NOT NULL,
    date_of_birth date,
    email text,
    phone text,
    home_address text,
    guardian_name text,
    guardian_email text,
    guardian_phone text,
    height_cm int,
    chest_cm int,
    waist_cm int,
    hips_cm int,
    instagram bigint NOT NULL DEFAULT 0,
    tiktok bigint NOT NULL DEFAULT 0,
    youtube bigint NOT NULL DEFAULT 0,
    office_note text,
    feed_token text,
    version int NOT NULL DEFAULT 1,
    portfolio_version int NOT NULL DEFAULT 1,
    saved_by text,
    saved_at timestamptz,
    portfolio_saved_by text,
    portfolio_saved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS talent_feed_token_key ON talent (feed_token) WHERE feed_token IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS members (
    id text PRIMARY KEY,
    name text NOT NULL,
    email text NOT NULL,
    role text NOT NULL,
    office_id text NOT NULL REFERENCES offices(id),
    talent_id text REFERENCES talent(id) ON DELETE SET NULL,
    password_hash text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS members_email_key ON members (lower(email))`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id text PRIMARY KEY,
    member_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    revoked_reason text
  )`,
  `CREATE TABLE IF NOT EXISTS password_resets (
    token text PRIMARY KEY,
    member_id text NOT NULL,
    email text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    used_at timestamptz,
    superseded boolean NOT NULL DEFAULT false
  )`,
  `CREATE TABLE IF NOT EXISTS invitations (
    token text PRIMARY KEY,
    email text NOT NULL,
    name text NOT NULL,
    role text NOT NULL,
    office_id text NOT NULL,
    talent_id text,
    created_at timestamptz NOT NULL DEFAULT now(),
    used_at timestamptz,
    superseded boolean NOT NULL DEFAULT false
  )`,
  `CREATE TABLE IF NOT EXISTS clients (
    id text PRIMARY KEY,
    slug text NOT NULL UNIQUE,
    company text NOT NULL,
    contact_name text NOT NULL,
    contact_email text NOT NULL,
    time_zone text NOT NULL,
    killbill_account_id text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS photos (
    id text PRIMARY KEY,
    talent_id text NOT NULL REFERENCES talent(id) ON DELETE CASCADE,
    position int NOT NULL,
    object_key text NOT NULL,
    width int NOT NULL,
    height int NOT NULL,
    bytes int NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS photos_talent ON photos (talent_id, position)`,
  `CREATE TABLE IF NOT EXISTS rate_cards (
    id text PRIMARY KEY,
    name text NOT NULL,
    effective_from date NOT NULL UNIQUE,
    data jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS options (
    id text PRIMARY KEY,
    talent_id text NOT NULL REFERENCES talent(id),
    client_id text NOT NULL REFERENCES clients(id),
    job_date date NOT NULL,
    job_title text NOT NULL,
    note text,
    rank int,
    last_rank int,
    state text NOT NULL,
    auto_release_at timestamptz NOT NULL,
    hold_until timestamptz,
    hold_until_local text,
    release_at timestamptz GENERATED ALWAYS AS (LEAST(hold_until, auto_release_at)) STORED,
    challenge_deadline timestamptz,
    challenged_by_option_id text,
    placed_by text NOT NULL,
    placed_by_name text NOT NULL,
    placed_at timestamptz NOT NULL DEFAULT now(),
    saved_by_name text NOT NULL,
    saved_at timestamptz NOT NULL DEFAULT now(),
    released_at timestamptz,
    release_reason text,
    booking_id text,
    version int NOT NULL DEFAULT 1,
    feed_sequence int NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS options_day ON options (talent_id, job_date)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS options_rank_key ON options (talent_id, job_date, rank) WHERE rank IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS options_client_live_key
    ON options (talent_id, job_date, client_id) WHERE state IN ('placed', 'challenged')`,
  `CREATE TABLE IF NOT EXISTS bookings (
    id text PRIMARY KEY,
    reference text NOT NULL UNIQUE,
    state text NOT NULL,
    job_date date NOT NULL,
    office_id text NOT NULL,
    client_id text NOT NULL REFERENCES clients(id),
    job_title text NOT NULL,
    rate_card_id text NOT NULL REFERENCES rate_cards(id),
    talent_fees_cents bigint NOT NULL,
    service_fee_cents bigint NOT NULL,
    tax_cents bigint NOT NULL,
    total_cents bigint NOT NULL,
    killbill_invoice_id text,
    confirmed_by text,
    confirmed_by_name text,
    confirmed_at timestamptz,
    issued_by text,
    issued_by_name text,
    issued_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS booking_talent (
    booking_id text NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    talent_id text NOT NULL,
    position int NOT NULL,
    display_name text NOT NULL,
    talent_fees_cents bigint NOT NULL,
    service_fee_share_cents bigint NOT NULL,
    PRIMARY KEY (booking_id, talent_id)
  )`,
  `CREATE TABLE IF NOT EXISTS booking_lines (
    booking_id text NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    idx int NOT NULL,
    kind text NOT NULL,
    label text NOT NULL,
    talent_id text,
    amount_cents bigint NOT NULL,
    PRIMARY KEY (booking_id, idx)
  )`,
  `CREATE TABLE IF NOT EXISTS licences (
    id text PRIMARY KEY,
    client_id text NOT NULL REFERENCES clients(id),
    talent_id text NOT NULL REFERENCES talent(id),
    media text NOT NULL,
    territory text NOT NULL,
    first_use_date date NOT NULL,
    term_months int NOT NULL,
    extra_months int NOT NULL DEFAULT 0,
    monthly_fee_cents bigint NOT NULL,
    version int NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS licence_extensions (
    id text PRIMARY KEY,
    licence_id text NOT NULL REFERENCES licences(id) ON DELETE CASCADE,
    months int NOT NULL,
    amount_cents bigint NOT NULL,
    killbill_invoice_id text,
    extended_by text NOT NULL,
    extended_by_name text NOT NULL,
    extended_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS licence_reminders (
    licence_id text NOT NULL REFERENCES licences(id) ON DELETE CASCADE,
    ends_on date NOT NULL,
    PRIMARY KEY (licence_id, ends_on)
  )`,
  `CREATE TABLE IF NOT EXISTS movements (
    id text PRIMARY KEY,
    kind text NOT NULL,
    reference text NOT NULL,
    talent_id text,
    booking_id text,
    client_id text,
    reversal_of text,
    reversed_by_movement text,
    reversed_by_name text,
    reversed_at timestamptz,
    description text NOT NULL,
    created_by text NOT NULL,
    created_by_name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    office_date date NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ledger_entries (
    id bigserial PRIMARY KEY,
    movement_id text NOT NULL REFERENCES movements(id) ON DELETE CASCADE,
    account text NOT NULL,
    amount_cents bigint NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ledger_entries_account ON ledger_entries (account)`,
  `CREATE TABLE IF NOT EXISTS packages (
    id text PRIMARY KEY,
    title text NOT NULL,
    recipient_name text NOT NULL,
    recipient_email text NOT NULL,
    state text NOT NULL,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS package_links (
    token text PRIMARY KEY,
    package_id text NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
    issued_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    status text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS package_talent (
    package_id text NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
    talent_id text NOT NULL,
    position int NOT NULL,
    decision text NOT NULL DEFAULT 'undecided',
    PRIMARY KEY (package_id, talent_id)
  )`,
  `CREATE TABLE IF NOT EXISTS applications (
    id text PRIMARY KEY,
    token text NOT NULL,
    status text NOT NULL,
    office_id text NOT NULL REFERENCES offices(id),
    first_name text,
    last_name text,
    email text,
    date_of_birth date,
    height_cm int,
    instagram_followers bigint,
    bio text,
    guardian_name text,
    guardian_email text,
    minor boolean NOT NULL DEFAULT false,
    consent_token text,
    consent_issued_at timestamptz,
    consent_expires_at timestamptz,
    consent_used_at timestamptz,
    consent_decision text,
    submitted_at timestamptz,
    decision text,
    decided_by text,
    decided_by_name text,
    decided_at timestamptz,
    talent_id text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS applications_consent_token_key
    ON applications (consent_token) WHERE consent_token IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS application_photos (
    application_id text NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    slot text NOT NULL,
    object_key text NOT NULL,
    width int NOT NULL,
    height int NOT NULL,
    PRIMARY KEY (application_id, slot)
  )`,
  `CREATE TABLE IF NOT EXISTS cast_requests (
    id text PRIMARY KEY,
    reference text NOT NULL UNIQUE,
    name text NOT NULL,
    company text NOT NULL,
    email text NOT NULL,
    office_id text NOT NULL,
    shoot_date date NOT NULL,
    brief text NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS cast_request_talent (
    cast_request_id text NOT NULL REFERENCES cast_requests(id) ON DELETE CASCADE,
    talent_id text NOT NULL,
    position int NOT NULL,
    PRIMARY KEY (cast_request_id, talent_id)
  )`,
  `CREATE TABLE IF NOT EXISTS outbox (
    id text PRIMARY KEY,
    dedupe_key text,
    recipient text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    attachment_name text,
    attachment_body text,
    talent_ids text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz,
    attempts int NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    claimed_at timestamptz
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS outbox_dedupe_key ON outbox (dedupe_key)`,
  `CREATE TABLE IF NOT EXISTS idempotency_keys (
    member_id text NOT NULL,
    idem_key text NOT NULL,
    request_hash text NOT NULL,
    response_status int,
    response_body text,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (member_id, idem_key)
  )`,
  `CREATE TABLE IF NOT EXISTS rate_limit_hits (
    id bigserial PRIMARY KEY,
    bucket text NOT NULL,
    address text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS rate_limit_hits_window ON rate_limit_hits (bucket, address, created_at)`,
  `CREATE TABLE IF NOT EXISTS counters (
    name text PRIMARY KEY,
    value bigint NOT NULL
  )`,
];

export async function ensureSchema(): Promise<void> {
  await withAdvisoryLock(SCHEMA_LOCK, async () => {
    for (const statement of STATEMENTS) {
      await pool.query(statement);
    }
  });
  // A copy that skipped the lock must not serve before the schema exists.
  for (;;) {
    const ready = await pool.query<{ ready: boolean }>(
      `SELECT to_regclass('public.counters') IS NOT NULL AS ready`,
    );
    if (ready.rows[0]?.ready) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

export async function nextCounter(name: string): Promise<number> {
  const rows = await pool.query<{ value: number }>(
    `INSERT INTO counters (name, value) VALUES ($1, 1)
     ON CONFLICT (name) DO UPDATE SET value = counters.value + 1
     RETURNING value`,
    [name],
  );
  return rows.rows[0].value;
}
