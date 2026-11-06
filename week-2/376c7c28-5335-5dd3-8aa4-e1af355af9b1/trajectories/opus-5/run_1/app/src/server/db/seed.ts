import { startOfStudioDay } from '../domain/studio-day.ts';
import { feeCents, roundUpToHalves } from '../domain/quote.ts';
import { hashPassword, newId } from '../security.ts';
import { putObject } from '../services/s3.ts';
import { lockKey, pool, rows, withClient, type Queryable } from './pool.ts';
import { seedPhoto } from './seed-photo.ts';
import type { Outcome, PieceStatus } from '../../shared/labels.ts';

const SEED_PASSWORD = 'kilnroom-2026';
const SEED_DAY = '2026-10-01';
const RATES_FROM = '2026-01-01';
const SEED_LOCK = lockKey('seed', 'kiln-desk');

interface SeedPerson {
  readonly name: string;
  readonly email: string;
  readonly handle: string;
  readonly role: 'owner' | 'kiln_tech' | 'member';
  readonly membership?: 'member' | 'drop_off';
  readonly card?: 'none' | 'on_file';
  readonly opening?: number;
}

interface SeedPiece {
  readonly title: string;
  readonly handle: string;
  readonly clayBody: string;
  readonly length: number;
  readonly width: number;
  readonly height: number;
  readonly status: PieceStatus;
  readonly bisqueOutcome?: Outcome;
  readonly glazeOutcome?: Outcome;
  readonly pickupDeadline?: string;
}

interface SeedStudio {
  readonly slug: string;
  readonly name: string;
  readonly timeZone: string;
  readonly people: readonly SeedPerson[];
  readonly rates: readonly [number, number, number, number];
  readonly kilns: readonly { name: string; shelfAreaTenths: number }[];
  readonly clayBodies: readonly string[];
  readonly pieces: readonly SeedPiece[];
}

const STUDIOS: readonly SeedStudio[] = [
  {
    slug: 'ember-lane',
    name: 'Ember Lane Clay',
    timeZone: 'Pacific/Auckland',
    rates: [3, 6, 5, 7],
    kilns: [
      { name: 'North Kiln', shelfAreaTenths: 3800 },
      { name: 'South Kiln', shelfAreaTenths: 2640 },
    ],
    clayBodies: ['Buff Stoneware', 'Speckled Stoneware', 'Porcelain'],
    people: [
      { name: 'Rowan Vale', email: 'rowan@ember-lane.example', handle: 'rowan', role: 'owner' },
      { name: 'Ines Calder', email: 'ines@ember-lane.example', handle: 'ines', role: 'kiln_tech' },
      { name: 'Theo Marsh', email: 'theo@ember-lane.example', handle: 'theo', role: 'kiln_tech' },
      {
        name: 'Priya Nandakumar',
        email: 'priya@ember-lane.example',
        handle: 'priya',
        role: 'member',
        membership: 'member',
        card: 'on_file',
        opening: 2000,
      },
      {
        name: 'Jonah Reyes',
        email: 'jonah@ember-lane.example',
        handle: 'jonah',
        role: 'member',
        membership: 'member',
        card: 'none',
      },
      {
        name: 'Wen Liu',
        email: 'wen@ember-lane.example',
        handle: 'wen',
        role: 'member',
        membership: 'drop_off',
        card: 'on_file',
      },
    ],
    pieces: [
      {
        title: 'Tall Vase',
        handle: 'priya',
        clayBody: 'Buff Stoneware',
        length: 5.2,
        width: 5.0,
        height: 11.3,
        status: 'waiting_bisque',
      },
      {
        title: 'Breakfast Bowl',
        handle: 'priya',
        clayBody: 'Speckled Stoneware',
        length: 6.1,
        width: 6.1,
        height: 3.2,
        status: 'waiting_bisque',
      },
      {
        title: 'Mug',
        handle: 'jonah',
        clayBody: 'Porcelain',
        length: 3.6,
        width: 4.4,
        height: 4.0,
        status: 'waiting_bisque',
      },
      {
        title: 'Serving Platter',
        handle: 'wen',
        clayBody: 'Buff Stoneware',
        length: 14.0,
        width: 10.2,
        height: 1.4,
        status: 'waiting_bisque',
      },
    ],
  },
  {
    slug: 'saltmarsh',
    name: 'Saltmarsh Pottery Co-op',
    timeZone: 'Pacific/Honolulu',
    rates: [2, 4, 4, 6],
    kilns: [{ name: 'Tide Kiln', shelfAreaTenths: 3800 }],
    clayBodies: ['Dark Stoneware'],
    people: [
      { name: 'Dana Whitfield', email: 'dana@saltmarsh.example', handle: 'dana', role: 'owner' },
      { name: 'Kofi Mensah', email: 'kofi@saltmarsh.example', handle: 'kofi', role: 'kiln_tech' },
      {
        name: 'Ana Ruiz',
        email: 'ana@saltmarsh.example',
        handle: 'ana',
        role: 'member',
        membership: 'member',
        card: 'on_file',
        opening: 1000,
      },
    ],
    pieces: [
      {
        title: 'Salt Jar',
        handle: 'ana',
        clayBody: 'Dark Stoneware',
        length: 4.0,
        width: 4.0,
        height: 6.0,
        status: 'waiting_bisque',
      },
    ],
  },
  {
    slug: 'andes',
    name: 'Andes Kiln Works',
    timeZone: 'America/Santiago',
    rates: [3, 5, 4, 6],
    kilns: [{ name: 'Cordillera Kiln', shelfAreaTenths: 3800 }],
    clayBodies: ['Red Earthenware'],
    people: [
      { name: 'Valentina Rojas', email: 'valentina@andes.example', handle: 'valentina', role: 'owner' },
      { name: 'Matías Fuentes', email: 'matias@andes.example', handle: 'matias', role: 'kiln_tech' },
      {
        name: 'Camila Soto',
        email: 'camila@andes.example',
        handle: 'camila',
        role: 'member',
        membership: 'member',
        card: 'on_file',
        opening: 1500,
      },
      {
        name: 'Diego Herrera',
        email: 'diego@andes.example',
        handle: 'diego',
        role: 'member',
        membership: 'member',
        card: 'none',
      },
    ],
    pieces: [
      {
        title: 'Andes Cup',
        handle: 'camila',
        clayBody: 'Red Earthenware',
        length: 3.5,
        width: 3.5,
        height: 4.2,
        status: 'waiting_bisque',
      },
      {
        title: 'Terrace Planter',
        handle: 'diego',
        clayBody: 'Red Earthenware',
        length: 8.0,
        width: 8.0,
        height: 6.3,
        status: 'ready_for_pickup',
        bisqueOutcome: 'intact',
        glazeOutcome: 'intact',
        pickupDeadline: '2026-11-13',
      },
    ],
  },
];

const CREDIT_PACKS: readonly { name: string; amount: number }[] = [
  { name: 'Credit 20', amount: 2000 },
  { name: 'Credit 50', amount: 5000 },
  { name: 'Credit 100', amount: 10_000 },
];

const HISTORY_BY_STATUS: Record<string, readonly PieceStatus[]> = {
  waiting_bisque: ['logged', 'waiting_bisque'],
  ready_for_pickup: [
    'logged',
    'waiting_bisque',
    'bisqued',
    'waiting_glaze',
    'glazed',
    'ready_for_pickup',
  ],
};

async function seedStudio(client: Queryable, studio: SeedStudio): Promise<void> {
  const studioId = newId();
  const seedInstant = new Date(
    startOfStudioDay(SEED_DAY, studio.timeZone).getTime() + 9 * 3_600_000,
  );
  const ratesInstant = startOfStudioDay(RATES_FROM, studio.timeZone);

  await client.query(
    `insert into studios (id, slug, name, time_zone, pickup_window_days, storage_fee_cents)
     values ($1,$2,$3,$4,14,50)`,
    [studioId, studio.slug, studio.name, studio.timeZone],
  );
  await client.query(
    'insert into storage_fee_history (id, studio_id, from_instant, fee_cents) values ($1,$2,$3,50)',
    [newId(), studioId, ratesInstant],
  );
  await client.query(
    `insert into rate_schedules (id, studio_id, effective_from, member_bisque_cents,
        member_glaze_cents, dropoff_bisque_cents, dropoff_glaze_cents, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      newId(),
      studioId,
      RATES_FROM,
      studio.rates[0],
      studio.rates[1],
      studio.rates[2],
      studio.rates[3],
      ratesInstant,
    ],
  );

  const clayBodyIds = new Map<string, string>();
  for (const [index, name] of studio.clayBodies.entries()) {
    const id = newId();
    clayBodyIds.set(name, id);
    await client.query(
      'insert into clay_bodies (id, studio_id, name, sort) values ($1,$2,$3,$4)',
      [id, studioId, name, index],
    );
  }
  for (const [index, kiln] of studio.kilns.entries()) {
    await client.query(
      `insert into kilns (id, studio_id, name, stack_height_eighths, shelf_area_tenths, sort)
       values ($1,$2,$3,216,$4,$5)`,
      [newId(), studioId, kiln.name, kiln.shelfAreaTenths, index],
    );
  }
  for (const [index, pack] of CREDIT_PACKS.entries()) {
    await client.query(
      'insert into credit_packs (id, studio_id, name, amount_cents, sort) values ($1,$2,$3,$4,$5)',
      [newId(), studioId, pack.name, pack.amount, index],
    );
  }

  const peopleIds = new Map<string, string>();
  for (const person of studio.people) {
    const id = newId();
    peopleIds.set(person.handle, id);
    await client.query(
      `insert into people (id, studio_id, name, handle, email, email_lower, role, membership,
                           card_status, active, password_hash, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$11)`,
      [
        id,
        studioId,
        person.name,
        person.handle,
        person.email,
        person.email.toLowerCase(),
        person.role,
        person.membership ?? null,
        person.card ?? 'none',
        await hashPassword(SEED_PASSWORD),
        seedInstant,
      ],
    );
    if (person.opening) {
      const movementId = newId();
      await client.query(
        'insert into ledger_movements (id, studio_id, member_id, kind, created_at) values ($1,$2,$3,$4,$5)',
        [movementId, studioId, id, 'opening', seedInstant],
      );
      for (const entry of [
        { account: 'member_credit', amount: person.opening },
        { account: 'adjustments', amount: -person.opening },
      ]) {
        await client.query(
          `insert into ledger_entries (id, movement_id, studio_id, member_id, account,
                                       amount_cents, created_at)
           values ($1,$2,$3,$4,$5,$6,$7)`,
          [newId(), movementId, studioId, id, entry.account, entry.amount, seedInstant],
        );
      }
    }
  }

  for (const piece of studio.pieces) {
    const id = newId();
    const memberId = peopleIds.get(piece.handle) as string;
    const person = studio.people.find((candidate) => candidate.handle === piece.handle) as SeedPerson;
    const membership = person.membership ?? 'member';
    const lengthHalves = roundUpToHalves(Math.round(piece.length * 100));
    const widthHalves = roundUpToHalves(Math.round(piece.width * 100));
    const heightHalves = roundUpToHalves(Math.round(piece.height * 100));
    const volume = lengthHalves * widthHalves * heightHalves;
    const bisqueRate = membership === 'member' ? studio.rates[0] : studio.rates[2];
    const glazeRate = membership === 'member' ? studio.rates[1] : studio.rates[3];
    const photoKey = `studios/${studioId}/pieces/${id}/${newId()}.png`;
    await client.query(
      `insert into pieces (id, studio_id, member_id, title, clay_body_id,
         length_hundredths, width_hundredths, height_hundredths,
         r_length_halves, r_width_halves, r_height_halves, cubic_eighths,
         membership, rates_effective_from, bisque_rate_cents, bisque_fee_cents,
         glaze_rate_cents, glaze_fee_cents, quoted_at, status, waiting_since, photo_key,
         photo_seeded, bisque_outcome, glaze_outcome, pickup_deadline, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
               true,$23,$24,$25,$26)`,
      [
        id,
        studioId,
        memberId,
        piece.title,
        clayBodyIds.get(piece.clayBody),
        Math.round(piece.length * 100),
        Math.round(piece.width * 100),
        Math.round(piece.height * 100),
        lengthHalves,
        widthHalves,
        heightHalves,
        volume,
        membership,
        RATES_FROM,
        bisqueRate,
        feeCents(volume, bisqueRate),
        glazeRate,
        feeCents(volume, glazeRate),
        seedInstant,
        piece.status,
        piece.status === 'waiting_bisque' ? seedInstant : null,
        photoKey,
        piece.bisqueOutcome ?? null,
        piece.glazeOutcome ?? null,
        piece.pickupDeadline ?? null,
        seedInstant,
      ],
    );
    for (const step of HISTORY_BY_STATUS[piece.status] as readonly PieceStatus[]) {
      await client.query('insert into piece_history (piece_id, status, at) values ($1,$2,$3)', [
        id,
        step,
        seedInstant,
      ]);
    }
  }
}

export async function applySeed(): Promise<void> {
  await withClient(async (client) => {
    await client.query('select pg_advisory_lock($1)', [SEED_LOCK.toString()]);
    try {
      const existing = await rows<{ total: number }>(
        client,
        'select count(*)::bigint as total from studios',
      );
      if ((existing[0]?.total ?? 0) > 0) return;
      await client.query('begin');
      try {
        for (const studio of STUDIOS) await seedStudio(client, studio);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        throw error;
      }
    } finally {
      await client.query('select pg_advisory_unlock($1)', [SEED_LOCK.toString()]);
    }
  });
}

/** Writes any seeded intake photo the bucket is missing, so a fresh bucket fills itself. */
export async function ensureSeedPhotos(): Promise<boolean> {
  const seeded = await rows<{ id: string; photo_key: string }>(
    pool,
    'select id, photo_key from pieces where photo_seeded and photo_key is not null',
  );
  let complete = true;
  for (const piece of seeded) {
    try {
      await putObject(piece.photo_key, seedPhoto(piece.id), 'image/png');
    } catch {
      complete = false;
    }
  }
  return complete;
}
