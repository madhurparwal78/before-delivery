import crypto from 'node:crypto';
import { pool } from './db.js';
import { settings } from './settings.js';
import { clockNow } from './clock.js';
import { clinicDateOf, clinicToUtc, addClinicDays } from './tz.js';
import { hash } from './routes/auth.js';

// First-start seeding runs under a database lock so two processes sharing one
// database create it once. The lock id is derived from the schema name so two
// instances with separate schemas never block each other.
const schemaName = process.env.DB_SCHEMA || 'public';
const LOCK_ID = 800000 + (crypto.createHash('md5').update(schemaName).digest()[0] % 100000);

export async function seedIfEmpty(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`create schema if not exists ${schemaName}`);
    await client.query('begin');
    await client.query(`set local search_path to ${schemaName}`);
    await client.query('select pg_advisory_xact_lock($1)', [LOCK_ID]);
    const existing = await client.query(`select count(*)::int as c from clinics`);
    if (existing.rows[0].c > 0) {
      await client.query('commit');
      return;
    }
    await seedWith(client);
    await client.query('commit');
  } finally {
    client.release();
  }
}

async function seedWith(client: any): Promise<void> {
  const today = clinicDateOf(clockNow());
  const pw = hash('roundbook-demo-1');

  const halberton = (
    await client.query(
      `insert into clinics (name, slug) values ($1, $2) returning id`,
      ['Halberton Road Animal Hospital', 'halberton-road']
    )
  ).rows[0].id;
  const marlow = (
    await client.query(
      `insert into clinics (name, slug) values ($1, $2) returning id`,
      ['Marlow Court Veterinary Centre', 'marlow-court']
    )
  ).rows[0].id;

  const roomIds: Record<string, string[]> = {};
  for (const [clinicId, names] of [
    [halberton, ['Consult 1', 'Consult 2', 'Consult 3']],
    [marlow, ['Consult A', 'Consult B', 'Consult C']],
  ] as [string, string[]][]) {
    roomIds[clinicId] = [];
    for (let i = 0; i < names.length; i++) {
      const r = await client.query(
        `insert into rooms (clinic_id, name, position) values ($1, $2, $3) returning id`,
        [clinicId, names[i], i]
      );
      roomIds[clinicId].push(r.rows[0].id);
    }
  }

  const staff: Record<string, { id: string; role: string }[]> = {};
  const insertUser = async (clinicId: string, name: string, email: string, role: string): Promise<string> => {
    const r = await client.query(
      `insert into users (clinic_id, name, email, password_hash, role) values ($1, $2, $3, $4, $5) returning id`,
      [clinicId, name, email, pw, role]
    );
    return r.rows[0].id;
  };
  staff[halberton] = [];
  staff[halberton].push({ id: await insertUser(halberton, 'Maya Brennan', 'maya.brennan@halberton.test', 'front-desk'), role: 'front-desk' });
  staff[halberton].push({ id: await insertUser(halberton, 'Tomasz Wren', 'tomasz.wren@halberton.test', 'nurse'), role: 'nurse' });
  const okafor = await insertUser(halberton, 'Dr Imani Okafor', 'imani.okafor@halberton.test', 'vet');
  const reyes = await insertUser(halberton, 'Dr Callum Reyes', 'callum.reyes@halberton.test', 'vet');
  const priya = await insertUser(halberton, 'Priya Nandakumar', 'priya.nandakumar@halberton.test', 'manager');
  staff[marlow] = [];
  const vale = await insertUser(marlow, 'Dr Hester Vale', 'hester.vale@marlow.test', 'vet');
  await insertUser(marlow, 'Lewis Ocampo', 'lewis.ocampo@marlow.test', 'manager');

  const clientRow = async (clinicId: string, name: string, email: string): Promise<string> => {
    const r = await client.query(
      `insert into clients (clinic_id, name, email) values ($1, $2, $3) returning id`,
      [clinicId, name, email]
    );
    return r.rows[0].id;
  };
  const nia = await clientRow(halberton, 'Nia Ashworth', 'nia.ashworth@example.test');
  const owen = await clientRow(halberton, 'Owen Pritchard', 'owen.pritchard@example.test');
  const rhys = await clientRow(marlow, 'Rhys Halloran', 'rhys.halloran@example.test');

  const patientRow = async (clinicId: string, clientId: string, name: string, species: string, weight: number): Promise<string> => {
    const r = await client.query(
      `insert into patients (clinic_id, client_id, name, species, weight_grams) values ($1, $2, $3, $4, $5) returning id`,
      [clinicId, clientId, name, species, weight]
    );
    return r.rows[0].id;
  };
  const biscuit = await patientRow(halberton, nia, 'Biscuit', 'dog', 12400);
  const juniper = await patientRow(halberton, nia, 'Juniper', 'cat', 4100);
  const mochi = await patientRow(halberton, owen, 'Mochi', 'rabbit', 1900);
  const saffron = await patientRow(halberton, owen, 'Saffron', 'dog', 8300);
  await patientRow(halberton, owen, 'Pickle', 'cat', 3600);
  const quill = await patientRow(marlow, rhys, 'Quill', 'cat', 3900);

  const weightRow = async (patientId: string, date: string, grams: number) => {
    await client.query(
      `insert into patient_weights (patient_id, recorded_on, grams) values ($1, $2, $3)`,
      [patientId, date, grams]
    );
  };
  await weightRow(biscuit, addClinicDays(today, -90), 12000);
  await weightRow(biscuit, addClinicDays(today, -60), 12150);
  await weightRow(biscuit, addClinicDays(today, -30), 12400);

  await client.query(
    `insert into vaccinations (clinic_id, patient_id, vaccine, due_date) values ($1, $2, $3, $4)`,
    [halberton, biscuit, 'DHPPi', addClinicDays(today, 35)]
  );
  await client.query(
    `insert into vaccinations (clinic_id, patient_id, vaccine, due_date) values ($1, $2, $3, $4)`,
    [halberton, juniper, 'FVRCP', addClinicDays(today, 40)]
  );

  // appointments today
  const appt = async (clinicId: string, patientId: string, vetId: string, roomId: string, hh: number, mm: number, reason: string, status = 'booked') => {
    const [y, mo, dd] = today.split('-').map(Number);
    const start = clinicToUtc(y, mo, dd, hh, mm, true)!;
    const r = await client.query(
      `insert into appointments (clinic_id, patient_id, vet_id, room_id, start_at, minutes, reason, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [clinicId, patientId, vetId, roomId, start, settings.slotMinutes, reason, status]
    );
    return r.rows[0].id;
  };
  await appt(halberton, biscuit, okafor, roomIds[halberton][0], 9, 0, 'Consult');
  await appt(halberton, juniper, reyes, roomIds[halberton][1], 9, 30, 'Vaccination');
  await appt(halberton, mochi, okafor, roomIds[halberton][0], 10, 0, 'Consult');

  // completed consult 30 days back with a two-paragraph note
  const pastStart = clinicToUtc(
    Number(today.slice(0, 4)), Number(today.slice(5, 7)), Number(today.slice(8, 10)), 9, 0, true
  )!;
  const pastAppt = (
    await client.query(
      `insert into appointments (clinic_id, patient_id, vet_id, room_id, start_at, minutes, reason, status)
       values ($1, $2, $3, $4, $5, 30, 'Consult', 'completed') returning id`,
      [halberton, biscuit, okafor, roomIds[halberton][0],
       new Date(pastStart.getTime() - 30 * 86400000), ]
    )
  ).rows[0].id;
  await client.query(`insert into consult_notes (appointment_id) values ($1)`, [pastAppt]);
  await client.query(
    `insert into note_paragraphs (appointment_id, n, version, text, edited_by) values ($1, 1, 1, $2, $3)`,
    [pastAppt, 'Biscuit is bright and eating well. Weight steady at 12.4 kg.', okafor]
  );
  await client.query(
    `insert into note_paragraphs (appointment_id, n, version, text, edited_by) values ($1, 2, 1, $2, $3)`,
    [pastAppt, 'Next DHPPi booster due in about a month; reminder scheduled.', okafor]
  );

  // ward: Biscuit in K3 on meloxicam 8-hourly from 08:00, Saffron in K5 on cefalexin 12-hourly from 09:00
  const admission = async (clinicId: string, patientId: string, kennel: string): Promise<string> => {
    const r = await client.query(
      `insert into admissions (clinic_id, patient_id, kennel) values ($1, $2, $3) returning id`,
      [clinicId, patientId, kennel]
    );
    return r.rows[0].id;
  };
  const treatment = async (clinicId: string, admissionId: string, patientId: string, name: string, first: Date, interval: number, count: number) => {
    const r = await client.query(
      `insert into treatments (clinic_id, admission_id, patient_id, name, first_at, interval_hours, dose_count)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [clinicId, admissionId, patientId, name, first, interval, count]
    );
    const treatmentId = r.rows[0].id;
    for (let k = 0; k < count; k++) {
      await client.query(
        `insert into doses (treatment_id, idx, scheduled_at) values ($1, $2, $3)`,
        [treatmentId, k, new Date(first.getTime() + k * interval * 3600_000)]
      );
    }
  };
  const today8 = clinicToUtc(Number(today.slice(0, 4)), Number(today.slice(5, 7)), Number(today.slice(8, 10)), 8, 0, true)!;
  const today9 = clinicToUtc(Number(today.slice(0, 4)), Number(today.slice(5, 7)), Number(today.slice(8, 10)), 9, 0, true)!;
  const biscuitAdmission = await admission(halberton, biscuit, 'K3');
  await treatment(halberton, biscuitAdmission, biscuit, 'meloxicam', today8, 8, 4);
  const saffronAdmission = await admission(halberton, saffron, 'K5');
  await treatment(halberton, saffronAdmission, saffron, 'cefalexin', today9, 12, 4);

  // stock
  const stockItem = async (clinicId: string, name: string, reorder: number, price: number): Promise<string> => {
    const r = await client.query(
      `insert into stock_items (clinic_id, name, reorder_point, unit_price_pence) values ($1, $2, $3, $4) returning id`,
      [clinicId, name, reorder, price]
    );
    return r.rows[0].id;
  };
  const receive = async (itemId: string, batch: string, expiresOn: string, qty: number, order: number) => {
    const r = await client.query(
      `insert into stock_batches (item_id, batch, expires_on, received_order) values ($1, $2, $3, $4) returning id`,
      [itemId, batch, expiresOn, order]
    );
    const bal = await client.query(
      `select coalesce(sum(m.delta),0)::int as b from stock_movements m join stock_batches b2 on b2.id = m.batch_id where b2.item_id = $1`,
      [itemId]
    );
    await client.query(
      `insert into stock_movements (item_id, batch_id, delta, reason, balance_after) values ($1, $2, $3, 'receive', $4)`,
      [itemId, r.rows[0].id, qty, bal.rows[0].b + qty]
    );
  };

  const meloxicam = await stockItem(halberton, 'Meloxicam 1.5 mg/ml oral suspension 10 ml', 6, 1850);
  await receive(meloxicam, 'MX-2411', addClinicDays(today, 20), 6, 0);
  await receive(meloxicam, 'MX-2502', addClinicDays(today, 200), 18, 1);
  const cefalexin = await stockItem(halberton, 'Cefalexin 250 mg tablets (10)', 5, 1440);
  await receive(cefalexin, 'OPENING', '2099-12-31', 18, 0);
  const nobivac = await stockItem(halberton, 'Nobivac DHPPi vaccine dose', 10, 1295);
  await receive(nobivac, 'OPENING', '2099-12-31', 40, 0);
  const saline = await stockItem(halberton, 'Sterile saline 500 ml', 4, 640);
  await receive(saline, 'OPENING', '2099-12-31', 12, 0);
  const dressing = await stockItem(marlow, 'Wound dressing pack', 5, 450);
  await receive(dressing, 'OPENING', '2099-12-31', 20, 0);

  // Marlow issued invoice INV-0001 for Quill: 2 wound dressing packs (total £10.80)
  await client.query(`update clinics set invoice_seq = 1 where id = $1`, [marlow]);
  const inv = (
    await client.query(
      `insert into invoices (clinic_id, patient_id, number, status) values ($1, $2, 'INV-0001', 'issued') returning id`,
      [marlow, quill]
    )
  ).rows[0].id;
  const { lineAmounts } = await import('./domain/money.js');
  const amounts = lineAmounts(2, 450, 0);
  await client.query(
    `insert into invoice_lines (invoice_id, stock_item_id, description, quantity, unit_price_pence,
      net_pence, discount_pence, vat_pence, total_pence, position)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [inv, dressing, 'Wound dressing pack', 2, 450, amounts.net, amounts.discount, amounts.vat, amounts.total, 1]
  );
  // draw the two packs from stock as a normal invoice line would
  const draws = await client.query(
    `select id from stock_batches where item_id = $1 order by received_order limit 1`,
    [dressing]
  );
  await client.query(
    `insert into stock_movements (item_id, batch_id, delta, reason, invoice_line_id, balance_after)
     values ($1, $2, -2, 'invoice-line', null, 18)`,
    [dressing, draws.rows[0].id]
  );
  void vale;
  void priya;
}
