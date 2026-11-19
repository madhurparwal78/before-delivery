import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import { config, type SeedSet } from './config';
import { LOCK_SEED, lock, one, pool, tx } from './db';
import { SCHEMA_SQL } from './schema';
import { createLot, drawFromLots, recordMovement, type Actor } from './domain/ledger';
import { localToInstant, wallToMinutes } from '../shared/tz';
import type { BookingStatus, DocumentType, Role, ServiceCode, StationKind } from '../shared/types';

const SEED_PASSWORD = 'pilot-light-demo';

const T1 = '10000000-0000-4000-8000-000000000001';
const T2 = '10000000-0000-4000-8000-000000000002';
const EASTSIDE = '20000000-0000-4000-8000-000000000001';
const HIGHLINE = '20000000-0000-4000-8000-000000000002';
const FERNHOLLOW = '20000000-0000-4000-8000-000000000003';

interface SeedStation {
  id: string;
  siteId: string;
  name: string;
  kind: StationKind;
}

const STATIONS: SeedStation[] = [
  { id: '30000000-0000-4000-8000-000000000001', siteId: EASTSIDE, name: 'Deck Oven 1', kind: 'oven' },
  {
    id: '30000000-0000-4000-8000-000000000002',
    siteId: EASTSIDE,
    name: 'Convection Oven 2',
    kind: 'oven',
  },
  {
    id: '30000000-0000-4000-8000-000000000003',
    siteId: EASTSIDE,
    name: 'Spiral Mixer 60 qt',
    kind: 'mixer',
  },
  {
    id: '30000000-0000-4000-8000-000000000004',
    siteId: EASTSIDE,
    name: 'Blast Chiller',
    kind: 'blast_chiller',
  },
  {
    id: '30000000-0000-4000-8000-000000000005',
    siteId: EASTSIDE,
    name: 'Prep Table A',
    kind: 'prep_table',
  },
  { id: '30000000-0000-4000-8000-000000000006', siteId: HIGHLINE, name: 'Rack Oven', kind: 'oven' },
  {
    id: '30000000-0000-4000-8000-000000000007',
    siteId: HIGHLINE,
    name: 'Planetary Mixer 40 qt',
    kind: 'mixer',
  },
  {
    id: '30000000-0000-4000-8000-000000000008',
    siteId: HIGHLINE,
    name: 'Blast Chiller H1',
    kind: 'blast_chiller',
  },
  {
    id: '30000000-0000-4000-8000-000000000009',
    siteId: HIGHLINE,
    name: 'Prep Table H',
    kind: 'prep_table',
  },
  {
    id: '30000000-0000-4000-8000-000000000010',
    siteId: FERNHOLLOW,
    name: 'Hearth Oven F1',
    kind: 'oven',
  },
  { id: '30000000-0000-4000-8000-000000000011', siteId: FERNHOLLOW, name: 'Mixer F2', kind: 'mixer' },
  {
    id: '30000000-0000-4000-8000-000000000012',
    siteId: FERNHOLLOW,
    name: 'Blast Chiller F3',
    kind: 'blast_chiller',
  },
  {
    id: '30000000-0000-4000-8000-000000000013',
    siteId: FERNHOLLOW,
    name: 'Prep Table F4',
    kind: 'prep_table',
  },
];

const USERS = {
  dana: '40000000-0000-4000-8000-000000000001',
  luis: '40000000-0000-4000-8000-000000000002',
  priya: '40000000-0000-4000-8000-000000000003',
  rosa: '40000000-0000-4000-8000-000000000004',
  ade: '40000000-0000-4000-8000-000000000005',
  theo: '40000000-0000-4000-8000-000000000006',
  hana: '40000000-0000-4000-8000-000000000007',
  ines: '40000000-0000-4000-8000-000000000008',
  marco: '40000000-0000-4000-8000-000000000009',
  rosalind: '40000000-0000-4000-8000-000000000010',
  rory: '40000000-0000-4000-8000-000000000011',
} as const;

const MEMBERS = {
  rosa: '50000000-0000-4000-8000-000000000001',
  ade: '50000000-0000-4000-8000-000000000002',
  theo: '50000000-0000-4000-8000-000000000003',
  hana: '50000000-0000-4000-8000-000000000004',
  rosalind: '50000000-0000-4000-8000-000000000005',
  rory: '50000000-0000-4000-8000-000000000006',
} as const;

const PACKS = {
  starter10: '60000000-0000-4000-8000-000000000001',
  production30: '60000000-0000-4000-8000-000000000002',
  bake20: '60000000-0000-4000-8000-000000000003',
} as const;

const TRUCKS = {
  smokeSignal: '70000000-0000-4000-8000-000000000001',
  steamEngine: '70000000-0000-4000-8000-000000000002',
} as const;

interface SeedUser {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: Role;
  siteId: string | null;
}

const SEED_USERS: SeedUser[] = [
  {
    id: USERS.dana,
    tenantId: T1,
    name: 'Dana Okafor',
    email: 'dana@copperline.example',
    role: 'kitchen_manager',
    siteId: EASTSIDE,
  },
  {
    id: USERS.luis,
    tenantId: T1,
    name: 'Luis Arrieta',
    email: 'luis@copperline.example',
    role: 'kitchen_manager',
    siteId: HIGHLINE,
  },
  {
    id: USERS.priya,
    tenantId: T1,
    name: 'Priya Raman',
    email: 'priya@copperline.example',
    role: 'finance_lead',
    siteId: null,
  },
  {
    id: USERS.rosa,
    tenantId: T1,
    name: 'Rosa Lindqvist',
    email: 'rosa@lindqvist.example',
    role: 'member',
    siteId: EASTSIDE,
  },
  {
    id: USERS.ade,
    tenantId: T1,
    name: 'Ade Okonjo',
    email: 'ade@okonjo.example',
    role: 'member',
    siteId: EASTSIDE,
  },
  {
    id: USERS.theo,
    tenantId: T1,
    name: 'Theo Mbeki',
    email: 'theo@mbekismoke.example',
    role: 'member',
    siteId: EASTSIDE,
  },
  {
    id: USERS.hana,
    tenantId: T1,
    name: 'Hana Sato',
    email: 'hana@satopatisserie.example',
    role: 'member',
    siteId: HIGHLINE,
  },
  {
    id: USERS.ines,
    tenantId: T2,
    name: 'Ines Calder',
    email: 'ines@fernhollow.example',
    role: 'kitchen_manager',
    siteId: FERNHOLLOW,
  },
  {
    id: USERS.marco,
    tenantId: T2,
    name: 'Marco Vitale',
    email: 'marco@fernhollow.example',
    role: 'finance_lead',
    siteId: null,
  },
  {
    id: USERS.rosalind,
    tenantId: T2,
    name: 'Rosalind Park',
    email: 'rosalind@parkstreetpies.example',
    role: 'member',
    siteId: FERNHOLLOW,
  },
  {
    id: USERS.rory,
    tenantId: T2,
    name: 'Rory Delacroix',
    email: 'rory@delacroix.example',
    role: 'member',
    siteId: FERNHOLLOW,
  },
];

interface SeedMember {
  id: string;
  userId: string;
  tenantId: string;
  businessName: string;
  contactName: string;
  homeSiteId: string;
  openingQuarters: number;
  validThrough: Record<DocumentType, string>;
}

const SEED_MEMBERS: SeedMember[] = [
  {
    id: MEMBERS.rosa,
    userId: USERS.rosa,
    tenantId: T1,
    businessName: 'Lindqvist Hearth Bakery',
    contactName: 'Rosa Lindqvist',
    homeSiteId: EASTSIDE,
    openingQuarters: 48,
    validThrough: {
      certificate_of_insurance: '2027-06-30',
      food_handler_certificate: '2027-08-31',
      business_licence: '2027-12-31',
    },
  },
  {
    id: MEMBERS.ade,
    userId: USERS.ade,
    tenantId: T1,
    businessName: 'Okonjo Small Batch',
    contactName: 'Ade Okonjo',
    homeSiteId: EASTSIDE,
    openingQuarters: 40,
    validThrough: {
      certificate_of_insurance: '2027-05-31',
      food_handler_certificate: '2027-05-31',
      business_licence: '2027-12-31',
    },
  },
  {
    id: MEMBERS.theo,
    userId: USERS.theo,
    tenantId: T1,
    businessName: 'Mbeki Smoke Truck',
    contactName: 'Theo Mbeki',
    homeSiteId: EASTSIDE,
    openingQuarters: 24,
    validThrough: {
      certificate_of_insurance: '2027-04-30',
      food_handler_certificate: '2027-04-30',
      business_licence: '2027-12-31',
    },
  },
  {
    id: MEMBERS.hana,
    userId: USERS.hana,
    tenantId: T1,
    businessName: 'Sato Patisserie',
    contactName: 'Hana Sato',
    homeSiteId: HIGHLINE,
    openingQuarters: 32,
    validThrough: {
      certificate_of_insurance: '2026-09-30',
      food_handler_certificate: '2027-03-31',
      business_licence: '2027-12-31',
    },
  },
  {
    id: MEMBERS.rosalind,
    userId: USERS.rosalind,
    tenantId: T2,
    businessName: 'Park Street Pies',
    contactName: 'Rosalind Park',
    homeSiteId: FERNHOLLOW,
    openingQuarters: 36,
    validThrough: {
      certificate_of_insurance: '2027-06-30',
      food_handler_certificate: '2027-06-30',
      business_licence: '2027-12-31',
    },
  },
  {
    id: MEMBERS.rory,
    userId: USERS.rory,
    tenantId: T2,
    businessName: 'Delacroix Dumpling Truck',
    contactName: 'Rory Delacroix',
    homeSiteId: FERNHOLLOW,
    openingQuarters: 20,
    validThrough: {
      certificate_of_insurance: '2027-06-30',
      food_handler_certificate: '2027-06-30',
      business_licence: '2027-12-31',
    },
  },
];

interface SeedVisit {
  truckId: string;
  tenantId: string;
  siteId: string;
  zone: string;
  arrived: [string, string];
  departed: [string, string];
  services: ServiceCode[];
  managerUserId: string;
  managerName: string;
  signature: string;
}

const SEED_VISITS: SeedVisit[] = [
  {
    truckId: TRUCKS.smokeSignal,
    tenantId: T1,
    siteId: EASTSIDE,
    zone: 'America/New_York',
    arrived: ['2026-10-20', '19:30'],
    departed: ['2026-10-20', '22:00'],
    services: ['potable_water', 'grey_water', 'cleaning'],
    managerUserId: USERS.dana,
    managerName: 'Dana Okafor',
    signature: 'Theo Mbeki',
  },
  {
    truckId: TRUCKS.smokeSignal,
    tenantId: T1,
    siteId: EASTSIDE,
    zone: 'America/New_York',
    arrived: ['2026-10-21', '20:00'],
    departed: ['2026-10-21', '21:30'],
    services: ['grey_water', 'restock'],
    managerUserId: USERS.dana,
    managerName: 'Dana Okafor',
    signature: 'Theo Mbeki',
  },
  {
    truckId: TRUCKS.smokeSignal,
    tenantId: T1,
    siteId: EASTSIDE,
    zone: 'America/New_York',
    arrived: ['2026-10-23', '06:00'],
    departed: ['2026-10-23', '07:00'],
    services: ['potable_water', 'food_storage'],
    managerUserId: USERS.dana,
    managerName: 'Dana Okafor',
    signature: 'Theo Mbeki',
  },
  {
    truckId: TRUCKS.steamEngine,
    tenantId: T2,
    siteId: FERNHOLLOW,
    zone: 'America/Los_Angeles',
    arrived: ['2026-10-22', '08:00'],
    departed: ['2026-10-22', '09:15'],
    services: ['potable_water', 'grey_water'],
    managerUserId: USERS.ines,
    managerName: 'Ines Calder',
    signature: 'Rory Delacroix',
  },
];

interface SeedBooking {
  id: string;
  reference: string;
  memberId: string;
  memberUserId: string;
  memberName: string;
  siteId: string;
  zone: string;
  stationId: string;
  date: string;
  start: string;
  end: string;
  status: BookingStatus;
  createdAt: string;
  checkedInAt?: string;
  checkedInByUserId?: string;
  checkedInByName?: string;
}

const SITE_DAY_BOOKINGS: SeedBooking[] = [
  {
    id: 'a0000000-0000-4000-8000-000000000001',
    reference: 'PL-SD0001',
    memberId: MEMBERS.rosa,
    memberUserId: USERS.rosa,
    memberName: 'Rosa Lindqvist',
    siteId: EASTSIDE,
    zone: 'America/New_York',
    stationId: '30000000-0000-4000-8000-000000000001',
    date: '2026-11-10',
    start: '09:00',
    end: '11:00',
    status: 'confirmed',
    createdAt: '2026-11-05T14:00:00.000Z',
  },
  {
    id: 'a0000000-0000-4000-8000-000000000002',
    reference: 'PL-SD0002',
    memberId: MEMBERS.ade,
    memberUserId: USERS.ade,
    memberName: 'Ade Okonjo',
    siteId: EASTSIDE,
    zone: 'America/New_York',
    stationId: '30000000-0000-4000-8000-000000000003',
    date: '2026-11-10',
    start: '08:15',
    end: '09:15',
    status: 'confirmed',
    createdAt: '2026-11-05T14:00:00.000Z',
  },
  {
    id: 'a0000000-0000-4000-8000-000000000003',
    reference: 'PL-SD0003',
    memberId: MEMBERS.ade,
    memberUserId: USERS.ade,
    memberName: 'Ade Okonjo',
    siteId: EASTSIDE,
    zone: 'America/New_York',
    stationId: '30000000-0000-4000-8000-000000000005',
    date: '2026-11-10',
    start: '06:00',
    end: '07:00',
    status: 'confirmed',
    createdAt: '2026-11-05T14:00:00.000Z',
  },
  {
    id: 'a0000000-0000-4000-8000-000000000004',
    reference: 'PL-SD0004',
    memberId: MEMBERS.theo,
    memberUserId: USERS.theo,
    memberName: 'Theo Mbeki',
    siteId: EASTSIDE,
    zone: 'America/New_York',
    stationId: '30000000-0000-4000-8000-000000000004',
    date: '2026-11-10',
    start: '06:00',
    end: '07:30',
    status: 'checked_in',
    createdAt: '2026-11-05T14:00:00.000Z',
    checkedInAt: '2026-11-10T10:50:00.000Z',
    checkedInByUserId: USERS.dana,
    checkedInByName: 'Dana Okafor',
  },
  {
    id: 'a0000000-0000-4000-8000-000000000005',
    reference: 'PL-SD0005',
    memberId: MEMBERS.theo,
    memberUserId: USERS.theo,
    memberName: 'Theo Mbeki',
    siteId: EASTSIDE,
    zone: 'America/New_York',
    stationId: '30000000-0000-4000-8000-000000000005',
    date: '2026-11-12',
    start: '10:00',
    end: '14:30',
    status: 'confirmed',
    createdAt: '2026-11-05T14:00:00.000Z',
  },
  {
    id: 'a0000000-0000-4000-8000-000000000006',
    reference: 'PL-SD0006',
    memberId: MEMBERS.rosa,
    memberUserId: USERS.rosa,
    memberName: 'Rosa Lindqvist',
    siteId: EASTSIDE,
    zone: 'America/New_York',
    stationId: '30000000-0000-4000-8000-000000000002',
    date: '2026-11-08',
    start: '21:00',
    end: '22:00',
    status: 'checked_in',
    createdAt: '2026-11-05T14:00:00.000Z',
    checkedInAt: '2026-11-09T01:50:00.000Z',
    checkedInByUserId: USERS.dana,
    checkedInByName: 'Dana Okafor',
  },
  {
    id: 'a0000000-0000-4000-8000-000000000007',
    reference: 'PL-SD0007',
    memberId: MEMBERS.hana,
    memberUserId: USERS.hana,
    memberName: 'Hana Sato',
    siteId: HIGHLINE,
    zone: 'America/Denver',
    stationId: '30000000-0000-4000-8000-000000000006',
    date: '2026-11-10',
    start: '07:00',
    end: '09:00',
    status: 'confirmed',
    createdAt: '2026-11-05T14:00:00.000Z',
  },
  {
    id: 'a0000000-0000-4000-8000-000000000008',
    reference: 'PL-SD0008',
    memberId: MEMBERS.rosa,
    memberUserId: USERS.rosa,
    memberName: 'Rosa Lindqvist',
    siteId: EASTSIDE,
    zone: 'America/New_York',
    stationId: '30000000-0000-4000-8000-000000000001',
    date: '2026-11-13',
    start: '08:45',
    end: '10:30',
    status: 'confirmed',
    createdAt: '2026-11-05T14:00:00.000Z',
  },
  {
    id: 'a0000000-0000-4000-8000-000000000009',
    reference: 'PL-SD0009',
    memberId: MEMBERS.ade,
    memberUserId: USERS.ade,
    memberName: 'Ade Okonjo',
    siteId: EASTSIDE,
    zone: 'America/New_York',
    stationId: '30000000-0000-4000-8000-000000000004',
    date: '2026-11-12',
    start: '08:45',
    end: '10:30',
    status: 'confirmed',
    createdAt: '2026-11-05T14:00:00.000Z',
  },
];

const PACK_EXPIRY_BOOKINGS: SeedBooking[] = [
  {
    id: 'a0000000-0000-4000-8000-000000000101',
    reference: 'PL-PE0001',
    memberId: MEMBERS.rosa,
    memberUserId: USERS.rosa,
    memberName: 'Rosa Lindqvist',
    siteId: EASTSIDE,
    zone: 'America/New_York',
    stationId: '30000000-0000-4000-8000-000000000005',
    date: '2026-11-20',
    start: '09:00',
    end: '11:00',
    status: 'confirmed',
    createdAt: '2026-11-01T14:00:00.000Z',
  },
  {
    id: 'a0000000-0000-4000-8000-000000000102',
    reference: 'PL-PE0002',
    memberId: MEMBERS.ade,
    memberUserId: USERS.ade,
    memberName: 'Ade Okonjo',
    siteId: EASTSIDE,
    zone: 'America/New_York',
    stationId: '30000000-0000-4000-8000-000000000003',
    date: '2026-11-11',
    start: '00:00',
    end: '01:00',
    status: 'confirmed',
    createdAt: '2026-11-01T14:00:00.000Z',
  },
  {
    id: 'a0000000-0000-4000-8000-000000000103',
    reference: 'PL-PE0003',
    memberId: MEMBERS.ade,
    memberUserId: USERS.ade,
    memberName: 'Ade Okonjo',
    siteId: EASTSIDE,
    zone: 'America/New_York',
    stationId: '30000000-0000-4000-8000-000000000005',
    date: '2026-11-11',
    start: '00:00',
    end: '01:00',
    status: 'confirmed',
    createdAt: '2026-11-01T14:00:00.000Z',
  },
];

const SANITATION_MINUTES: Record<StationKind, number> = {
  blast_chiller: 45,
  oven: 30,
  mixer: 30,
  prep_table: 15,
};

function stationKind(stationId: string): StationKind {
  const station = STATIONS.find((candidate) => candidate.id === stationId);
  if (station === undefined) throw new Error(`Unknown seeded station ${stationId}`);
  return station.kind;
}

async function insertBaseSeed(client: PoolClient): Promise<void> {
  await client.query(
    `insert into tenants (id, name, legal_name) values
       ($1,'Copperline Kitchen Collective','Copperline Kitchen Collective, Inc.'),
       ($2,'Fernhollow Food Works','Fernhollow Food Works Cooperative')`,
    [T1, T2],
  );
  await client.query(
    `insert into sites (id, tenant_id, name, time_zone, address, display_order) values
       ($1,$4,'Copperline Eastside','America/New_York','410 Foundry Row, Port Avery',1),
       ($2,$4,'Copperline Highline','America/Denver','88 Mesa Spur, Highline Junction',2),
       ($3,$5,'Fernhollow Commissary','America/Los_Angeles','7 Cedar Siding, Fernhollow',1)`,
    [EASTSIDE, HIGHLINE, FERNHOLLOW, T1, T2],
  );
  for (let index = 0; index < STATIONS.length; index += 1) {
    const station = STATIONS[index] as SeedStation;
    await client.query(
      `insert into stations (id, tenant_id, site_id, name, kind, display_order)
       values ($1,$2,$3,$4,$5,$6)`,
      [
        station.id,
        station.siteId === FERNHOLLOW ? T2 : T1,
        station.siteId,
        station.name,
        station.kind,
        index,
      ],
    );
  }
  await client.query(
    `insert into rates (id, tenant_id, site_id, effective_from, hourly_rate_cents, tax_rate_percent, created_at) values
       ($1,$7,$4,'2026-01-01',4250,'8.875','2025-12-01T00:00:00.000Z'),
       ($2,$7,$5,'2026-01-01',3800,'7.65','2025-12-01T00:00:00.000Z'),
       ($3,$8,$6,'2026-01-01',4500,'9.25','2025-12-01T00:00:00.000Z')`,
    [
      '80000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000002',
      '80000000-0000-4000-8000-000000000003',
      EASTSIDE,
      HIGHLINE,
      FERNHOLLOW,
      T1,
      T2,
    ],
  );
  await client.query(
    `insert into packs (id, tenant_id, name, quarters, price_cents, display_order) values
       ($1,$4,'Starter 10',40,25000,1),
       ($2,$4,'Production 30',120,66000,2),
       ($3,$5,'Bake 20',80,46000,1)`,
    [PACKS.starter10, PACKS.production30, PACKS.bake20, T1, T2],
  );

  for (const user of SEED_USERS) {
    const hash = await bcrypt.hash(SEED_PASSWORD, 10);
    await client.query(
      `insert into users (id, tenant_id, name, email, email_lower, password_hash, role, site_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        user.id,
        user.tenantId,
        user.name,
        user.email,
        user.email.toLowerCase(),
        hash,
        user.role,
        user.siteId,
      ],
    );
  }

  for (const member of SEED_MEMBERS) {
    await client.query(
      `insert into members (id, user_id, tenant_id, business_name, contact_name, home_site_id,
         seeded_certificate_of_insurance, seeded_food_handler_certificate, seeded_business_licence)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        member.id,
        member.userId,
        member.tenantId,
        member.businessName,
        member.contactName,
        member.homeSiteId,
        member.validThrough.certificate_of_insurance,
        member.validThrough.food_handler_certificate,
        member.validThrough.business_licence,
      ],
    );
    const openedAtMs = Date.parse('2026-01-01T00:00:00.000Z');
    const lotId = await createLot(client, {
      memberId: member.id,
      purchaseId: null,
      packName: 'Opening balance',
      validThrough: null,
      createdAtMs: openedAtMs,
    });
    await recordMovement(client, {
      tenantId: member.tenantId,
      memberId: member.id,
      kind: 'opening_balance',
      quarters: member.openingQuarters,
      createdAtMs: openedAtMs,
      actor: null,
      lots: [{ lotId, quarters: member.openingQuarters }],
    });
  }

  await client.query(
    `insert into trucks (id, tenant_id, member_id, site_id, name, permit_number) values
       ($1,$3,$5,$7,'Smoke Signal','MFU-2291'),
       ($2,$4,$6,$8,'Steam Engine','MFU-8820')`,
    [
      TRUCKS.smokeSignal,
      TRUCKS.steamEngine,
      T1,
      T2,
      MEMBERS.theo,
      MEMBERS.rory,
      EASTSIDE,
      FERNHOLLOW,
    ],
  );

  for (const visit of SEED_VISITS) {
    const arrivedAt = localToInstant(
      visit.zone,
      visit.arrived[0],
      wallToMinutes(visit.arrived[1]) ?? 0,
    );
    const departedAt = localToInstant(
      visit.zone,
      visit.departed[0],
      wallToMinutes(visit.departed[1]) ?? 0,
    );
    await client.query(
      `insert into visits (id, tenant_id, truck_id, site_id, arrived_at, departed_at, services,
         operator_signature, manager_user_id, manager_name, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$5)`,
      [
        randomUUID(),
        visit.tenantId,
        visit.truckId,
        visit.siteId,
        new Date(arrivedAt).toISOString(),
        new Date(departedAt).toISOString(),
        visit.services,
        visit.signature,
        visit.managerUserId,
        visit.managerName,
      ],
    );
  }
}

async function insertSeedBooking(client: PoolClient, booking: SeedBooking): Promise<void> {
  const startMinutes = wallToMinutes(booking.start) ?? 0;
  const endMinutes = wallToMinutes(booking.end) ?? 0;
  const startAt = localToInstant(booking.zone, booking.date, startMinutes);
  const endAt = localToInstant(booking.zone, booking.date, endMinutes);
  const quarters = Math.round((endAt - startAt) / 900000);
  const buffer = SANITATION_MINUTES[stationKind(booking.stationId)];
  const createdAtMs = Date.parse(booking.createdAt);
  const member = SEED_MEMBERS.find((candidate) => candidate.id === booking.memberId) as SeedMember;
  await client.query(
    `insert into bookings (id, tenant_id, site_id, station_id, member_id, reference, booking_date,
       start_minutes, end_minutes, start_at, end_at, occupied_end_at, quarters, status,
       hold_expires_at, series_id, checked_in_at, checked_in_by_user_id, checked_in_by_name, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,null,null,$15,$16,$17,$18)`,
    [
      booking.id,
      member.tenantId,
      booking.siteId,
      booking.stationId,
      booking.memberId,
      booking.reference,
      booking.date,
      startMinutes,
      endMinutes,
      new Date(startAt).toISOString(),
      new Date(endAt).toISOString(),
      new Date(endAt + buffer * 60000).toISOString(),
      quarters,
      booking.status,
      booking.checkedInAt ?? null,
      booking.checkedInByUserId ?? null,
      booking.checkedInByName ?? null,
      booking.createdAt,
    ],
  );
  const homeZone = member.homeSiteId === HIGHLINE ? 'America/Denver' : 'America/New_York';
  const allocations = await drawFromLots(
    client,
    booking.memberId,
    homeZone,
    createdAtMs,
    quarters,
  );
  if (allocations === null) throw new Error(`Seeded booking ${booking.reference} has too few hours`);
  const actor: Actor = {
    userId: booking.memberUserId,
    name: booking.memberName,
    role: 'member',
  };
  await recordMovement(client, {
    tenantId: member.tenantId,
    memberId: booking.memberId,
    kind: 'booking_debit',
    quarters,
    createdAtMs,
    actor,
    bookingId: booking.id,
    lots: allocations,
  });
}

async function insertSiteDaySet(client: PoolClient): Promise<void> {
  await client.query(
    `insert into rates (id, tenant_id, site_id, effective_from, hourly_rate_cents, tax_rate_percent, created_at) values
       ($1,$3,$4,'2026-11-09',5000,'10','2026-11-07T15:00:00.000Z'),
       ($2,$3,$4,'2026-11-11',6000,'12','2026-11-07T15:05:00.000Z')`,
    [
      '80000000-0000-4000-8000-000000000011',
      '80000000-0000-4000-8000-000000000012',
      T1,
      EASTSIDE,
    ],
  );
  for (const booking of SITE_DAY_BOOKINGS) {
    await insertSeedBooking(client, booking);
  }
}

async function insertPackExpirySet(client: PoolClient): Promise<void> {
  await client.query(
    `update members set seeded_certificate_of_insurance = '2026-11-10' where id = $1`,
    [MEMBERS.ade],
  );
  const purchaseId = 'b0000000-0000-4000-8000-000000000001';
  const purchasedAt = '2026-09-11T16:00:00.000Z';
  await client.query(
    `insert into pack_purchases (id, tenant_id, member_id, pack_id, pack_name, quarters,
       price_cents, valid_through, killbill_payment_id, created_at)
     values ($1,$2,$3,$4,'Starter 10',40,25000,'2026-11-10',null,$5)`,
    [purchaseId, T1, MEMBERS.rosa, PACKS.starter10, purchasedAt],
  );
  const lotId = await createLot(client, {
    memberId: MEMBERS.rosa,
    purchaseId,
    packName: 'Starter 10',
    validThrough: '2026-11-10',
    createdAtMs: Date.parse(purchasedAt),
  });
  await recordMovement(client, {
    tenantId: T1,
    memberId: MEMBERS.rosa,
    kind: 'pack_purchase',
    quarters: 40,
    createdAtMs: Date.parse(purchasedAt),
    actor: { userId: USERS.rosa, name: 'Rosa Lindqvist', role: 'member' },
    purchaseId,
    lots: [{ lotId, quarters: 40 }],
  });
  for (const booking of PACK_EXPIRY_BOOKINGS) {
    await insertSeedBooking(client, booking);
  }
}

async function insertSeedSet(client: PoolClient, seedSet: SeedSet): Promise<void> {
  if (seedSet === 'site-day') await insertSiteDaySet(client);
  if (seedSet === 'pack-expiry') await insertPackExpirySet(client);
}

let ready = false;

export function isReady(): boolean {
  return ready;
}

/** Creates any missing schema and, on an empty database, inserts the seed. */
export async function ensureSchemaAndSeed(): Promise<void> {
  await pool.query(SCHEMA_SQL);
  await tx(async (client) => {
    await lock(client, LOCK_SEED, 'pilotlight-seed');
    const existing = await one<{ count: string }>(client, 'select count(*) as count from tenants');
    if (Number(existing?.count ?? 0) > 0) return;
    await insertBaseSeed(client);
    await insertSeedSet(client, config.seedSet);
    await client.query(
      `insert into seed_state (id, seed_set, seeded_at) values (1, $1, now())
       on conflict (id) do nothing`,
      [config.seedSet],
    );
  });
  ready = true;
}
