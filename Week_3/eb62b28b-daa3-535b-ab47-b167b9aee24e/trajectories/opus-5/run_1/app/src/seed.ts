import { MemberRow, findMember } from './data';
import { newId, pool, query, queryOne } from './db';
import { AGE_BANDS, AgeBand, RangeRow, SEXES } from './domain/flags';
import { hashPassword } from './http/sessions';
import { Cadence } from './shared/money';
import { TimeZoneId, localDate, localTime } from './shared/time';
import { ensureKillBillAccount, membershipOf, recordReceipts } from './services/memberships';
import * as killBill from './services/killbill';

interface SeedStaff {
  name: string;
  email: string;
  role: 'owner' | 'specialist' | 'coordinator' | 'billingLead';
}

const STAFF: SeedStaff[] = [
  { name: 'Maya Okafor', email: 'maya.okafor@ocotillo.example', role: 'owner' },
  { name: 'Priya Shah', email: 'priya.shah@ocotillo.example', role: 'specialist' },
  { name: 'Theo Lindqvist', email: 'theo.lindqvist@ocotillo.example', role: 'specialist' },
  { name: 'Dana Ruiz', email: 'dana.ruiz@ocotillo.example', role: 'coordinator' },
  { name: 'Sam Whitfield', email: 'sam.whitfield@ocotillo.example', role: 'coordinator' },
  { name: 'Jordan Pell', email: 'jordan.pell@ocotillo.example', role: 'billingLead' },
];

const STAFF_PASSWORD = 'desk-pass-2027';
const MEMBER_PASSWORD = 'member-pass-2027';

interface SeedMember {
  name: string;
  email: string;
  dateOfBirth: string;
  sex: 'female' | 'male';
  state: string;
  timeZone: TimeZoneId;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  postalCode: string;
  gateNotes: string | null;
  cadence: Cadence | null;
}

const MEMBERS: SeedMember[] = [
  {
    name: 'Elena Marsh',
    email: 'elena.marsh@example.com',
    dateOfBirth: '1987-03-02',
    sex: 'female',
    state: 'co',
    timeZone: 'denver',
    phone: '+1 303 555 0142',
    line1: '1450 Larimer St',
    line2: 'Apt 6B',
    city: 'Denver',
    postalCode: '80202',
    gateNotes: 'Buzz 6B; the lobby door sticks.',
    cadence: 'sixMonths',
  },
  {
    name: 'Marcus Bell',
    email: 'marcus.bell@example.com',
    dateOfBirth: '1971-06-14',
    sex: 'male',
    state: 'ny',
    timeZone: 'newYork',
    phone: '+1 212 555 0187',
    line1: '88 Orchard St',
    line2: 'Apt 3',
    city: 'New York',
    postalCode: '10002',
    gateNotes: 'Ring twice.',
    cadence: 'yearly',
  },
  {
    name: 'Rosa Delgado',
    email: 'rosa.delgado@example.com',
    dateOfBirth: '1958-11-20',
    sex: 'female',
    state: 'il',
    timeZone: 'chicago',
    phone: '+1 312 555 0119',
    line1: '2201 W Armitage Ave',
    line2: '',
    city: 'Chicago',
    postalCode: '60647',
    gateNotes: 'Side door by the garden.',
    cadence: 'sixMonths',
  },
  {
    name: 'Owen Pryce',
    email: 'owen.pryce@example.com',
    dateOfBirth: '1990-08-09',
    sex: 'male',
    state: 'az',
    timeZone: 'phoenix',
    phone: '+1 480 555 0163',
    line1: '3300 N Scottsdale Rd',
    line2: 'Unit 12',
    city: 'Scottsdale',
    postalCode: '85251',
    gateNotes: null,
    cadence: null,
  },
  {
    name: 'Hana Sato',
    email: 'hana.sato@example.com',
    dateOfBirth: '1979-04-27',
    sex: 'female',
    state: 'ca',
    timeZone: 'losAngeles',
    phone: '+1 415 555 0175',
    line1: '640 Valencia St',
    line2: '',
    city: 'San Francisco',
    postalCode: '94110',
    gateNotes: 'Gate code 4417.',
    cadence: 'yearly',
  },
];

const PHLEBOTOMISTS: { name: string; email: string; states: string[] }[] = [
  { name: 'Luis Carrillo', email: 'luis.carrillo@visits.example', states: ['az', 'co', 'nm', 'nv', 'ut'] },
  { name: 'Ivy Chen', email: 'ivy.chen@visits.example', states: ['co', 'ut'] },
  {
    name: 'Bree Halvorsen',
    email: 'bree.halvorsen@visits.example',
    states: ['ca', 'id', 'mt', 'or', 'wa', 'wy'],
  },
  {
    name: 'Tomas Reyes',
    email: 'tomas.reyes@visits.example',
    states: ['ar', 'ia', 'ks', 'la', 'mn', 'mo', 'nd', 'ne', 'ok', 'sd', 'tx'],
  },
  {
    name: 'Nia Brooks',
    email: 'nia.brooks@visits.example',
    states: ['al', 'il', 'in', 'ky', 'mi', 'ms', 'oh', 'tn', 'wi'],
  },
  {
    name: 'Grace Whitaker',
    email: 'grace.whitaker@visits.example',
    states: ['ct', 'de', 'ma', 'md', 'me', 'nh', 'nj', 'ny', 'pa', 'vt'],
  },
  { name: 'Caleb Ford', email: 'caleb.ford@visits.example', states: ['fl', 'ga', 'nc', 'sc', 'va', 'wv'] },
];

type Bounds = [string, string, string, string];

function everyone(bounds: Bounds): RangeRow[] {
  return SEXES.flatMap((sex) =>
    AGE_BANDS.map((ageBand) => ({
      sex,
      ageBand,
      low: bounds[0],
      high: bounds[1],
      optimalLow: bounds[2],
      optimalHigh: bounds[3],
    })),
  );
}

function bySex(female: Bounds, male: Bounds): RangeRow[] {
  return [
    ...AGE_BANDS.map((ageBand) => row('female', ageBand, female)),
    ...AGE_BANDS.map((ageBand) => row('male', ageBand, male)),
  ];
}

function row(sex: 'female' | 'male', ageBand: AgeBand, bounds: Bounds): RangeRow {
  return {
    sex,
    ageBand,
    low: bounds[0],
    high: bounds[1],
    optimalLow: bounds[2],
    optimalHigh: bounds[3],
  };
}

function byBand(bands: Record<AgeBand, Bounds>): RangeRow[] {
  return SEXES.flatMap((sex) => AGE_BANDS.map((ageBand) => row(sex, ageBand, bands[ageBand])));
}

const STARTING_RANGES: Record<string, RangeRow[]> = {
  glucose: everyone(['70', '99', '75', '90']),
  hba1c: everyone(['4.0', '5.6', '4.6', '5.3']),
  insulin: everyone(['2.0', '19.6', '2.0', '8.0']),
  ldl: everyone(['40', '129', '40', '99']),
  hdl: bySex(['50', '100', '60', '90'], ['40', '100', '50', '90']),
  triglycerides: everyone(['30', '149', '30', '99']),
  apoB: everyone(['40', '99', '40', '79']),
  tsh: everyone(['0.45', '4.50', '1.00', '2.50']),
  testosterone: [
    ...AGE_BANDS.map((ageBand) => row('female', ageBand, ['15', '70', '25', '60'])),
    row('male', 'age18To39', ['300', '1000', '500', '900']),
    row('male', 'age40To59', ['300', '950', '450', '850']),
    row('male', 'age60Plus', ['250', '900', '400', '800']),
  ],
  estradiol: [
    row('female', 'age18To39', ['30', '400', '50', '250']),
    row('female', 'age40To59', ['10', '350', '30', '200']),
    row('female', 'age60Plus', ['0', '30', '0', '20']),
    ...AGE_BANDS.map((ageBand) => row('male', ageBand, ['10', '40', '20', '35'])),
  ],
  creatinine: bySex(['0.50', '1.00', '0.60', '0.90'], ['0.70', '1.30', '0.80', '1.10']),
  egfr: byBand({
    age18To39: ['90', '150', '100', '130'],
    age40To59: ['75', '150', '90', '120'],
    age60Plus: ['60', '150', '75', '110'],
  }),
  alt: bySex(['7', '33', '10', '25'], ['7', '40', '10', '30']),
  vitaminD: everyone(['30.0', '100.0', '40.0', '60.0']),
  ferritin: bySex(['15', '150', '40', '120'], ['30', '400', '50', '200']),
  vitaminB12: everyone(['232', '1245', '500', '1000']),
  magnesiumRbc: everyone(['4.2', '6.8', '5.5', '6.5']),
  hsCrp: everyone(['0.00', '3.00', '0.00', '1.00']),
  homocysteine: everyone(['4.0', '15.0', '4.0', '9.0']),
  hemoglobin: bySex(['12.0', '15.5', '13.0', '14.5'], ['13.5', '17.5', '14.0', '16.0']),
};

interface SeedDraw {
  member: string;
  phlebotomist: string;
  startsAt: string;
  collectedAt: string;
  kitCode: string;
  results: { marker: string; value: string; note?: string; by?: string }[];
}

const DRAWS: SeedDraw[] = [
  {
    member: 'Elena Marsh',
    phlebotomist: 'Luis Carrillo',
    startsAt: '2025-09-15T13:00:00Z',
    collectedAt: '2025-09-15T13:12:00Z',
    kitCode: 'KT-1000013-6',
    results: [
      { marker: 'vitaminD', value: '22.5' },
      { marker: 'ldl', value: '118' },
      { marker: 'hdl', value: '58' },
      { marker: 'apoB', value: '92' },
      { marker: 'hsCrp', value: '1.40' },
      { marker: 'ferritin', value: '35' },
    ],
  },
  {
    member: 'Elena Marsh',
    phlebotomist: 'Luis Carrillo',
    startsAt: '2026-03-09T13:00:00Z',
    collectedAt: '2026-03-09T13:15:00Z',
    kitCode: 'KT-1000021-6',
    results: [
      { marker: 'vitaminD', value: '31.5' },
      { marker: 'ldl', value: '108' },
      { marker: 'hdl', value: '61' },
      { marker: 'apoB', value: '84' },
      { marker: 'hsCrp', value: '0.90' },
      { marker: 'ferritin', value: '48' },
    ],
  },
  {
    member: 'Elena Marsh',
    phlebotomist: 'Luis Carrillo',
    startsAt: '2026-09-14T13:00:00Z',
    collectedAt: '2026-09-14T13:10:00Z',
    kitCode: 'KT-1000101-6',
    results: [
      {
        marker: 'vitaminD',
        value: '44.0',
        note: 'Keep the morning D3 with breakfast.',
        by: 'Priya Shah',
      },
      { marker: 'ldl', value: '120' },
      { marker: 'hdl', value: '64' },
      { marker: 'apoB', value: '78' },
      { marker: 'hsCrp', value: '0.60' },
      { marker: 'ferritin', value: '62' },
    ],
  },
  {
    member: 'Marcus Bell',
    phlebotomist: 'Grace Whitaker',
    startsAt: '2026-10-05T11:20:00Z',
    collectedAt: '2026-10-05T11:31:00Z',
    kitCode: 'KT-1000110-4',
    results: [
      { marker: 'vitaminD', value: '38.2' },
      { marker: 'ldl', value: '96' },
      { marker: 'hdl', value: '47' },
      { marker: 'apoB', value: '88' },
      { marker: 'hsCrp', value: '2.10' },
      { marker: 'ferritin', value: '180' },
      { marker: 'testosterone', value: '520' },
    ],
  },
];

const SEED_BLEND_ITEMS = [
  { ingredient: 'vitaminD3', capsulesPerDay: 1, morning: 1, evening: 0 },
  { ingredient: 'magnesiumGlycinate', capsulesPerDay: 2, morning: 0, evening: 2 },
  { ingredient: 'omega3', capsulesPerDay: 2, morning: 1, evening: 1 },
  { ingredient: 'methylB12', capsulesPerDay: 1, morning: 1, evening: 0 },
  { ingredient: 'ashwagandha', capsulesPerDay: 1, morning: 0, evening: 1 },
];

const PLAN_TEXT = {
  nutrition:
    'Build each meal around protein and vegetables.\n\n- Two portions of oily fish a week\n- Fibre at breakfast',
  movement: '- Walk 30 minutes a day\n- Strength work twice a week',
  sleep: 'Lights out by 22:30 on weeknights.',
  supplements:
    'Take the morning packet with breakfast and the evening packet an hour before bed.',
};

async function seedStaff(): Promise<void> {
  for (const member of STAFF) {
    await query(
      `insert into staff (id, name, email, password_hash, role) values ($1, $2, $3, $4, $5)
       on conflict do nothing`,
      [newId(), member.name, member.email, hashPassword(STAFF_PASSWORD), member.role],
    );
  }
}

async function seedPhlebotomists(): Promise<void> {
  for (let index = 0; index < PHLEBOTOMISTS.length; index += 1) {
    const phlebotomist = PHLEBOTOMISTS[index] as (typeof PHLEBOTOMISTS)[number];
    await query(
      `insert into phlebotomists (id, name, email, states, seq) values ($1, $2, $3, $4, $5)
       on conflict do nothing`,
      [newId(), phlebotomist.name, phlebotomist.email, phlebotomist.states, index],
    );
  }
}

async function seedMembers(): Promise<void> {
  for (const member of MEMBERS) {
    const id = newId();
    await query(
      `insert into members (id, name, email, password_hash, date_of_birth, sex, state, time_zone,
         phone, address_line1, address_line2, city, postal_code, gate_notes)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        id,
        member.name,
        member.email,
        hashPassword(MEMBER_PASSWORD),
        member.dateOfBirth,
        member.sex,
        member.state,
        member.timeZone,
        member.phone,
        member.line1,
        member.line2,
        member.city,
        member.postalCode,
        member.gateNotes,
      ],
    );
    await query(
      'insert into memberships (member_id, state, cadence) values ($1, $2, $3)',
      [id, member.cadence ? 'pending' : 'free', member.cadence],
    );
  }
}

async function seedRanges(): Promise<void> {
  for (const [marker, rows] of Object.entries(STARTING_RANGES)) {
    await insertRangeChange(marker, '2020-01-01', 'Maya Okafor', rows, '2020-01-01T00:00:00Z');
  }
  await insertRangeChange(
    'ldl',
    '2026-07-01',
    'Maya Okafor',
    everyone(['40', '115', '40', '89']),
    '2026-06-01T00:00:00Z',
  );
}

async function insertRangeChange(
  marker: string,
  effectiveFrom: string,
  createdBy: string,
  rows: RangeRow[],
  createdAt: string,
): Promise<void> {
  const id = newId();
  const inserted = await query<{ id: string }>(
    `insert into range_changes (id, marker, effective_from, created_by, created_at)
     values ($1, $2, $3, $4, $5)
     on conflict (marker, effective_from) do nothing
     returning id`,
    [id, marker, effectiveFrom, createdBy, createdAt],
  );
  if (inserted.length === 0) return;
  for (const range of rows) {
    await query(
      `insert into range_rows (change_id, sex, age_band, low, high, optimal_low, optimal_high)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [id, range.sex, range.ageBand, range.low, range.high, range.optimalLow, range.optimalHigh],
    );
  }
}

async function memberByName(name: string): Promise<MemberRow> {
  const found = await queryOne<MemberRow>('select * from members where name = $1', [name]);
  if (!found) throw new Error(`Seeded member ${name} is missing`);
  return found;
}

async function seedDraws(): Promise<void> {
  for (const draw of DRAWS) {
    const member = await memberByName(draw.member);
    const phlebotomist = await queryOne<{ id: string }>(
      'select id from phlebotomists where name = $1',
      [draw.phlebotomist],
    );
    if (!phlebotomist) throw new Error(`Seeded phlebotomist ${draw.phlebotomist} is missing`);
    const startsAt = new Date(draw.startsAt);
    const drawId = newId();
    await query(
      `insert into draws (id, member_id, phlebotomist_id, state, starts_at, local_date, local_time,
         time_zone, collected_at, booked_by_kind, booked_by_name, created_at)
       values ($1, $2, $3, 'released', $4, $5, $6, $7, $8, 'staff', 'Dana Ruiz', $4)`,
      [
        drawId,
        member.id,
        phlebotomist.id,
        startsAt,
        localDate(startsAt, member.time_zone),
        localTime(startsAt, member.time_zone),
        member.time_zone,
        new Date(draw.collectedAt),
      ],
    );
    await query('insert into draw_kit_codes (draw_id, kit_code, added_at) values ($1, $2, $3)', [
      drawId,
      draw.kitCode,
      new Date(draw.collectedAt),
    ]);
    for (const result of draw.results) {
      const resultId = newId();
      await query(
        `insert into results (id, draw_id, marker, value, note, created_at)
         values ($1, $2, $3, $4, $5, $6)`,
        [resultId, drawId, result.marker, result.value, result.note ?? null, new Date(draw.collectedAt)],
      );
      await query(
        `insert into result_history (id, result_id, value, note, by_name, at)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          newId(),
          resultId,
          result.value,
          result.note ?? null,
          result.by ?? 'Priya Shah',
          new Date(draw.collectedAt),
        ],
      );
    }
  }
}

async function seedPlanAndBlend(): Promise<void> {
  const elena = await memberByName('Elena Marsh');
  const publishedAt = new Date('2026-09-21T16:30:00Z');
  const blendId = newId();
  await query(
    `insert into blends (id, member_id, items, morning_capsules, evening_capsules,
       list_price_cents, member_price_cents, saved_by, saved_at)
     values ($1, $2, $3, 3, 4, 2970, 2525, 'Priya Shah', $4)`,
    [blendId, elena.id, JSON.stringify(SEED_BLEND_ITEMS), publishedAt],
  );
  await query(
    `insert into plans (id, member_id, state, based_on_plan_id, nutrition, movement, sleep,
       supplements, published_at, published_by, blend_id, updated_at, created_at)
     values ($1, $2, 'published', null, $3, $4, $5, $6, $7, 'Priya Shah', $8, $7, $7)`,
    [
      newId(),
      elena.id,
      PLAN_TEXT.nutrition,
      PLAN_TEXT.movement,
      PLAN_TEXT.sleep,
      PLAN_TEXT.supplements,
      publishedAt,
      blendId,
    ],
  );
}

async function seedThread(): Promise<void> {
  const elena = await memberByName('Elena Marsh');
  await query(
    `insert into messages (id, member_id, from_role, from_name, body, sent_at)
     values ($1, $2, 'member', $3, $4, $5)`,
    [
      newId(),
      elena.id,
      'Elena Marsh',
      'Could we move my spring draw a little earlier?',
      new Date('2026-09-22T15:00:00Z'),
    ],
  );
  await query(
    `insert into messages (id, member_id, from_role, from_name, body, sent_at)
     values ($1, $2, 'coordinator', $3, $4, $5)`,
    [
      newId(),
      elena.id,
      'Dana Ruiz',
      "Yes — I'll offer you 06:20 next time.",
      new Date('2026-09-22T16:10:00Z'),
    ],
  );
  await query(
    `insert into threads (member_id, state, last_message_at) values ($1, 'handled', $2)
     on conflict (member_id) do nothing`,
    [elena.id, new Date('2026-09-22T16:10:00Z')],
  );
}

/** Applies the published starting data once per database, whoever starts first. */
export async function seed(): Promise<void> {
  await pool.query("select pg_advisory_lock(hashtext('ocotillo-seed'))");
  try {
    const done = await queryOne<{ value: string }>('select value from app_state where key = $1', [
      'seeded',
    ]);
    if (done) return;
    await seedStaff();
    await seedPhlebotomists();
    await seedMembers();
    await seedRanges();
    await seedDraws();
    await seedPlanAndBlend();
    await seedThread();
    await query('insert into app_state (key, value) values ($1, $2)', [
      'seeded',
      new Date().toISOString(),
    ]);
  } finally {
    await pool.query("select pg_advisory_unlock(hashtext('ocotillo-seed'))");
  }
}

/** Each seeded member's first paid invoice is recorded before the next member starts,
 * so the seeded receipts carry the members table's order. */
async function waitForFirstReceipt(memberId: string, accountId: string): Promise<void> {
  const deadline = Date.now() + 30000;
  for (;;) {
    const member = await findMember(memberId);
    if (member) await recordReceipts(member, accountId);
    const recorded = await query<{ id: string }>('select id from receipts where member_id = $1', [
      memberId,
    ]);
    if (recorded.length > 0 || Date.now() >= deadline) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** Starts each seeded Plus member in Kill Bill, retrying every 5 seconds until it answers. */
export function startSeedBillingLoop(): void {
  const tick = async (): Promise<void> => {
    try {
      await killBill.ensureTenantAndCatalog();
      const pending = await query<MemberRow>(
        `select m.* from members m join memberships s on s.member_id = m.id
         where s.cadence is not null and s.subscription_id is null
           and m.account_state = 'active'
         order by m.seq`,
      );
      for (const member of pending) {
        const membership = await membershipOf(member.id);
        if (!membership.cadence) continue;
        const accountId = await ensureKillBillAccount(member);
        const subscriptionId = await killBill.createSubscription(accountId, membership.cadence);
        await query('update memberships set subscription_id = $2 where member_id = $1', [
          member.id,
          subscriptionId,
        ]);
        await waitForFirstReceipt(member.id, accountId);
      }
      if (pending.length === 0) return;
    } catch {
      // Kill Bill is unreachable; try again.
    }
    setTimeout(() => void tick(), 5000);
  };
  setTimeout(() => void tick(), 100);
}
