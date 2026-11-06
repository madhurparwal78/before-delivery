import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { SCHEMA_SQL } from './schema.js';
import { hashPassword } from './services/passwords.js';
import { pool, transaction } from './db.js';

const SEED_PASSWORD = 'Sunlit-Tide-2027';

interface SeedWorkspace {
  readonly slug: string;
  readonly name: string;
}

const WORKSPACES: readonly SeedWorkspace[] = [
  { slug: 'adriatic-sunline', name: 'Adriatic Sunline Charters' },
  { slug: 'saronic-lightwater', name: 'Saronic Lightwater Yachts' },
];

interface SeedYacht {
  readonly workspace: string;
  readonly slug: string;
  readonly name: string;
  readonly base: 'split' | 'lavrio';
  readonly cabins: number;
  readonly lengthCm: number;
  readonly beamCm: number;
  readonly draftCm: number;
  readonly batteryKwh: string;
  readonly hotelKw: string;
  readonly solarKw: string;
  readonly dragKwPerKnCubed: string;
  readonly rates: readonly [number, number, number];
  readonly crew: readonly (readonly [string, string])[];
}

const YACHTS: readonly SeedYacht[] = [
  {
    workspace: 'adriatic-sunline',
    slug: 'sunwake',
    name: 'Sunwake',
    base: 'split',
    cabins: 4,
    lengthCm: 1829,
    beamCm: 904,
    draftCm: 155,
    batteryKwh: '280',
    hotelKw: '3.0',
    solarKw: '9.0',
    dragKwPerKnCubed: '0.110',
    rates: [1890000, 2450000, 3290000],
    crew: [
      ['Ivo Matic', 'captain'],
      ['Nina Horvat', 'deckhand'],
      ['Petra Juric', 'chef'],
    ],
  },
  {
    workspace: 'adriatic-sunline',
    slug: 'halcyon-drift',
    name: 'Halcyon Drift',
    base: 'split',
    cabins: 6,
    lengthCm: 2440,
    beamCm: 1120,
    draftCm: 180,
    batteryKwh: '420',
    hotelKw: '4.5',
    solarKw: '14.0',
    dragKwPerKnCubed: '0.160',
    rates: [3150000, 3980000, 5200000],
    crew: [
      ['Tomislav Rados', 'captain'],
      ['Marta Vukovic', 'stewardess'],
      ['Dario Simic', 'deckhand'],
    ],
  },
  {
    workspace: 'adriatic-sunline',
    slug: 'kelp-lantern',
    name: 'Kelp Lantern',
    base: 'lavrio',
    cabins: 4,
    lengthCm: 1615,
    beamCm: 865,
    draftCm: 135,
    batteryKwh: '240',
    hotelKw: '2.5',
    solarKw: '8.0',
    dragKwPerKnCubed: '0.095',
    rates: [1450000, 1890000, 2490000],
    crew: [
      ['Stavros Mela', 'captain'],
      ['Irini Daskalou', 'chef'],
      ['Marko Lisac', 'deckhand'],
    ],
  },
  {
    workspace: 'saronic-lightwater',
    slug: 'meltemi-glow',
    name: 'Meltemi Glow',
    base: 'lavrio',
    cabins: 5,
    lengthCm: 1965,
    beamCm: 985,
    draftCm: 160,
    batteryKwh: '300',
    hotelKw: '3.2',
    solarKw: '10.0',
    dragKwPerKnCubed: '0.120',
    rates: [2100000, 2750000, 3600000],
    crew: [
      ['Yannis Karras', 'captain'],
      ['Dimitra Lekka', 'deckhand'],
      ['Thanos Ritsos', 'chef'],
    ],
  },
  {
    workspace: 'saronic-lightwater',
    slug: 'brightwater',
    name: 'Brightwater',
    base: 'split',
    cabins: 3,
    lengthCm: 1495,
    beamCm: 795,
    draftCm: 120,
    batteryKwh: '200',
    hotelKw: '2.0',
    solarKw: '7.0',
    dragKwPerKnCubed: '0.080',
    rates: [1245000, 1590000, 2150000],
    crew: [
      ['Josip Bilic', 'captain'],
      ['Lea Grgic', 'stewardess'],
      ['Pavlos Zervas', 'deckhand'],
    ],
  },
  {
    workspace: 'saronic-lightwater',
    slug: 'salt-ember',
    name: 'Salt Ember',
    base: 'split',
    cabins: 5,
    lengthCm: 2135,
    beamCm: 1040,
    draftCm: 165,
    batteryKwh: '360',
    hotelKw: '4.0',
    solarKw: '12.0',
    dragKwPerKnCubed: '0.140',
    rates: [2600000, 3300000, 4450000],
    crew: [
      ['Kresimir Tadic', 'captain'],
      ['Vesna Bozic', 'chef'],
      ['Andreas Mavros', 'deckhand'],
    ],
  },
];

interface SeedMember {
  readonly workspace: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly yachtSlug?: string;
}

const MEMBERS: readonly SeedMember[] = [
  {
    workspace: 'adriatic-sunline',
    name: 'Mira Kovac',
    email: 'mira.kovac@adriatic-sunline.example',
    role: 'fleet_director',
  },
  {
    workspace: 'adriatic-sunline',
    name: 'Luka Babic',
    email: 'luka.babic@adriatic-sunline.example',
    role: 'charter_manager',
  },
  {
    workspace: 'adriatic-sunline',
    name: 'Ana Peric',
    email: 'ana.peric@adriatic-sunline.example',
    role: 'finance_lead',
  },
  {
    workspace: 'adriatic-sunline',
    name: 'Ivo Matic',
    email: 'ivo.matic@adriatic-sunline.example',
    role: 'captain',
  },
  {
    workspace: 'adriatic-sunline',
    name: 'Nina Horvat',
    email: 'nina.horvat@adriatic-sunline.example',
    role: 'crew_member',
    yachtSlug: 'sunwake',
  },
  {
    workspace: 'saronic-lightwater',
    name: 'Eleni Papadaki',
    email: 'eleni.papadaki@saronic-lightwater.example',
    role: 'fleet_director',
  },
  {
    workspace: 'saronic-lightwater',
    name: 'Nikos Vlachos',
    email: 'nikos.vlachos@saronic-lightwater.example',
    role: 'charter_manager',
  },
  {
    workspace: 'saronic-lightwater',
    name: 'Sofia Andreou',
    email: 'sofia.andreou@saronic-lightwater.example',
    role: 'finance_lead',
  },
  {
    workspace: 'saronic-lightwater',
    name: 'Yannis Karras',
    email: 'yannis.karras@saronic-lightwater.example',
    role: 'captain',
  },
  {
    workspace: 'saronic-lightwater',
    name: 'Dimitra Lekka',
    email: 'dimitra.lekka@saronic-lightwater.example',
    role: 'crew_member',
    yachtSlug: 'meltemi-glow',
  },
];

const ANCHORAGES: readonly (readonly [string, string, 'split' | 'lavrio', string, string])[] = [
  ['split-base', 'Split Marina', 'split', '43.5040', '16.4290'],
  ['solta-maslinica', 'Maslinica, Solta', 'split', '43.3985', '16.2060'],
  ['hvar-stari-grad', 'Stari Grad, Hvar', 'split', '43.1855', '16.5960'],
  ['pakleni-palmizana', 'Palmizana, Pakleni Islands', 'split', '43.1620', '16.3940'],
  ['vis-town', 'Vis Town', 'split', '43.0615', '16.1855'],
  ['brac-bol', 'Bol, Brac', 'split', '43.2600', '16.6550'],
  ['lavrio-base', 'Lavrio Marina', 'lavrio', '37.7150', '24.0580'],
  ['kea-vourkari', 'Vourkari, Kea', 'lavrio', '37.6670', '24.3230'],
  ['kythnos-kolona', 'Kolona, Kythnos', 'lavrio', '37.4300', '24.3950'],
  ['poros-town', 'Poros Town', 'lavrio', '37.4985', '23.4555'],
  ['aegina-port', 'Aegina Port', 'lavrio', '37.7465', '23.4275'],
  ['sounio-bay', 'Sounio Bay', 'lavrio', '37.6520', '24.0250'],
];

interface SeedMarina {
  readonly id: string;
  readonly name: string;
  readonly base: 'split' | 'lavrio';
  readonly berths: readonly (readonly [string, number, number, number])[];
  readonly pontoons: readonly (readonly [string, string])[];
  readonly tariffs: readonly (readonly [string, number])[];
}

const MARINAS: readonly SeedMarina[] = [
  {
    id: 'split-marina',
    name: 'Split Marina',
    base: 'split',
    berths: [
      ['A1', 1500, 800, 300],
      ['A2', 2000, 1000, 350],
      ['A3', 2500, 1200, 400],
      ['A4', 1829, 904, 185],
      ['A5', 1829, 904, 184],
      ['A6', 1495, 795, 150],
    ],
    pontoons: [
      ['C', '44'],
      ['D', '22'],
    ],
    tariffs: [
      ['2026-01-01', 450],
      ['2028-04-01', 520],
    ],
  },
  {
    id: 'lavrio-marina',
    name: 'Lavrio Marina',
    base: 'lavrio',
    berths: [
      ['B1', 1700, 900, 300],
      ['B2', 2200, 1100, 320],
      ['B3', 1615, 865, 165],
      ['B4', 1965, 985, 190],
    ],
    pontoons: [['P', '22']],
    tariffs: [
      ['2026-01-01', 380],
      ['2028-04-01', 430],
    ],
  },
];

const EXCHANGE_TABLES: readonly (readonly [string, string, string])[] = [
  ['2026-01-01', '0.8450', '1.0820'],
  ['2028-04-01', '0.8700', '1.1500'],
];

interface SeedBroker {
  readonly workspace: string;
  readonly id: string;
  readonly name: string;
  readonly contactName: string;
  readonly email: string;
  readonly notes: string;
}

const BROKERS: readonly SeedBroker[] = [
  {
    workspace: 'adriatic-sunline',
    id: 'bluewake',
    name: 'Bluewake Brokers',
    contactName: 'Hana Ostrova',
    email: 'desk@bluewake-brokers.example',
    notes: 'Commission 10%, pays within 14 days',
  },
  {
    workspace: 'adriatic-sunline',
    id: 'cetina',
    name: 'Cetina Yacht Partners',
    contactName: 'Rafael Oyelaran',
    email: 'charters@cetina-partners.example',
    notes: 'Commission 12%, prefers July weeks',
  },
  {
    workspace: 'saronic-lightwater',
    id: 'aegean-keel',
    name: 'Aegean Keel Agency',
    contactName: 'Clio Varga',
    email: 'hello@aegean-keel.example',
    notes: 'Commission 10%, Greek clients only',
  },
  {
    workspace: 'saronic-lightwater',
    id: 'northstar',
    name: 'Northstar Charter Desk',
    contactName: 'Bram Ellery',
    email: 'desk@northstar-charter.example',
    notes: 'Commission 11%, invoices quarterly',
  },
];

const STORE_ITEMS: readonly (readonly [string, string, string, number, number, number])[] = [
  ['Still water', 'bottles', 'drinks', 48, 12, 0],
  ['Olive oil', 'litres', 'provisions', 10, 3, 0],
  ['Lemons', 'kg', 'provisions', 8, 2, 1],
  ['Deck cleaner', 'bottles', 'cleaning', 6, 1, 0],
];

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA_SQL);
}

export async function seedIfEmpty(): Promise<void> {
  await transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(4711)');
    const existing = await client.query('SELECT 1 FROM seed_state WHERE id = 1');
    if (existing.rows.length > 0) return;
    await insertSeed(client);
    await client.query('INSERT INTO seed_state (id, seeded_at) VALUES (1, now())');
  });
}

async function insertSeed(client: PoolClient): Promise<void> {
  const now = new Date();
  const workspaceIds = new Map<string, string>();
  for (const workspace of WORKSPACES) {
    const id = randomUUID();
    workspaceIds.set(workspace.slug, id);
    await client.query('INSERT INTO workspaces (id, slug, name) VALUES ($1, $2, $3)', [
      id,
      workspace.slug,
      workspace.name,
    ]);
  }

  const yachtIds = new Map<string, string>();
  for (const [index, yacht] of YACHTS.entries()) {
    const id = randomUUID();
    yachtIds.set(`${yacht.workspace}/${yacht.slug}`, id);
    await client.query(
      `INSERT INTO yachts (id, workspace_id, slug, name, base, status, cabins, length_cm, beam_cm, draft_cm,
         battery_kwh, hotel_kw, solar_kw, drag_kw_per_kn_cubed, shore_power_kw,
         rate_low_minor, rate_shoulder_minor, rate_high_minor, currency, seed_order)
       VALUES ($1,$2,$3,$4,$5,'on_sale',$6,$7,$8,$9,$10,$11,$12,$13,'22',$14,$15,$16,'EUR',$17)`,
      [
        id,
        workspaceIds.get(yacht.workspace),
        yacht.slug,
        yacht.name,
        yacht.base,
        yacht.cabins,
        yacht.lengthCm,
        yacht.beamCm,
        yacht.draftCm,
        yacht.batteryKwh,
        yacht.hotelKw,
        yacht.solarKw,
        yacht.dragKwPerKnCubed,
        yacht.rates[0],
        yacht.rates[1],
        yacht.rates[2],
        index,
      ],
    );
    for (const [crewIndex, member] of yacht.crew.entries()) {
      await client.query(
        'INSERT INTO crew (id, yacht_id, name, position, seed_order) VALUES ($1,$2,$3,$4,$5)',
        [randomUUID(), id, member[0], member[1], crewIndex],
      );
    }
    for (const [itemName, unit, category, received, used, spoiled] of STORE_ITEMS) {
      const itemId = randomUUID();
      await client.query(
        `INSERT INTO store_items (id, workspace_id, yacht_id, name, unit, category, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [itemId, workspaceIds.get(yacht.workspace), id, itemName, unit, category, now],
      );
      for (const [kind, quantity] of [
        ['received', received],
        ['used', used],
        ['spoiled', spoiled],
      ] as const) {
        if (quantity === 0) continue;
        await client.query(
          `INSERT INTO store_movements (id, item_id, kind, quantity, logged_by_member_id, logged_by_name, logged_at)
           VALUES ($1,$2,$3,$4,NULL,'Tidewright',$5)`,
          [randomUUID(), itemId, kind, quantity, now],
        );
      }
    }
  }

  const passwordHash = await hashPassword(SEED_PASSWORD);
  for (const member of MEMBERS) {
    await client.query(
      `INSERT INTO members (id, workspace_id, name, email, password_hash, role, yacht_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        randomUUID(),
        workspaceIds.get(member.workspace),
        member.name,
        member.email,
        passwordHash,
        member.role,
        member.yachtSlug === undefined
          ? null
          : yachtIds.get(`${member.workspace}/${member.yachtSlug}`),
      ],
    );
  }

  for (const workspace of WORKSPACES) {
    const workspaceId = workspaceIds.get(workspace.slug);
    for (const [index, anchorage] of ANCHORAGES.entries()) {
      await client.query(
        `INSERT INTO anchorages (workspace_id, id, name, base, latitude, longitude, seed_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [workspaceId, anchorage[0], anchorage[1], anchorage[2], anchorage[3], anchorage[4], index],
      );
    }
    for (const [marinaIndex, marina] of MARINAS.entries()) {
      await client.query(
        'INSERT INTO marinas (workspace_id, id, name, base, seed_order) VALUES ($1,$2,$3,$4,$5)',
        [workspaceId, marina.id, marina.name, marina.base, marinaIndex],
      );
      for (const [berthIndex, berth] of marina.berths.entries()) {
        await client.query(
          `INSERT INTO berths (workspace_id, marina_id, code, length_cm, width_cm, depth_cm, seed_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [workspaceId, marina.id, berth[0], berth[1], berth[2], berth[3], berthIndex],
        );
      }
      for (const [pontoonIndex, pontoon] of marina.pontoons.entries()) {
        await client.query(
          'INSERT INTO pontoons (workspace_id, marina_id, code, limit_kw, seed_order) VALUES ($1,$2,$3,$4,$5)',
          [workspaceId, marina.id, pontoon[0], pontoon[1], pontoonIndex],
        );
      }
      for (const tariff of marina.tariffs) {
        await client.query(
          `INSERT INTO marina_tariffs (id, workspace_id, marina_id, effective_date, rate_per_metre_minor, currency)
           VALUES ($1,$2,$3,$4,$5,'EUR')`,
          [randomUUID(), workspaceId, marina.id, tariff[0], tariff[1]],
        );
      }
    }
    for (const table of EXCHANGE_TABLES) {
      await client.query(
        `INSERT INTO exchange_tables (id, workspace_id, effective_date, rate_gbp, rate_usd)
         VALUES ($1,$2,$3,$4,$5)`,
        [randomUUID(), workspaceId, table[0], table[1], table[2]],
      );
    }
  }

  for (const [index, broker] of BROKERS.entries()) {
    await client.query(
      `INSERT INTO brokers (workspace_id, id, name, contact_name, email, notes, seed_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        workspaceIds.get(broker.workspace),
        broker.id,
        broker.name,
        broker.contactName,
        broker.email,
        broker.notes,
        index,
      ],
    );
  }
}
