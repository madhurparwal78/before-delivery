import pg from 'pg';

// An instance may own a dedicated schema through DB_SCHEMA (used by the
// storage-outage instance, which shares no state with the main instance).
const schema = process.env.DB_SCHEMA || 'public';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  options: `-c search_path=${schema}`,
});

export type Row = Record<string, any>;
export const q = (text: string, params?: any[]) => pool.query(text, params);
export const one = async (text: string, params?: any[]): Promise<Row> => {
  const r = await pool.query(text, params);
  return r.rows[0];
};

const HOUR = 3600_000;

export async function createSchema(): Promise<void> {
  await pool.query(`create schema if not exists ${schema}`);
  const ddl = `
  create extension if not exists pgcrypto;

  create table if not exists clinics (
    id text primary key default gen_random_uuid()::text,
    name text not null,
    slug text not null unique,
    invoice_seq int not null default 0
  );

  create table if not exists rooms (
    id text primary key default gen_random_uuid()::text,
    clinic_id text not null references clinics(id) on delete cascade,
    name text not null,
    position int not null default 0
  );

  create table if not exists users (
    id text primary key default gen_random_uuid()::text,
    clinic_id text not null references clinics(id) on delete cascade,
    name text not null,
    email text not null,
    password_hash text,
    role text not null,
    status text not null default 'Active',
    created_at timestamptz not null default now()
  );

  create table if not exists login_links (
    token text primary key,
    user_id text not null references users(id) on delete cascade,
    used_at timestamptz,
    created_at timestamptz not null default now()
  );

  create table if not exists sessions (
    token text primary key,
    user_id text not null references users(id) on delete cascade,
    created_at timestamptz not null default now()
  );

  create table if not exists invitations (
    id text primary key default gen_random_uuid()::text,
    clinic_id text not null references clinics(id) on delete cascade,
    email text not null,
    name text,
    role text not null,
    token text not null unique,
    status text not null default 'Invited',
    created_at timestamptz not null default now()
  );

  create table if not exists clients (
    id text primary key default gen_random_uuid()::text,
    clinic_id text not null references clinics(id) on delete cascade,
    name text not null,
    email text
  );

  create table if not exists patients (
    id text primary key default gen_random_uuid()::text,
    clinic_id text not null references clinics(id) on delete cascade,
    client_id text not null references clients(id) on delete cascade,
    name text not null,
    species text not null,
    weight_grams int,
    photo_file_id text,
    created_at timestamptz not null default now()
  );

  create table if not exists patient_weights (
    id text primary key default gen_random_uuid()::text,
    patient_id text not null references patients(id) on delete cascade,
    recorded_on date not null,
    grams int not null
  );

  create table if not exists vaccinations (
    id text primary key default gen_random_uuid()::text,
    clinic_id text not null references clinics(id) on delete cascade,
    patient_id text not null references patients(id) on delete cascade,
    vaccine text not null,
    due_date date not null,
    reminder text not null default 'Scheduled',
    sent_at timestamptz,
    pet_token text,
    created_at timestamptz not null default now()
  );

  create table if not exists appointments (
    id text primary key default gen_random_uuid()::text,
    clinic_id text not null references clinics(id) on delete cascade,
    patient_id text not null references patients(id) on delete cascade,
    vet_id text not null references users(id) on delete cascade,
    room_id text not null references rooms(id) on delete cascade,
    start_at timestamptz not null,
    minutes int not null,
    reason text not null,
    status text not null default 'booked',
    checked_in_at timestamptz,
    prev_status text,
    cancelled_at timestamptz,
    undo_until timestamptz,
    created_at timestamptz not null default now()
  );
  create index if not exists appointments_clinic_start on appointments(clinic_id, start_at);

  create table if not exists consult_notes (
    id text primary key default gen_random_uuid()::text,
    appointment_id text not null references appointments(id) on delete cascade,
    created_at timestamptz not null default now()
  );

  create table if not exists note_paragraphs (
    id text primary key default gen_random_uuid()::text,
    appointment_id text not null references appointments(id) on delete cascade,
    n int not null,
    version int not null default 1,
    text text not null default '',
    edited_by text,
    edited_at timestamptz not null default now(),
    unique(appointment_id, n)
  );

  `;
  await pool.query(ddl);
  await pool.query(`
    create table if not exists note_operations (
      id bigserial primary key,
      appointment_id text not null references appointments(id) on delete cascade,
      n int not null,
      version int not null,
      text text not null,
      edited_by text,
      at timestamptz not null default now()
    );`);
  await pool.query(`
    create table if not exists admissions (
      id text primary key default gen_random_uuid()::text,
      clinic_id text not null references clinics(id) on delete cascade,
      patient_id text not null references patients(id) on delete cascade,
      kennel text not null,
      created_at timestamptz not null default now()
    );`);
  await pool.query(`
    create table if not exists treatments (
      id text primary key default gen_random_uuid()::text,
      clinic_id text not null references clinics(id) on delete cascade,
      admission_id text not null references admissions(id) on delete cascade,
      patient_id text not null references patients(id) on delete cascade,
      name text not null,
      first_at timestamptz not null,
      interval_hours int not null,
      dose_count int not null
    );`);
  await pool.query(`
    create table if not exists doses (
      id text primary key default gen_random_uuid()::text,
      treatment_id text not null references treatments(id) on delete cascade,
      idx int not null,
      scheduled_at timestamptz not null,
      status text not null default 'upcoming',
      given_at timestamptz,
      given_by text,
      skip_reason text,
      unique(treatment_id, idx)
    );`);
  await pool.query(`
    create table if not exists treatment_notes (
      id text primary key default gen_random_uuid()::text,
      treatment_id text not null references treatments(id) on delete cascade,
      text text not null,
      author text,
      created_at timestamptz not null default now()
    );`);
  await pool.query(`
    create table if not exists stock_items (
      id text primary key default gen_random_uuid()::text,
      clinic_id text not null references clinics(id) on delete cascade,
      name text not null,
      reorder_point int not null default 0,
      unit_price_pence int not null default 0,
      low_alerted boolean not null default false
    );`);
  await pool.query(`
    create table if not exists stock_batches (
      id text primary key default gen_random_uuid()::text,
      item_id text not null references stock_items(id) on delete cascade,
      batch text not null,
      expires_on date not null,
      received_order int not null,
      unique(item_id, batch)
    );`);
  await pool.query(`
    create table if not exists stock_movements (
      id text primary key default gen_random_uuid()::text,
      item_id text not null references stock_items(id) on delete cascade,
      batch_id text not null references stock_batches(id) on delete cascade,
      delta int not null,
      reason text not null,
      invoice_line_id text,
      paired_movement_id text,
      balance_after int not null,
      by text,
      at timestamptz not null default now()
    );`);
  await pool.query(`
    create table if not exists invoices (
      id text primary key default gen_random_uuid()::text,
      clinic_id text not null references clinics(id) on delete cascade,
      patient_id text not null references patients(id) on delete cascade,
      appointment_id text,
      number text not null,
      status text not null default 'draft',
      discount_percent int not null default 0,
      voided_by text,
      voided_at timestamptz,
      void_reason text,
      created_at timestamptz not null default now()
    );
    create unique index if not exists invoices_number_uniq on invoices(clinic_id, number);`);
  await pool.query(`
    create table if not exists invoice_lines (
      id text primary key default gen_random_uuid()::text,
      invoice_id text not null references invoices(id) on delete cascade,
      stock_item_id text not null references stock_items(id),
      description text not null,
      quantity int not null,
      unit_price_pence int not null,
      net_pence int not null,
      discount_pence int not null,
      vat_pence int not null,
      total_pence int not null,
      position int not null default 0
    );`);
  await pool.query(`
    create table if not exists invoice_payments (
      id text primary key default gen_random_uuid()::text,
      invoice_id text not null references invoices(id) on delete cascade,
      pence int not null,
      taken_by text,
      at timestamptz not null default now()
    );`);
  await pool.query(`
    create table if not exists idempotency_keys (
      key text not null,
      clinic_id text not null,
      method text not null,
      path text not null,
      body_hash text not null,
      status int not null,
      response jsonb not null,
      created_at timestamptz not null default now(),
      primary key(clinic_id, key)
    );`);
  await pool.query(`
    create table if not exists patient_files (
      id text primary key default gen_random_uuid()::text,
      clinic_id text not null references clinics(id) on delete cascade,
      patient_id text not null references patients(id) on delete cascade,
      appointment_id text,
      name text not null,
      kind text not null,
      content_type text not null,
      size_bytes bigint not null,
      sha256 text not null,
      s3_key text not null,
      created_at timestamptz not null default now()
    );`);
  await pool.query(`
    create table if not exists bookings (
      code text primary key,
      clinic_id text not null references clinics(id) on delete cascade,
      appointment_id text not null references appointments(id) on delete cascade,
      owner_email text not null,
      created_at timestamptz not null default now()
    );`);
  await pool.query(`
    create table if not exists rate_windows (
      address text not null,
      at timestamptz not null,
      primary key(address, at)
    );`);
  await pool.query(`
    create table if not exists app_meta (
      key text primary key,
      value text not null
    );`);
  await pool.query(`
    create table if not exists advisory_locks (id int primary key);`);
}
