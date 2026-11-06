import { randomUUID } from 'node:crypto';
import { BAY_PLAN } from '../shared/bays';
import { stageOrder, type StageName } from '../shared/stages';
import type { BayClass, LineKind, Role } from '../shared/types';
import type { PanelId } from '../shared/panels';
import { withTransaction, type Tx } from './db';
import { hashPassword } from './passwords';

const SEED_PASSWORD = 'lacquer-demo-2026';
const DAY = 86_400_000;

interface SeedUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

const USERS: SeedUser[] = [
  { id: 'u-ines', name: 'Ines Varga', email: 'ines@marrowlark.test', role: 'concierge' },
  { id: 'u-tomas', name: 'Tomas Riedl', email: 'tomas@marrowlark.test', role: 'care_technician' },
  { id: 'u-luca', name: 'Luca Marent', email: 'luca@marrowlark.test', role: 'care_technician' },
  { id: 'u-odile', name: 'Odile Fenner', email: 'odile@marrowlark.test', role: 'workshop_lead' },
  { id: 'u-rafael', name: 'Rafael Amsel', email: 'rafael@marrowlark.test', role: 'house_manager' },
  {
    id: 'u-henrietta',
    name: 'Henrietta Calloway',
    email: 'henrietta@owners.test',
    role: 'owner',
  },
  { id: 'u-kenji', name: 'Kenji Arlow', email: 'kenji@owners.test', role: 'owner' },
];

interface SeedBay {
  code: string;
  class: BayClass;
  length_mm: number;
  width_mm: number;
  row: number;
  column: number;
  car: string | null;
}

const BAYS: SeedBay[] = [
  { code: 'A1', class: 'standard', length_mm: 5200, width_mm: 2500, row: 1, column: 1, car: 'c-911rs' },
  { code: 'A2', class: 'standard', length_mm: 5200, width_mm: 2500, row: 1, column: 2, car: null },
  { code: 'A3', class: 'standard', length_mm: 5200, width_mm: 2500, row: 1, column: 3, car: null },
  { code: 'A4', class: 'standard', length_mm: 4600, width_mm: 2300, row: 1, column: 4, car: null },
  {
    code: 'B1',
    class: 'covered_lift',
    length_mm: 5600,
    width_mm: 2700,
    row: 2,
    column: 1,
    car: 'c-etype',
  },
  {
    code: 'B2',
    class: 'covered_lift',
    length_mm: 5600,
    width_mm: 2700,
    row: 2,
    column: 2,
    car: 'c-300sl',
  },
  {
    code: 'C1',
    class: 'sealed_capsule',
    length_mm: 5800,
    width_mm: 2800,
    row: 3,
    column: 1,
    car: 'c-testarossa',
  },
  {
    code: 'C2',
    class: 'sealed_capsule',
    length_mm: 5000,
    width_mm: 2400,
    row: 3,
    column: 2,
    car: null,
  },
];

interface SeedCar {
  id: string;
  owner_id: string;
  year: number;
  make: string;
  model: string;
  registration: string;
  colour: string;
  length_mm: number;
  width_mm: number;
  odometer_km: number;
  tyre_spec_bar: string;
  startup_scheduled: boolean;
  bay: string | null;
  lastStartupDaysAgo: number | null;
}

const CARS: SeedCar[] = [
  {
    id: 'c-etype',
    owner_id: 'u-henrietta',
    year: 1967,
    make: 'Jaguar',
    model: 'E-Type',
    registration: 'ZH 41967',
    colour: 'Opalescent Silver Grey',
    length_mm: 4450,
    width_mm: 1660,
    odometer_km: 48210,
    tyre_spec_bar: '2.20',
    startup_scheduled: true,
    bay: 'B1',
    lastStartupDaysAgo: 31,
  },
  {
    id: 'c-911rs',
    owner_id: 'u-henrietta',
    year: 1973,
    make: 'Porsche',
    model: '911 Carrera RS 2.7',
    registration: 'ZH 27373',
    colour: 'Grand Prix White',
    length_mm: 4147,
    width_mm: 1652,
    odometer_km: 61377,
    tyre_spec_bar: '2.00',
    startup_scheduled: true,
    bay: 'A1',
    lastStartupDaysAgo: 3,
  },
  {
    id: 'c-testarossa',
    owner_id: 'u-kenji',
    year: 1989,
    make: 'Ferrari',
    model: 'Testarossa',
    registration: 'GE 19890',
    colour: 'Rosso Corsa',
    length_mm: 4485,
    width_mm: 1976,
    odometer_km: 23904,
    tyre_spec_bar: '2.40',
    startup_scheduled: true,
    bay: 'C1',
    lastStartupDaysAgo: 10,
  },
  {
    id: 'c-300sl',
    owner_id: 'u-kenji',
    year: 1962,
    make: 'Mercedes-Benz',
    model: '300 SL Roadster',
    registration: 'BE 30062',
    colour: 'Silver Blue',
    length_mm: 4570,
    width_mm: 1790,
    odometer_km: 87650,
    tyre_spec_bar: '2.10',
    startup_scheduled: false,
    bay: 'B2',
    lastStartupDaysAgo: null,
  },
  {
    id: 'c-fulvia',
    owner_id: 'u-kenji',
    year: 1971,
    make: 'Lancia',
    model: 'Fulvia Coupé',
    registration: 'TI 19710',
    colour: 'Blu Lancia',
    length_mm: 3975,
    width_mm: 1555,
    odometer_km: 112045,
    tyre_spec_bar: '1.80',
    startup_scheduled: true,
    bay: null,
    lastStartupDaysAgo: null,
  },
];

const ITEMS: { id: string; car: string; kind: string; label: string; count: number }[] = [
  { id: 'b-etype-keys', car: 'c-etype', kind: 'key_set', label: 'Key sets', count: 2 },
  { id: 'b-etype-cover', car: 'c-etype', kind: 'cover', label: 'Indoor cover', count: 1 },
  { id: 'b-etype-wheel', car: 'c-etype', kind: 'spare_wheel', label: 'Wire spare wheel', count: 1 },
  { id: 'b-etype-cert', car: 'c-etype', kind: 'document', label: 'Heritage certificate', count: 1 },
  { id: 'b-911rs-keys', car: 'c-911rs', kind: 'key_set', label: 'Key sets', count: 2 },
  { id: 'b-911rs-cover', car: 'c-911rs', kind: 'cover', label: 'Indoor cover', count: 1 },
  { id: 'b-testarossa-keys', car: 'c-testarossa', kind: 'key_set', label: 'Key sets', count: 2 },
  { id: 'b-testarossa-cover', car: 'c-testarossa', kind: 'cover', label: 'Indoor cover', count: 1 },
  { id: 'b-testarossa-book', car: 'c-testarossa', kind: 'document', label: 'Service book', count: 1 },
  { id: 'b-300sl-keys', car: 'c-300sl', kind: 'key_set', label: 'Key sets', count: 1 },
  { id: 'b-300sl-cover', car: 'c-300sl', kind: 'cover', label: 'Indoor cover', count: 1 },
];

interface SeedJob {
  id: string;
  number: string;
  car: string;
  owner: string;
  title: string;
  status: string;
  sentDaysAgo: number | null;
  approvedDaysAgo: number | null;
  finishedDaysAgo: number | null;
}

const JOBS: SeedJob[] = [
  {
    id: 'j-1001',
    number: 'J-1001',
    car: 'c-911rs',
    owner: 'u-henrietta',
    title: 'Bonnet and front wings respray',
    status: 'in_progress',
    sentDaysAgo: 22,
    approvedDaysAgo: 20,
    finishedDaysAgo: null,
  },
  {
    id: 'j-1002',
    number: 'J-1002',
    car: 'c-testarossa',
    owner: 'u-kenji',
    title: 'Front valance stone-chip repair',
    status: 'sent',
    sentDaysAgo: 2,
    approvedDaysAgo: null,
    finishedDaysAgo: null,
  },
  {
    id: 'j-1003',
    number: 'J-1003',
    car: 'c-300sl',
    owner: 'u-kenji',
    title: 'Sill touch-in',
    status: 'finished',
    sentDaysAgo: 14,
    approvedDaysAgo: 13,
    finishedDaysAgo: 4,
  },
  {
    id: 'j-1004',
    number: 'J-1004',
    car: 'c-etype',
    owner: 'u-henrietta',
    title: 'Boot floor inspection',
    status: 'draft',
    sentDaysAgo: null,
    approvedDaysAgo: null,
    finishedDaysAgo: null,
  },
];

const JOB_LINES: {
  job: string;
  kind: LineKind;
  description: string;
  quantity: string;
  unit_price: string;
}[] = [
  { job: 'j-1001', kind: 'part', description: 'Bonnet hinge bushes', quantity: '2.00', unit_price: '37.45' },
  {
    job: 'j-1001',
    kind: 'labour',
    description: 'Strip, prime and paint bonnet and front wings',
    quantity: '26.50',
    unit_price: '145.00',
  },
  {
    job: 'j-1001',
    kind: 'paint_materials',
    description: 'Primer, base and clear',
    quantity: '1.00',
    unit_price: '218.30',
  },
  {
    job: 'j-1002',
    kind: 'labour',
    description: 'Fill, flat and blend front valance chips',
    quantity: '3.25',
    unit_price: '145.00',
  },
  {
    job: 'j-1002',
    kind: 'paint_materials',
    description: 'Touch-up primer and base',
    quantity: '1.00',
    unit_price: '64.80',
  },
  { job: 'j-1003', kind: 'part', description: 'Touch-in kit', quantity: '1.00', unit_price: '12.90' },
  {
    job: 'j-1003',
    kind: 'labour',
    description: 'Flat and touch in sill chips',
    quantity: '1.75',
    unit_price: '145.00',
  },
  {
    job: 'j-1003',
    kind: 'paint_materials',
    description: 'Base and clear',
    quantity: '1.00',
    unit_price: '38.40',
  },
  {
    job: 'j-1004',
    kind: 'labour',
    description: 'Lift boot floor mat and inspect for corrosion',
    quantity: '2.00',
    unit_price: '145.00',
  },
];

type ReadingRow = { panel: PanelId; values: (number | null)[] };

/** J-1001 readings at Intake, Stripped, Epoxy primer, 2K primer and Base. */
const J1001_STAGES: StageName[] = ['Intake', 'Stripped', 'Epoxy primer', '2K primer', 'Base'];
const J1001_READINGS: ReadingRow[] = [
  { panel: 'front_valance', values: [112, null, null, null, null] },
  { panel: 'bonnet', values: [142, 0, 48, 132, 158] },
  { panel: 'front_wing_l', values: [268, 0, 51, 140, 166] },
  { panel: 'front_wing_r', values: [335, 0, 50, 138, 163] },
  { panel: 'door_l', values: [118, null, null, null, null] },
  { panel: 'door_r', values: [121, null, null, null, null] },
  { panel: 'sill_l', values: [96, null, null, null, null] },
  { panel: 'sill_r', values: [74, null, null, null, null] },
  { panel: 'roof', values: [131, null, null, null, null] },
  { panel: 'rear_quarter_l', values: [127, null, null, null, null] },
  { panel: 'rear_quarter_r', values: [124, null, null, null, null] },
  { panel: 'boot_lid', values: [138, null, null, null, null] },
];

const J1003_INTAKE: { panel: PanelId; value: number }[] = [
  { panel: 'front_valance', value: 104 },
  { panel: 'bonnet', value: 118 },
  { panel: 'front_wing_l', value: 121 },
  { panel: 'front_wing_r', value: 117 },
  { panel: 'door_l', value: 112 },
  { panel: 'door_r', value: 115 },
  { panel: 'sill_l', value: 212 },
  { panel: 'sill_r', value: 109 },
  { panel: 'roof', value: 120 },
  { panel: 'rear_quarter_l', value: 116 },
  { panel: 'rear_quarter_r', value: 119 },
  { panel: 'boot_lid', value: 122 },
];

export async function seedIfEmpty(): Promise<void> {
  const passwordHash = await hashPassword(SEED_PASSWORD);
  await withTransaction(async (tx) => {
    await tx.lock('seed');
    const existing = await tx.queryOne<{ count: string }>('select count(*)::text as count from users');
    if (existing !== null && existing.count !== '0') return;
    await writeSeed(tx, passwordHash);
  });
}

async function writeSeed(tx: Tx, passwordHash: string): Promise<void> {
  const firstStart = Date.now();
  const at = (daysAgo: number): Date => new Date(firstStart - daysAgo * DAY);

  for (const user of USERS) {
    await tx.query(
      'insert into users (id, name, email, role, password_hash) values ($1,$2,$3,$4,$5)',
      [user.id, user.name, user.email, user.role, passwordHash],
    );
  }

  for (const bay of BAYS) {
    await tx.query(
      'insert into bays (id, code, class, length_mm, width_mm, row_index, column_index) values ($1,$2,$3,$4,$5,$6,$7)',
      [bay.code, bay.code, bay.class, bay.length_mm, bay.width_mm, bay.row, bay.column],
    );
  }

  for (const car of CARS) {
    const stored = car.bay !== null;
    await tx.query(
      `insert into cars (id, owner_id, year, make, model, registration, colour, length_mm, width_mm,
        odometer_km, tyre_spec_bar, startup_scheduled, status, bay_id, stay_seq, intake_at, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        car.id,
        car.owner_id,
        car.year,
        car.make,
        car.model,
        car.registration,
        car.colour,
        car.length_mm,
        car.width_mm,
        car.odometer_km,
        car.tyre_spec_bar,
        car.startup_scheduled,
        stored ? 'stored' : 'awaiting_intake',
        car.bay,
        stored ? 1 : 0,
        stored ? at(60) : null,
        at(60),
      ],
    );
    if (stored) {
      const bay = BAYS.find((candidate) => candidate.code === car.bay);
      if (bay === undefined) throw new Error(`Seed bay ${String(car.bay)} is missing`);
      await tx.query(
        'insert into subscriptions (car_id, owner_id, plan, created_at) values ($1,$2,$3,$4)',
        [car.id, car.owner_id, BAY_PLAN[bay.class].plan, at(60)],
      );
      await tx.query(
        "insert into queue (kind, car_id, payload, created_at) values ('subscription_create',$1,$2,$3)",
        [car.id, JSON.stringify({ car_id: car.id }), at(60)],
      );
    }
    if (car.lastStartupDaysAgo !== null) {
      await tx.query(
        `insert into care_entries (id, car_id, at, by_user, started, note, flags)
         values ($1,$2,$3,'u-tomas',true,'','{}')`,
        [randomUUID(), car.id, at(car.lastStartupDaysAgo)],
      );
    }
  }

  for (const item of ITEMS) {
    await tx.query(
      'insert into belongings (id, car_id, kind, label, created_at) values ($1,$2,$3,$4,$5)',
      [item.id, item.car, item.kind, item.label, at(60)],
    );
    await tx.query(
      "insert into movements (id, item_id, direction, count, at, by_user) values ($1,$2,'in',$3,$4,'u-ines')",
      [randomUUID(), item.id, item.count, at(60)],
    );
  }

  for (const job of JOBS) {
    const sentAt = job.sentDaysAgo === null ? null : at(job.sentDaysAgo);
    const expiresAt = sentAt === null ? null : new Date(sentAt.getTime() + 14 * DAY);
    await tx.query(
      `insert into jobs (id, number, car_id, owner_id, title, status, version, sent_at, expires_at,
        approved_at, finished_at, created_at)
       values ($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10,$11)`,
      [
        job.id,
        job.number,
        job.car,
        job.owner,
        job.title,
        job.status,
        sentAt,
        expiresAt,
        job.approvedDaysAgo === null ? null : at(job.approvedDaysAgo),
        job.finishedDaysAgo === null ? null : at(job.finishedDaysAgo),
        at(25),
      ],
    );
  }

  const positions = new Map<string, number>();
  for (const line of JOB_LINES) {
    const position = (positions.get(line.job) ?? 0) + 1;
    positions.set(line.job, position);
    await tx.query(
      'insert into job_lines (id, job_id, position, kind, description, quantity, unit_price) values ($1,$2,$3,$4,$5,$6,$7)',
      [randomUUID(), line.job, position, line.kind, line.description, line.quantity, line.unit_price],
    );
  }

  for (const [index, stageName] of J1001_STAGES.entries()) {
    const loggedAt = at(6 - index);
    const stageId = randomUUID();
    await tx.query(
      'insert into job_stages (id, job_id, name, stage_order, logged_at, logged_by) values ($1,$2,$3,$4,$5,$6)',
      [stageId, 'j-1001', stageName, stageOrder(stageName), loggedAt, 'u-odile'],
    );
    for (const row of J1001_READINGS) {
      const value = row.values[index];
      if (value === null || value === undefined) continue;
      await tx.query(
        'insert into readings (id, job_id, stage_id, panel, film_um, logged_at, logged_by) values ($1,$2,$3,$4,$5,$6,$7)',
        [randomUUID(), 'j-1001', stageId, row.panel, value, loggedAt, 'u-odile'],
      );
    }
  }

  const intakeStageId = randomUUID();
  await tx.query(
    'insert into job_stages (id, job_id, name, stage_order, logged_at, logged_by) values ($1,$2,$3,$4,$5,$6)',
    [intakeStageId, 'j-1003', 'Intake', stageOrder('Intake'), at(12), 'u-odile'],
  );
  for (const reading of J1003_INTAKE) {
    await tx.query(
      'insert into readings (id, job_id, stage_id, panel, film_um, logged_at, logged_by) values ($1,$2,$3,$4,$5,$6,$7)',
      [randomUUID(), 'j-1003', intakeStageId, reading.panel, reading.value, at(12), 'u-odile'],
    );
  }
  const clearStageId = randomUUID();
  await tx.query(
    'insert into job_stages (id, job_id, name, stage_order, logged_at, logged_by) values ($1,$2,$3,$4,$5,$6)',
    [clearStageId, 'j-1003', 'Clear', stageOrder('Clear'), at(5), 'u-odile'],
  );
  await tx.query(
    'insert into readings (id, job_id, stage_id, panel, film_um, logged_at, logged_by) values ($1,$2,$3,$4,$5,$6,$7)',
    [randomUUID(), 'j-1003', clearStageId, 'sill_l', 236, at(5), 'u-odile'],
  );

  await tx.query("insert into counters (name, value) values ('job_number', 1004)");
}
