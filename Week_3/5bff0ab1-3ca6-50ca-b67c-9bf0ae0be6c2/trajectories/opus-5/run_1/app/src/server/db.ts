import { randomUUID, scrypt as scryptCb, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';
import {
  CLOSED_DATES,
  FINISHES,
  HUBS,
  MODELS,
  PRICE_STEPS,
  type FinishId,
  type HubId,
  type ModelId,
} from '../shared/catalogue.js';
import { istInstant, setClockOffset } from './clock.js';

const scrypt = promisify(scryptCb);

pg.types.setTypeParser(1082, (value: string) => value);
pg.types.setTypeParser(20, (value: string) => Number(value));
pg.types.setTypeParser(1700, (value: string) => Number(value));

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 12,
  idleTimeoutMillis: 2_000,
  connectionTimeoutMillis: 3_000,
});

pool.on('error', () => {
  /* a dropped idle client is replaced by the pool on the next checkout */
});

export type Row = Record<string, unknown>;

export async function query<T extends Row = Row>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params as unknown[]);
  return result.rows;
}

export async function one<T extends Row = Row>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export interface Tx {
  query<T extends Row = Row>(text: string, params?: readonly unknown[]): Promise<T[]>;
  one<T extends Row = Row>(text: string, params?: readonly unknown[]): Promise<T | null>;
}

export async function transact<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const tx: Tx = {
    async query<R extends Row = Row>(text: string, params: readonly unknown[] = []) {
      const result = await client.query<R>(text, params as unknown[]);
      return result.rows;
    },
    async one<R extends Row = Row>(text: string, params: readonly unknown[] = []) {
      const rows = await tx.query<R>(text, params);
      return rows[0] ?? null;
    },
  };
  try {
    await client.query('begin');
    const value = await work(tx);
    await client.query('commit');
    return value;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      /* the client is discarded below */
    }
    throw error;
  } finally {
    client.release();
  }
}

export function newId(): string {
  return randomUUID();
}

export function newRef(): string {
  return `lk-${randomUUID()}`;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scrypt(password, salt, 32)) as Buffer;
  return `s1:${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [version, salt, hash] = stored.split(':');
  if (version !== 's1' || !salt || !hash) return false;
  const derived = (await scrypt(password, salt, 32)) as Buffer;
  const expected = Buffer.from(hash, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

const SCHEMA = `
create table if not exists app_clock (id int primary key, offset_ms bigint not null, seeded_at timestamptz not null);
alter table app_clock add column if not exists frozen_ms bigint;
create table if not exists tick_state (id int primary key, at timestamptz not null);
create table if not exists users (
  id text primary key,
  role text not null,
  name text not null,
  mobile text not null unique,
  password_hash text,
  hub text,
  licence_number text,
  licence_valid_until date,
  reminders_on boolean not null default false,
  seeded boolean not null default false,
  rev bigint not null default 1
);
create table if not exists sessions (
  token text primary key,
  user_id text not null references users(id),
  created_at timestamptz not null,
  ended_by text
);
create table if not exists hub_seq (hub text primary key, seq bigint not null default 1);
create table if not exists hub_state (
  hub text primary key,
  counting boolean not null default false,
  count_started_at timestamptz,
  stock_as_of timestamptz not null,
  stale_system_until timestamptz
);
create table if not exists ledger_health (id int primary key, ok boolean not null, changed_at timestamptz not null);
create table if not exists stock (
  hub text not null, model text not null, finish text not null, on_hand int not null,
  primary key (hub, model, finish)
);
create table if not exists price_steps (model text not null, effective_from date not null, ex_factory_paise bigint not null, primary key (model, effective_from));
create table if not exists road_tax_steps (hub text not null, effective_from date not null, percent numeric not null, primary key (hub, effective_from));
create table if not exists closed_days (hub text not null, closed_date date, weekday int);
create unique index if not exists closed_days_on_date on closed_days (hub, closed_date) where closed_date is not null;
create unique index if not exists closed_days_on_weekday on closed_days (hub, weekday) where weekday is not null;
create table if not exists locks (
  id text primary key,
  ref text not null unique,
  rider_id text not null references users(id),
  hub text not null,
  model text not null,
  finish text not null,
  state text not null,
  issued_at timestamptz not null,
  expires_at timestamptz,
  hold_active boolean not null default true,
  step_effective_from date not null,
  ex_factory_paise bigint not null,
  gst_percent numeric not null,
  gst_paise bigint not null,
  ex_showroom_paise bigint not null,
  road_tax_percent numeric not null,
  road_tax_paise bigint not null,
  insurance_paise bigint not null,
  on_road_paise bigint not null,
  delivery_date date,
  waiting_for date,
  waiting_since timestamptz,
  ended_at timestamptz
);
create unique index if not exists locks_one_active_per_model
  on locks (rider_id, model) where state in ('requested','locked','delivery_set');
create index if not exists locks_hub_state on locks (hub, state);
create index if not exists locks_expiry on locks (expires_at) where state in ('requested','locked');
create table if not exists lock_sheets (lock_id text primary key references locks(id), pdf bytea not null, made_at timestamptz not null);
create table if not exists rides (
  id text primary key,
  rider_id text not null references users(id),
  hub text not null,
  model text not null,
  state text not null,
  starts_at timestamptz not null,
  moved_from timestamptz,
  booked_at timestamptz not null,
  marked_at timestamptz
);
create unique index if not exists rides_one_per_slot on rides (hub, starts_at) where state = 'booked';
create unique index if not exists rides_one_booked_per_model on rides (rider_id, model) where state = 'booked';
create table if not exists delivery_seed (hub text not null, delivery_date date not null, taken int not null, primary key (hub, delivery_date));
create table if not exists notices (
  id text primary key,
  rider_id text not null references users(id),
  kind text not null,
  state text not null,
  due_at timestamptz not null,
  sent_at timestamptz,
  lock_id text,
  ride_id text
);
create index if not exists notices_pending on notices (state, due_at);
`;

export interface ReferenceData {
  priceSteps: Map<ModelId, { from: string; exFactoryPaise: number }[]>;
  roadTaxSteps: Map<HubId, { from: string; percent: number }[]>;
  closedDates: Map<string, Set<HubId>>;
  closedWeekdays: Map<HubId, Set<number>>;
}

let reference: ReferenceData | null = null;

export function referenceData(): ReferenceData {
  if (!reference) throw new Error('reference data not loaded');
  return reference;
}

export const SEED_CLOCK_AT = '2026-10-28';
export const SEED_CLOCK_MINUTES = 9 * 60;

interface SeedPerson {
  id: string;
  name: string;
  mobile: string;
  hub?: HubId;
  licenceNumber?: string;
  licenceValidUntil?: string;
}

const SEED_HOSTS: readonly SeedPerson[] = [
  { id: 'host-nandini-rao', name: 'Nandini Rao', mobile: '9000000101', hub: 'pune' },
  { id: 'host-farhan-qureshi', name: 'Farhan Qureshi', mobile: '9000000102', hub: 'bengaluru' },
  { id: 'host-simran-gill', name: 'Simran Gill', mobile: '9000000103', hub: 'gurugram' },
  { id: 'host-thomas-varghese', name: 'Thomas Varghese', mobile: '9000000104', hub: 'kochi' },
  { id: 'host-leela-kamat', name: 'Leela Kamat', mobile: '9000000105', hub: 'pune' },
];

const SEED_RIDERS: readonly SeedPerson[] = [
  {
    id: 'rider-kabir-menon',
    name: 'Kabir Menon',
    mobile: '9000000201',
    licenceNumber: 'MH1220190043210',
    licenceValidUntil: '2031-03-15',
  },
  {
    id: 'rider-ira-deshpande',
    name: 'Ira Deshpande',
    mobile: '9000000202',
    licenceNumber: 'MH1420210098765',
    licenceValidUntil: '2026-10-29',
  },
  {
    id: 'rider-tara-joseph',
    name: 'Tara Joseph',
    mobile: '9000000203',
    licenceNumber: 'KL0720180012345',
    licenceValidUntil: '2030-06-30',
  },
  { id: 'rider-arjun-bhatt', name: 'Arjun Bhatt', mobile: '9000000204' },
  { id: 'rider-meera-pillai', name: 'Meera Pillai', mobile: '9000000205' },
];

const BASELINE_ON_HAND: Readonly<Record<HubId, Readonly<Record<ModelId, readonly number[]>>>> = {
  pune: { 'megh-349': [3, 1, 0], 'desh-648': [2, 0, 1] },
  bengaluru: { 'megh-349': [5, 2, 1], 'desh-648': [1, 1, 0] },
  gurugram: { 'megh-349': [2, 0, 4], 'desh-648': [0, 2, 2] },
  kochi: { 'megh-349': [1, 1, 1], 'desh-648': [3, 1, 0] },
};

export const SEED_RIDES: readonly {
  id: string;
  riderId: string;
  hub: HubId;
  model: ModelId;
  date: string;
  minutes: number;
}[] = [
  {
    id: 'seed-ride-kabir',
    riderId: 'rider-kabir-menon',
    hub: 'pune',
    model: 'megh-349',
    date: '2026-10-28',
    minutes: 10 * 60,
  },
  {
    id: 'seed-ride-ira',
    riderId: 'rider-ira-deshpande',
    hub: 'pune',
    model: 'desh-648',
    date: '2026-10-28',
    minutes: 12 * 60 + 15,
  },
];

export const SEED_DELIVERY_TAKEN: readonly { hub: HubId; date: string; taken: number }[] = [
  { hub: 'pune', date: '2026-11-06', taken: 11 },
];

export function seedClockOffsetMs(): number {
  return istInstant(SEED_CLOCK_AT, SEED_CLOCK_MINUTES).getTime() - Date.now();
}

async function seedPeople(): Promise<void> {
  const riderPassword = process.env.SEED_RIDER_PASSWORD;
  const hostPassword = process.env.SEED_HOST_PASSWORD;
  const riderHash = riderPassword ? await hashPassword(riderPassword) : null;
  const hostHash = hostPassword ? await hashPassword(hostPassword) : null;
  for (const person of SEED_HOSTS) {
    await query(
      `insert into users (id, role, name, mobile, password_hash, hub, seeded)
       values ($1,'hub_host',$2,$3,$4,$5,true)
       on conflict (id) do update set password_hash = excluded.password_hash`,
      [person.id, person.name, person.mobile, hostHash, person.hub ?? null],
    );
  }
  for (const person of SEED_RIDERS) {
    await query(
      `insert into users (id, role, name, mobile, password_hash, licence_number, licence_valid_until, seeded)
       values ($1,'rider',$2,$3,$4,$5,$6,true)
       on conflict (id) do update set password_hash = excluded.password_hash`,
      [
        person.id,
        person.name,
        person.mobile,
        riderHash,
        person.licenceNumber ?? null,
        person.licenceValidUntil ?? null,
      ],
    );
  }
}

async function loadReference(): Promise<void> {
  const priceSteps = new Map<ModelId, { from: string; exFactoryPaise: number }[]>();
  for (const row of await query<{ model: string; effective_from: string; ex_factory_paise: number }>(
    'select model, effective_from, ex_factory_paise from price_steps order by effective_from',
  )) {
    const list = priceSteps.get(row.model as ModelId) ?? [];
    list.push({ from: row.effective_from, exFactoryPaise: row.ex_factory_paise });
    priceSteps.set(row.model as ModelId, list);
  }
  const roadTaxSteps = new Map<HubId, { from: string; percent: number }[]>();
  for (const row of await query<{ hub: string; effective_from: string; percent: number }>(
    'select hub, effective_from, percent from road_tax_steps order by effective_from',
  )) {
    const list = roadTaxSteps.get(row.hub as HubId) ?? [];
    list.push({ from: row.effective_from, percent: row.percent });
    roadTaxSteps.set(row.hub as HubId, list);
  }
  const closedDates = new Map<string, Set<HubId>>();
  const closedWeekdays = new Map<HubId, Set<number>>();
  for (const row of await query<{ hub: string; closed_date: string | null; weekday: number | null }>(
    'select hub, closed_date, weekday from closed_days',
  )) {
    const hubs: HubId[] = row.hub === '*' ? HUBS.map((h) => h.id) : [row.hub as HubId];
    if (row.closed_date) {
      const set = closedDates.get(row.closed_date) ?? new Set<HubId>();
      for (const h of hubs) set.add(h);
      closedDates.set(row.closed_date, set);
    } else if (row.weekday !== null) {
      for (const h of hubs) {
        const set = closedWeekdays.get(h) ?? new Set<number>();
        set.add(row.weekday);
        closedWeekdays.set(h, set);
      }
    }
  }
  reference = { priceSteps, roadTaxSteps, closedDates, closedWeekdays };
}

async function seedCalendarAndPrices(): Promise<void> {
  for (const m of MODELS) {
    for (const step of PRICE_STEPS[m.id]) {
      await query(
        `insert into price_steps (model, effective_from, ex_factory_paise) values ($1,$2,$3)
         on conflict (model, effective_from) do update set ex_factory_paise = excluded.ex_factory_paise`,
        [m.id, step.from, step.exFactoryPaise],
      );
    }
  }
  for (const h of HUBS) {
    for (const step of h.roadTaxSteps) {
      await query(
        `insert into road_tax_steps (hub, effective_from, percent) values ($1,$2,$3)
         on conflict (hub, effective_from) do update set percent = excluded.percent`,
        [h.id, step.from, step.percent],
      );
    }
  }
  await query(
    `insert into closed_days (hub, closed_date, weekday) values ('*', null, 2)
     on conflict do nothing`,
  );
  for (const [date, hubs] of Object.entries(CLOSED_DATES)) {
    const list: readonly string[] = hubs === 'all' ? ['*'] : hubs;
    for (const h of list) {
      await query(
        `insert into closed_days (hub, closed_date, weekday) values ($1,$2,null) on conflict do nothing`,
        [h, date],
      );
    }
  }
}

async function seedStock(reset: boolean): Promise<void> {
  const stockAsOf = istInstant(SEED_CLOCK_AT, SEED_CLOCK_MINUTES);
  for (const h of HUBS) {
    await query(
      `insert into hub_seq (hub, seq) values ($1, 1) on conflict (hub) do nothing`,
      [h.id],
    );
    if (reset) {
      await query(
        `insert into hub_state (hub, counting, count_started_at, stock_as_of, stale_system_until)
         values ($1,false,null,$2,null)
         on conflict (hub) do update set counting=false, count_started_at=null,
           stock_as_of=excluded.stock_as_of, stale_system_until=null`,
        [h.id, stockAsOf],
      );
    } else {
      await query(
        `insert into hub_state (hub, counting, stock_as_of) values ($1,false,$2) on conflict (hub) do nothing`,
        [h.id, stockAsOf],
      );
    }
    for (const m of MODELS) {
      const counts = BASELINE_ON_HAND[h.id][m.id];
      for (let i = 0; i < FINISHES.length; i += 1) {
        const f = FINISHES[i] as { id: FinishId };
        const onHand = counts[i] ?? 0;
        if (reset) {
          await query(
            `insert into stock (hub, model, finish, on_hand) values ($1,$2,$3,$4)
             on conflict (hub, model, finish) do update set on_hand = excluded.on_hand`,
            [h.id, m.id, f.id, onHand],
          );
        } else {
          await query(
            `insert into stock (hub, model, finish, on_hand) values ($1,$2,$3,$4)
             on conflict (hub, model, finish) do nothing`,
            [h.id, m.id, f.id, onHand],
          );
        }
      }
    }
  }
}

async function seedRidesAndPlaces(reset: boolean): Promise<void> {
  for (const ride of SEED_RIDES) {
    const startsAt = istInstant(ride.date, ride.minutes);
    if (reset) {
      await query(
        `insert into rides (id, rider_id, hub, model, state, starts_at, booked_at)
         values ($1,$2,$3,$4,'booked',$5,$6)
         on conflict (id) do update set state='booked', starts_at=excluded.starts_at,
           moved_from=null, marked_at=null`,
        [ride.id, ride.riderId, ride.hub, ride.model, startsAt, startsAt],
      );
    } else {
      await query(
        `insert into rides (id, rider_id, hub, model, state, starts_at, booked_at)
         values ($1,$2,$3,$4,'booked',$5,$6) on conflict (id) do nothing`,
        [ride.id, ride.riderId, ride.hub, ride.model, startsAt, startsAt],
      );
    }
  }
  for (const place of SEED_DELIVERY_TAKEN) {
    await query(
      `insert into delivery_seed (hub, delivery_date, taken) values ($1,$2,$3)
       on conflict (hub, delivery_date) do update set taken = excluded.taken`,
      [place.hub, place.date, place.taken],
    );
  }
}

export async function migrateAndSeed(): Promise<void> {
  await query(SCHEMA);
  await query(
    `insert into app_clock (id, offset_ms, seeded_at) values (1, $1, now()) on conflict (id) do nothing`,
    [seedClockOffsetMs()],
  );
  await query(`insert into tick_state (id, at) values (1, now()) on conflict (id) do nothing`);
  await query(
    `insert into ledger_health (id, ok, changed_at) values (1, true, now()) on conflict (id) do nothing`,
  );
  await seedCalendarAndPrices();
  await seedPeople();
  await seedStock(false);
  await seedRidesAndPlaces(false);
  await loadReference();
  await refreshClockOffset();
}

export async function resetToSeed(): Promise<void> {
  await query('delete from notices');
  await query('delete from lock_sheets');
  await query('delete from locks');
  await query('delete from rides');
  await query('delete from sessions');
  await query(`delete from users where seeded = false`);
  await query(`update users set reminders_on = false`);
  await query(`update ledger_health set ok = true, changed_at = now() where id = 1`);
  await seedCalendarAndPrices();
  await seedPeople();
  await seedStock(true);
  await seedRidesAndPlaces(true);
  await query(`update app_clock set offset_ms = $1, frozen_ms = null where id = 1`, [
    seedClockOffsetMs(),
  ]);
  await query(`update tick_state set at = now() + ($1 || ' milliseconds')::interval where id = 1`, [
    String(seedClockOffsetMs()),
  ]);
  await loadReference();
  await refreshClockOffset();
}

export async function refreshClockOffset(): Promise<void> {
  const row = await one<{ offset_ms: number; frozen_ms: number | null }>(
    'select offset_ms, frozen_ms from app_clock where id = 1',
  );
  if (row) setClockOffset(row.offset_ms, row.frozen_ms);
}

export async function writeClockOffset(offsetMs: number, frozenMs: number | null): Promise<void> {
  await query('update app_clock set offset_ms = $1, frozen_ms = $2 where id = 1', [
    offsetMs,
    frozenMs,
  ]);
  setClockOffset(offsetMs, frozenMs);
}
