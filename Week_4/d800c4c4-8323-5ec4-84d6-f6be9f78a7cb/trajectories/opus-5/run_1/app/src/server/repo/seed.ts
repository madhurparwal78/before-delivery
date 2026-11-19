import type { PoolClient } from 'pg';
import type { PartShape, Role, Tier } from '../../shared/types';
import { placeRectangle, type Placement } from '../domain/board';
import { hashPassword } from '../domain/password';
import { instantsForWallClock } from '../../shared/time';
import { SEED_LOCK, withAdvisoryLock, withTransaction } from './db';

const SEED_ZONE = 'America/Chicago';

const CLOSURES: readonly [string, string][] = [
  ['2026-10-17', 'Volunteer training day'],
  ['2026-11-26', 'Thanksgiving'],
  ['2026-12-24', 'Christmas Eve'],
  ['2026-12-26', 'Winter stocktake'],
];

interface SeedPerson {
  name: string;
  email: string;
  password: string;
  role: Role;
  tier?: Tier;
}

const PEOPLE: readonly SeedPerson[] = [
  {
    name: 'Rosalind Okafor',
    email: 'coordinator@pegworth.example',
    password: 'coordinator-pass-1',
    role: 'coordinator',
  },
  {
    name: 'Tomasz Brennan',
    email: 'tomasz@pegworth.example',
    password: 'volunteer-pass-1',
    role: 'volunteer',
  },
  {
    name: 'Priya Halloran',
    email: 'priya@pegworth.example',
    password: 'volunteer-pass-2',
    role: 'volunteer',
  },
  {
    name: 'Ada Mwangi',
    email: 'ada@members.example',
    password: 'member-pass-ada',
    role: 'member',
    tier: 'standard',
  },
  {
    name: 'Ben Castillo',
    email: 'ben@members.example',
    password: 'member-pass-ben',
    role: 'member',
    tier: 'pay-what-you-can',
  },
  {
    name: 'Cleo Danforth',
    email: 'cleo@members.example',
    password: 'member-pass-cleo',
    role: 'member',
    tier: 'supporter',
  },
  {
    name: 'Eli Nakamura',
    email: 'eli@members.example',
    password: 'member-pass-eli',
    role: 'member',
    tier: 'standard',
  },
];

interface SeedItem {
  tag: string;
  name: string;
  cost: number;
  parts: readonly [string, PartShape, number, number][];
}

const ITEMS: readonly SeedItem[] = [
  {
    tag: 'PW-101',
    name: 'Cordless drill kit',
    cost: 18900,
    parts: [
      ['Drill body', 'drill', 3, 3],
      ['Battery A', 'battery', 2, 2],
      ['Battery B', 'battery', 2, 2],
      ['Charger', 'case', 3, 2],
    ],
  },
  { tag: 'PW-102', name: 'Tile saw', cost: 24000, parts: [['Tile saw', 'saw', 4, 3]] },
  { tag: 'PW-103', name: 'Step ladder', cost: 9500, parts: [['Step ladder', 'ladder', 2, 8]] },
  {
    tag: 'PW-104',
    name: 'Socket set kit',
    cost: 6800,
    parts: [
      ['Case', 'case', 4, 2],
      ['Ratchet', 'wrench', 2, 3],
      ['Extension bar', 'generic', 2, 4],
      ['Metric socket tray', 'case', 3, 2],
      ['Imperial socket tray', 'case', 3, 2],
      ['Spark plug socket', 'generic', 2, 2],
    ],
  },
  {
    tag: 'PW-105',
    name: 'Orbital sander kit',
    cost: 7900,
    parts: [
      ['Sander', 'generic', 3, 3],
      ['Dust bag', 'generic', 2, 2],
      ['Sandpaper pack', 'blade', 2, 2],
    ],
  },
  { tag: 'PW-106', name: 'Claw hammer', cost: 1800, parts: [['Claw hammer', 'hammer', 2, 4]] },
  { tag: 'PW-107', name: 'Stud finder', cost: 3200, parts: [['Stud finder', 'generic', 2, 3]] },
  {
    tag: 'PW-108',
    name: 'Pressure washer kit',
    cost: 31000,
    parts: [
      ['Washer unit', 'generic', 4, 4],
      ['Hose', 'cable', 3, 3],
      ['Lance', 'generic', 2, 6],
      ['Nozzle set', 'case', 2, 2],
    ],
  },
  { tag: 'PW-109', name: 'Hedge trimmer', cost: 12000, parts: [['Hedge trimmer', 'saw', 5, 2]] },
  { tag: 'PW-110', name: 'Pipe wrench', cost: 2600, parts: [['Pipe wrench', 'wrench', 2, 5]] },
  { tag: 'PW-111', name: 'Laser level', cost: 8500, parts: [['Laser level', 'generic', 3, 2]] },
  {
    tag: 'PW-112',
    name: 'Jigsaw kit',
    cost: 9900,
    parts: [
      ['Jigsaw', 'saw', 3, 3],
      ['Blade case', 'blade', 2, 2],
    ],
  },
];

interface SeedLoan {
  ref: string;
  email: string;
  tags: readonly string[];
  checkedOut: [string, number];
  dueDate: string;
}

const LOANS: readonly SeedLoan[] = [
  {
    ref: 'L-0001',
    email: 'ada@members.example',
    tags: ['PW-102'],
    checkedOut: ['2026-10-03', 11 * 3600],
    dueDate: '2026-10-10',
  },
  {
    ref: 'L-0002',
    email: 'ben@members.example',
    tags: ['PW-101', 'PW-106'],
    checkedOut: ['2026-10-15', 17 * 3600],
    dueDate: '2026-10-22',
  },
  {
    ref: 'L-0003',
    email: 'eli@members.example',
    tags: ['PW-104'],
    checkedOut: ['2026-10-18', 13 * 3600],
    dueDate: '2026-10-25',
  },
  {
    ref: 'L-0004',
    email: 'cleo@members.example',
    tags: ['PW-108'],
    checkedOut: ['2026-10-24', 10 * 3600 + 1800],
    dueDate: '2026-10-31',
  },
];

export async function seedDatabase(): Promise<void> {
  await withAdvisoryLock(SEED_LOCK, async () => {
    await withTransaction(async (client) => {
      await seedSettings(client);
      await seedPeople(client);
      await seedInventory(client);
      await seedLoans(client);
      await seedHolds(client);
    });
  });
}

async function seedSettings(client: PoolClient): Promise<void> {
  await client.query(
    `insert into settings (id, time_zone, late_fee_cents, damage_fee_cents, loan_period_days)
     values (1, $1, 250, 1500, 7) on conflict (id) do nothing`,
    [SEED_ZONE],
  );
  const hoursRows = await client.query<{ count: number }>(
    'select count(*)::int as count from opening_hours',
  );
  if ((hoursRows.rows[0]?.count ?? 0) === 0) {
    for (const [weekday, opens, closes] of [
      ['thursday', '16:00', '20:00'],
      ['saturday', '10:00', '16:00'],
      ['sunday', '12:00', '16:00'],
    ]) {
      await client.query(
        'insert into opening_hours (weekday, opens, closes) values ($1, $2, $3)',
        [weekday, opens, closes],
      );
    }
  }
  for (const [date, reason] of CLOSURES) {
    await client.query(
      'insert into closures (closure_date, reason) values ($1, $2) on conflict (closure_date) do nothing',
      [date, reason],
    );
  }
}

async function seedPeople(client: PoolClient): Promise<void> {
  for (const person of PEOPLE) {
    const existing = await client.query<{ id: number }>('select id from users where email = $1', [
      person.email,
    ]);
    let userId = existing.rows[0]?.id;
    if (userId === undefined) {
      const inserted = await client.query<{ id: number }>(
        'insert into users (name, email, password_hash, role) values ($1, $2, $3, $4) returning id',
        [person.name, person.email, await hashPassword(person.password), person.role],
      );
      userId = inserted.rows[0]?.id as number;
    }
    if (person.tier) {
      await client.query(
        `insert into memberships (user_id, status, tier) values ($1, 'pending-payment', $2)
         on conflict (user_id) do nothing`,
        [userId, person.tier],
      );
    }
  }
}

async function seedInventory(client: PoolClient): Promise<void> {
  const taken: Placement[] = (
    await client.query<Placement>(
      'select grid_col as col, grid_row as row, width, height from parts',
    )
  ).rows;
  for (const item of ITEMS) {
    const existing = await client.query<{ id: number }>('select id from items where tag = $1', [
      item.tag,
    ]);
    if (existing.rows.length > 0) continue;
    const inserted = await client.query<{ id: number }>(
      'insert into items (tag, name, replacement_cost_cents) values ($1, $2, $3) returning id',
      [item.tag, item.name, item.cost],
    );
    const itemId = inserted.rows[0]?.id as number;
    let listedAt = 0;
    for (const [name, shape, width, height] of item.parts) {
      const spot = placeRectangle(taken, width, height);
      taken.push(spot);
      await client.query(
        `insert into parts (item_id, name, shape, grid_col, grid_row, width, height, state, listed_at)
         values ($1, $2, $3, $4, $5, $6, $7, 'hung', $8)`,
        [itemId, name, shape, spot.col, spot.row, width, height, listedAt],
      );
      listedAt += 1;
    }
  }
}

async function seedLoans(client: PoolClient): Promise<void> {
  const settings = await client.query<{ late_fee_cents: number; damage_fee_cents: number }>(
    'select late_fee_cents, damage_fee_cents from settings where id = 1',
  );
  const rules = settings.rows[0];
  if (!rules) return;
  for (const loan of LOANS) {
    const existing = await client.query('select id from loans where ref = $1', [loan.ref]);
    if (existing.rows.length > 0) continue;
    const member = await client.query<{ id: number }>('select id from users where email = $1', [
      loan.email,
    ]);
    const memberId = member.rows[0]?.id;
    if (memberId === undefined) continue;
    const items = await client.query<{ id: number; replacement_cost_cents: number }>(
      'select id, replacement_cost_cents from items where tag = any($1::text[])',
      [[...loan.tags]],
    );
    const costs: Record<string, number> = {};
    for (const row of items.rows) costs[String(row.id)] = row.replacement_cost_cents;
    const [date, secondOfDay] = loan.checkedOut;
    const checkedOutAt = instantsForWallClock(date, secondOfDay, SEED_ZONE)[0];
    const inserted = await client.query<{ id: number }>(
      `insert into loans (ref, member_id, status, checked_out_at, due_date, fee_rules)
       values ($1, $2, 'out', $3, $4, $5) returning id`,
      [
        loan.ref,
        memberId,
        checkedOutAt?.toISOString(),
        loan.dueDate,
        {
          late_fee_cents: rules.late_fee_cents,
          damage_fee_cents: rules.damage_fee_cents,
          replacement_costs_cents: costs,
        },
      ],
    );
    const loanId = inserted.rows[0]?.id as number;
    let listedAt = 0;
    for (const tag of loan.tags) {
      const itemRow = await client.query<{ id: number }>('select id from items where tag = $1', [
        tag,
      ]);
      const itemId = itemRow.rows[0]?.id as number;
      await client.query(
        'insert into loan_items (loan_id, item_id, listed_at) values ($1, $2, $3)',
        [loanId, itemId, listedAt],
      );
      await client.query("update parts set state = 'out' where item_id = $1", [itemId]);
      listedAt += 1;
    }
  }
  await client.query(
    `select setval('loan_ref_seq', greatest((select coalesce(max(id), 0) from loans), 4))`,
  );
}

async function seedHolds(client: PoolClient): Promise<void> {
  const existing = await client.query('select id from holds limit 1');
  if (existing.rows.length > 0) return;
  const rows = await client.query<{ member_id: number; item_id: number }>(
    `select u.id as member_id, i.id as item_id from users u, items i
     where u.email = 'cleo@members.example' and i.tag = 'PW-102'`,
  );
  const row = rows.rows[0];
  if (!row) return;
  await client.query(
    "insert into holds (item_id, member_id, status) values ($1, $2, 'queued')",
    [row.item_id, row.member_id],
  );
}
