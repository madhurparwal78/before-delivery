import { takeAdvisoryLock, transaction } from './db';

const STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS owner_credential (
     id int PRIMARY KEY DEFAULT 1,
     passphrase_hash text NOT NULL,
     CONSTRAINT owner_credential_single CHECK (id = 1)
   )`,
  `CREATE TABLE IF NOT EXISTS owner_session (
     token text PRIMARY KEY,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS car (
     id uuid PRIMARY KEY,
     name text NOT NULL,
     registration text NOT NULL,
     asking_pounds int NOT NULL,
     viewing_area text NOT NULL,
     home_address text NOT NULL,
     story text NOT NULL,
     listing_status text NOT NULL,
     prior_status text,
     current_version int,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS panel_reading (
     car_id uuid NOT NULL REFERENCES car(id) ON DELETE CASCADE,
     panel_id text NOT NULL,
     microns int NOT NULL,
     read_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (car_id, panel_id)
   )`,
  `CREATE TABLE IF NOT EXISTS upload (
     id uuid PRIMARY KEY,
     car_id uuid NOT NULL REFERENCES car(id) ON DELETE CASCADE,
     kind text NOT NULL,
     file_name text NOT NULL,
     sha256 text NOT NULL,
     bytes int NOT NULL,
     content_type text NOT NULL,
     derivative_sha256 text,
     location_removed boolean NOT NULL DEFAULT false,
     label text,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS finding (
     id uuid PRIMARY KEY,
     car_id uuid NOT NULL REFERENCES car(id) ON DELETE CASCADE,
     panel_id text NOT NULL,
     u numeric(4,3) NOT NULL,
     v numeric(4,3) NOT NULL,
     title text NOT NULL,
     wording text NOT NULL,
     severity text NOT NULL,
     photo_id uuid REFERENCES upload(id),
     revision int NOT NULL DEFAULT 1,
     created_seq bigserial NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS record_pull (
     id uuid PRIMARY KEY,
     car_id uuid NOT NULL REFERENCES car(id) ON DELETE CASCADE,
     pulled_at timestamptz NOT NULL,
     first_used_date text,
     payload jsonb NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS record_pull_car_idx ON record_pull (car_id, pulled_at DESC)`,
  `CREATE TABLE IF NOT EXISTS advisory_response (
     car_id uuid NOT NULL REFERENCES car(id) ON DELETE CASCADE,
     mot_test_number text NOT NULL,
     advisory_text text NOT NULL,
     stance text NOT NULL,
     note text NOT NULL,
     answered_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (car_id, mot_test_number, advisory_text)
   )`,
  `CREATE TABLE IF NOT EXISTS car_version (
     car_id uuid NOT NULL REFERENCES car(id) ON DELETE CASCADE,
     number int NOT NULL,
     published_at timestamptz NOT NULL,
     report_sha256 text NOT NULL,
     findings jsonb NOT NULL,
     panels jsonb NOT NULL,
     record jsonb,
     open_advisories int NOT NULL,
     PRIMARY KEY (car_id, number)
   )`,
  `CREATE TABLE IF NOT EXISTS removed_finding (
     car_id uuid NOT NULL REFERENCES car(id) ON DELETE CASCADE,
     finding_id uuid NOT NULL,
     title text NOT NULL,
     removed_in_version int NOT NULL,
     PRIMARY KEY (car_id, finding_id)
   )`,
  `CREATE TABLE IF NOT EXISTS named_link (
     id uuid PRIMARY KEY,
     car_id uuid NOT NULL REFERENCES car(id) ON DELETE CASCADE,
     role text NOT NULL,
     name text NOT NULL,
     token text NOT NULL UNIQUE,
     expires_at timestamptz NOT NULL,
     revoked_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS seen_record (
     link_id uuid NOT NULL REFERENCES named_link(id) ON DELETE CASCADE,
     finding_id uuid NOT NULL,
     content_hash text NOT NULL,
     version_number int NOT NULL,
     seen_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (link_id, finding_id, content_hash)
   )`,
  `CREATE TABLE IF NOT EXISTS viewing_slot (
     id uuid PRIMARY KEY,
     car_id uuid NOT NULL REFERENCES car(id) ON DELETE CASCADE,
     local_start text NOT NULL,
     starts_at timestamptz NOT NULL,
     duration_minutes int NOT NULL,
     holder_link_id uuid REFERENCES named_link(id) ON DELETE SET NULL
   )`,
  `CREATE TABLE IF NOT EXISTS offer (
     id uuid PRIMARY KEY,
     car_id uuid NOT NULL REFERENCES car(id) ON DELETE CASCADE,
     link_id uuid NOT NULL REFERENCES named_link(id) ON DELETE CASCADE,
     amount_pounds int NOT NULL,
     status text NOT NULL,
     stamped_at timestamptz NOT NULL,
     lapses_at timestamptz NOT NULL,
     lapsing_alerted boolean NOT NULL DEFAULT false
   )`,
  `CREATE TABLE IF NOT EXISTS phone_alert (
     id uuid PRIMARY KEY,
     car_id uuid NOT NULL REFERENCES car(id) ON DELETE CASCADE,
     kind text NOT NULL,
     state text NOT NULL,
     attempts int NOT NULL DEFAULT 0,
     created_at timestamptz NOT NULL DEFAULT now(),
     delivered_at timestamptz
   )`,
  `CREATE TABLE IF NOT EXISTS idempotency (
     scope text NOT NULL,
     key text NOT NULL,
     body_hash text NOT NULL,
     status int NOT NULL,
     response jsonb NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (scope, key)
   )`,
  `CREATE TABLE IF NOT EXISTS capture_item (
     link_id uuid NOT NULL REFERENCES named_link(id) ON DELETE CASCADE,
     client_id uuid NOT NULL,
     payload_hash text NOT NULL,
     kind text NOT NULL,
     panel_id text NOT NULL,
     microns int,
     u numeric(4,3),
     v numeric(4,3),
     wording text,
     captured_at timestamptz NOT NULL,
     received_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (link_id, client_id)
   )`,
  `CREATE TABLE IF NOT EXISTS seed_state (
     id int PRIMARY KEY DEFAULT 1,
     completed_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT seed_state_single CHECK (id = 1)
   )`,
];

/** Applies the schema. Safe to repeat and safe to run at the same time as other instances. */
export const applySchema = async (): Promise<void> => {
  await transaction(async (tx) => {
    await takeAdvisoryLock(tx, 'open-bonnet:schema');
    for (const statement of STATEMENTS) await tx.query(statement);
  });
};
