import type { PoolClient } from 'pg';
import { computeLuxStatus, computePlannedLuxHours } from '../domain/lux';
import { countOpenDays } from '../time';
import { schemaSql } from './schema';
import { withClient } from './pool';

export const EXHIBITION_ID = 'exh-salt';
export const RUN_START = '2027-03-06';
export const RUN_END = '2027-06-27';
export const OPEN_HOURS_PER_DAY = 7;
export const CLOSED_WEEKDAYS = [1];

export const openDays = countOpenDays(RUN_START, RUN_END, CLOSED_WEEKDAYS);
export const openHours = openDays * OPEN_HOURS_PER_DAY;

const staffSeed: [string, string, string][] = [
  ['cur-ines', 'Ines Calloway', 'curator'],
  ['reg-tomasz', 'Tomasz Adeyemi', 'registrar'],
  ['prep-ruth', 'Ruth Okonkwo-Hale', 'preparator'],
  ['prep-dev', 'Dev Malhotra', 'preparator'],
];

const lenderSeed: [string, string, string][] = [
  ['lender-harbourside', 'Harbourside Historical Society', 'loans@harbourside-history.example'],
  ['lender-oduya', 'Mirela Oduya', 'mirela.oduya@example.net'],
  ['lender-fenwick', 'Fenwick Maritime Trust', 'registrar@fenwick-trust.example'],
];

const wallSeed: [string, string, number, number, number][] = [
  ['wall-north', 'North wall', 12000, 4000, 50],
  ['wall-east', 'East wall', 6000, 4000, 50],
  ['wall-south', 'South wall', 12000, 4000, 150],
  ['wall-west', 'West wall', 6000, 4000, 150],
];

interface ObjectSeed {
  id: string;
  objectNumber: string;
  title: string;
  lenderId: string | null;
  medium: string;
  widthMm: number;
  heightMm: number;
  luxLimit: number;
  luxHourBudget: number;
  insuranceValueGbp: number;
  registrarNote: string;
}

const objectSeed: ObjectSeed[] = [
  {
    id: 'obj-herring',
    objectNumber: 'L-2027-001',
    title: 'Herring Girls at the Gutting Station',
    lenderId: 'lender-harbourside',
    medium: 'Watercolour on paper',
    widthMm: 560,
    heightMm: 380,
    luxLimit: 50,
    luxHourBudget: 50000,
    insuranceValueGbp: 18000,
    registrarNote: 'Slight foxing lower left; glazing replaced 2019.',
  },
  {
    id: 'obj-sampler',
    objectNumber: 'L-2027-002',
    title: 'Net Mending Sampler',
    lenderId: 'lender-harbourside',
    medium: 'Wool on linen',
    widthMm: 450,
    heightMm: 600,
    luxLimit: 50,
    luxHourBudget: 30000,
    insuranceValueGbp: 9500,
    registrarNote: 'Loose stitching at upper edge; do not pin.',
  },
  {
    id: 'obj-ganseys',
    objectNumber: 'L-2027-003',
    title: 'Ganseys Drying',
    lenderId: 'lender-oduya',
    medium: 'Oil on canvas',
    widthMm: 762,
    heightMm: 610,
    luxLimit: 200,
    luxHourBudget: 150000,
    insuranceValueGbp: 42000,
    registrarNote: 'Lender requires two-person handling.',
  },
  {
    id: 'obj-quilt',
    objectNumber: 'L-2027-004',
    title: 'Tide Chart Quilt',
    lenderId: 'lender-oduya',
    medium: 'Cotton patchwork',
    widthMm: 1400,
    heightMm: 1800,
    luxLimit: 50,
    luxHourBudget: 50000,
    insuranceValueGbp: 26000,
    registrarNote: 'Hang on fabric batten only.',
  },
  {
    id: 'obj-signal',
    objectNumber: 'L-2027-005',
    title: 'Signal Flag Pattern Book',
    lenderId: 'lender-fenwick',
    medium: 'Ink and watercolour on paper',
    widthMm: 280,
    heightMm: 360,
    luxLimit: 50,
    luxHourBudget: 50000,
    insuranceValueGbp: 7200,
    registrarNote: 'Open at plate 7 only.',
  },
  {
    id: 'obj-logbook',
    objectNumber: 'AS-1961-14',
    title: 'Lighthouse Log, Skerrin Point',
    lenderId: null,
    medium: 'Ink on paper',
    widthMm: 300,
    heightMm: 420,
    luxLimit: 50,
    luxHourBudget: 50000,
    insuranceValueGbp: 4000,
    registrarNote: '',
  },
  {
    id: 'obj-shore',
    objectNumber: 'AS-1974-02',
    title: 'Shore Light, Evening',
    lenderId: null,
    medium: 'Oil on board',
    widthMm: 900,
    heightMm: 700,
    luxLimit: 200,
    luxHourBudget: 150000,
    insuranceValueGbp: 31000,
    registrarNote: '',
  },
];

interface PlacementSeed {
  id: string;
  objectId: string;
  wallId: string;
  offsetMm: number;
  status: string;
  claimedBy: string | null;
}

const placementSeed: PlacementSeed[] = [
  { id: 'pl-herring', objectId: 'obj-herring', wallId: 'wall-north', offsetMm: 2000, status: 'proposed', claimedBy: null },
  { id: 'pl-ganseys', objectId: 'obj-ganseys', wallId: 'wall-south', offsetMm: 3000, status: 'proposed', claimedBy: null },
  { id: 'pl-shore', objectId: 'obj-shore', wallId: 'wall-south', offsetMm: 6000, status: 'claimed', claimedBy: 'prep-ruth' },
  { id: 'pl-logbook', objectId: 'obj-logbook', wallId: 'wall-east', offsetMm: 1500, status: 'hung', claimedBy: 'prep-dev' },
];

async function applySeed(client: PoolClient): Promise<void> {
  await client.query(
    `insert into exhibitions (id, title, museum, time_zone, run_start, run_end, open_hours_per_day, closed_weekdays)
     values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (id) do nothing`,
    [
      EXHIBITION_ID,
      'Salt and Thread',
      'Ashgrove Museum of Art',
      'Europe/London',
      RUN_START,
      RUN_END,
      OPEN_HOURS_PER_DAY,
      CLOSED_WEEKDAYS,
    ],
  );
  await client.query(
    `insert into galleries (id, exhibition_id, name) values ($1, $2, $3) on conflict (id) do nothing`,
    ['gal-east', EXHIBITION_ID, 'East Gallery'],
  );
  await client.query(`insert into event_counter (id, value) values (1, 0) on conflict (id) do nothing`);

  for (const [index, [id, name, role]] of staffSeed.entries()) {
    await client.query(
      `insert into staff (id, name, role, sort) values ($1, $2, $3, $4) on conflict (id) do nothing`,
      [id, name, role, index],
    );
  }
  for (const [index, [id, name, email]] of lenderSeed.entries()) {
    await client.query(
      `insert into lenders (id, name, email, sort) values ($1, $2, $3, $4) on conflict (id) do nothing`,
      [id, name, email, index],
    );
  }
  for (const [index, [id, name, lengthMm, heightMm, plannedLux]] of wallSeed.entries()) {
    await client.query(
      `insert into walls (id, gallery_id, name, length_mm, height_mm, planned_lux, sort)
       values ($1, 'gal-east', $2, $3, $4, $5, $6) on conflict (id) do nothing`,
      [id, name, lengthMm, heightMm, plannedLux, index],
    );
  }
  for (const object of objectSeed) {
    await client.query(
      `insert into loan_objects (id, object_number, title, medium, lender_id, width_mm, height_mm,
         lux_limit, lux_hour_budget, insurance_value_gbp, registrar_note)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) on conflict do nothing`,
      [
        object.id,
        object.objectNumber,
        object.title,
        object.medium,
        object.lenderId,
        object.widthMm,
        object.heightMm,
        object.luxLimit,
        object.luxHourBudget,
        object.insuranceValueGbp,
        object.registrarNote,
      ],
    );
  }
  for (const placement of placementSeed) {
    const object = objectSeed.find((candidate) => candidate.id === placement.objectId);
    const wall = wallSeed.find((candidate) => candidate[0] === placement.wallId);
    if (!object || !wall) continue;
    const plannedLux = wall[4];
    const plannedLuxHours = computePlannedLuxHours(plannedLux, openHours);
    const luxStatus = computeLuxStatus({
      plannedLux,
      plannedLuxHours,
      luxLimit: object.luxLimit,
      luxHourBudget: object.luxHourBudget,
    });
    await client.query(
      `insert into placements (id, object_id, wall_id, offset_mm, centre_height_mm, height_override,
         status, claimed_by, planned_lux, planned_lux_hours, lux_status, version)
       values ($1, $2, $3, $4, 1450, false, $5, $6, $7, $8, $9, 1) on conflict do nothing`,
      [
        placement.id,
        placement.objectId,
        placement.wallId,
        placement.offsetMm,
        placement.status,
        placement.claimedBy,
        plannedLux,
        plannedLuxHours,
        luxStatus,
      ],
    );
  }
}

let ready = false;

/** Creates the schema and seed idempotently; called at start and after any database outage. */
export async function ensureDatabaseReady(): Promise<void> {
  if (ready) return;
  await withClient(async (client) => {
    await client.query(schemaSql);
    await applySeed(client);
  });
  ready = true;
}

export function markDatabaseNotReady(): void {
  ready = false;
}
