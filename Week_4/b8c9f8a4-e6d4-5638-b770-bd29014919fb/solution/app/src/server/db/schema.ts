// The schema is applied on every serve. Every statement is safe to repeat, and the whole run is
// held behind one advisory lock so instances that start together do not race.

import { pool, withWaitingLock } from './pool.js';

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS owner_session (
     id uuid PRIMARY KEY,
     created_at timestamptz NOT NULL DEFAULT now())`,

  `CREATE TABLE IF NOT EXISTS car (
     id uuid PRIMARY KEY,
     name text NOT NULL,
     registration text NOT NULL,
     asking_pounds integer NOT NULL,
     viewing_area text NOT NULL,
     home_address text NOT NULL,
     story text NOT NULL,
     listing_status text NOT NULL,
     prior_status text,
     current_version integer,
     created_at timestamptz NOT NULL DEFAULT now())`,

  `CREATE TABLE IF NOT EXISTS reading (
     car_id uuid NOT NULL REFERENCES car(id) ON DELETE CASCADE,
     panel_id text NOT NULL,
     microns integer NOT NULL,
     read_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (car_id, panel_id))`,

  `CREATE TABLE IF NOT EXISTS upload (
     id uuid PRIMARY KEY,
     car_id uuid NOT NULL REFERENCES car(id) ON DELETE CASCADE,
     kind text NOT NULL,
     file_name text NOT NULL,
     sha256 text NOT NULL,
     bytes integer NOT NULL,
     content_type text NOT NULL,
     derivative_sha256 text,
     location_removed boolean NOT NULL DEFAULT false,
     label text,
     created_at timestamptz NOT NULL DEFAULT now())`,

  `CREATE TABLE IF NOT EXISTS finding (
     id uuid PRIMARY KEY,
     car_id uuid NOT NULL REFERENCES car(id) ON DELETE CASCADE,
     panel_id text NOT NULL,
     u numeric(4,3) NOT NULL,
     v numeric(4,3) NOT NULL,
     title text NOT NULL,
     wording text NOT NULL,
     severity text NOT NULL,
     photo_id uuid,
     revision integer NOT NULL DEFAULT 1,
     created_at timestamptz NOT NULL DEFAULT now(),
     removed_at timestamptz)`,

  `CREATE TABLE IF NOT EXISTS record_pull (
     id uuid PRIMARY KEY,
     car_id uuid NOT NULL REFERENCES car(id) ON DELETE CASCADE,
     pulled_at timestamptz NOT NULL DEFAULT now(),
     payload jsonb NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS advisory_response (
     car_id uuid NOT NULL REFERENCES car(id) ON DELETE CASCADE,
     advisory_id text NOT NULL,
     stance text NOT NULL,
     note text NOT NULL,
     answered_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (car_id, advisory_id))`,

  `CREATE TABLE IF NOT EXISTS version (
     car_id uuid NOT NULL REFERENCES car(id) ON DELETE CASCADE,
     number integer NOT NULL,
     published_at timestamptz NOT NULL DEFAULT now(),
     report_sha256 text NOT NULL,
     signature text NOT NULL,
     snapshot jsonb NOT NULL,
     PRIMARY KEY (car_id, number))`,

  `CREATE TABLE IF NOT EXISTS version_finding (
     car_id uuid NOT NULL REFERENCES car(id) ON DELETE CASCADE,
     number integer NOT NULL,
     finding_id uuid NOT NULL,
     content_hash text NOT NULL,
     position integer NOT NULL,
     material boolean NOT NULL,
     PRIMARY KEY (car_id, number, finding_id))`,

  `CREATE TABLE IF NOT EXISTS link (
     id uuid PRIMARY KEY,
     car_id uuid NOT NULL REFERENCES car(id) ON DELETE CASCADE,
     role text NOT NULL,
     name text NOT NULL,
     token text NOT NULL UNIQUE,
     revoked boolean NOT NULL DEFAULT false,
     issued_at timestamptz NOT NULL DEFAULT now(),
     expires_at timestamptz NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS seen_record (
     link_id uuid NOT NULL REFERENCES link(id) ON DELETE CASCADE,
     finding_id uuid NOT NULL,
     content_hash text NOT NULL,
     seen_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (link_id, finding_id, content_hash))`,

  `CREATE TABLE IF NOT EXISTS slot (
     id uuid PRIMARY KEY,
     car_id uuid NOT NULL REFERENCES car(id) ON DELETE CASCADE,
     local_start text NOT NULL,
     starts_at timestamptz NOT NULL,
     duration_minutes integer NOT NULL,
     holder_link_id uuid REFERENCES link(id) ON DELETE SET NULL)`,

  `CREATE TABLE IF NOT EXISTS offer (
     id uuid PRIMARY KEY,
     car_id uuid NOT NULL REFERENCES car(id) ON DELETE CASCADE,
     link_id uuid NOT NULL REFERENCES link(id) ON DELETE CASCADE,
     amount_pounds integer NOT NULL,
     status text NOT NULL,
     stamped_at timestamptz NOT NULL DEFAULT now(),
     lapses_at timestamptz NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS phone_alert (
     id uuid PRIMARY KEY,
     car_id uuid NOT NULL REFERENCES car(id) ON DELETE CASCADE,
     offer_id uuid,
     kind text NOT NULL,
     state text NOT NULL,
     attempts integer NOT NULL DEFAULT 0,
     created_at timestamptz NOT NULL DEFAULT now(),
     delivered_at timestamptz)`,

  `CREATE UNIQUE INDEX IF NOT EXISTS phone_alert_one_lapse_warning
     ON phone_alert (offer_id) WHERE kind = 'offer_lapsing'`,

  `CREATE TABLE IF NOT EXISTS idempotency (
     scope text NOT NULL,
     key text NOT NULL,
     body_hash text NOT NULL,
     status integer NOT NULL,
     response jsonb NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (scope, key))`,

  `CREATE TABLE IF NOT EXISTS capture_item (
     link_id uuid NOT NULL REFERENCES link(id) ON DELETE CASCADE,
     client_id text NOT NULL,
     payload_hash text NOT NULL,
     kind text NOT NULL,
     panel_id text NOT NULL,
     microns integer,
     u numeric(4,3),
     v numeric(4,3),
     wording text,
     captured_at timestamptz NOT NULL,
     received_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (link_id, client_id))`,

  `CREATE TABLE IF NOT EXISTS owner_secret (
     id integer PRIMARY KEY,
     passphrase_hash text NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS seed_state (
     id integer PRIMARY KEY,
     completed_at timestamptz NOT NULL DEFAULT now())`,

  `CREATE INDEX IF NOT EXISTS finding_by_car ON finding (car_id)`,
  `CREATE INDEX IF NOT EXISTS link_by_car ON link (car_id)`,
  `CREATE INDEX IF NOT EXISTS offer_by_car ON offer (car_id)`,
  `CREATE INDEX IF NOT EXISTS phone_alert_by_car ON phone_alert (car_id)`,
  `CREATE INDEX IF NOT EXISTS seen_by_link ON seen_record (link_id)`,
  `CREATE INDEX IF NOT EXISTS pull_by_car ON record_pull (car_id, pulled_at DESC)`,
];

const SCHEMA_LOCK = 848201;

export async function applySchema(): Promise<void> {
  await withWaitingLock(SCHEMA_LOCK, async () => {
    for (const statement of STATEMENTS) {
      await pool.query(statement);
    }
  });
}
