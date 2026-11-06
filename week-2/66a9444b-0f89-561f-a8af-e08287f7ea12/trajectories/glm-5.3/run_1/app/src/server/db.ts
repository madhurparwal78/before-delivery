import pg from "pg";
import type { PoolClient } from "pg";
import { hashPassword } from "./config.js";
import { festivalDayOf, parseWall } from "../shared/time.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

export type Row = Record<string, unknown>;
export async function query(sql: string, args: unknown[] = []): Promise<{ rows: Row[]; rowCount: number | null }> {
  const res = await pool.query(sql, args);
  return { rows: res.rows as Row[], rowCount: res.rowCount ?? null };
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

const SCHEMA = `
create table if not exists app_secret (id int primary key, secret text not null);
create table if not exists organisations (id text primary key, name text not null);
create table if not exists users (
  id serial primary key,
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null,
  organisation_id text references organisations(id),
  created_at timestamptz not null default now()
);
create table if not exists venues (id text primary key, name text not null);
create table if not exists disciplines (id text primary key, name text not null);
create table if not exists edition (id int primary key, name text not null, first_day text not null, last_day text not null);
create table if not exists price_policy (
  id int primary key,
  full_festival_full_cents int not null,
  full_festival_reduced_cents int not null,
  day_full_cents int not null,
  day_reduced_cents int not null,
  group_discount_percent int not null,
  version int not null
);
create table if not exists sessions (
  id text primary key,
  title text not null,
  description text not null default '',
  discipline text not null references disciplines(id),
  venue_id text not null references venues(id),
  admission text not null,
  capacity int,
  price_full_cents int,
  price_reduced_cents int,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  festival_day text not null,
  status text not null,
  publish_at timestamptz,
  version int not null default 1,
  created_at timestamptz not null default now()
);
create table if not exists item_history (
  id serial primary key,
  item_type text not null,
  item_id text not null,
  from_status text not null,
  to_status text not null,
  at timestamptz not null default now(),
  by text not null,
  note text
);
create index if not exists item_history_item on item_history (item_type, item_id);
create table if not exists entries (
  id text primary key,
  artist_id int not null references users(id),
  title text not null,
  statement text not null default '',
  discipline text not null,
  medium text not null default '',
  year text not null default '',
  status text not null,
  publish_at timestamptz,
  version int not null default 1,
  created_at timestamptz not null default now()
);
create table if not exists entry_images (
  id text primary key,
  entry_id text not null references entries(id),
  width int not null,
  height int not null,
  created_at timestamptz not null default now()
);
alter table if exists orders add column if not exists invoice_id text;
alter table if exists orders add column if not exists buyer_name text not null default '';
alter table if exists invoice_lines drop constraint if exists invoice_lines_invoice_id_fkey;

create table if not exists holds (
  id text primary key,
  user_id int not null references users(id),
  session_id text not null references sessions(id),
  quantity int not null,
  expires_at timestamptz not null,
  status text not null,
  created_at timestamptz not null default now()
);
create index if not exists holds_session on holds (session_id, status);
create table if not exists waitlist_entries (
  id text primary key,
  user_id int not null references users(id),
  session_id text not null references sessions(id),
  position int not null,
  status text not null,
  offer_expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists waitlist_session on waitlist_entries (session_id, status, position);
create table if not exists orders (
  id text primary key,
  buyer_id int not null references users(id),
  buyer_name text not null default '',
  organisation_id text references organisations(id),
  kind text not null,
  rate text not null,
  status text not null,
  subtotal_cents int not null,
  group_discount_cents int not null default 0,
  voucher_code text,
  voucher_cents int not null default 0,
  total_cents int not null,
  proof_deadline timestamptz,
  confirmation_mail text not null default 'pending',
  invoice_id text,
  created_at timestamptz not null default now()
);
create table if not exists lines (
  id serial primary key,
  order_id text not null references orders(id),
  position int not null,
  kind text not null,
  session_id text,
  festival_day text,
  title text not null,
  holder_name text not null,
  state text not null,
  list_cents int not null,
  group_discount_cents int not null default 0,
  voucher_cents int not null default 0,
  charged_cents int not null
);
create index if not exists lines_order on lines (order_id);
create index if not exists lines_session on lines (session_id);
create table if not exists passes (
  id serial primary key,
  code text not null unique,
  line_id int references lines(id),
  status text not null,
  created_at timestamptz not null default now()
);
create table if not exists proofs (
  id text primary key,
  order_id text not null references orders(id),
  kind text not null,
  status text not null,
  uploaded_at timestamptz not null default now(),
  deadline timestamptz not null,
  content_type text not null,
  size_bytes int not null
);
create table if not exists refunds (
  id text primary key,
  order_id text not null references orders(id),
  line_ids jsonb not null,
  card_cents int not null,
  voucher_cents int not null,
  credit_note_id text,
  status text not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create table if not exists invoices (
  id text primary key,
  number text not null unique,
  organisation_id text not null references organisations(id),
  order_id text not null references orders(id),
  status text not null,
  amount_cents int not null,
  credited_cents int not null default 0,
  paid_cents int not null default 0,
  balance_cents int not null,
  issued_at timestamptz not null,
  due_at timestamptz not null,
  retries_used int not null default 0,
  next_retry_at timestamptz,
  first_return_at timestamptz
);
create index if not exists invoices_org on invoices (organisation_id);
create table if not exists invoice_lines (
  invoice_id text not null,
  line_id int not null,
  description text not null,
  amount_cents int not null,
  primary key (invoice_id, line_id)
);
create table if not exists credit_notes (
  id text primary key,
  number text not null unique,
  invoice_id text not null references invoices(id),
  amount_cents int not null,
  issued_at timestamptz not null default now()
);
create table if not exists vouchers (
  code text primary key,
  note text,
  created_at timestamptz not null default now()
);
create table if not exists voucher_movements (
  id serial primary key,
  voucher_code text not null,
  kind text not null,
  amount_cents int not null,
  actor text not null,
  order_ref text,
  created_at timestamptz not null default now()
);
create index if not exists voucher_movements_code on voucher_movements (voucher_code);
create table if not exists ledger_entries (
  id serial primary key,
  movement_id int not null references voucher_movements(id),
  account text not null,
  side text not null,
  amount_cents int not null
);
create index if not exists ledger_entries_movement on ledger_entries (movement_id);
create index if not exists ledger_entries_account on ledger_entries (account);
create table if not exists outbox (
  id serial primary key,
  event text not null,
  to_email text not null,
  subject text not null,
  body_text text not null,
  attachments jsonb not null default '[]',
  status text not null default 'queued',
  attempts int not null default 0,
  order_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);
create table if not exists scans (
  id serial primary key,
  pass_code text not null,
  session_id text not null,
  result text not null,
  staff_id int not null references users(id),
  festival_day text not null,
  first_admitted_at timestamptz,
  scanned_at timestamptz not null default now()
);
create table if not exists kb_accounts (
  id serial primary key,
  external_key text not null unique,
  user_id int references users(id),
  organisation_id text references organisations(id),
  kb_account_id text not null
);
create table if not exists kb_transactions (
  id serial primary key,
  killbill_transaction_id text not null,
  transaction_type text not null,
  amount_cents int not null,
  status text not null,
  external_key text not null,
  order_ref text,
  payment_id text,
  created_at timestamptz not null default now()
);
create table if not exists idempotency_keys (
  user_id int not null,
  key text not null,
  request_hash text not null,
  status text not null,
  response_status int,
  response_body jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);
create table if not exists reconciliation_runs (
  id text primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  checked_transactions int not null default 0
);
create table if not exists mismatches (
  id text primary key,
  run_id text not null,
  type text not null,
  order_ref text,
  killbill_transaction_id text,
  transaction_type text,
  app_amount_cents int,
  killbill_amount_cents int,
  status text not null,
  note text,
  resolved_by text,
  resolved_at timestamptz
);
create table if not exists login_sessions (
  id text primary key,
  user_id int not null references users(id),
  created_at timestamptz not null default now()
);
create table if not exists audit (
  id serial primary key,
  at timestamptz not null default now(),
  actor text not null,
  actor_role text not null,
  action text not null,
  target_type text not null,
  target_id text not null,
  detail text
);
create table if not exists file_links (
  token_hash text primary key,
  object_key text not null,
  content_type text not null,
  expires_at timestamptz not null
);
`;

interface SeedSession {
  id: string;
  title: string;
  discipline: string;
  venue: string;
  admission: string;
  capacity: number | null;
  full: number | null;
  reduced: number | null;
  start: string;
  end: string;
  status: string;
}

const SEED_SESSIONS: SeedSession[] = [
  { id: "feedback-gardens", title: "Feedback Gardens", discipline: "sound", venue: "lab-hoogstraat", admission: "seat", capacity: 12, full: 1800, reduced: 1000, start: "2027-10-29T14:00+02:00", end: "2027-10-29T16:30+02:00", status: "published" },
  { id: "shader-sketching", title: "Shader Sketching", discipline: "code", venue: "lab-hoogstraat", admission: "seat", capacity: 12, full: 1800, reduced: 1000, start: "2027-10-30T11:00+02:00", end: "2027-10-30T13:00+02:00", status: "published" },
  { id: "signal-bodies", title: "Signal Bodies", discipline: "performance", venue: "black-box-kanaal", admission: "seat", capacity: 60, full: 1200, reduced: 700, start: "2027-10-29T20:00+02:00", end: "2027-10-29T21:00+02:00", status: "published" },
  { id: "delta-choir", title: "Delta Choir", discipline: "sound", venue: "riverside-pavilion", admission: "pass", capacity: null, full: null, reduced: null, start: "2027-10-29T20:30+02:00", end: "2027-10-29T21:30+02:00", status: "published" },
  { id: "orbit-index", title: "Orbit Index", discipline: "moving-image", venue: "planetarium-dome", admission: "pass", capacity: null, full: null, reduced: null, start: "2027-10-28T21:00+02:00", end: "2027-10-28T21:45+02:00", status: "published" },
  { id: "lumen-drift", title: "Lumen Drift", discipline: "light", venue: "remise-noord", admission: "pass", capacity: null, full: null, reduced: null, start: "2027-10-28T18:00+02:00", end: "2027-10-28T23:00+02:00", status: "published" },
  { id: "nachtstroom", title: "Nachtstroom", discipline: "sound", venue: "remise-noord", admission: "pass", capacity: null, full: null, reduced: null, start: "2027-10-31T01:30+02:00", end: "2027-10-31T02:30+02:00", status: "published" },
  { id: "second-hour-summer", title: "The Second Hour (first pass)", discipline: "light", venue: "riverside-pavilion", admission: "pass", capacity: null, full: null, reduced: null, start: "2027-10-31T02:15+02:00", end: "2027-10-31T02:45+02:00", status: "published" },
  { id: "second-hour-winter", title: "The Second Hour (second pass)", discipline: "light", venue: "black-box-kanaal", admission: "pass", capacity: null, full: null, reduced: null, start: "2027-10-31T02:15+01:00", end: "2027-10-31T02:45+01:00", status: "published" },
  { id: "dawn-patch", title: "Dawn Patch", discipline: "code", venue: "riverside-pavilion", admission: "pass", capacity: null, full: null, reduced: null, start: "2027-10-31T06:00+01:00", end: "2027-10-31T07:00+01:00", status: "published" },
  { id: "residency-showing", title: "Untitled residency showing", discipline: "performance", venue: "black-box-kanaal", admission: "pass", capacity: null, full: null, reduced: null, start: "2027-10-30T16:00+02:00", end: "2027-10-30T17:00+02:00", status: "draft" },
];

async function seedSessionRow(client: PoolClient, s: SeedSession): Promise<void> {
  const start = parseWall(s.start);
  const end = parseWall(s.end);
  if (!start.ok || !end.ok) throw new Error(`bad seed time for ${s.id}`);
  await client.query(
    `insert into sessions (id, title, description, discipline, venue_id, admission, capacity,
       price_full_cents, price_reduced_cents, starts_at, ends_at, festival_day, status, publish_at, version)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,null,1)
     on conflict (id) do nothing`,
    [s.id, s.title, "", s.discipline, s.venue, s.admission, s.capacity, s.full, s.reduced, start.at, end.at, festivalDayOf(start.at), s.status],
  );
}

export async function migrateAndSeed(): Promise<void> {
  await pool.query(SCHEMA);
  await withTransaction(async (client) => {
    await client.query("insert into organisations (id, name) values ('vierwinden','Atheneum Vierwinden'), ('quai-lumiere','École Quai-Lumière') on conflict (id) do nothing");
    await client.query(
      `insert into venues (id, name) values
        ('remise-noord','Remise Noord (disused tram depot)'),
        ('planetarium-dome','Planetarium Dome'),
        ('lab-hoogstraat','Lab Hoogstraat (university lab)'),
        ('black-box-kanaal','Black Box Kanaal'),
        ('riverside-pavilion','Riverside Pavilion')
       on conflict (id) do nothing`,
    );
    await client.query(
      `insert into disciplines (id, name) values
        ('sound','Sound'), ('light','Light'), ('performance','Performance'),
        ('moving-image','Moving image'), ('code','Code')
       on conflict (id) do nothing`,
    );
    await client.query(
      `insert into edition (id, name, first_day, last_day) values (1,'Kerf Frequencies 2027','2027-10-28','2027-10-31')
       on conflict (id) do nothing`,
    );
    await client.query(
      `insert into price_policy (id, full_festival_full_cents, full_festival_reduced_cents, day_full_cents,
         day_reduced_cents, group_discount_percent, version)
       values (1, 9500, 5500, 3500, 2000, 15, 1)
       on conflict (id) do nothing`,
    );

    const password = hashPassword("kerf-festival-2027");
    const staff: Array<[string, string, string, string | null]> = [
      ["Ines Vandeput", "admin@kerf.example", "admin", null],
      ["Bram Okafor", "curator@kerf.example", "curator", null],
      ["Lotte Riss", "curator2@kerf.example", "curator", null],
      ["Sami Haddad", "boxoffice@kerf.example", "box_office", null],
      ["Elif Marchal", "finance@kerf.example", "finance", null],
      ["Yara Delcour", "artist@kerf.example", "artist", null],
      ["Tom Achterberg", "artist2@kerf.example", "artist", null],
      ["Mira Janssens", "mira@visitors.example", "visitor", null],
      ["Jonas Peeters", "jonas@visitors.example", "visitor", null],
      ["Hanne De Wit", "bookings@vierwinden.example", "group_booker", "vierwinden"],
      ["Karim Lambrecht", "bookings@quai-lumiere.example", "group_booker", "quai-lumiere"],
    ];
    for (const [name, email, role, org] of staff) {
      await client.query(
        `insert into users (name, email, password_hash, role, organisation_id)
         values ($1,$2,$3,$4,$5) on conflict (email) do nothing`,
        [name, email, password, role, org],
      );
    }

    for (const s of SEED_SESSIONS) await seedSessionRow(client, s);

    const artist1 = await client.query("select id from users where email = 'artist@kerf.example'");
    const artist2 = await client.query("select id from users where email = 'artist2@kerf.example'");
    const yara = Number(artist1.rows[0]?.id ?? 0);
    const tom = Number(artist2.rows[0]?.id ?? 0);
    const entries: Array<[string, number, string, string, string, string, string, string]> = [
      ["e-tidal-mesh", yara, "Tidal Mesh", "light", "A mesh of light that breathes with the tide tables of the Scheldt.", "Kinetic light installation", "2026", "published"],
      ["e-quiet-servo", tom, "Quiet Servo", "code", "A silent robot arm drawing the sound of the room.", "Code and servo motors", "2025", "published"],
      ["e-rust-chorus", yara, "Rust Chorus", "sound", "Corroded circuits sing together in slow decay.", "Modified hardware", "2027", "published"],
      ["e-slow-orbit", tom, "Slow Orbit", "moving-image", "A camera falls forever around a Brussels rooftop.", "Generative video", "2024", "published"],
      ["e-wet-signal", yara, "Wet Signal", "performance", "A performer and a bucket of canal water tune an antenna.", "Performance for one antenna", "2027", "published"],
      ["e-salt-print", yara, "Salt Print", "light", "Photographs developed in salt water from the North Sea.", "Salt-print photography", "2023", "review"],
      ["e-ghost-loop", tom, "Ghost Loop", "code", "A loop that only runs when nobody watches the gallery.", "Software installation", "2027", "draft"],
    ];
    for (const [id, artist, title, discipline, statement, medium, year, status] of entries) {
      await client.query(
        `insert into entries (id, artist_id, title, statement, discipline, medium, year, status, publish_at, version)
         values ($1,$2,$3,$4,$5,$6,$7,$8,null,1) on conflict (id) do nothing`,
        [id, artist, title, statement, discipline, medium, year, status],
      );
    }

    const financeEmail = "finance@kerf.example";
    const vouchers: Array<[string, number]> = [["KERF-GIFT-A1", 4000], ["KERF-GIFT-B2", 2500]];
    for (const [code, amount] of vouchers) {
      await client.query("insert into vouchers (code, note) values ($1, 'seeded gift voucher') on conflict (code) do nothing", [code]);
      const existing = await client.query("select 1 from voucher_movements where voucher_code = $1 limit 1", [code]);
      if (existing.rowCount === 0) {
        const mov = await client.query(
          `insert into voucher_movements (voucher_code, kind, amount_cents, actor, order_ref)
           values ($1,'issue',$2,$3,null) returning id`,
          [code, amount, financeEmail],
        );
        const movementId = Number(mov.rows[0].id);
        await client.query(
          `insert into ledger_entries (movement_id, account, side, amount_cents) values
            ($1,'voucher-sales','debit',$2), ($1,$3::text,'credit',$2)`,
          [movementId, amount, `voucher:${code}`],
        );
      }
    }
  });
}
