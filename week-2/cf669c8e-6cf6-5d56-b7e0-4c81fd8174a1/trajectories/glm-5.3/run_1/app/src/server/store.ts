import type { Config } from './config.js';
import { query, withClient } from './db.js';
import { amsterdamDateOf, shopNowMs, amsterdamInstant, amsterdamParts } from './clock.js';
import { SEED_USERS } from './domain/seed.js';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// Schema and seed, idempotent on every serve, safe with several instances.

const SCHEMA = `
create table if not exists users (
  id text primary key,
  email text not null unique,
  password_hash text not null,
  name text not null,
  country text not null,
  role text not null,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  token text primary key,
  user_id text not null references users(id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists shop_secrets (
  key text primary key,
  value text not null
);

create table if not exists slots (
  id text primary key,
  bike_id text not null,
  starts_at timestamptz not null,
  local_date text not null,
  local_time text not null,
  unique (bike_id, local_date, local_time)
);

create table if not exists rides (
  id text primary key,
  user_id text not null references users(id),
  slot_id text not null references slots(id),
  bike_id text not null,
  starts_at timestamptz not null,
  local_date text not null,
  local_time text not null,
  state text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists orders (
  id text primary key,
  number text not null,
  user_id text not null references users(id),
  kind text not null,
  state text not null,
  partly_refunded boolean not null default false,
  plan_version int not null default 1,
  plan jsonb not null,
  donor jsonb,
  config jsonb,
  bike_id text,
  lines jsonb not null,
  total_cents int not null,
  vat_cents int not null,
  notices jsonb not null,
  fee_code text,
  fee_cents int,
  quote_date text not null,
  delivered_on text,
  withdrawal_deadline timestamptz,
  stage_corrections jsonb,
  created_at timestamptz not null default now()
);

create table if not exists payments (
  id text primary key,
  order_id text not null references orders(id),
  user_id text not null,
  stage text not null,
  attempt int not null default 0,
  amount_cents int not null,
  status text not null,
  idempotency_key text,
  external_key text not null,
  killbill_payment_id text,
  killbill_transaction_id text,
  due_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists allocations (
  id bigserial primary key,
  payment_id text not null references payments(id),
  line_id text not null,
  gross_cents int not null,
  vat_cents int not null,
  net_cents int not null,
  created_at timestamptz not null default now()
);

create table if not exists refunds (
  id text primary key,
  order_id text not null references orders(id),
  line_id text not null,
  amount_cents int not null,
  status text not null default 'pending',
  idempotency_key text not null,
  created_at timestamptz not null default now()
);

create table if not exists refund_draws (
  id text primary key,
  refund_id text not null references refunds(id),
  payment_id text not null references payments(id),
  stage text not null,
  amount_cents int not null,
  vat_cents int not null,
  status text not null default 'pending',
  external_key text not null,
  created_at timestamptz not null default now()
);

create table if not exists idempotency (
  key text not null,
  user_id text not null,
  status int not null,
  body jsonb,
  request_hash text not null,
  primary key (user_id, key)
);

create table if not exists mails (
  id text primary key,
  kind text not null,
  subject text not null,
  body text not null,
  to_email text not null,
  status text not null default 'pending',
  attempts int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists mail_facts (
  fact_key text primary key,
  created_at timestamptz not null default now()
);

create table if not exists notifications (
  payment_id text not null,
  kind text not null,
  outcome text not null,
  handled_at timestamptz not null default now(),
  primary key (payment_id, kind)
);

create index if not exists idx_sessions_expires on sessions(expires_at);
create index if not exists idx_rides_state on rides(state);
create index if not exists idx_payments_order on payments(order_id);
create index if not exists idx_rides_slot on rides(slot_id);
`

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function newId(prefix: string): string {
  return `${prefix}-${randomBytes(9).toString('hex')}`;
}

export function newSecret(): string {
  return randomBytes(24).toString('hex');
}

function slotId(bikeId: string, date: string, time: string): string {
  const h = createHash('sha256').update(`${bikeId}|${date}|${time}`).digest('hex').slice(0, 12);
  return `slot-${h}`;
}

async function seedSlots(config: Config, client: { query: Function }): Promise<void> {
  const existing = await client.query('select count(*)::int as n from slots');
  if (existing.rows[0].n > 0) return;
  const today = amsterdamDateOf(shopNowMs(config));
  const base = Date.parse(`${today}T00:00:00Z`);
  const rows: { bikeId: string; date: string; time: string; instant: number }[] = [];
  for (let i = 0; i < 14; i++) {
    const dayMs = base + i * 24 * 3600_000;
    const date = new Date(dayMs).toISOString().slice(0, 10);
    if (amsterdamParts(dayMs).weekday === 0) continue;
    for (const time of ['10:00', '13:00', '16:00']) {
      rows.push({ bikeId: 'BK-KADE-25', date, time, instant: amsterdamInstant(date, `${time}:00`).instant });
      rows.push({ bikeId: 'BK-DIJK-45', date, time, instant: amsterdamInstant(date, `${time}:00`).instant });
    }
  }
  for (let i = 1; i <= 14; i++) {
    const dayMs = base + i * 24 * 3600_000;
    const date = new Date(dayMs).toISOString().slice(0, 10);
    if (amsterdamParts(dayMs).weekday === 0) continue;
    rows.push({ bikeId: 'BK-POLDER-45', date, time: '10:00', instant: amsterdamInstant(date, '10:00:00').instant });
    break;
  }
  for (const s of rows) {
    await client.query(
      `insert into slots (id, bike_id, starts_at, local_date, local_time)
       values ($1, $2, $3, $4, $5) on conflict do nothing`,
      [slotId(s.bikeId, s.date, s.time), s.bikeId, new Date(s.instant).toISOString(), s.date, s.time],
    );
  }
}

export async function migrateAndSeed(config: Config): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await withClient(config, async (client) => {
        await client.query(SCHEMA);
        for (const u of SEED_USERS) {
          await client.query(
            `insert into users (id, email, password_hash, name, country, role)
             values ($1, $2, $3, $4, $5, $6)
             on conflict (email) do update set name = excluded.name, country = excluded.country, role = excluded.role`,
            [newId('user'), u.email, hashPassword(u.password), u.name, u.country, u.role],
          );
        }
        await client.query(
          `insert into shop_secrets (key, value) values ('killbill_callback_secret', $1)
           on conflict (key) do nothing`,
          [newSecret()],
        );
        await seedSlots(config, client as unknown as { query: Function });
      });
      return;
    } catch (err) {
      if (attempt > 120) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

export async function callbackSecret(config: Config): Promise<string> {
  const r = await query<{ value: string }>(config, `select value from shop_secrets where key = 'killbill_callback_secret'`);
  return r.rows[0]!.value;
}
