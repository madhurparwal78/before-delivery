import { query } from './db';

const STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS practices (
     id uuid PRIMARY KEY,
     reminder_hour integer NOT NULL DEFAULT 9,
     clock_now_ms bigint,
     created_ms bigint NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS users (
     id uuid PRIMARY KEY,
     practice_id uuid NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
     display_name text NOT NULL,
     email text NOT NULL UNIQUE,
     password_hash text NOT NULL,
     role text NOT NULL CHECK (role IN ('bookkeeper','owner')),
     client_id uuid,
     created_ms bigint NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token text PRIMARY KEY,
     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     expires_ms bigint NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS clients (
     id uuid PRIMARY KEY,
     practice_id uuid NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
     name text NOT NULL,
     owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_ms bigint NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS states (
     id uuid PRIMARY KEY,
     practice_id uuid NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
     code text NOT NULL,
     name text NOT NULL,
     zone text NOT NULL,
     UNIQUE (practice_id, code)
   )`,
  `CREATE TABLE IF NOT EXISTS state_holidays (
     state_id uuid NOT NULL REFERENCES states(id) ON DELETE CASCADE,
     day date NOT NULL,
     PRIMARY KEY (state_id, day)
   )`,
  `CREATE TABLE IF NOT EXISTS state_editions (
     id uuid PRIMARY KEY,
     state_id uuid NOT NULL REFERENCES states(id) ON DELETE CASCADE,
     effective_date date NOT NULL,
     due_day integer NOT NULL,
     carry text NOT NULL CHECK (carry IN ('next_business','fixed')),
     rate numeric(9,3) NOT NULL,
     extension_days integer NOT NULL,
     UNIQUE (state_id, effective_date)
   )`,
  `CREATE TABLE IF NOT EXISTS registrations (
     id uuid PRIMARY KEY,
     practice_id uuid NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
     client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
     state_id uuid NOT NULL REFERENCES states(id) ON DELETE CASCADE,
     frequency text NOT NULL CHECK (frequency IN ('monthly','quarterly','yearly')),
     first_period text NOT NULL,
     created_ms bigint NOT NULL,
     UNIQUE (client_id, state_id)
   )`,
  `CREATE TABLE IF NOT EXISTS returns (
     id uuid PRIMARY KEY,
     practice_id uuid NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
     client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
     registration_id uuid NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
     state_id uuid NOT NULL REFERENCES states(id) ON DELETE CASCADE,
     period text NOT NULL,
     frequency text NOT NULL,
     status text NOT NULL CHECK (status IN ('not_started','prepared','client_approved','filed','packeted','amended')),
     version integer NOT NULL DEFAULT 1,
     gross_sales numeric(14,2),
     tax_due numeric(14,2),
     unextended_nominal_date date NOT NULL,
     nominal_due_date date NOT NULL,
     due_date date NOT NULL,
     carried_from date,
     due_at_ms bigint NOT NULL,
     edition_effective_date date NOT NULL,
     edition_due_day integer NOT NULL,
     edition_carry text NOT NULL,
     edition_rate numeric(9,3) NOT NULL,
     edition_extension_days integer NOT NULL,
     awaiting_approval boolean NOT NULL DEFAULT false,
     filed_at_ms bigint,
     packet_revisions integer NOT NULL DEFAULT 0,
     packet_target_revision integer NOT NULL DEFAULT 0,
     changed_by text NOT NULL,
     created_ms bigint NOT NULL,
     UNIQUE (registration_id, period)
   )`,
  `CREATE INDEX IF NOT EXISTS returns_practice_idx ON returns (practice_id)`,
  `CREATE INDEX IF NOT EXISTS returns_render_idx ON returns (status) WHERE packet_target_revision > packet_revisions`,
  `CREATE TABLE IF NOT EXISTS approvals (
     id uuid PRIMARY KEY,
     return_id uuid NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
     action text NOT NULL CHECK (action IN ('approved','sent_back')),
     by_name text NOT NULL,
     at_ms bigint NOT NULL,
     reason text,
     seq bigserial
   )`,
  `CREATE INDEX IF NOT EXISTS approvals_return_idx ON approvals (return_id)`,
  `CREATE TABLE IF NOT EXISTS extensions (
     return_id uuid PRIMARY KEY REFERENCES returns(id) ON DELETE CASCADE,
     granted_at_ms bigint NOT NULL,
     extension_days integer NOT NULL,
     due_date_before date NOT NULL,
     due_at_before_ms bigint NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS amendments (
     id uuid PRIMARY KEY,
     return_id uuid NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
     at_ms bigint NOT NULL,
     by_name text NOT NULL,
     note text,
     original_gross_sales numeric(14,2) NOT NULL,
     original_tax_due numeric(14,2) NOT NULL,
     amended_gross_sales numeric(14,2) NOT NULL,
     amended_tax_due numeric(14,2) NOT NULL,
     seq bigserial
   )`,
  `CREATE INDEX IF NOT EXISTS amendments_return_idx ON amendments (return_id)`,
  `CREATE TABLE IF NOT EXISTS reminders (
     id uuid PRIMARY KEY,
     return_id uuid NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
     lead_days integer NOT NULL CHECK (lead_days IN (7,1)),
     scheduled_for_ms bigint NOT NULL,
     sent_at_ms bigint,
     UNIQUE (return_id, lead_days)
   )`,
  `CREATE INDEX IF NOT EXISTS reminders_pending_idx ON reminders (scheduled_for_ms) WHERE sent_at_ms IS NULL`,
  `CREATE TABLE IF NOT EXISTS mail_jobs (
     id uuid PRIMARY KEY,
     practice_id uuid NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
     return_id uuid REFERENCES returns(id) ON DELETE CASCADE,
     kind text NOT NULL,
     recipient text NOT NULL,
     subject text NOT NULL,
     body text NOT NULL,
     sent_ms bigint,
     created_ms bigint NOT NULL,
     seq bigserial
   )`,
  `CREATE INDEX IF NOT EXISTS mail_jobs_pending_idx ON mail_jobs (seq) WHERE sent_ms IS NULL`,
  `CREATE TABLE IF NOT EXISTS packet_revisions (
     return_id uuid NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
     revision integer NOT NULL,
     bytes bytea NOT NULL,
     created_ms bigint NOT NULL,
     PRIMARY KEY (return_id, revision)
   )`,
];

export async function applySchema(): Promise<void> {
  for (const statement of STATEMENTS) {
    await query(statement);
  }
}
