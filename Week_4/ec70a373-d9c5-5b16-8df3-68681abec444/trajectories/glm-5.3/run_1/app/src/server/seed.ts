import bcrypt from 'bcryptjs';
import type { DbClient, Row } from './db.js';
import { clientQuery } from './db.js';
import { drawFromLots } from './ledger.js';
import { uuid } from './ids.js';

export const DEMO_PASSWORD = 'pilot-light-demo';

export async function hashPassword(): Promise<string> {
  return bcrypt.hashSync(DEMO_PASSWORD, 10);
}

const IDs = {
  copperline: uuid(),
  eastside: uuid(),
  highline: uuid(),
  fernhollowTenant: uuid(),
  fernhollowSite: uuid(),
  dana: uuid(),
  luis: uuid(),
  priya: uuid(),
  rosa: uuid(),
  ade: uuid(),
  theo: uuid(),
  hana: uuid(),
  ines: uuid(),
  marco: uuid(),
  rosalind: uuid(),
  rory: uuid(),
  smokeTruck: uuid(),
  steamTruck: uuid(),
  stationEast: {
    deckOven1: uuid(),
    convectionOven2: uuid(),
    spiralMixer: uuid(),
    blastChiller: uuid(),
    prepTableA: uuid(),
  },
  stationHigh: {
    rackOven: uuid(),
    planetaryMixer: uuid(),
    blastChillerH1: uuid(),
    prepTableH: uuid(),
  },
  stationFern: {
    hearthOvenF1: uuid(),
    mixerF2: uuid(),
    blastChillerF3: uuid(),
    prepTableF4: uuid(),
  },
  packs: {
    starter10: uuid(),
    production30: uuid(),
    bake20: uuid(),
  },
};

interface SeedUser {
  id: string;
  name: string;
  email: string;
  role: 'member' | 'kitchen_manager' | 'finance_lead';
  siteId: string | null;
  businessName: string | null;
  contactName: string | null;
  openingQh: number | null;
  coiValidThrough: string | null;
  fhcValidThrough: string | null;
  blValidThrough: string | null;
  truck: { id: string; name: string; permit: string; siteId: string } | null;
}

const USERS: SeedUser[] = [
  { id: IDs.dana, name: 'Dana Okafor', email: 'dana@copperline.example', role: 'kitchen_manager', siteId: IDs.eastside, businessName: null, contactName: null, openingQh: null, coiValidThrough: null, fhcValidThrough: null, blValidThrough: null, truck: null },
  { id: IDs.luis, name: 'Luis Arrieta', email: 'luis@copperline.example', role: 'kitchen_manager', siteId: IDs.highline, businessName: null, contactName: null, openingQh: null, coiValidThrough: null, fhcValidThrough: null, blValidThrough: null, truck: null },
  { id: IDs.priya, name: 'Priya Raman', email: 'priya@copperline.example', role: 'finance_lead', siteId: null, businessName: null, contactName: null, openingQh: null, coiValidThrough: null, fhcValidThrough: null, blValidThrough: null, truck: null },
  { id: IDs.rosa, name: 'Rosa Lindqvist', email: 'rosa@lindqvist.example', role: 'member', siteId: IDs.eastside, businessName: 'Lindqvist Hearth Bakery', contactName: 'Rosa Lindqvist', openingQh: 48, coiValidThrough: '2027-06-30', fhcValidThrough: '2027-08-31', blValidThrough: '2027-12-31', truck: null },
  { id: IDs.ade, name: 'Ade Okonjo', email: 'ade@okonjo.example', role: 'member', siteId: IDs.eastside, businessName: 'Okonjo Small Batch', contactName: 'Ade Okonjo', openingQh: 40, coiValidThrough: '2027-05-31', fhcValidThrough: '2027-05-31', blValidThrough: '2027-12-31', truck: null },
  { id: IDs.theo, name: 'Theo Mbeki', email: 'theo@mbekismoke.example', role: 'member', siteId: IDs.eastside, businessName: 'Mbeki Smoke Truck', contactName: 'Theo Mbeki', openingQh: 24, coiValidThrough: '2027-04-30', fhcValidThrough: '2027-04-30', blValidThrough: '2027-12-31', truck: { id: IDs.smokeTruck, name: 'Smoke Signal', permit: 'MFU-2291', siteId: IDs.eastside } },
  { id: IDs.hana, name: 'Hana Sato', email: 'hana@satopatisserie.example', role: 'member', siteId: IDs.highline, businessName: 'Sato Patisserie', contactName: 'Hana Sato', openingQh: 32, coiValidThrough: '2026-09-30', fhcValidThrough: '2027-03-31', blValidThrough: '2027-12-31', truck: null },
  { id: IDs.ines, name: 'Ines Calder', email: 'ines@fernhollow.example', role: 'kitchen_manager', siteId: IDs.fernhollowSite, businessName: null, contactName: null, openingQh: null, coiValidThrough: null, fhcValidThrough: null, blValidThrough: null, truck: null },
  { id: IDs.marco, name: 'Marco Vitale', email: 'marco@fernhollow.example', role: 'finance_lead', siteId: null, businessName: null, contactName: null, openingQh: null, coiValidThrough: null, fhcValidThrough: null, blValidThrough: null, truck: null },
  { id: IDs.rosalind, name: 'Rosalind Park', email: 'rosalind@parkstreetpies.example', role: 'member', siteId: IDs.fernhollowSite, businessName: 'Park Street Pies', contactName: 'Rosalind Park', openingQh: 36, coiValidThrough: '2027-06-30', fhcValidThrough: '2027-06-30', blValidThrough: '2027-12-31', truck: null },
  { id: IDs.rory, name: 'Rory Delacroix', email: 'rory@delacroix.example', role: 'member', siteId: IDs.fernhollowSite, businessName: 'Delacroix Dumpling Truck', contactName: 'Rory Delacroix', openingQh: 20, coiValidThrough: '2027-06-30', fhcValidThrough: '2027-06-30', blValidThrough: '2027-12-31', truck: { id: IDs.steamTruck, name: 'Steam Engine', permit: 'MFU-8820', siteId: IDs.fernhollowSite } },
];

/** Site-local wall times for seeded visits, resolved from the site's zone. */
export interface SeedVisit {
  date: string;
  arrivedMinutes: number;
  departedMinutes: number;
  services: string[];
  signature: string;
  manager: string;
}

export const SEED_VISITS: Record<string, SeedVisit[]> = {
  smoke: [
    { date: '2026-10-20', arrivedMinutes: 19 * 60 + 30, departedMinutes: 22 * 60, services: ['potable_water', 'grey_water', 'cleaning'], signature: 'Theo Mbeki', manager: 'Dana Okafor' },
    { date: '2026-10-21', arrivedMinutes: 20 * 60, departedMinutes: 21 * 60 + 30, services: ['grey_water', 'restock'], signature: 'Theo Mbeki', manager: 'Dana Okafor' },
    { date: '2026-10-23', arrivedMinutes: 6 * 60, departedMinutes: 7 * 60, services: ['potable_water', 'food_storage'], signature: 'Theo Mbeki', manager: 'Dana Okafor' },
  ],
  steam: [
    { date: '2026-10-22', arrivedMinutes: 8 * 60, departedMinutes: 9 * 60 + 15, services: ['potable_water', 'grey_water'], signature: 'Rory Delacroix', manager: 'Ines Calder' },
  ],
};

export interface SeedBooking {
  reference: string;
  userId: string;
  siteId: string;
  stationId: string;
  date: string;
  startMinute: number;
  endMinute: number;
  status: 'confirmed' | 'checked_in';
  createdAt: number;
  checkedInAt?: number;
  checkedInBy?: string;
}

export interface SeedRate {
  siteId: string;
  effectiveFrom: string;
  hourlyRateCents: number;
  taxRatePercent: string;
  createdAt: number;
}

export interface SeedSet {
  bookings: SeedBooking[];
  rates: SeedRate[];
  purchase?: {
    userId: string;
    packId: string;
    packName: string;
    quarterHours: number;
    priceCents: number;
    committedAt: number;
    validThrough: string;
  };
  coiOverrides: Record<string, string>;
}

export async function seedDatabase(
  client: DbClient,
  input: {
    nowMs: number;
    seedSet: 'site-day' | 'pack-expiry' | null;
    zoneInstant: (date: string, zone: string, minutes: number) => number;
  },
): Promise<void> {
  const existing = await clientQuery<Row>(client, `SELECT id FROM tenants LIMIT 1`);
  if (existing.length > 0) return;

  const passwordHash = await hashPassword();
  const tenantCopperline = IDs.copperline;
  const tenantFernhollow = IDs.fernhollowTenant;

  await clientQuery(
    client,
    `INSERT INTO tenants (id, name, legal_name) VALUES ($1, $2, $3), ($4, $5, $6)`,
    [
      tenantCopperline,
      'Copperline Kitchen Collective',
      'Copperline Kitchen Collective, Inc.',
      tenantFernhollow,
      'Fernhollow Food Works',
      'Fernhollow Food Works Cooperative',
    ],
  );

  const sites: Array<[string, string, string, string, string, number]> = [
    [IDs.eastside, tenantCopperline, 'Copperline Eastside', 'America/New_York', '410 Foundry Row, Port Avery', 1],
    [IDs.highline, tenantCopperline, 'Copperline Highline', 'America/Denver', '88 Mesa Spur, Highline Junction', 2],
    [IDs.fernhollowSite, tenantFernhollow, 'Fernhollow Commissary', 'America/Los_Angeles', '7 Cedar Siding, Fernhollow', 3],
  ];
  for (const site of sites) {
    await clientQuery(
      client,
      `INSERT INTO sites (id, tenant_id, name, time_zone, address, display_order) VALUES ($1, $2, $3, $4, $5, $6)`,
      site,
    );
  }

  const stations: Array<[string, string, string, string, number]> = [
    [IDs.stationEast.deckOven1, IDs.eastside, 'Deck Oven 1', 'oven', 1],
    [IDs.stationEast.convectionOven2, IDs.eastside, 'Convection Oven 2', 'oven', 2],
    [IDs.stationEast.spiralMixer, IDs.eastside, 'Spiral Mixer 60 qt', 'mixer', 3],
    [IDs.stationEast.blastChiller, IDs.eastside, 'Blast Chiller', 'blast_chiller', 4],
    [IDs.stationEast.prepTableA, IDs.eastside, 'Prep Table A', 'prep_table', 5],
    [IDs.stationHigh.rackOven, IDs.highline, 'Rack Oven', 'oven', 1],
    [IDs.stationHigh.planetaryMixer, IDs.highline, 'Planetary Mixer 40 qt', 'mixer', 2],
    [IDs.stationHigh.blastChillerH1, IDs.highline, 'Blast Chiller H1', 'blast_chiller', 3],
    [IDs.stationHigh.prepTableH, IDs.highline, 'Prep Table H', 'prep_table', 4],
    [IDs.stationFern.hearthOvenF1, IDs.fernhollowSite, 'Hearth Oven F1', 'oven', 1],
    [IDs.stationFern.mixerF2, IDs.fernhollowSite, 'Mixer F2', 'mixer', 2],
    [IDs.stationFern.blastChillerF3, IDs.fernhollowSite, 'Blast Chiller F3', 'blast_chiller', 3],
    [IDs.stationFern.prepTableF4, IDs.fernhollowSite, 'Prep Table F4', 'prep_table', 4],
  ];
  for (const station of stations) {
    await clientQuery(
      client,
      `INSERT INTO stations (id, site_id, name, kind, display_order) VALUES ($1, $2, $3, $4, $5)`,
      station,
    );
  }

  const packs: Array<[string, string, string, number, number, number]> = [
    [IDs.packs.starter10, tenantCopperline, 'Starter 10', 40, 25000, 1],
    [IDs.packs.production30, tenantCopperline, 'Production 30', 120, 66000, 2],
    [IDs.packs.bake20, tenantFernhollow, 'Bake 20', 80, 46000, 1],
  ];
  for (const pack of packs) {
    await clientQuery(
      client,
      `INSERT INTO packs (id, tenant_id, name, quarter_hours, price_cents, display_order) VALUES ($1, $2, $3, $4, $5, $6)`,
      pack,
    );
  }

  for (const user of USERS) {
    const tenantId = user.siteId === IDs.fernhollowSite ? tenantFernhollow : tenantCopperline;
    const emailKey = user.email.toLowerCase();
    await clientQuery(
      client,
      `INSERT INTO users (id, tenant_id, name, email, email_key, password_hash, role, site_id,
         business_name, contact_name, coi_valid_through, fhc_valid_through, bl_valid_through, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        user.id,
        tenantId,
        user.name,
        user.email,
        emailKey,
        passwordHash,
        user.role,
        user.siteId,
        user.businessName,
        user.contactName,
        user.coiValidThrough,
        user.fhcValidThrough,
        user.blValidThrough,
        input.nowMs,
      ],
    );
    if (user.truck) {
      await clientQuery(
        client,
        `INSERT INTO trucks (id, member_id, site_id, name, permit_number) VALUES ($1, $2, $3, $4, $5)`,
        [user.truck.id, user.id, user.truck.siteId, user.truck.name, user.truck.permit],
      );
    }
    if (user.role === 'member' && user.openingQh !== null) {
      await seedOpeningBalance(client, user.id, tenantId, user.openingQh, input.nowMs);
    }
  }

  const rates: Array<[string, string, string, number, string, number]> = [
    [uuid(), IDs.eastside, '2026-01-01', 4250, '8.875', input.nowMs],
    [uuid(), IDs.highline, '2026-01-01', 3800, '7.65', input.nowMs],
    [uuid(), IDs.fernhollowSite, '2026-01-01', 4500, '9.25', input.nowMs],
  ];
  for (const rate of rates) {
    await clientQuery(
      client,
      `INSERT INTO rates (id, site_id, effective_from, hourly_rate_cents, tax_rate_percent, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
      rate,
    );
  }

  await seedVisits(client, input.nowMs, input.zoneInstant);

  if (input.seedSet) {
    const set = seedSetFor(input.seedSet);
    await applySeedSet(client, set, input);
  }
}

async function seedOpeningBalance(
  client: DbClient,
  memberId: string,
  tenantId: string,
  quarterHours: number,
  atMs: number,
): Promise<void> {
  const lotResult = await clientQuery<{ id: string }>(
    client,
    `INSERT INTO lots (member_id, purchase_id, pack_name, valid_through, remainder_qh, purchase_seq, created_at)
     VALUES ($1, NULL, 'Opening balance', NULL, $2, 0, $3) RETURNING id`,
    [memberId, quarterHours, atMs],
  );
  const lotId = Number(lotResult[0].id);
  const movementResult = await clientQuery<{ id: string }>(
    client,
    `INSERT INTO movements (tenant_id, member_id, kind, booking_id, purchase_id, quarter_hours,
       from_account, to_account, actor_user_id, actor_name, actor_role, created_at)
     VALUES ($1, $2, 'opening_balance', NULL, NULL, $3, 'opening_balance', 'available', NULL, 'Pilotlight', NULL, $4)
     RETURNING id`,
    [tenantId, memberId, quarterHours, atMs],
  );
  const movementId = Number(movementResult[0].id);
  await clientQuery(
    client,
    `INSERT INTO movement_entries (movement_id, member_id, account, quarter_hours) VALUES ($1, $2, 'opening_balance', $3), ($1, $2, 'available', $4)`,
    [movementId, memberId, -quarterHours, quarterHours],
  );
  await clientQuery(
    client,
    `INSERT INTO movement_lots (movement_id, lot_id, purchase_id, quarter_hours) VALUES ($1, $2, NULL, $3)`,
    [movementId, lotId, quarterHours],
  );
}

async function seedVisits(
  client: DbClient,
  nowMs: number,
  zoneInstant: (date: string, zone: string, minutes: number) => number,
): Promise<void> {
  const visits: Array<[string, string, string, string, number, number, string[], string, string]> = [];
  for (const [truckKey, list] of Object.entries(SEED_VISITS)) {
    const truckId = truckKey === 'smoke' ? IDs.smokeTruck : IDs.steamTruck;
    const siteId = truckKey === 'smoke' ? IDs.eastside : IDs.fernhollowSite;
    const zone = truckKey === 'smoke' ? 'America/New_York' : 'America/Los_Angeles';
    for (const visit of list) {
      const arrivedAt = zoneInstant(visit.date, zone, visit.arrivedMinutes);
      const departedAt = zoneInstant(visit.date, zone, visit.departedMinutes);
      visits.push([uuid(), truckKey === 'smoke' ? IDs.copperline : IDs.fernhollowTenant, truckId, siteId, arrivedAt, departedAt, visit.services, visit.signature, visit.manager]);
    }
  }
  for (const visit of visits) {
    await clientQuery(
      client,
      `INSERT INTO visits (id, tenant_id, truck_id, site_id, arrived_at, departed_at, services, operator_signature, manager_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      visit,
    );
  }
}

function seedSetFor(name: 'site-day' | 'pack-expiry'): SeedSet {
  if (name === 'site-day') {
    const created = Date.parse('2026-11-05T14:00:00Z');
    const rateCreated1 = Date.parse('2026-11-07T15:00:00Z');
    const rateCreated2 = Date.parse('2026-11-07T15:05:00Z');
    return {
      bookings: [
        { reference: 'PL-SD0001', userId: IDs.rosa, siteId: IDs.eastside, stationId: IDs.stationEast.deckOven1, date: '2026-11-10', startMinute: 9 * 60, endMinute: 11 * 60, status: 'confirmed', createdAt: created },
        { reference: 'PL-SD0002', userId: IDs.ade, siteId: IDs.eastside, stationId: IDs.stationEast.spiralMixer, date: '2026-11-10', startMinute: 8 * 60 + 15, endMinute: 9 * 60 + 15, status: 'confirmed', createdAt: created },
        { reference: 'PL-SD0003', userId: IDs.ade, siteId: IDs.eastside, stationId: IDs.stationEast.prepTableA, date: '2026-11-10', startMinute: 6 * 60, endMinute: 7 * 60, status: 'confirmed', createdAt: created },
        { reference: 'PL-SD0004', userId: IDs.theo, siteId: IDs.eastside, stationId: IDs.stationEast.blastChiller, date: '2026-11-10', startMinute: 6 * 60, endMinute: 7 * 60 + 30, status: 'checked_in', createdAt: created, checkedInAt: Date.parse('2026-11-10T10:50:00Z'), checkedInBy: 'Dana Okafor' },
        { reference: 'PL-SD0005', userId: IDs.theo, siteId: IDs.eastside, stationId: IDs.stationEast.prepTableA, date: '2026-11-12', startMinute: 10 * 60, endMinute: 14 * 60 + 30, status: 'confirmed', createdAt: created },
        { reference: 'PL-SD0006', userId: IDs.rosa, siteId: IDs.eastside, stationId: IDs.stationEast.convectionOven2, date: '2026-11-08', startMinute: 21 * 60, endMinute: 22 * 60, status: 'checked_in', createdAt: created, checkedInAt: Date.parse('2026-11-09T01:50:00Z'), checkedInBy: 'Dana Okafor' },
        { reference: 'PL-SD0007', userId: IDs.hana, siteId: IDs.highline, stationId: IDs.stationHigh.rackOven, date: '2026-11-10', startMinute: 7 * 60, endMinute: 9 * 60, status: 'confirmed', createdAt: created },
        { reference: 'PL-SD0008', userId: IDs.rosa, siteId: IDs.eastside, stationId: IDs.stationEast.deckOven1, date: '2026-11-13', startMinute: 8 * 60 + 45, endMinute: 10 * 60 + 30, status: 'confirmed', createdAt: created },
        { reference: 'PL-SD0009', userId: IDs.ade, siteId: IDs.eastside, stationId: IDs.stationEast.blastChiller, date: '2026-11-12', startMinute: 8 * 60 + 45, endMinute: 10 * 60 + 30, status: 'confirmed', createdAt: created },
      ],
      rates: [
        { siteId: IDs.eastside, effectiveFrom: '2026-11-09', hourlyRateCents: 5000, taxRatePercent: '10', createdAt: rateCreated1 },
        { siteId: IDs.eastside, effectiveFrom: '2026-11-11', hourlyRateCents: 6000, taxRatePercent: '12', createdAt: rateCreated2 },
      ],
      coiOverrides: {},
    };
  }
  return {
    bookings: [
      { reference: 'PL-PE0001', userId: IDs.rosa, siteId: IDs.eastside, stationId: IDs.stationEast.prepTableA, date: '2026-11-20', startMinute: 9 * 60, endMinute: 11 * 60, status: 'confirmed', createdAt: Date.parse('2026-11-01T14:00:00Z') },
      { reference: 'PL-PE0002', userId: IDs.ade, siteId: IDs.eastside, stationId: IDs.stationEast.spiralMixer, date: '2026-11-11', startMinute: 0, endMinute: 60, status: 'confirmed', createdAt: Date.parse('2026-11-01T14:00:00Z') },
      { reference: 'PL-PE0003', userId: IDs.ade, siteId: IDs.eastside, stationId: IDs.stationEast.prepTableA, date: '2026-11-11', startMinute: 0, endMinute: 60, status: 'confirmed', createdAt: Date.parse('2026-11-01T14:00:00Z') },
    ],
    rates: [],
    purchase: {
      userId: IDs.rosa,
      packId: IDs.packs.starter10,
      packName: 'Starter 10',
      quarterHours: 40,
      priceCents: 25000,
      committedAt: Date.parse('2026-09-11T16:00:00Z'),
      validThrough: '2026-11-10',
    },
    coiOverrides: { [IDs.ade]: '2026-11-10' },
  };
}

async function applySeedSet(
  client: DbClient,
  set: SeedSet,
  input: { nowMs: number; zoneInstant: (date: string, zone: string, minutes: number) => number },
): Promise<void> {
  for (const rate of set.rates) {
    await clientQuery(
      client,
      `INSERT INTO rates (id, site_id, effective_from, hourly_rate_cents, tax_rate_percent, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
      [uuid(), rate.siteId, rate.effectiveFrom, rate.hourlyRateCents, rate.taxRatePercent, rate.createdAt],
    );
  }
  for (const [userId, coi] of Object.entries(set.coiOverrides)) {
    await clientQuery(client, `UPDATE users SET coi_valid_through = $1 WHERE id = $2`, [coi, userId]);
  }
  if (set.purchase) {
    await seedPurchase(client, set.purchase);
  }
  for (const booking of set.bookings) {
    await seedBooking(client, booking, input.zoneInstant);
  }
}

/** Seed bookings confirm directly, drawing hours from the member's lots in drawing order. */
async function seedBooking(
  client: DbClient,
  booking: SeedBooking,
  zoneInstant: (date: string, zone: string, minutes: number) => number,
): Promise<void> {
  const stationRow = await clientQuery<Row>(
    client,
    `SELECT s.id, s.site_id, si.time_zone FROM stations s JOIN sites si ON si.id = s.site_id WHERE s.id = $1`,
    [booking.stationId],
  );
  const station = stationRow[0];
  const zone = String(station.time_zone);
  const startAt = zoneInstant(booking.date, zone, booking.startMinute);
  const endAt = booking.endMinute >= 1440
    ? zoneInstant(datePlusDays(booking.date, 1), zone, booking.endMinute - 1440)
    : zoneInstant(booking.date, zone, booking.endMinute);
  const quarterHours = Math.ceil((endAt - startAt) / 900000);
  const userRow = await clientQuery<Row>(
    client,
    `SELECT tenant_id, business_name FROM users WHERE id = $1`,
    [booking.userId],
  );
  const user = userRow[0];
  const bookingId = uuid();
  await clientQuery(
    client,
    `INSERT INTO bookings (id, tenant_id, site_id, station_id, member_id, series_id, reference, date,
       start_minute, end_minute, start_at, end_at, quarter_hours, status, hold_expires_at, created_at,
       checked_in_at, checked_in_by_name)
     VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, $9, $10, $11, $12, $13, NULL, $14, $15, $16)`,
    [
      bookingId,
      user.tenant_id,
      booking.siteId,
      booking.stationId,
      booking.userId,
      booking.reference,
      booking.date,
      booking.startMinute,
      booking.endMinute,
      startAt,
      endAt,
      quarterHours,
      booking.status,
      booking.createdAt,
      booking.checkedInAt ?? null,
      booking.checkedInBy ?? null,
    ],
  );
  const draws = await drawFromLots(client, booking.userId, quarterHours);
  for (const draw of draws) {
    await clientQuery(
      client,
      `INSERT INTO booking_lot_draw (booking_id, lot_id, purchase_id, quarter_hours) VALUES ($1, $2, $3, $4)`,
      [bookingId, draw.lotId, draw.purchaseId, draw.quarterHours],
    );
  }
  const actorName = await contactNameFor(client, booking.userId);
  const movementResult = await clientQuery<{ id: string }>(
    client,
    `INSERT INTO movements (tenant_id, member_id, kind, booking_id, purchase_id, quarter_hours,
       from_account, to_account, actor_user_id, actor_name, actor_role, created_at)
     VALUES ($1, $2, 'booking_debit', $3, NULL, $4, 'available', 'committed', $5, $6, 'member', $7)
     RETURNING id`,
    [
      user.tenant_id,
      booking.userId,
      bookingId,
      quarterHours,
      booking.userId,
      actorName,
      booking.createdAt,
    ],
  );
  const movementId = Number(movementResult[0].id);
  await clientQuery(
    client,
    `INSERT INTO movement_entries (movement_id, member_id, account, quarter_hours) VALUES ($1, $2, 'available', $3), ($1, $2, 'committed', $4)`,
    [movementId, booking.userId, -quarterHours, quarterHours],
  );
  for (const draw of draws) {
    await clientQuery(
      client,
      `INSERT INTO movement_lots (movement_id, lot_id, purchase_id, quarter_hours) VALUES ($1, $2, $3, $4)`,
      [movementId, draw.lotId, draw.purchaseId, draw.quarterHours],
    );
  }
}

async function contactNameFor(client: DbClient, userId: string): Promise<string> {
  const row = await clientQuery<Row>(client, `SELECT name FROM users WHERE id = $1`, [userId]);
  return String(row[0].name);
}

function datePlusDays(date: string, days: number): string {
  return new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}

async function seedPurchase(
  client: DbClient,
  purchase: NonNullable<SeedSet['purchase']>,
): Promise<void> {
  const purchaseId = uuid();
  await clientQuery(
    client,
    `INSERT INTO purchases (id, member_id, pack_id, pack_name, quarter_hours, price_cents, valid_through, killbill_payment_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8)`,
    [
      purchaseId,
      purchase.userId,
      purchase.packId,
      purchase.packName,
      purchase.quarterHours,
      purchase.priceCents,
      purchase.validThrough,
      purchase.committedAt,
    ],
  );
  await clientQuery(
    client,
    `INSERT INTO lots (member_id, purchase_id, pack_name, valid_through, remainder_qh, purchase_seq, created_at)
     VALUES ($1, $2, $3, $4, $5, 1, $6)`,
    [purchase.userId, purchaseId, purchase.packName, purchase.validThrough, purchase.quarterHours, purchase.committedAt],
  );
  const tenantRow = await clientQuery<Row>(client, `SELECT tenant_id FROM users WHERE id = $1`, [purchase.userId]);
  const tenantId = String(tenantRow[0].tenant_id);
  const movementResult = await clientQuery<{ id: string }>(
    client,
    `INSERT INTO movements (tenant_id, member_id, kind, booking_id, purchase_id, quarter_hours,
       from_account, to_account, actor_user_id, actor_name, actor_role, created_at)
     VALUES ($1, $2, 'pack_purchase', NULL, $3, $4, 'pack_sales', 'available', $5, $6, 'member', $7)
     RETURNING id`,
    [tenantId, purchase.userId, purchaseId, purchase.quarterHours, purchase.userId, 'Rosa Lindqvist', purchase.committedAt],
  );
  const movementId = Number(movementResult[0].id);
  await clientQuery(
    client,
    `INSERT INTO movement_entries (movement_id, member_id, account, quarter_hours) VALUES ($1, $2, 'pack_sales', $3), ($1, $2, 'available', $4)`,
    [movementId, purchase.userId, -purchase.quarterHours, purchase.quarterHours],
  );
  const lot = await clientQuery<{ id: string }>(
    client,
    `SELECT id FROM lots WHERE member_id = $1 AND purchase_id = $2`,
    [purchase.userId, purchaseId],
  );
  await clientQuery(
    client,
    `INSERT INTO movement_lots (movement_id, lot_id, purchase_id, quarter_hours) VALUES ($1, $2, $3, $4)`,
    [movementId, Number(lot[0].id), purchaseId, purchase.quarterHours],
  );
}
