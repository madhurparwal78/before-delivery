import type { PoolClient } from 'pg';
import type { DocumentType, StationKind } from '../../shared/types.js';
import { DOCUMENT_LABELS } from '../../shared/types.js';
import { addDays, kitchenInstant, kitchenToday } from '../domain/time.js';
import { hashPassword } from '../domain/secrets.js';
import { cashLineAmountCents } from '../domain/pricing.js';
import { documentStorageKey } from '../services/storage.js';
import { onePagePdf } from './pdf.js';
import { pool, query, queryOne, withTransaction } from './pool.js';
import { SCHEMA_SQL } from './schema.js';

const PASSWORD = 'nightshift-demo-26';

interface SeedStation {
  id: string;
  name: string;
  kind: StationKind;
  surcharge_cents: number;
}

const NSC_STATIONS: SeedStation[] = [
  { id: 'st-deck-1', name: 'Deck oven 1', kind: 'oven', surcharge_cents: 600 },
  { id: 'st-deck-2', name: 'Deck oven 2', kind: 'oven', surcharge_cents: 600 },
  { id: 'st-convection', name: 'Convection oven', kind: 'oven', surcharge_cents: 450 },
  { id: 'st-mixer', name: '60-quart mixer', kind: 'mixer', surcharge_cents: 375 },
  { id: 'st-chiller', name: 'Blast chiller', kind: 'chiller', surcharge_cents: 550 },
  { id: 'st-prep-a', name: 'Prep table A', kind: 'prep', surcharge_cents: 0 },
  { id: 'st-prep-b', name: 'Prep table B', kind: 'prep', surcharge_cents: 0 },
  { id: 'st-range', name: 'Six-burner range', kind: 'range', surcharge_cents: 225 },
  { id: 'st-kettle', name: 'Steam kettle', kind: 'kettle', surcharge_cents: 400 },
  { id: 'st-walkin', name: 'Walk-in cooler', kind: 'cooler', surcharge_cents: 125 },
];

const LARK_STATIONS: SeedStation[] = [
  { id: 'st-l-oven', name: 'Rack oven', kind: 'oven', surcharge_cents: 500 },
  { id: 'st-l-mixer', name: '40-quart mixer', kind: 'mixer', surcharge_cents: 300 },
  { id: 'st-l-kettle', name: 'Jam kettle', kind: 'kettle', surcharge_cents: 400 },
  { id: 'st-l-prep', name: 'Prep table', kind: 'prep', surcharge_cents: 0 },
  { id: 'st-l-chiller', name: 'Blast chiller', kind: 'chiller', surcharge_cents: 500 },
  { id: 'st-l-cooler', name: 'Walk-in cooler', kind: 'cooler', surcharge_cents: 100 },
];

const USERS = [
  { id: 'usr-dana', name: 'Dana Okafor', email: 'operator@nightshift.test', role: 'operator', kitchen: 'kit-nsc', member: null },
  { id: 'usr-ember', name: 'Priya Anand', email: 'ember@pilotlight.test', role: 'member', kitchen: 'kit-nsc', member: 'mem-ember' },
  { id: 'usr-saltline', name: 'Marcus Bell', email: 'saltline@pilotlight.test', role: 'member', kitchen: 'kit-nsc', member: 'mem-saltline' },
  { id: 'usr-wren', name: 'Lin Zhao', email: 'wren@pilotlight.test', role: 'member', kitchen: 'kit-nsc', member: 'mem-wren' },
  { id: 'usr-tidewater', name: 'Aoife Ryan', email: 'tidewater@pilotlight.test', role: 'member', kitchen: 'kit-nsc', member: 'mem-tidewater' },
  { id: 'usr-ines', name: 'Ines Calloway', email: 'books@ledgerline.test', role: 'bookkeeper', kitchen: 'kit-nsc', member: null },
  { id: 'usr-teo', name: 'Teo Marsh', email: 'operator@larkspur.test', role: 'operator', kitchen: 'kit-lark', member: null },
  { id: 'usr-copper', name: 'Sam Ortiz', email: 'copperpot@pilotlight.test', role: 'member', kitchen: 'kit-lark', member: 'mem-copper' },
] as const;

const MEMBERS = [
  { id: 'mem-ember', kitchen: 'kit-nsc', business: 'Ember & Rye Bakery', email: 'ember@pilotlight.test' },
  { id: 'mem-saltline', kitchen: 'kit-nsc', business: 'Saltline Catering', email: 'saltline@pilotlight.test' },
  { id: 'mem-wren', kitchen: 'kit-nsc', business: 'Wren Street Dumplings', email: 'wren@pilotlight.test' },
  { id: 'mem-tidewater', kitchen: 'kit-nsc', business: 'Tidewater Granola', email: 'tidewater@pilotlight.test' },
  { id: 'mem-copper', kitchen: 'kit-lark', business: 'Copper Pot Jams', email: 'copperpot@pilotlight.test' },
] as const;

const DOCUMENTS: { id: string; member: string; type: DocumentType; offset: number | null }[] = [
  { id: 'doc-ember-coi', member: 'mem-ember', type: 'insurance', offset: 300 },
  { id: 'doc-ember-fh', member: 'mem-ember', type: 'food_handler', offset: 300 },
  { id: 'doc-ember-agreement', member: 'mem-ember', type: 'kitchen_agreement', offset: null },
  { id: 'doc-saltline-coi', member: 'mem-saltline', type: 'insurance', offset: 200 },
  { id: 'doc-saltline-fh', member: 'mem-saltline', type: 'food_handler', offset: 200 },
  { id: 'doc-wren-coi', member: 'mem-wren', type: 'insurance', offset: 10 },
  { id: 'doc-wren-fh', member: 'mem-wren', type: 'food_handler', offset: 200 },
  { id: 'doc-tide-coi', member: 'mem-tidewater', type: 'insurance', offset: -1 },
  { id: 'doc-tide-fh', member: 'mem-tidewater', type: 'food_handler', offset: 200 },
  { id: 'doc-copper-coi', member: 'mem-copper', type: 'insurance', offset: 300 },
  { id: 'doc-copper-fh', member: 'mem-copper', type: 'food_handler', offset: 300 },
];

export async function applySchemaAndSeed(): Promise<void> {
  await pool.query(SCHEMA_SQL);
  const marker = await queryOne<{ id: number }>(pool, 'SELECT id FROM seed_marker WHERE id = 1');
  if (marker) return;
  await withTransaction(async (client) => {
    const existing = await queryOne<{ id: number }>(
      client,
      'SELECT id FROM seed_marker WHERE id = 1 FOR UPDATE',
    );
    if (existing) return;
    await seedEverything(client);
  });
}

async function seedEverything(client: PoolClient): Promise<void> {
  const now = new Date();
  const nscToday = kitchenToday('America/Chicago', now);
  const larkToday = kitchenToday('America/New_York', now);

  await client.query(
    `INSERT INTO kitchens (id, name, timezone, same_day_cutoff_minutes) VALUES
       ('kit-nsc', 'Night Shift Commons', 'America/Chicago', $1),
       ('kit-lark', 'Larkspur Commissary', 'America/New_York', $2)`,
    [14 * 60, 12 * 60],
  );

  for (const [kitchenId, stations] of [
    ['kit-nsc', NSC_STATIONS],
    ['kit-lark', LARK_STATIONS],
  ] as const) {
    for (const [index, station] of stations.entries()) {
      await client.query(
        'INSERT INTO stations (id, kitchen_id, name, kind, loom_order) VALUES ($1, $2, $3, $4, $5)',
        [station.id, kitchenId, station.name, station.kind, index + 1],
      );
    }
  }

  for (const member of MEMBERS) {
    await client.query(
      'INSERT INTO members (id, kitchen_id, business, contact_email) VALUES ($1, $2, $3, $4)',
      [member.id, member.kitchen, member.business, member.email],
    );
  }

  const passwordHash = await hashPassword(PASSWORD);
  for (const user of USERS) {
    await client.query(
      'INSERT INTO users (id, kitchen_id, member_id, name, email, role, password_hash) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [user.id, user.kitchen, user.member, user.name, user.email, user.role, passwordHash],
    );
  }

  await seedRateCard(client, {
    id: 'rc-nsc-seed',
    kitchenId: 'kit-nsc',
    effectiveFrom: nscToday,
    tiers: [3200, 2950, 2725, 2500],
    windowHours: 72,
    packPriceCents: 56000,
    stations: NSC_STATIONS,
    now,
  });
  await seedRateCard(client, {
    id: 'rc-lark-seed',
    kitchenId: 'kit-lark',
    effectiveFrom: larkToday,
    tiers: [3000, 2800, 2600, 2400],
    windowHours: 48,
    packPriceCents: 52000,
    stations: LARK_STATIONS,
    now,
  });

  for (const document of DOCUMENTS) {
    const member = MEMBERS.find((candidate) => candidate.id === document.member);
    if (!member) continue;
    const kitchenToday_ = member.kitchen === 'kit-nsc' ? nscToday : larkToday;
    const expiresOn = document.offset === null ? null : addDays(kitchenToday_, document.offset);
    const bytes = onePagePdf(DOCUMENT_LABELS[document.type], `${member.business} — Pilotlight`);
    await client.query(
      `INSERT INTO documents
         (id, kitchen_id, member_id, type, state, expires_on, original_name, size_bytes,
          content_type, uploaded_at, reject_reason, storage_key, file_stored)
       VALUES ($1, $2, $3, $4, 'verified', $5, $6, $7, 'application/pdf', $8, NULL, $9, false)`,
      [
        document.id,
        member.kitchen,
        member.id,
        document.type,
        expiresOn,
        `${document.id}.pdf`,
        bytes.byteLength,
        now,
        documentStorageKey(member.kitchen, member.id, document.id),
      ],
    );
  }

  await client.query(
    `INSERT INTO pack_movements (id, member_id, kind, quarters, booking_id, reverses, created_at)
     VALUES ('mov-ember-seed', 'mem-ember', 'purchase', 80, NULL, NULL, $1)`,
    [now],
  );
  await client.query(
    `INSERT INTO pack_entries (movement_id, idx, account, quarters) VALUES
       ('mov-ember-seed', 0, 'member_pack', 80),
       ('mov-ember-seed', 1, 'pack_sales', -80)`,
  );

  await seedBooking(client, {
    id: 'bkg-seed-1',
    ref: 'PL-000001',
    kitchenId: 'kit-nsc',
    timezone: 'America/Chicago',
    memberId: 'mem-saltline',
    date: addDays(nscToday, 2),
    rateCardId: 'rc-nsc-seed',
    windowHours: 72,
    startMinute: 5 * 60,
    endMinute: 7 * 60,
    stations: [
      { id: 'st-deck-1', rate: 3800 },
      { id: 'st-chiller', rate: 3750 },
    ],
    now,
  });

  await seedBooking(client, {
    id: 'bkg-seed-2',
    ref: 'PL-000002',
    kitchenId: 'kit-lark',
    timezone: 'America/New_York',
    memberId: 'mem-copper',
    date: addDays(larkToday, 3),
    rateCardId: 'rc-lark-seed',
    windowHours: 48,
    startMinute: 6 * 60,
    endMinute: 10 * 60,
    stations: [{ id: 'st-l-kettle', rate: 3400 }],
    now,
  });

  await client.query('INSERT INTO seed_marker (id, seeded_on) VALUES (1, $1)', [nscToday]);
}

async function seedRateCard(
  client: PoolClient,
  card: {
    id: string;
    kitchenId: string;
    effectiveFrom: string;
    tiers: [number, number, number, number];
    windowHours: number;
    packPriceCents: number;
    stations: SeedStation[];
    now: Date;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO rate_cards
       (id, kitchen_id, effective_from, tier_1_cents, tier_2_cents, tier_3_cents, tier_4_cents,
        cancellation_window_hours, pack_price_cents, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      card.id,
      card.kitchenId,
      card.effectiveFrom,
      card.tiers[0],
      card.tiers[1],
      card.tiers[2],
      card.tiers[3],
      card.windowHours,
      card.packPriceCents,
      card.now,
    ],
  );
  for (const station of card.stations) {
    await client.query(
      'INSERT INTO rate_card_surcharges (rate_card_id, station_id, surcharge_cents) VALUES ($1, $2, $3)',
      [card.id, station.id, station.surcharge_cents],
    );
  }
}

async function seedBooking(
  client: PoolClient,
  booking: {
    id: string;
    ref: string;
    kitchenId: string;
    timezone: string;
    memberId: string;
    date: string;
    rateCardId: string;
    windowHours: number;
    startMinute: number;
    endMinute: number;
    stations: { id: string; rate: number }[];
    now: Date;
  },
): Promise<void> {
  const quarters = (booking.endMinute - booking.startMinute) / 15;
  const lines = booking.stations.map((station) => ({
    station_id: station.id,
    tier: 1,
    paid_by: 'cash' as const,
    quarters,
    hourly_rate_cents: station.rate,
    amount_cents: cashLineAmountCents(quarters, station.rate),
  }));
  const total = lines.reduce((sum, line) => sum + line.amount_cents, 0);

  await client.query(
    `INSERT INTO bookings
       (id, ref, kitchen_id, member_id, series_id, invoice_id, date, state, rate_card_id,
        cancellation_window_hours, pack_quarters, total_cents, starts_at, ends_at, confirmed_at)
     VALUES ($1, $2, $3, $4, NULL, NULL, $5, 'confirmed', $6, $7, 0, $8, $9, $10, $11)`,
    [
      booking.id,
      booking.ref,
      booking.kitchenId,
      booking.memberId,
      booking.date,
      booking.rateCardId,
      booking.windowHours,
      total,
      kitchenInstant(booking.timezone, booking.date, booking.startMinute),
      kitchenInstant(booking.timezone, booking.date, booking.endMinute),
      booking.now,
    ],
  );

  for (const station of booking.stations) {
    for (let minute = booking.startMinute; minute < booking.endMinute; minute += 15) {
      await client.query(
        'INSERT INTO booking_cells (booking_id, station_id, start_minute) VALUES ($1, $2, $3)',
        [booking.id, station.id, minute],
      );
    }
  }

  for (const [index, line] of lines.entries()) {
    await client.query(
      `INSERT INTO booking_lines
         (booking_id, idx, station_id, tier, paid_by, quarters, hourly_rate_cents, amount_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        booking.id,
        index,
        line.station_id,
        line.tier,
        line.paid_by,
        line.quarters,
        line.hourly_rate_cents,
        line.amount_cents,
      ],
    );
  }

  await client.query(
    `INSERT INTO audit_events (at, actor_id, kitchen_id, subject, subject_id, from_state, to_state)
     VALUES ($1, NULL, $2, 'booking', $3, NULL, 'confirmed')`,
    [booking.now, booking.kitchenId, booking.id],
  );
}

/** Seeded documents get their generated file the first time storage is reachable. */
export async function seededDocumentFiles(): Promise<
  { id: string; storage_key: string; title: string; subtitle: string }[]
> {
  return query<{ id: string; storage_key: string; title: string; subtitle: string }>(
    pool,
    `SELECT d.id, d.storage_key, d.type AS title, m.business AS subtitle
       FROM documents d JOIN members m ON m.id = d.member_id
      WHERE d.file_stored = false`,
  );
}
