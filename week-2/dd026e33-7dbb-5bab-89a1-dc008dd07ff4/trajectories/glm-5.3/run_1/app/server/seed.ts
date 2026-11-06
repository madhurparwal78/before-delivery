import type { Db } from './db.ts';
import { hashPassword } from './password.ts';
import { lineNetMinor, lineVatMinor, computeTotals, fromMinor } from '../shared/money.ts';

export const SEED_PASSWORD = 'lacquer-demo-2026';

const DAY = 24 * 3600 * 1000;

interface SeedLine {
  kind: 'part' | 'labour' | 'paint_materials';
  description: string;
  quantity: string;
  unit_price: string;
}

export async function seedIfEmpty(db: Db, env: import('./env.ts').Env): Promise<void> {
  await db.withTx(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', ['seed', 'seed']);
    const existing = await tx.query<{ count: string }>('SELECT count(*)::text AS count FROM users');
    if (Number(existing.rows[0]?.count ?? '0') > 0) return;
    await seed(db, tx, env, Date.now());
  });
}

export async function seed(db: Db, tx: import('./db.ts').Tx, env: import('./env.ts').Env, firstStartMs: number): Promise<void> {
  const at = (daysAgo: number): string => new Date(firstStartMs - daysAgo * DAY).toISOString();

  const expiresAt = (daysAgo: number): string =>
    new Date(firstStartMs + (env.timers.estimateExpirySeconds * 1000) - daysAgo * DAY).toISOString();

  const password = hashPassword(SEED_PASSWORD);
  const users: [string, string, string, string][] = [
    ['u-ines', 'Ines Varga', 'ines@marrowlark.test', 'concierge'],
    ['u-tomas', 'Tomas Riedl', 'tomas@marrowlark.test', 'care_technician'],
    ['u-luca', 'Luca Marent', 'luca@marrowlark.test', 'care_technician'],
    ['u-odile', 'Odile Fenner', 'odile@marrowlark.test', 'workshop_lead'],
    ['u-rafael', 'Rafael Amsel', 'rafael@marrowlark.test', 'house_manager'],
    ['u-henrietta', 'Henrietta Calloway', 'henrietta@owners.test', 'owner'],
    ['u-kenji', 'Kenji Arlow', 'kenji@owners.test', 'owner'],
  ];
  for (const [id, name, email, role] of users) {
    await tx.query(
      `INSERT INTO users (id, name, email, password_hash, role, active) VALUES ($1,$2,$3,$4,$5,TRUE)
       ON CONFLICT (id) DO NOTHING`,
      [id, name, email, password, role],
    );
    if (role === 'owner') {
      await tx.query('INSERT INTO owners (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
    }
  }

  const bays: [string, string, string, number, number, number, number][] = [
    ['A1', 'A1', 'standard', 5200, 2500, 1, 1],
    ['A2', 'A2', 'standard', 5200, 2500, 1, 2],
    ['A3', 'A3', 'standard', 5200, 2500, 1, 3],
    ['A4', 'A4', 'standard', 4600, 2300, 1, 4],
    ['B1', 'B1', 'covered_lift', 5600, 2700, 2, 1],
    ['B2', 'B2', 'covered_lift', 5600, 2700, 2, 2],
    ['C1', 'C1', 'sealed_capsule', 5800, 2800, 3, 1],
    ['C2', 'C2', 'sealed_capsule', 5000, 2400, 3, 2],
  ];
  for (const [id, code, klass, length, width, row, column] of bays) {
    await tx.query(
      `INSERT INTO bays (id, code, class, length_mm, width_mm, row_index, column_index)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
      [id, code, klass, length, width, row, column],
    );
  }

  const intakeAt = at(60);
  const cars: [string, string, number, string, string, string, string, number, number, number, string, boolean, string, string | null, string | null, string | null][] = [
    ['c-etype', 'u-henrietta', 1967, 'Jaguar', 'E-Type', 'ZH 41967', 'Opalescent Silver Grey', 4450, 1660, 48210, '2.20', true, 'stored', 'B1', intakeAt, intakeAt],
    ['c-911rs', 'u-henrietta', 1973, 'Porsche', '911 Carrera RS 2.7', 'ZH 27373', 'Grand Prix White', 4147, 1652, 61377, '2.00', true, 'stored', 'A1', intakeAt, intakeAt],
    ['c-testarossa', 'u-kenji', 1989, 'Ferrari', 'Testarossa', 'GE 19890', 'Rosso Corsa', 4485, 1976, 23904, '2.40', true, 'stored', 'C1', intakeAt, intakeAt],
    ['c-300sl', 'u-kenji', 1962, 'Mercedes-Benz', '300 SL Roadster', 'BE 30062', 'Silver Blue', 4570, 1790, 87650, '2.10', false, 'stored', 'B2', intakeAt, intakeAt],
    ['c-fulvia', 'u-kenji', 1971, 'Lancia', 'Fulvia Coupé', 'TI 19710', 'Blu Lancia', 3975, 1555, 112045, '1.80', true, 'awaiting_intake', null, null, intakeAt],
  ];
  for (const [id, owner, year, make, model, registration, colour, length, width, odo, tyre, scheduled, status, bayId, intake, createdAt] of cars) {
    await tx.query(
      `INSERT INTO cars (id, owner_id, year, make, model, registration, colour, length_mm, width_mm,
        odometer_km, tyre_spec_bar, startup_scheduled, status, bay_id, intake_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (id) DO NOTHING`,
      [id, owner, year, make, model, registration, colour, length, width, odo, tyre, scheduled, status, bayId, intake, createdAt],
    );
  }

  const belongings: [string, string, string, string, number][] = [
    ['b-etype-keys', 'c-etype', 'key_set', 'Key sets', 2],
    ['b-etype-cover', 'c-etype', 'cover', 'Indoor cover', 1],
    ['b-etype-wheel', 'c-etype', 'spare_wheel', 'Wire spare wheel', 1],
    ['b-etype-cert', 'c-etype', 'document', 'Heritage certificate', 1],
    ['b-911rs-keys', 'c-911rs', 'key_set', 'Key sets', 2],
    ['b-911rs-cover', 'c-911rs', 'cover', 'Indoor cover', 1],
    ['b-testarossa-keys', 'c-testarossa', 'key_set', 'Key sets', 2],
    ['b-testarossa-cover', 'c-testarossa', 'cover', 'Indoor cover', 1],
    ['b-testarossa-book', 'c-testarossa', 'document', 'Service book', 1],
    ['b-300sl-keys', 'c-300sl', 'key_set', 'Key sets', 1],
    ['b-300sl-cover', 'c-300sl', 'cover', 'Indoor cover', 1],
  ];
  for (const [id, carId, kind, label, count] of belongings) {
    await tx.query(
      `INSERT INTO belongings (id, car_id, kind, label, created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
      [id, carId, kind, label, intakeAt],
    );
    await tx.query(
      `INSERT INTO movements (id, belonging_id, direction, count, at, by_user_id)
       VALUES ($1,$2,'in',$3,$4,'u-ines')`,
      [`m-${id}`, id, count, intakeAt],
    );
  }

  // Care entries: the start-ups the schedule column refers to.
  const careEntries: [string, string, number, string, string | null][] = [
    ['ce-etype-1', 'c-etype', 31, 'u-tomas', '12.61'],
    ['ce-911rs-1', 'c-911rs', 3, 'u-luca', '12.55'],
    ['ce-testarossa-1', 'c-testarossa', 10, 'u-tomas', '12.72'],
  ];
  for (const [id, carId, daysAgo, by, battery] of careEntries) {
    await tx.query(
      `INSERT INTO care_entries (id, car_id, at, by_user_id, started, battery_v, note, flags)
       VALUES ($1,$2,$3,$4,TRUE,$5,'','{}')`,
      [id, carId, at(daysAgo), by, battery],
    );
  }

  const jobs: [string, string, string, string, string, string | null, string | null, string | null, string | null][] = [
    // id, number, car, title, status, sent_at, expires_at, approved_at, finished_at
    ['j-1001', 'J-1001', 'c-911rs', 'Bonnet and front wings respray', 'in_progress', at(22), expiresAt(22), at(20), null],
    ['j-1002', 'J-1002', 'c-testarossa', 'Front valance stone-chip repair', 'sent', at(2), expiresAt(2), null, null],
    ['j-1003', 'J-1003', 'c-300sl', 'Sill touch-in', 'finished', at(18), expiresAt(18), at(17), at(4)],
    ['j-1004', 'J-1004', 'c-etype', 'Boot floor inspection', 'draft', null, null, null, null],
  ];
  for (const [id, number, carId, title, status, sentAt, expiresAt, approvedAt, finishedAt] of jobs) {
    await tx.query(
      `INSERT INTO jobs (id, number, car_id, title, status, version, sent_at, expires_at, approved_at, finished_at, created_at)
       VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
      [id, number, carId, title, status, sentAt, expiresAt, approvedAt, finishedAt, at(25)],
    );
  }

  const lines: [string, string, SeedLine][] = [
    ['l-1001-1', 'j-1001', { kind: 'part', description: 'Bonnet hinge bushes', quantity: '2', unit_price: '37.45' }],
    ['l-1001-2', 'j-1001', { kind: 'labour', description: 'Strip, prime and paint bonnet and front wings', quantity: '26.50', unit_price: '145.00' }],
    ['l-1001-3', 'j-1001', { kind: 'paint_materials', description: 'Primer, base and clear', quantity: '1', unit_price: '218.30' }],
    ['l-1002-1', 'j-1002', { kind: 'labour', description: 'Fill, flat and blend front valance chips', quantity: '3.25', unit_price: '145.00' }],
    ['l-1002-2', 'j-1002', { kind: 'paint_materials', description: 'Touch-up primer and base', quantity: '1', unit_price: '64.80' }],
    ['l-1003-1', 'j-1003', { kind: 'part', description: 'Touch-in kit', quantity: '1', unit_price: '12.90' }],
    ['l-1003-2', 'j-1003', { kind: 'labour', description: 'Flat and touch in sill chips', quantity: '1.75', unit_price: '145.00' }],
    ['l-1003-3', 'j-1003', { kind: 'paint_materials', description: 'Base and clear', quantity: '1', unit_price: '38.40' }],
    ['l-1004-1', 'j-1004', { kind: 'labour', description: 'Lift boot floor mat and inspect for corrosion', quantity: '2.00', unit_price: '145.00' }],
  ];
  let position = 0;
  let lastJob = '';
  for (const [id, jobId, line] of lines) {
    if (jobId !== lastJob) {
      position = 0;
      lastJob = jobId;
    }
    position += 1;
    await tx.query(
      `INSERT INTO job_lines (id, job_id, kind, description, quantity, unit_price, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, jobId, line.kind, line.description, line.quantity, line.unit_price, position],
    );
  }

  await seedStages(tx, firstStartMs);
  await queueSeedProviderEffects(tx);
}

async function seedStages(tx: import('./db.ts').Tx, firstStartMs: number): Promise<void> {
  const DAY = 24 * 3600 * 1000;
  const at = (daysAgo: number, hour = 14): string =>
    new Date(firstStartMs - daysAgo * DAY).toISOString();

  // J-1001: Intake 6d, Stripped 5d, Epoxy primer 4d, 2K primer 3d, Base 2d before first start.
  const j1001Stages: [string, string, number][] = [
    ['st-1001-intake', 'Intake', 6],
    ['st-1001-stripped', 'Stripped', 5],
    ['st-1001-epoxy', 'Epoxy primer', 4],
    ['st-1001-2k', '2K primer', 3],
    ['st-1001-base', 'Base', 2],
  ];
  for (const [id, name, daysAgo] of j1001Stages) {
    await tx.query(
      `INSERT INTO stages (id, job_id, name, logged_at) VALUES ($1,'j-1001',$2,$3)`,
      [id, name, at(daysAgo)],
    );
  }

  const j1001Readings: [string, string, number, number][] = [
    // stage id, panel, value, daysAgo (same as stage)
    ['st-1001-intake', 'front_valance', 112, 6],
    ['st-1001-intake', 'bonnet', 142, 6],
    ['st-1001-intake', 'front_wing_l', 268, 6],
    ['st-1001-intake', 'front_wing_r', 335, 6],
    ['st-1001-intake', 'door_l', 118, 6],
    ['st-1001-intake', 'door_r', 121, 6],
    ['st-1001-intake', 'sill_l', 96, 6],
    ['st-1001-intake', 'sill_r', 74, 6],
    ['st-1001-intake', 'roof', 131, 6],
    ['st-1001-intake', 'rear_quarter_l', 127, 6],
    ['st-1001-intake', 'rear_quarter_r', 124, 6],
    ['st-1001-intake', 'boot_lid', 138, 6],
    ['st-1001-stripped', 'bonnet', 0, 5],
    ['st-1001-stripped', 'front_wing_l', 0, 5],
    ['st-1001-stripped', 'front_wing_r', 0, 5],
    ['st-1001-epoxy', 'bonnet', 48, 4],
    ['st-1001-epoxy', 'front_wing_l', 51, 4],
    ['st-1001-epoxy', 'front_wing_r', 50, 4],
    ['st-1001-2k', 'bonnet', 132, 3],
    ['st-1001-2k', 'front_wing_l', 140, 3],
    ['st-1001-2k', 'front_wing_r', 138, 3],
    ['st-1001-base', 'bonnet', 158, 2],
    ['st-1001-base', 'front_wing_l', 166, 2],
    ['st-1001-base', 'front_wing_r', 163, 2],
  ];
  let readingIndex = 0;
  for (const [stageId, panel, um, daysAgo] of j1001Readings) {
    readingIndex += 1;
    await tx.query(
      `INSERT INTO readings (id, stage_id, job_id, panel, film_um, logged_at, logged_by_user_id)
       VALUES ($1,$2,'j-1001',$3,$4,$5,'u-odile')`,
      [`r-1001-${readingIndex}`, stageId, panel, um, at(daysAgo)],
    );
  }

  // J-1003: Intake 12d with all panels, Clear 5d with sill_l.
  await tx.query(
    `INSERT INTO stages (id, job_id, name, logged_at) VALUES ('st-1003-intake','j-1003','Intake',$1)`,
    [at(12)],
  );
  await tx.query(
    `INSERT INTO stages (id, job_id, name, logged_at) VALUES ('st-1003-clear','j-1003','Clear',$1)`,
    [at(5)],
  );
  const j1003Intake: [string, number][] = [
    ['front_valance', 104], ['bonnet', 118], ['front_wing_l', 121], ['front_wing_r', 117],
    ['door_l', 112], ['door_r', 115], ['sill_l', 212], ['sill_r', 109], ['roof', 120],
    ['rear_quarter_l', 116], ['rear_quarter_r', 119], ['boot_lid', 122],
  ];
  let index = 0;
  for (const [panel, um] of j1003Intake) {
    index += 1;
    await tx.query(
      `INSERT INTO readings (id, stage_id, job_id, panel, film_um, logged_at, logged_by_user_id)
       VALUES ($1,'st-1003-intake','j-1003',$2,$3,$4,'u-odile')`,
      [`r-1003-i-${index}`, panel, um, at(12)],
    );
  }
  await tx.query(
    `INSERT INTO readings (id, stage_id, job_id, panel, film_um, logged_at, logged_by_user_id)
     VALUES ('r-1003-c-1','st-1003-clear','j-1003','sill_l',236,$1,'u-odile')`,
    [at(5)],
  );
}

async function queueSeedProviderEffects(tx: import('./db.ts').Tx): Promise<void> {
  // Kill Bill accounts (once per owner) and bay subscriptions for the stored cars.
  for (const ownerId of ['u-henrietta', 'u-kenji']) {
    await tx.query(
      `INSERT INTO queue (kind, payload, created_at) VALUES ('killbill_account',$1,now())`,
      [JSON.stringify({ owner_id: ownerId })],
    );
  }
  for (const carId of ['c-etype', 'c-911rs', 'c-testarossa', 'c-300sl']) {
    await tx.query(
      `INSERT INTO queue (kind, payload, created_at) VALUES ('killbill_subscription',$1,now())`,
      [JSON.stringify({ car_id: carId })],
    );
  }
}

export function seedJobTotals(lines: SeedLine[]): { net_total: string; vat_total: string; rounding: string; total: string } {
  const nets = lines.map((line) => lineNetMinor(line.quantity, line.unit_price));
  const vats = nets.map((net) => lineVatMinor(net));
  return computeTotals(nets.map(fromMinor), vats.map(fromMinor));
}
