import type { Database } from './pool.js';
import { hashPassword } from '../core/passwords.js';

const SEED_PASSWORD = 'pegboard-2026';

const PEOPLE: ReadonlyArray<{
  id: string;
  name: string;
  role: 'founder' | 'volunteer' | 'member';
  email: string;
  phone: string;
}> = [
  { id: 'usr-rosa', name: 'Rosa Lindqvist', role: 'founder', email: 'rosa@commonshed.example', phone: '555-0100' },
  { id: 'usr-dev', name: 'Dev Okafor', role: 'volunteer', email: 'dev@commonshed.example', phone: '555-0101' },
  { id: 'usr-ines', name: 'Ines Marchetti', role: 'volunteer', email: 'ines@commonshed.example', phone: '555-0102' },
  { id: 'mem-hal', name: 'Hal Brennan', role: 'member', email: 'hal@members.example', phone: '555-0141' },
  { id: 'mem-mina', name: 'Mina Castellanos', role: 'member', email: 'mina@members.example', phone: '555-0142' },
  { id: 'mem-tobi', name: 'Tobi Adeyemi', role: 'member', email: 'tobi@members.example', phone: '555-0143' },
  { id: 'mem-wren', name: 'Wren Kowalski', role: 'member', email: 'wren@members.example', phone: '555-0144' },
  { id: 'mem-sol', name: 'Sol Navarro', role: 'member', email: 'sol@members.example', phone: '555-0145' },
  { id: 'mem-juno', name: 'Juno Achterberg', role: 'member', email: 'juno@members.example', phone: '555-0146' },
];

const ITEMS: ReadonlyArray<{
  id: string;
  name: string;
  category: string;
  labels: readonly string[];
  depositCents: number;
  replacementCents: number;
}> = [
  { id: 'tile-saw', name: '7-inch wet tile saw', category: 'Masonry', labels: ['TS-1', 'TS-2'], depositCents: 5000, replacementCents: 18900 },
  { id: 'pressure-washer', name: 'Electric pressure washer', category: 'Cleaning', labels: ['PW-1', 'PW-2', 'PW-3'], depositCents: 4000, replacementCents: 24900 },
  { id: 'carpet-cleaner', name: 'Carpet cleaner', category: 'Cleaning', labels: ['CC-1', 'CC-2'], depositCents: 6000, replacementCents: 32900 },
  { id: 'floor-sander', name: 'Orbital floor sander', category: 'Power tools', labels: ['FS-1', 'FS-2'], depositCents: 7500, replacementCents: 89900 },
  { id: 'laser-level', name: 'Self-levelling laser', category: 'Measuring', labels: ['LL-1'], depositCents: 2500, replacementCents: 13900 },
  { id: 'ext-ladder', name: '24-foot extension ladder', category: 'Ladders', labels: ['LD-1'], depositCents: 0, replacementCents: 21900 },
  { id: 'drill-driver', name: 'Cordless drill driver', category: 'Power tools', labels: ['DR-1', 'DR-2', 'DR-3', 'DR-4'], depositCents: 0, replacementCents: 12900 },
  { id: 'hedge-trimmer', name: 'Hedge trimmer', category: 'Garden', labels: ['HT-1', 'HT-2'], depositCents: 0, replacementCents: 9900 },
  { id: 'post-hole-digger', name: 'Post hole digger', category: 'Garden', labels: ['PH-1'], depositCents: 0, replacementCents: 4500 },
  { id: 'stud-finder', name: 'Stud finder', category: 'Hand tools', labels: ['SF-1', 'SF-2'], depositCents: 0, replacementCents: 2499 },
];

const CLOSURE_DATES = ['2026-07-04', '2026-11-26', '2026-12-25', '2026-12-26'];

const LATE_FEE_SCHEDULE: ReadonlyArray<{ effectiveFrom: string; centsPerDay: number }> = [
  { effectiveFrom: '2026-01-06', centsPerDay: 50 },
  { effectiveFrom: '2026-09-01', centsPerDay: 100 },
];

export async function seed(pool: Database): Promise<void> {
  await pool.query(
    `insert into library (id, name, time_zone, open_days, opening_time, closing_time, max_active_per_member)
     values (1, $1, $2, $3, $4, $5, $6)
     on conflict (id) do update set
       name = excluded.name,
       time_zone = excluded.time_zone,
       open_days = excluded.open_days,
       opening_time = excluded.opening_time,
       closing_time = excluded.closing_time,
       max_active_per_member = excluded.max_active_per_member`,
    ['Common Shed \u2014 Eastgate', 'America/New_York', ['tue', 'wed', 'thu', 'fri', 'sat', 'sun'], '10:00', '18:00', 4],
  );

  await pool.query(
    `insert into closure_date (closed_on) select unnest($1::text[]) on conflict do nothing`,
    [CLOSURE_DATES],
  );

  for (const entry of LATE_FEE_SCHEDULE) {
    await pool.query(
      `insert into late_fee_schedule (effective_from, cents_per_day) values ($1, $2)
       on conflict (effective_from) do update set cents_per_day = excluded.cents_per_day`,
      [entry.effectiveFrom, entry.centsPerDay],
    );
  }

  const passwordHash = await hashPassword(SEED_PASSWORD);
  for (const person of PEOPLE) {
    await pool.query(
      `insert into person (id, name, role, email, phone, password_hash)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (id) do update set
         name = excluded.name,
         role = excluded.role,
         email = excluded.email,
         phone = excluded.phone`,
      [person.id, person.name, person.role, person.email, person.phone, passwordHash],
    );
  }

  for (const [index, item] of ITEMS.entries()) {
    await pool.query(
      `insert into item (id, name, category, deposit_cents, replacement_cents, seed_order)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (id) do update set
         name = excluded.name,
         category = excluded.category,
         deposit_cents = excluded.deposit_cents,
         replacement_cents = excluded.replacement_cents,
         seed_order = excluded.seed_order`,
      [item.id, item.name, item.category, item.depositCents, item.replacementCents, index],
    );
    for (const [laneIndex, label] of item.labels.entries()) {
      await pool.query(
        `insert into unit (id, item_id, label, lane_index) values ($1, $2, $3, $4)
         on conflict (id) do update set label = excluded.label, lane_index = excluded.lane_index`,
        [`${item.id}-${laneIndex + 1}`, item.id, label, laneIndex],
      );
    }
  }
}
