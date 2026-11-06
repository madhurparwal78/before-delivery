import { connectDb, type Tx } from './db.js';
import { config } from './config.js';
import { now, addDays, todayInPractice } from './time.js';
import bcrypt from 'bcrypt';
import { storeSeedPhoto } from './seedphotos.js';

interface Migration {
  version: number;
  up: (tx: Tx) => Promise<void>;
}

const SCHEMA_SQL = [
`create table if not exists schema_migrations(version bigint primary key, applied_at timestamptz not null)`,
`create table if not exists practice(id int primary key, name text not null, time_zone text not null)`,
`create table if not exists users(
  id text primary key,
  name text not null,
  email text not null unique,
  password_hash text,
  role text not null check(role in ('farrier','apprentice','owner','barn_manager')),
  phone text,
  barn_id text,
  card_token text,
  card_last4 text,
  created_at timestamptz not null
)`,
`create table if not exists barns(id text primary key, name text not null, trip_fee_cents int not null check(trip_fee_cents between 0 and 100000))`,
`create table if not exists horses(
  id text primary key,
  name text not null,
  owner_id text not null references users(id),
  barn_id text not null references barns(id),
  stall text,
  cycle_weeks int not null check(cycle_weeks between 5 and 8),
  created_at timestamptz not null
)`,
`create index if not exists horses_owner on horses(owner_id)`,
`create index if not exists horses_barn on horses(barn_id)`,
`create table if not exists price_lists(
  id text primary key,
  effective_from date not null,
  deposit_cents int not null check(deposit_cents between 0 and 100000),
  trim_price int not null, front_reset int not null, full_reset int not null, front_new int not null, full_new int not null,
  created_at timestamptz not null
)`,
`create unique index if not exists price_lists_effective on price_lists(effective_from)`,
`create table if not exists barn_days(
  id text primary key,
  barn_id text not null references barns(id),
  business_date date not null,
  start_time text not null,
  starts_at timestamptz not null,
  cancellation_cutoff_at timestamptz not null,
  slot_count int not null check(slot_count between 1 and 12),
  slot_minutes int not null check(slot_minutes between 15 and 120),
  trip_fee_cents int not null check(trip_fee_cents between 0 and 100000),
  status text not null check(status in ('draft','published','in_progress','closed','cancelled')),
  created_at timestamptz not null
)`,
`create index if not exists barn_days_date on barn_days(business_date, id)`,
`create table if not exists slots(
  id text primary key,
  barn_day_id text not null references barn_days(id),
  idx int not null,
  time text not null,
  unique(barn_day_id, idx)
)`,
`create table if not exists counters(id int primary key, next_booking_number int not null)`,
`create table if not exists bookings(
  id text primary key,
  number int not null unique,
  status text not null check(status in ('held','confirmed','cancelled_in_time','cancelled_late','worked','no_show','excused','released','lapsed','removed')),
  barn_day_id text not null references barn_days(id),
  slot_id text not null references slots(id),
  horse_id text not null references horses(id),
  owner_id text not null references users(id),
  hold_expires_at timestamptz,
  offer boolean not null default false,
  deposit_cents int not null default 0,
  payment_id text,
  trip_share_cents int,
  initial_cents int,
  decided_at timestamptz,
  lapse_recorded boolean not null default false,
  created_at timestamptz not null,
  updated_at timestamptz not null
)`,
`create index if not exists bookings_day on bookings(barn_day_id)`,
`create index if not exists bookings_slot on bookings(slot_id)`,
`create index if not exists bookings_owner on bookings(owner_id)`,
`create index if not exists bookings_horse_day on bookings(horse_id, barn_day_id)`,
`create table if not exists waitlist(
  id text primary key,
  barn_day_id text not null references barn_days(id),
  horse_id text not null references horses(id),
  owner_id text not null references users(id),
  joined_at timestamptz not null,
  seq bigint generated always as identity
)`,
`create index if not exists waitlist_day on waitlist(barn_day_id, joined_at, seq)`,
`create table if not exists adjustments(
  barn_day_id text not null references barn_days(id),
  seq int not null,
  booking_id text not null references bookings(id),
  delta_cents int not null,
  cause_booking_id text not null references bookings(id),
  at timestamptz not null,
  primary key(barn_day_id, seq)
)`,
`create index if not exists adjustments_day on adjustments(barn_day_id, seq)`,
`create table if not exists visits(
  id text primary key,
  booking_id text not null unique references bookings(id),
  horse_id text not null references horses(id),
  business_date date not null,
  status text not null check(status in ('open','closed','invoice_pending','invoiced')),
  note text not null default '',
  invoice_id text,
  close_lease_expires_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null
)`,
`create table if not exists photos(
  id text primary key,
  visit_id text not null references visits(id),
  hoof text not null check(hoof in ('LF','RF','LH','RH')),
  phase text not null check(phase in ('before','after')),
  content_type text not null,
  width int not null, height int not null, size_bytes int not null,
  storage_key text not null,
  thumbnail_status text not null default 'pending' check(thumbnail_status in ('pending','ready','failed')),
  created_at timestamptz not null,
  unique(visit_id, hoof, phase)
)`,
`create table if not exists uploads(
  id text primary key,
  visit_id text not null references visits(id),
  hoof text not null, phase text not null,
  size_bytes int not null,
  chunk_bytes int not null,
  uploaded_offset int not null,
  expires_at timestamptz not null,
  ended boolean not null default false,
  created_at timestamptz not null
)`,
`create index if not exists uploads_visit on uploads(visit_id)`,
`create table if not exists marks(
  visit_id text not null references visits(id),
  hoof text not null,
  version int not null,
  hx1 double precision not null, hy1 double precision not null, hx2 double precision not null, hy2 double precision not null,
  hoof_wall_angle double precision not null,
  px1 double precision not null, py1 double precision not null, px2 double precision not null, py2 double precision not null,
  pastern_angle double precision not null,
  alignment text not null check(alignment in ('aligned','broken-back','broken-forward')),
  saved_by text not null, saved_at timestamptz not null, restored_from int,
  primary key(visit_id, hoof, version)
)`,
`create table if not exists invoices(
  id text primary key,
  kind text not null check(kind in ('visit','trip')),
  status text not null check(status in ('pending','unpaid','paid')),
  horse_id text not null references horses(id),
  owner_id text not null references users(id),
  booking_id text references bookings(id),
  visit_id text references visits(id),
  business_date date not null,
  items jsonb not null,
  total_cents int not null,
  balance_cents int not null,
  killbill_invoice_id text,
  dunning_state text not null default 'none' check(dunning_state in ('none','past_due','retry_1','retry_2','blocked','cleared')),
  reconciliation text not null default 'unchecked' check(reconciliation in ('unchecked','matched','mismatch','unavailable')),
  first_declined_at timestamptz,
  pending_since timestamptz,
  created_at timestamptz not null
)`,
`create index if not exists invoices_owner on invoices(owner_id)`,
`create index if not exists invoices_booking on invoices(booking_id)`,
`create table if not exists payments(
  id text primary key,
  kind text not null check(kind in ('deposit','invoice')),
  status text not null check(status in ('authorized','captured','partially_refunded','refunded','voided','declined')),
  owner_id text not null references users(id),
  booking_id text references bookings(id),
  invoice_id text references invoices(id),
  amount_cents int not null,
  captured_cents int not null default 0,
  refunded_cents int not null default 0,
  applied_cents int not null default 0,
  disposition text check(disposition in ('held','forfeited','applied') or disposition is null),
  card_last4 text,
  decline_code text,
  killbill_status text not null default 'not_recorded' check(killbill_status in ('not_recorded','pending','recorded')),
  killbill_invoice_id text,
  killbill_payment_id text,
  pending_since timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
)`,
`create index if not exists payments_booking on payments(booking_id)`,
`create index if not exists payments_invoice on payments(invoice_id)`,
`create table if not exists refunds(
  id text primary key,
  payment_id text not null references payments(id),
  amount_cents int not null,
  killbill_status text not null default 'pending' check(killbill_status in ('pending','recorded')),
  pending_since timestamptz,
  ledger_at timestamptz,
  created_at timestamptz not null
)`,
`create table if not exists sessions(
  id text primary key,
  user_id text not null references users(id),
  created_at timestamptz not null,
  last_seen timestamptz not null
)`,
`create table if not exists tokens(
  id text primary key,
  name text not null,
  scope text not null check(scope in ('read_only','billing')),
  token_hash text not null,
  created_at timestamptz not null,
  revoked_at timestamptz
)`,
`create table if not exists audit_log(
  id bigint generated always as identity primary key,
  at timestamptz not null,
  actor_type text not null check(actor_type in ('user','token','system')),
  actor_id text,
  action text not null,
  entity_type text not null check(entity_type in ('barn_day','booking','visit','invoice','payment','vet_link','price_list','api_token','import','dunning')),
  entity_id text not null,
  from_status text,
  to_status text,
  request_id text not null
)`,
`create or replace function audit_log_immutable() returns trigger as $$
begin
  raise exception 'audit_log is append-only';
end $$ language plpgsql`,
`drop trigger if exists audit_log_no_edit on audit_log`,
`create trigger audit_log_no_edit before update or delete on audit_log
  for each row execute function audit_log_immutable()`,
`create table if not exists idem_claims(
  user_id text not null,
  route text not null,
  key text not null,
  request_hash text not null,
  status text not null check(status in ('in_progress','done')),
  lease_expires_at timestamptz not null,
  response_status int,
  response_body text,
  created_at timestamptz not null,
  primary key(user_id, route, key)
)`,
`create table if not exists rate_rows(
  bucket text not null, scope text not null, key text not null,
  tokens double precision not null, updated_at timestamptz not null,
  primary key(bucket, scope, key)
)`,
`create table if not exists jobs(
  id text primary key,
  kind text not null check(kind in ('thumbnail','dunning_retry','due_reminder','offer_pass','csv_export')),
  status text not null check(status in ('queued','running','succeeded','dead')),
  attempts int not null default 0,
  max_attempts int not null,
  run_at timestamptz not null,
  lease_expires_at timestamptz,
  leased_by text,
  last_error text,
  result jsonb,
  params jsonb not null default '{}',
  created_at timestamptz not null
)`,
`create index if not exists jobs_due on jobs(status, run_at)`,
`create table if not exists emails(
  id text primary key,
  to_addr text not null,
  subject text not null,
  body text not null,
  request_claimed boolean not null default false,
  claim_expires_at timestamptz,
  claimed_by text,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  attempts int not null default 0,
  sent_at timestamptz,
  created_at timestamptz not null
)`,
`create index if not exists emails_due on emails(sent_at, next_attempt_at)`,
`create table if not exists stream_events(
  stream text not null,
  id int not null,
  event text not null,
  data jsonb not null,
  created_at timestamptz not null,
  primary key(stream, id)
)`,
`create table if not exists signing_keys(
  id int primary key,
  secret text not null,
  created_at timestamptz not null
)`,
`create table if not exists vet_links(
  id text primary key,
  horse_id text not null references horses(id),
  vet_name text not null,
  vet_email text not null,
  token_hash text not null,
  status text not null check(status in ('active','revoked')),
  expires_at timestamptz not null,
  created_at timestamptz not null
)`,
`create table if not exists vet_views(
  id text primary key,
  vet_link_id text not null references vet_links(id),
  at timestamptz not null,
  address text not null,
  outcome text not null check(outcome in ('viewed','expired','revoked')),
  user_agent text,
  previous_date date,
  pair_current_date date
)`,
`create table if not exists vet_misses(
  address text not null,
  at timestamptz not null
)`,
`create index if not exists vet_misses_at on vet_misses(address, at)`,
`create table if not exists ledger(
  id bigint generated always as identity primary key,
  kind text not null check(kind in ('billed','deposit_captured','invoice_payment','refund','deposit_transfer_out','deposit_transfer_in')),
  amount_cents int not null,
  at timestamptz not null,
  owner_id text not null,
  horse_id text,
  business_date date not null,
  invoice_id text,
  payment_id text
)`,
`create index if not exists ledger_date on ledger(business_date, at)`,
`create table if not exists alert_state(
  threshold int primary key,
  armed boolean not null
)`,
`create table if not exists due_reminders(
  horse_id text not null,
  next_due_date date not null,
  sent_at timestamptz,
  primary key(horse_id, next_due_date)
)`
];

async function migrate(tx: Tx): Promise<void> {
  await tx.query(`select pg_advisory_xact_lock(918273645)`);
  await tx.query(`create table if not exists schema_migrations(version bigint primary key, applied_at timestamptz not null)`);
  const existing = await tx.query(`select version from schema_migrations`);
  const applied = new Set(existing.map((r: any) => Number(r.version)));
  for (const sql of SCHEMA_SQL) {
    await tx.query(sql);
  }
  if (!applied.has(1)) {
    await tx.query(`insert into schema_migrations(version, applied_at) values(1, $1)`, [now()]);
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'migration_applied', version: 1, instance: config.instanceLabel }));
  }
}

export async function runMigrations(): Promise<void> {
  const db = connectDb();
  const client = await db.connect();
  const tx: Tx = {
    query: (sql, p) => client.query(sql, p as any[]).then(r => r.rows),
    release: () => client.release()
  };
  try {
    await client.query('BEGIN');
    await migrate(tx);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    tx.release();
  }
}

function id(prefix: string): string {
  return prefix + '_' + [...Array(16)].map(() => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
}

export async function seedIfEmpty(): Promise<void> {
  const db = connectDb();
  const client = await db.connect();
  const tx: Tx = {
    query: (sql, p) => client.query(sql, p as any[]).then(r => r.rows),
    release: () => client.release()
  };
  try {
    await client.query('BEGIN');
    await tx.query(`select pg_advisory_xact_lock(9182736451)`);
    const existing = await tx.query(`select count(*)::int as n from practice`);
    if (existing[0].n > 0) {
      await client.query('COMMIT');
      return;
    }
    const seedDate = todayInPractice();
    const hash = await bcrypt.hash('hoofcare-2026', 10);
    const cedarId = id('brn');
    const larkspurId = id('brn');

    await tx.query(`insert into practice(id, name, time_zone) values(1, 'Rasp & Rein', 'America/Denver')`);
    await tx.query(`insert into counters(id, next_booking_number) values(1, 1)`);

    const users: [string, string, string, string | null, string | null, string | null][] = [
      ['farrier@clinchline.test', 'Marlow Tesk', 'farrier', hash, null, null],
      ['apprentice@clinchline.test', 'Ike Ferreira', 'apprentice', hash, null, null],
      ['manager.cedar@clinchline.test', 'Rosa Vint', 'barn_manager', hash, 'CEDAR', null],
      ['manager.larkspur@clinchline.test', 'Hollis Breen', 'barn_manager', hash, 'LARKSPUR', null],
      ['owner.ada@clinchline.test', 'Ada Quill', 'owner', hash, null, '+1 303 555 0141'],
      ['owner.bram@clinchline.test', 'Bram Lowe', 'owner', hash, null, '+1 303 555 0142'],
      ['owner.cleo@clinchline.test', 'Cleo Marsh', 'owner', hash, null, '+1 303 555 0143'],
      ['owner.dev@clinchline.test', 'Dev Ansel', 'owner', hash, null, '+1 303 555 0144']
    ];
    for (const [email, name, role, pw, barnRef, phone] of users) {
      await tx.query(
        `insert into users(id, name, email, password_hash, role, phone, barn_id, created_at) values($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id('usr'), name, email, pw, role, phone, barnRef === 'CEDAR' ? cedarId : barnRef === 'LARKSPUR' ? larkspurId : null, now()]
      );
    }

    const barnIds: Record<string, string> = {};
    barnIds['Cedar Hollow Stables'] = cedarId;
    barnIds['Larkspur Farm'] = larkspurId;
    await tx.query(`insert into barns(id, name, trip_fee_cents) values($1,'Cedar Hollow Stables',4500)`, [cedarId]);
    await tx.query(`insert into barns(id, name, trip_fee_cents) values($1,'Larkspur Farm',6000)`, [larkspurId]);

    const ownerByEmail = new Map<string, string>();
    for (const r of await tx.query(`select id, email from users where role='owner'`)) ownerByEmail.set(r.email, r.id);
    const horseRows: [string, string, string, string, string][] = [
      ['Juniper', 'owner.ada@clinchline.test', 'Cedar Hollow Stables', '4', '6'],
      ['Pilot', 'owner.ada@clinchline.test', 'Cedar Hollow Stables', '7', '8'],
      ['Saffron', 'owner.bram@clinchline.test', 'Cedar Hollow Stables', '5', '5'],
      ['Quarry', 'owner.bram@clinchline.test', 'Cedar Hollow Stables', '9', '6'],
      ['Tamarack', 'owner.cleo@clinchline.test', 'Cedar Hollow Stables', '12', '7'],
      ['Wicket', 'owner.cleo@clinchline.test', 'Cedar Hollow Stables', '11', '8'],
      ['Fern', 'owner.dev@clinchline.test', 'Cedar Hollow Stables', '14', '6'],
      ['Maple', 'owner.dev@clinchline.test', 'Larkspur Farm', '2', '6']
    ];
    const horseIds: Record<string, string> = {};
    for (const [name, email, barn, stall, cycle] of horseRows) {
      const hid = id('hrs');
      horseIds[name] = hid;
      await tx.query(
        `insert into horses(id, name, owner_id, barn_id, stall, cycle_weeks, created_at)
         values($1,$2,$3,$4,$5,$6,$7)`,
        [hid, name, ownerByEmail.get(email)!, barnIds[barn], stall, Number(cycle), now()]
      );
    }

    await tx.query(
      `insert into price_lists(id, effective_from, deposit_cents, trim_price, front_reset, full_reset, front_new, full_new, created_at)
       values($1,'2026-01-01',2500,5500,12000,19000,15000,24000,$2)`,
      [id('prc'), now()]
    );

    // History visits, photos and marks for Juniper's two fore hooves.
    const farrierId = (await tx.query(`select id from users where email='farrier@clinchline.test'`))[0].id;
    const juniper = horseIds['Juniper'];
    const adaId = ownerByEmail.get('owner.ada@clinchline.test')!;
    const cedarDayForVisits = id('day');
    const { resolveWallClock } = await import('./time.js');
    const visitsStart = resolveWallClock(addDays(seedDate, -84), '07:30', 'America/Denver')!;
    await tx.query(
      `insert into barn_days(id, barn_id, business_date, start_time, starts_at, cancellation_cutoff_at, slot_count, slot_minutes, trip_fee_cents, status, created_at)
       values($1,$2,$3,'07:30',$4,$5,1,45,4500,'cancelled',$6)`,
      [cedarDayForVisits, cedarId, addDays(seedDate, -84), visitsStart, new Date(visitsStart.getTime() - 86400e3), now()]
    );
    const firstSlot = id('slt');
    await tx.query(`insert into slots(id, barn_day_id, idx, time) values($1,$2,0,'07:30')`, [firstSlot, cedarDayForVisits]);
    const placeholderBooking = async (): Promise<string> => {
      const bid = id('bkg');
      const n = (await tx.query(`select next_booking_number from counters where id=1`))[0].next_booking_number;
      await tx.query(`update counters set next_booking_number = next_booking_number + 1 where id=1`);
      await tx.query(
        `insert into bookings(id, number, status, barn_day_id, slot_id, horse_id, owner_id, deposit_cents, created_at, updated_at)
         values($1,$2,'removed',$3,$4,$5,$6,0,$7,$7)`,
        [bid, n, cedarDayForVisits, firstSlot, juniper, adaId, now()]
      );
      return bid;
    };
    const visits: { date: string; marks: { hoof: string; hw: number[][]; pt: number[][] }[] }[] = [
      { date: addDays(seedDate, -84), marks: [
        { hoof: 'LF', hw: [[300, 800], [700, 297]], pt: [[700, 700], [1100, 107]] },
        { hoof: 'RF', hw: [[300, 800], [700, 330]], pt: [[700, 700], [1100, 170]] }
      ] },
      { date: addDays(seedDate, -42), marks: [
        { hoof: 'LF', hw: [[300, 820], [700, 269]], pt: [[700, 700], [1100, 129]] },
        { hoof: 'RF', hw: [[300, 800], [700, 310]], pt: [[700, 700], [1100, 210]] }
      ] }
    ];
    for (const v of visits) {
      const vid = id('vst');
      await tx.query(
        `insert into visits(id, booking_id, horse_id, business_date, status, note, closed_at, created_at)
         values($1,$2,$3,$4,'invoiced','',null,$5)`,
        [vid, await placeholderBooking(), juniper, v.date, now()]
      );
      for (const m of v.marks) {
        const pid = id('pht');
        const stored = await storeSeedPhoto(tx, vid, m.hoof);
        await tx.query(
          `insert into photos(id, visit_id, hoof, phase, content_type, width, height, size_bytes, storage_key, thumbnail_status, created_at)
           values($1,$2,$3,'after','image/jpeg',900,1200,$4,$5,'ready',$6)`,
          [pid, vid, m.hoof, stored.size, stored.key, now()]
        );
        const hwAngle = lineAngle(m.hw[0], m.hw[1]);
        const ptAngle = lineAngle(m.pt[0], m.pt[1]);
        await tx.query(
          `insert into marks(visit_id, hoof, version, hx1, hy1, hx2, hy2, hoof_wall_angle, px1, py1, px2, py2, pastern_angle, alignment, saved_by, saved_at, restored_from)
           values($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,null)`,
          [vid, m.hoof, m.hw[0][0], m.hw[0][1], m.hw[1][0], m.hw[1][1], hwAngle,
           m.pt[0][0], m.pt[0][1], m.pt[1][0], m.pt[1][1], ptAngle,
           alignmentLabel(hwAngle, ptAngle), farrierId, now()]
        );
      }
    }
    // Saffron and Maple history visits without photos.
    for (const [horse, date] of [['Saffron', addDays(seedDate, -10)], ['Maple', addDays(seedDate, -30)], ['Pilot', addDays(seedDate, -63)]] as [string, string][]) {
      await tx.query(
        `insert into visits(id, booking_id, horse_id, business_date, status, note, closed_at, created_at)
         values($1,$2,$3,$4,'invoiced','',null,$5)`,
        [id('vst'), await placeholderBooking(), horseIds[horse], date, now()]
      );
    }

    // Seeded barn days.
    const cedarDay = id('day');
    const start1 = resolveWallClock(addDays(seedDate, 14), '07:30', 'America/Denver')!;
    await tx.query(
      `insert into barn_days(id, barn_id, business_date, start_time, starts_at, cancellation_cutoff_at, slot_count, slot_minutes, trip_fee_cents, status, created_at)
       values($1,$2,$3,'07:30',$4,$5,4,45,4500,'published',$6)`,
      [cedarDay, cedarId, addDays(seedDate, 14), start1, new Date(start1.getTime() - 86400e3), now()]
    );
    for (let i = 0; i < 4; i++) {
      const t = 7 * 60 + 30 + i * 45;
      await tx.query(`insert into slots(id, barn_day_id, idx, time) values($1,$2,$3,$4)`,
        [id('slt'), cedarDay, i, `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`]);
    }
    const larkDay = id('day');
    const start2 = resolveWallClock(addDays(seedDate, 21), '08:00', 'America/Denver')!;
    await tx.query(
      `insert into barn_days(id, barn_id, business_date, start_time, starts_at, cancellation_cutoff_at, slot_count, slot_minutes, trip_fee_cents, status, created_at)
       values($1,$2,$3,'08:00',$4,$5,2,60,6000,'draft',$6)`,
      [larkDay, larkspurId, addDays(seedDate, 21), start2, new Date(start2.getTime() - 86400e3), now()]
    );
    for (let i = 0; i < 2; i++) {
      const t = 8 * 60 + i * 60;
      await tx.query(`insert into slots(id, barn_day_id, idx, time) values($1,$2,$3,$4)`,
        [id('slt'), larkDay, i, `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`]);
    }

    await client.query('COMMIT');
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'seeded', instance: config.instanceLabel }));
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    tx.release();
  }
}

export function lineAngle(a: number[], b: number[]): number {
  const deg = Math.atan2(Math.abs(b[1] - a[1]), Math.abs(b[0] - a[0])) * 180 / Math.PI;
  return roundHalfAway(deg);
}

export function roundHalfAway(v: number): number {
  const d = Math.round(Math.abs(v) * 10) / 10;
  return v < 0 ? -d : d;
}

export function alignmentLabel(hw: number, pt: number): 'aligned' | 'broken-back' | 'broken-forward' {
  const d = hw - pt;
  if (Math.abs(d) <= 3.0) return 'aligned';
  return d < 0 ? 'broken-back' : 'broken-forward';
}
