import { PoolClient } from 'pg';
import { hashPassword } from '../api/passwords';
import { Deriver } from '../domain/derive';
import { allocateShares } from '../domain/money';
import { ParentRole, PlanVersion, VersionBody } from '../domain/plan';
import { parseInstant } from '../domain/time';
import { appendLog, transaction } from './index';
import { Household, refreshStatement } from './repo';

interface SeedParent {
  id: string;
  role: ParentRole;
  name: string;
  email: string;
  password: string;
  joined: boolean;
}

interface SeedCost {
  id: string;
  description: string;
  category: string;
  amountMinor: number;
  incurredAt: string;
  paidBy: ParentRole;
  state: 'accepted' | 'settled';
}

interface SeedSwap {
  id: string;
  nights: [string, string];
  toParent: ParentRole;
  createdBy: ParentRole;
  state: 'settled';
  sentAt: string;
}

interface SeedHousehold {
  id: string;
  name: string;
  currency: string;
  parents: SeedParent[];
  version: { id: string; body: VersionBody };
  costs: SeedCost[];
  swaps: SeedSwap[];
}

const mapleVersion: VersionBody = {
  effectiveFrom: '2026-01-01',
  exchangeZone: 'America/St_Johns',
  firstExchangeAt: '2026-01-01T17:00:00-03:30',
  base: { pattern: 'PPOOPPPPPOOOOO', anchor: '2026-01-05' },
  splitBp: { planning: 6000, other: 4000 },
  maxConsecutiveNights: null,
  rules: [
    {
      id: 'easter',
      kind: 'holiday',
      name: 'Easter',
      date: { type: 'easter' },
      startOffset: -2,
      nights: 3,
      oddYears: 'planning',
      evenYears: 'other',
    },
    {
      id: 'thanksgiving',
      kind: 'holiday',
      name: 'Thanksgiving',
      date: { type: 'nth_weekday', month: 11, weekday: 4, n: 4 },
      startOffset: -1,
      nights: 4,
      oddYears: 'planning',
      evenYears: 'other',
    },
    {
      id: 'xmas-eve',
      kind: 'holiday',
      name: 'Christmas Eve',
      date: { type: 'fixed', month: 12, day: 24 },
      startOffset: 0,
      nights: 1,
      oddYears: 'other',
      evenYears: 'planning',
    },
    {
      id: 'xmas-day',
      kind: 'holiday',
      name: 'Christmas Day',
      date: { type: 'fixed', month: 12, day: 25 },
      startOffset: 0,
      nights: 1,
      oddYears: 'planning',
      evenYears: 'other',
    },
    {
      id: 'winter-2026',
      kind: 'school_break',
      name: 'Winter break',
      nights: '2026-12-19/2027-01-04',
      split: 'halves',
      firstHalfOddYears: 'planning',
    },
    {
      id: 'spring-2027',
      kind: 'school_break',
      name: 'Spring break',
      nights: '2027-03-20/2027-03-28',
      split: 'halves',
      firstHalfOddYears: 'planning',
    },
    {
      id: 'winter-2027',
      kind: 'school_break',
      name: 'Winter break 2027',
      nights: '2027-12-18/2028-01-03',
      split: 'halves',
      firstHalfOddYears: 'planning',
    },
    {
      id: 'summer-2027',
      kind: 'vacation',
      name: 'Summer in Boston',
      parent: 'other',
      nights: '2027-07-10/2027-07-24',
      exchangeZone: 'America/New_York',
      firstExchangeAt: '2027-07-10T10:00:00-04:00',
    },
  ],
};

const households: SeedHousehold[] = [
  {
    id: '9007199254740993',
    name: 'Maple & Fern',
    currency: 'CAD',
    parents: [
      {
        id: '9007199254741001',
        role: 'planning',
        name: 'Robin Okafor',
        email: 'robin@maple-fern.test',
        password: 'Hollow-Robin-2026',
        joined: true,
      },
      {
        id: '9007199254741002',
        role: 'other',
        name: 'Sam Lindqvist',
        email: 'sam@maple-fern.test',
        password: 'Hollow-Sam-2026',
        joined: true,
      },
    ],
    version: { id: '9007199254741041', body: mapleVersion },
    costs: [
      {
        id: '9007199254741021',
        description: 'School shoes',
        category: 'clothing',
        amountMinor: 4999,
        incurredAt: '2026-09-02T18:00:00-02:30',
        paidBy: 'planning',
        state: 'settled',
      },
      {
        id: '9007199254741022',
        description: 'Swim lessons term',
        category: 'activities',
        amountMinor: 12501,
        incurredAt: '2026-10-01T18:00:00-02:30',
        paidBy: 'other',
        state: 'accepted',
      },
    ],
    swaps: [
      {
        id: '9007199254741031',
        nights: ['2026-06-12', '2026-06-14'],
        toParent: 'other',
        createdBy: 'planning',
        state: 'settled',
        sentAt: '2026-06-05T17:00:00-02:30',
      },
    ],
  },
  {
    id: '9007199254740995',
    name: 'Birch Lane',
    currency: 'KWD',
    parents: [
      {
        id: '9007199254741003',
        role: 'planning',
        name: 'Kai Moreno',
        email: 'kai@birch-lane.test',
        password: 'Hollow-Kai-2026',
        joined: true,
      },
      {
        id: '9007199254741004',
        role: 'other',
        name: 'Ari Moreno',
        email: 'ari@birch-lane.test',
        password: 'Hollow-Ari-2026',
        joined: true,
      },
    ],
    version: {
      id: '9007199254741042',
      body: {
        effectiveFrom: '2026-01-01',
        exchangeZone: 'Australia/Lord_Howe',
        firstExchangeAt: '2026-01-01T18:00:00+11:00',
        base: { pattern: 'PPPPPPPOOOOOOO', anchor: '2026-01-05' },
        splitBp: { planning: 5000, other: 5000 },
        maxConsecutiveNights: null,
        rules: [],
      },
    },
    costs: [
      {
        id: '9007199254741012',
        description: 'Piano lessons',
        category: 'activities',
        amountMinor: 8000,
        incurredAt: '2026-10-05T12:00:00+11:00',
        paidBy: 'planning',
        state: 'accepted',
      },
    ],
    swaps: [],
  },
  {
    id: '9007199254740997',
    name: 'Cedar Court',
    currency: 'JPY',
    parents: [
      {
        id: '9007199254741005',
        role: 'planning',
        name: 'Noor Haddad',
        email: 'noor@cedar-court.test',
        password: 'Hollow-Noor-2026',
        joined: true,
      },
      {
        id: '9007199254741006',
        role: 'other',
        name: 'Tove Aalto',
        email: 'tove@cedar-court.test',
        password: 'Hollow-Tove-2026',
        joined: true,
      },
    ],
    version: {
      id: '9007199254741043',
      body: {
        effectiveFrom: '2026-01-01',
        exchangeZone: 'Pacific/Pago_Pago',
        firstExchangeAt: '2026-01-01T09:00:00-11:00',
        base: { pattern: 'PPOO', anchor: '2026-01-05' },
        splitBp: { planning: 3333, other: 6667 },
        maxConsecutiveNights: null,
        rules: [],
      },
    },
    costs: [
      {
        id: '9007199254741013',
        description: 'Uniforms',
        category: 'school',
        amountMinor: 123456,
        incurredAt: '2026-10-05T12:00:00-11:00',
        paidBy: 'planning',
        state: 'accepted',
      },
    ],
    swaps: [],
  },
];

/** The seed is applied at serve time and leaves an already seeded database untouched. */
export async function applySeed(): Promise<void> {
  for (const seed of households) {
    await transaction(async (client) => {
      const existing = await client.query('SELECT id FROM households WHERE id = $1', [seed.id]);
      if (existing.rows.length > 0) return;
      await seedHousehold(client, seed);
    });
  }
}

function asHousehold(seed: SeedHousehold): Household {
  const planning = seed.parents.find((parent) => parent.role === 'planning') as SeedParent;
  const other = seed.parents.find((parent) => parent.role === 'other') as SeedParent;
  const record = (parent: SeedParent) => ({
    id: parent.id,
    role: parent.role,
    name: parent.name,
    email: parent.email,
    joined: parent.joined,
  });
  return {
    id: seed.id,
    name: seed.name,
    currency: seed.currency,
    planning: record(planning),
    other: record(other),
  };
}

async function seedHousehold(client: PoolClient, seed: SeedHousehold): Promise<void> {
  await client.query('INSERT INTO households (id, name, currency) VALUES ($1, $2, $3)', [
    seed.id,
    seed.name,
    seed.currency,
  ]);
  for (const parent of seed.parents) {
    await client.query(
      `INSERT INTO parents (id, household_id, role, name, email, email_lower, password_hash, joined)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        parent.id,
        seed.id,
        parent.role,
        parent.name,
        parent.email,
        parent.email.toLowerCase(),
        hashPassword(parent.password),
        parent.joined,
      ],
    );
  }
  await client.query(
    `INSERT INTO plan_versions (id, household_id, number, status, effective_from, body)
     VALUES ($1, $2, 1, 'adopted', $3, $4)`,
    [seed.version.id, seed.id, seed.version.body.effectiveFrom, JSON.stringify(seed.version.body)],
  );
  await appendLog(client, seed.id, 'planning', 'household.created', seed.id);
  const otherParent = seed.parents.find((parent) => parent.role === 'other') as SeedParent;
  await appendLog(client, seed.id, 'other', 'household.joined', otherParent.id);
  await appendLog(client, seed.id, 'planning', 'plan.adopted', seed.version.id);

  const version: PlanVersion = { id: seed.version.id, number: 1, status: 'adopted', body: seed.version.body };
  const applied = seed.swaps.map((swap) => ({
    id: swap.id,
    nights: { start: swap.nights[0], end: swap.nights[1] },
    makeupNights: null,
    toParent: swap.toParent,
  }));
  const deriver = new Deriver([version], applied);

  for (const cost of seed.costs) {
    const incurredAt = parseInstant(cost.incurredAt) as number;
    const custodyDay = deriver.custodyDayFor(incurredAt) as string;
    const shares = allocateShares(cost.amountMinor, seed.version.body.splitBp, cost.paidBy);
    await client.query(
      `INSERT INTO costs (id, household_id, description, category, amount_minor, incurred_at, custody_day, paid_by,
          version_id, split_planning_bp, share_planning, share_other, state, sent_at, answer_by, answer_zone,
          answered_at)
       VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0), $7, $8, $9, $10, $11, $12, $13,
          to_timestamp($6 / 1000.0) + interval '1 hour', to_timestamp($6 / 1000.0) + interval '49 hours', $14,
          to_timestamp($6 / 1000.0) + interval '2 hours')`,
      [
        cost.id,
        seed.id,
        cost.description,
        cost.category,
        cost.amountMinor,
        incurredAt,
        custodyDay,
        cost.paidBy,
        seed.version.id,
        seed.version.body.splitBp.planning,
        shares.planning,
        shares.other,
        cost.state,
        seed.version.body.exchangeZone,
      ],
    );
    await appendLog(client, seed.id, cost.paidBy, `cost.${cost.state}`, cost.id);
  }

  for (const swap of seed.swaps) {
    const sentAt = parseInstant(swap.sentAt) as number;
    await client.query(
      `INSERT INTO swaps (id, household_id, nights_start, nights_end, to_parent, created_by, state, sent_at,
          answer_by, answer_zone, answered_at, settle_at, reminded)
       VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0), to_timestamp($8 / 1000.0) + interval '48 hours',
          $9, to_timestamp($8 / 1000.0) + interval '1 hour', to_timestamp($8 / 1000.0) + interval '9 days', true)`,
      [
        swap.id,
        seed.id,
        swap.nights[0],
        swap.nights[1],
        swap.toParent,
        swap.createdBy,
        swap.state,
        sentAt,
        seed.version.body.exchangeZone,
      ],
    );
    await appendLog(client, seed.id, swap.createdBy, `swap.${swap.state}`, swap.id);
  }

  await refreshStatement(client, asHousehold(seed));
}
