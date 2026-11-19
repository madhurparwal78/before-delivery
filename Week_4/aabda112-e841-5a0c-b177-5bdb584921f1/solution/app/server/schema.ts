/** Idempotent schema, applied at every start under an advisory lock. */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS clock (
  id int PRIMARY KEY CHECK (id = 1),
  anchor_real timestamptz NOT NULL,
  anchor_virtual timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS clinics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  name text NOT NULL,
  email text NOT NULL,
  role text NOT NULL,
  status text NOT NULL DEFAULT 'Active',
  password_hash text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '30 days'
);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '30 days';
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
CREATE TABLE IF NOT EXISTS login_links (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  used boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS invitations (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  name text NOT NULL,
  position serial
);
CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  name text NOT NULL,
  email text NOT NULL
);
CREATE INDEX IF NOT EXISTS clients_clinic ON clients (clinic_id, lower(email));
CREATE TABLE IF NOT EXISTS patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  name text NOT NULL,
  species text NOT NULL,
  weight_grams int,
  photo_file_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS patients_clinic ON patients (clinic_id);
CREATE TABLE IF NOT EXISTS weights (
  seq bigserial PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES patients(id),
  recorded_on date NOT NULL,
  grams int NOT NULL
);
CREATE TABLE IF NOT EXISTS vaccinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id),
  vaccine text NOT NULL,
  due_date date NOT NULL,
  reminder text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (patient_id, vaccine, due_date)
);
CREATE TABLE IF NOT EXISTS pet_tokens (
  token_hash text PRIMARY KEY,
  vaccination_id uuid NOT NULL REFERENCES vaccinations(id)
);
CREATE TABLE IF NOT EXISTS appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  vet_id uuid NOT NULL REFERENCES users(id),
  room_id uuid NOT NULL REFERENCES rooms(id),
  start_at timestamptz NOT NULL,
  minutes int NOT NULL,
  reason text NOT NULL,
  status text NOT NULL,
  checked_in_at timestamptz,
  late_by_minutes int,
  cancelled_at timestamptz,
  status_before_cancel text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS appointments_clinic_start ON appointments (clinic_id, start_at);
CREATE INDEX IF NOT EXISTS appointments_patient ON appointments (patient_id);
CREATE TABLE IF NOT EXISTS note_ops (
  seq bigserial PRIMARY KEY,
  appointment_id uuid NOT NULL REFERENCES appointments(id),
  n int NOT NULL,
  version int NOT NULL,
  text text NOT NULL,
  edited_by uuid REFERENCES users(id),
  at timestamptz NOT NULL,
  UNIQUE (appointment_id, n, version)
);
CREATE TABLE IF NOT EXISTS admissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  kennel text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS treatments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id uuid NOT NULL REFERENCES admissions(id),
  name text NOT NULL,
  idx int NOT NULL,
  scheduled_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'open',
  closed_at timestamptz,
  given_by uuid REFERENCES users(id),
  skip_reason text,
  seen_status text
);
CREATE INDEX IF NOT EXISTS treatments_admission ON treatments (admission_id);
CREATE TABLE IF NOT EXISTS treatment_notes (
  seq bigserial PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  treatment_id uuid NOT NULL REFERENCES treatments(id),
  text text NOT NULL,
  author_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS stock_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  name text NOT NULL,
  reorder_point int NOT NULL,
  unit_price_pence int NOT NULL,
  low_flag boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS stock_batches (
  seq bigserial PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  item_id uuid NOT NULL REFERENCES stock_items(id),
  name text NOT NULL,
  expires_on date NOT NULL,
  UNIQUE (item_id, name)
);
CREATE TABLE IF NOT EXISTS stock_movements (
  seq bigserial PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  item_id uuid NOT NULL REFERENCES stock_items(id),
  batch_id uuid NOT NULL REFERENCES stock_batches(id),
  delta int NOT NULL,
  reason text NOT NULL,
  invoice_line_id uuid,
  paired_movement_id uuid,
  balance_after int NOT NULL,
  by_user uuid REFERENCES users(id),
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS stock_movements_item ON stock_movements (item_id, seq);
CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  number_seq int NOT NULL,
  patient_id uuid NOT NULL REFERENCES patients(id),
  appointment_id uuid REFERENCES appointments(id),
  status text NOT NULL DEFAULT 'draft',
  discount_percent int NOT NULL DEFAULT 0,
  voided_by uuid REFERENCES users(id),
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (clinic_id, number_seq)
);
CREATE TABLE IF NOT EXISTS invoice_lines (
  seq bigserial PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  stock_item_id uuid NOT NULL REFERENCES stock_items(id),
  description text NOT NULL,
  quantity int NOT NULL,
  unit_price_pence int NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  seq bigserial PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  pence int NOT NULL,
  taken_by uuid NOT NULL REFERENCES users(id),
  at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  key text NOT NULL,
  fingerprint text NOT NULL,
  status int NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (clinic_id, key)
);
CREATE TABLE IF NOT EXISTS files (
  seq bigserial PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  appointment_id uuid REFERENCES appointments(id),
  name text NOT NULL,
  kind text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 text NOT NULL,
  object_key text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS online_bookings (
  code text PRIMARY KEY,
  clinic_id uuid NOT NULL REFERENCES clinics(id),
  appointment_id uuid NOT NULL REFERENCES appointments(id),
  owner_email text NOT NULL
);
CREATE TABLE IF NOT EXISTS booking_attempts (
  id bigserial PRIMARY KEY,
  address text NOT NULL,
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS booking_attempts_address ON booking_attempts (address, at);
CREATE TABLE IF NOT EXISTS mail_outbox (
  seq bigserial PRIMARY KEY,
  to_addr text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  vaccination_id uuid UNIQUE REFERENCES vaccinations(id),
  sent_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS mail_outbox_pending ON mail_outbox (next_attempt_at) WHERE sent_at IS NULL;
`;
