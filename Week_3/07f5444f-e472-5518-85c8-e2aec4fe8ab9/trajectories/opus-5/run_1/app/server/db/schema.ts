import type { Queryable } from './pool.js';

const STATEMENTS: string[] = [
  `CREATE EXTENSION IF NOT EXISTS btree_gist`,

  `CREATE TABLE IF NOT EXISTS people (
     id text PRIMARY KEY,
     name text NOT NULL,
     email text NOT NULL UNIQUE,
     passcode text NOT NULL,
     role text NOT NULL,
     chair_key text,
     chair_section text,
     chair_number int,
     chair_label text
   )`,

  `CREATE TABLE IF NOT EXISTS sessions (
     id text PRIMARY KEY,
     person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
     created_at timestamptz NOT NULL DEFAULT now(),
     last_seen_at timestamptz NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS catalogue_works (
     id text PRIMARY KEY,
     title text NOT NULL,
     composer text NOT NULL,
     bars int NOT NULL,
     ord int NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS catalogue_bar_spans (
     catalogue_work_id text NOT NULL REFERENCES catalogue_works(id) ON DELETE CASCADE,
     from_bar int NOT NULL,
     to_bar int NOT NULL,
     bar_ms int NOT NULL,
     PRIMARY KEY (catalogue_work_id, from_bar)
   )`,

  `CREATE TABLE IF NOT EXISTS catalogue_letters (
     catalogue_work_id text NOT NULL REFERENCES catalogue_works(id) ON DELETE CASCADE,
     letter text NOT NULL,
     bar int NOT NULL,
     PRIMARY KEY (catalogue_work_id, letter)
   )`,

  `CREATE TABLE IF NOT EXISTS catalogue_parts (
     catalogue_work_id text NOT NULL REFERENCES catalogue_works(id) ON DELETE CASCADE,
     chair_key text NOT NULL,
     name text NOT NULL,
     bars_from int NOT NULL,
     bars_to int NOT NULL,
     ord int NOT NULL,
     PRIMARY KEY (catalogue_work_id, chair_key)
   )`,

  `CREATE TABLE IF NOT EXISTS programmes (
     id text PRIMARY KEY,
     number int NOT NULL UNIQUE,
     title text NOT NULL,
     status text NOT NULL,
     first_rehearsal timestamptz NOT NULL,
     violin_1 int NOT NULL,
     violin_2 int NOT NULL,
     viola int NOT NULL,
     cello int NOT NULL,
     bass int NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS performances (
     programme_id text NOT NULL REFERENCES programmes(id) ON DELETE CASCADE,
     at timestamptz NOT NULL,
     PRIMARY KEY (programme_id, at)
   )`,

  `CREATE TABLE IF NOT EXISTS programme_works (
     id text PRIMARY KEY,
     programme_id text NOT NULL REFERENCES programmes(id) ON DELETE CASCADE,
     catalogue_work_id text NOT NULL REFERENCES catalogue_works(id),
     ord int NOT NULL,
     UNIQUE (programme_id, catalogue_work_id)
   )`,

  `CREATE TABLE IF NOT EXISTS parts (
     id text PRIMARY KEY,
     programme_work_id text NOT NULL REFERENCES programme_works(id) ON DELETE CASCADE,
     chair_key text NOT NULL,
     name text NOT NULL,
     bars_from int NOT NULL,
     bars_to int NOT NULL,
     ord int NOT NULL,
     copies_on_hand int NOT NULL DEFAULT 0,
     UNIQUE (programme_work_id, chair_key)
   )`,

  `CREATE TABLE IF NOT EXISTS cuts (
     id text PRIMARY KEY,
     programme_work_id text NOT NULL REFERENCES programme_works(id) ON DELETE CASCADE,
     from_bar int NOT NULL,
     to_bar int NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT cuts_ascending CHECK (from_bar <= to_bar),
     CONSTRAINT cuts_one_per_bar EXCLUDE USING gist (
       programme_work_id WITH =,
       int4range(from_bar, to_bar, '[]') WITH &&
     )
   )`,

  `CREATE TABLE IF NOT EXISTS marks (
     part_id text NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
     cut_id text NOT NULL REFERENCES cuts(id) ON DELETE CASCADE,
     marked_by text NOT NULL REFERENCES people(id),
     marked_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (part_id, cut_id)
   )`,

  `CREATE TABLE IF NOT EXISTS scans (
     id text PRIMARY KEY,
     part_id text NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
     kind text NOT NULL,
     file_name text NOT NULL,
     content_type text NOT NULL,
     size_bytes bigint NOT NULL,
     sha256 text NOT NULL,
     object_key text NOT NULL,
     filed_at timestamptz NOT NULL DEFAULT now(),
     uploaded_by text NOT NULL REFERENCES people(id)
   )`,

  `CREATE INDEX IF NOT EXISTS scans_by_part ON scans (part_id, kind, filed_at DESC)`,

  `CREATE TABLE IF NOT EXISTS notices (
     programme_id text NOT NULL REFERENCES programmes(id) ON DELETE CASCADE,
     player_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
     chair_label text NOT NULL,
     status text NOT NULL,
     sent_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (programme_id, player_id)
   )`,

  `CREATE TABLE IF NOT EXISTS rental_sets (
     id text PRIMARY KEY,
     programme_work_id text NOT NULL REFERENCES programme_works(id) ON DELETE CASCADE,
     publisher text NOT NULL,
     status text NOT NULL,
     returned_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,

  `CREATE UNIQUE INDEX IF NOT EXISTS rental_sets_one_open
     ON rental_sets (programme_work_id) WHERE status <> 'checked_in'`,

  `CREATE TABLE IF NOT EXISTS rental_slip_lines (
     rental_set_id text NOT NULL REFERENCES rental_sets(id) ON DELETE CASCADE,
     part_id text NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
     copies int NOT NULL,
     checked_in int NOT NULL DEFAULT 0,
     ord int NOT NULL,
     PRIMARY KEY (rental_set_id, part_id)
   )`,

  `CREATE TABLE IF NOT EXISTS rental_reminders (
     rental_set_id text NOT NULL REFERENCES rental_sets(id) ON DELETE CASCADE,
     person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
     status text NOT NULL,
     sent_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (rental_set_id, person_id)
   )`,

  `CREATE TABLE IF NOT EXISTS idempotency_records (
     scope text NOT NULL,
     key text NOT NULL,
     fingerprint text NOT NULL,
     status_code int,
     response_body jsonb,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (scope, key)
   )`,
];

export async function applySchema(db: Queryable): Promise<void> {
  for (const statement of STATEMENTS) {
    await db.query(statement);
  }
}
