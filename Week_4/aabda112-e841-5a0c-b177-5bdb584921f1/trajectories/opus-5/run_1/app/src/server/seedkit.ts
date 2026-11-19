import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { SEED_PASSWORD } from './config';
import { serverNow } from './clock';
import { newId, type Tx } from './db';
import { hashPassword, type Role } from './auth';
import { fileObjectKey, putObject } from './storage';
import { doseInstants } from './domain/ward';
import { drawForInvoiceLine, receiveStock, settleLowStock, type StockItemRow } from './domain/stock';
import { invoiceDetail } from './routes/invoices';

export async function createClinic(
  tx: Tx,
  input: { name: string; slug: string },
): Promise<string> {
  const id = newId();
  await tx.query('insert into clinics (id, name, slug) values ($1,$2,$3)', [
    id,
    input.name,
    input.slug,
  ]);
  await tx.query('insert into clinic_counters (clinic_id, next_invoice) values ($1, 0)', [id]);
  return id;
}

export async function createUser(
  tx: Tx,
  input: { clinicId: string; name: string; email: string; role: Role },
): Promise<string> {
  const id = newId();
  await tx.query(
    `insert into users (id, clinic_id, name, email, role, password_hash, status, created_at)
     values ($1,$2,$3,$4,$5,$6,'Active',$7)`,
    [
      id,
      input.clinicId,
      input.name,
      input.email,
      input.role,
      hashPassword(SEED_PASSWORD),
      new Date(serverNow()).toISOString(),
    ],
  );
  return id;
}

export async function createRoom(
  tx: Tx,
  input: { clinicId: string; name: string; sort: number },
): Promise<string> {
  const id = newId();
  await tx.query('insert into rooms (id, clinic_id, name, sort) values ($1,$2,$3,$4)', [
    id,
    input.clinicId,
    input.name,
    input.sort,
  ]);
  return id;
}

export async function createClient(
  tx: Tx,
  input: { clinicId: string; name: string; email: string },
): Promise<string> {
  const id = newId();
  await tx.query('insert into clients (id, clinic_id, name, email) values ($1,$2,$3,$4)', [
    id,
    input.clinicId,
    input.name,
    input.email,
  ]);
  return id;
}

/** A small procedural profile photo, stored like any other patient file. */
function profilePhotoPng(seedText: string): Buffer {
  const size = 64;
  const hash = createHash('sha256').update(seedText).digest();
  const base = [hash[0] % 90 + 120, hash[1] % 90 + 120, hash[2] % 90 + 120];
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x += 1) {
      const centre = Math.hypot(x - size / 2, y - size / 2) < size / 3;
      const offset = 1 + x * 3;
      row[offset] = centre ? 255 : base[0];
      row[offset + 1] = centre ? 255 : base[1];
      row[offset + 2] = centre ? 255 : base[2];
    }
    rows.push(row);
  }
  const raw = deflateSync(Buffer.concat(rows));
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', raw),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export async function createPatient(
  tx: Tx,
  input: {
    clinicId: string;
    clientId: string;
    name: string;
    species: string;
    weightGrams?: number | null;
    photo?: boolean;
    vaccinations?: { vaccine: string; dueDate: string }[];
    weights?: { recordedOn: string; grams: number }[];
  },
): Promise<string> {
  const id = newId();
  await tx.query(
    `insert into patients (id, clinic_id, client_id, name, species, weight_grams, created_at)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      id,
      input.clinicId,
      input.clientId,
      input.name,
      input.species,
      input.weightGrams ?? null,
      new Date(serverNow()).toISOString(),
    ],
  );
  for (const weight of input.weights ?? []) {
    await tx.query(
      'insert into patient_weights (id, patient_id, recorded_on, grams) values ($1,$2,$3,$4)',
      [newId(), id, weight.recordedOn, weight.grams],
    );
  }
  for (const vaccination of input.vaccinations ?? []) {
    await tx.query(
      'insert into vaccinations (id, patient_id, vaccine, due_date, created_at) values ($1,$2,$3,$4,$5)',
      [newId(), id, vaccination.vaccine, vaccination.dueDate, new Date(serverNow()).toISOString()],
    );
  }
  if (input.photo) {
    const fileId = newId();
    const bytes = profilePhotoPng(`${input.name}-${id}`);
    const name = `${input.name.toLowerCase()}-profile.png`;
    const key = fileObjectKey(input.clinicId, id, fileId, name);
    try {
      await putObject(key, bytes, 'image/png');
      await tx.query(
        `insert into files (id, clinic_id, patient_id, name, kind, content_type, size_bytes, sha256, object_key, created_at)
         values ($1,$2,$3,$4,'profile','image/png',$5,$6,$7,$8)`,
        [
          fileId,
          input.clinicId,
          id,
          name,
          bytes.length,
          createHash('sha256').update(bytes).digest('hex'),
          key,
          new Date(serverNow()).toISOString(),
        ],
      );
      await tx.query('update patients set photo_file_id = $2 where id = $1', [id, fileId]);
    } catch {
      /* storage is unreachable on the outage instance; the record stays photo-less */
    }
  }
  return id;
}

export async function createAppointment(
  tx: Tx,
  input: {
    clinicId: string;
    patientId: string;
    vetId: string;
    roomId: string;
    start: number;
    minutes: number;
    reason: string;
    status: string;
    checkedInAt?: number | null;
  },
): Promise<string> {
  const id = newId();
  const checkedInAt = input.checkedInAt ?? (input.status === 'booked' ? null : input.start);
  const lateMinutes =
    checkedInAt === null ? null : Math.floor((checkedInAt - input.start) / 60_000) || null;
  await tx.query(
    `insert into appointments
       (id, clinic_id, patient_id, vet_id, room_id, start_at, end_at, reason, status, checked_in_at, checked_in_late_minutes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      id,
      input.clinicId,
      input.patientId,
      input.vetId,
      input.roomId,
      new Date(input.start).toISOString(),
      new Date(input.start + input.minutes * 60_000).toISOString(),
      input.reason,
      input.status,
      checkedInAt === null ? null : new Date(checkedInAt).toISOString(),
      input.status === 'checked-in' ? lateMinutes : null,
    ],
  );
  return id;
}

export async function addNoteParagraphs(
  tx: Tx,
  appointmentId: string,
  paragraphs: string[],
  authorId: string,
): Promise<void> {
  for (const [index, text] of paragraphs.entries()) {
    await tx.query(
      'insert into note_paragraphs (id, appointment_id, n, text, version, edited_by) values ($1,$2,$3,$4,1,$5)',
      [newId(), appointmentId, index + 1, text, authorId],
    );
  }
}

export async function createHospitalisation(
  tx: Tx,
  input: {
    clinicId: string;
    patientId: string;
    kennel: string;
    treatments: {
      name: string;
      firstAt: number;
      intervalHours: number;
      count: number;
      givenDoses?: number[];
    }[];
    now: number;
    givenBy: string | null;
  },
): Promise<{ id: string; treatmentIds: string[] }> {
  const admissionId = newId();
  await tx.query('insert into admissions (id, clinic_id, patient_id, kennel) values ($1,$2,$3,$4)', [
    admissionId,
    input.clinicId,
    input.patientId,
    input.kennel,
  ]);
  const treatmentIds: string[] = [];
  for (const treatment of input.treatments) {
    const scheduleId = newId();
    await tx.query(
      `insert into treatment_schedules (id, admission_id, name, first_at, interval_hours, dose_count)
       values ($1,$2,$3,$4,$5,$6)`,
      [
        scheduleId,
        admissionId,
        treatment.name,
        new Date(treatment.firstAt).toISOString(),
        treatment.intervalHours,
        treatment.count,
      ],
    );
    const instants = doseInstants(treatment.firstAt, treatment.intervalHours, treatment.count);
    for (const [index, instant] of instants.entries()) {
      const doseId = newId();
      const given = (treatment.givenDoses ?? []).includes(index);
      await tx.query(
        `insert into treatment_doses
           (id, schedule_id, dose_index, scheduled_at, status, given_at, given_by, closed_at, overdue_announced)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          doseId,
          scheduleId,
          index,
          new Date(instant).toISOString(),
          given ? 'given' : 'open',
          given ? new Date(instant).toISOString() : null,
          given ? input.givenBy : null,
          given ? new Date(instant).toISOString() : null,
          instant <= input.now,
        ],
      );
      treatmentIds.push(doseId);
    }
  }
  return { id: admissionId, treatmentIds };
}

export async function createStockItem(
  tx: Tx,
  input: {
    clinicId: string;
    name: string;
    onHand?: number;
    reorderPoint: number;
    unitPricePence: number;
    batches?: { batch: string; expiresOn: string; quantity: number }[];
    now: number;
  },
): Promise<string> {
  const id = newId();
  await tx.query(
    'insert into stock_items (id, clinic_id, name, reorder_point, unit_price_pence) values ($1,$2,$3,$4,$5)',
    [id, input.clinicId, input.name, input.reorderPoint, input.unitPricePence],
  );
  const item: StockItemRow = {
    id,
    clinic_id: input.clinicId,
    name: input.name,
    reorder_point: input.reorderPoint,
    unit_price_pence: input.unitPricePence,
    low_alerted: false,
  };
  const batches =
    input.batches && input.batches.length > 0
      ? input.batches
      : [{ batch: 'OPENING', expiresOn: '2099-12-31', quantity: input.onHand ?? 0 }];
  for (const batch of batches) {
    await receiveStock(tx, {
      item,
      delta: batch.quantity,
      batch: batch.batch,
      expiresOn: batch.expiresOn,
      byUser: null,
      now: input.now,
    });
  }
  await settleLowStock(tx, item, input.now);
  return id;
}

export async function createInvoice(
  tx: Tx,
  input: {
    clinicId: string;
    patientId: string;
    status: 'draft' | 'issued';
    discountPercent?: number;
    lines: { stockItemId: string; quantity: number }[];
    payments?: { pence: number; by: string }[];
    now: number;
    actorId: string;
  },
): Promise<string> {
  const counter = await tx.one<{ next_invoice: number }>(
    `insert into clinic_counters (clinic_id, next_invoice) values ($1, 1)
     on conflict (clinic_id) do update set next_invoice = clinic_counters.next_invoice + 1
     returning next_invoice`,
    [input.clinicId],
  );
  const id = newId();
  await tx.query(
    `insert into invoices (id, clinic_id, number, patient_id, status, discount_percent, created_at)
     values ($1,$2,$3,$4,'draft',$5,$6)`,
    [
      id,
      input.clinicId,
      `INV-${String(counter?.next_invoice ?? 1).padStart(4, '0')}`,
      input.patientId,
      input.discountPercent ?? 0,
      new Date(input.now).toISOString(),
    ],
  );
  for (const line of input.lines) {
    const item = await tx.one<StockItemRow>('select * from stock_items where id = $1', [
      line.stockItemId,
    ]);
    if (!item) continue;
    const lineId = newId();
    await tx.query(
      `insert into invoice_lines (id, invoice_id, stock_item_id, description, quantity, unit_price_pence)
       values ($1,$2,$3,$4,$5,$6)`,
      [lineId, id, item.id, item.name, line.quantity, item.unit_price_pence],
    );
    await drawForInvoiceLine(tx, {
      item,
      quantity: line.quantity,
      invoiceLineId: lineId,
      byUser: input.actorId,
      now: input.now,
    });
    await settleLowStock(tx, item, input.now);
  }
  if (input.status === 'issued' || (input.payments ?? []).length > 0) {
    await tx.query(`update invoices set status = 'issued' where id = $1`, [id]);
  }
  for (const payment of input.payments ?? []) {
    const detail = await invoiceDetail(tx, id);
    const balance = detail.balancePence as number;
    await tx.query(
      'insert into payments (id, invoice_id, pence, at, taken_by) values ($1,$2,$3,$4,$5)',
      [newId(), id, payment.pence, new Date(input.now).toISOString(), payment.by],
    );
    await tx.query('update invoices set status = $2 where id = $1', [
      id,
      payment.pence >= balance ? 'paid' : 'part-paid',
    ]);
  }
  return id;
}
