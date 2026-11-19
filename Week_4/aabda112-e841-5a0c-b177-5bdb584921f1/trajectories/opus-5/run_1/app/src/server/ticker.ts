import { settings } from './config';
import {
  addClinicDays,
  clinicDateOf,
  instantOfClinicHour,
  serverNow,
} from './clock';
import { query, transaction } from './db';
import { announce, publish } from './live';
import { retryQueuedMail, sendMail } from './mail';
import { clinicDateDdMonYyyy, clinicTimeHm } from './format';
import { doseStatus, wardBoard } from './domain/ward';
import { itemState, lowStockAnnouncement, settleLowStock, type StockItemRow } from './domain/stock';
import { isLate } from './domain/appointments';
import { randomBytes } from 'node:crypto';
import { config } from './config';

const fingerprints = new Map<string, string>();
let lastQueueTick = 0;
let lastMailRetry = 0;

type VaccinationRow = {
  id: string;
  patient_id: string;
  vaccine: string;
  due_date: Date | string;
  reminder_status: string;
  created_at: Date;
  clinic_id: string;
  clinic_slug: string;
  pet_name: string;
  client_email: string;
};

function dateText(value: Date | string): string {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

/** The one place the reminder send moment is worked out. */
export function reminderSendMoment(dueDate: string): number {
  const sendDate = addClinicDays(dueDate, -settings.reminderLeadDays);
  return instantOfClinicHour(sendDate, settings.reminderHour);
}

async function processReminders(now: number): Promise<void> {
  const rows = await query<VaccinationRow>(
    `select v.id, v.patient_id, v.vaccine, v.due_date, v.reminder_status, v.created_at,
            p.clinic_id, cl.slug as clinic_slug, p.name as pet_name, c.email as client_email
       from vaccinations v
       join patients p on p.id = v.patient_id
       join clients c on c.id = p.client_id
       join clinics cl on cl.id = p.clinic_id
      where v.reminder_status = 'Scheduled'`,
  );
  for (const row of rows) {
    const dueDate = dateText(row.due_date);
    const sendMoment = reminderSendMoment(dueDate);
    const today = clinicDateOf(now);
    if (today >= dueDate) {
      await query(`update vaccinations set reminder_status = 'Missed' where id = $1`, [row.id]);
      publish(row.clinic_id, { kind: 'changed', topics: ['patients'] });
      continue;
    }
    if (now < sendMoment) continue;
    if (row.created_at.getTime() > sendMoment) {
      await query(`update vaccinations set reminder_status = 'Missed' where id = $1`, [row.id]);
      publish(row.clinic_id, { kind: 'changed', topics: ['patients'] });
      continue;
    }
    const claimed = await query<{ id: string }>(
      `insert into reminder_sends (vaccination_id, sent_at) values ($1, $2)
       on conflict (vaccination_id) do nothing returning vaccination_id as id`,
      [row.id, new Date(now).toISOString()],
    );
    if (claimed.length === 0) continue;
    const token = randomBytes(24).toString('hex');
    await query(
      'insert into pet_tokens (token, clinic_id, patient_id, due_date) values ($1,$2,$3,$4)',
      [token, row.clinic_id, row.patient_id, dueDate],
    );
    const base = config.publicUrl ? config.publicUrl.replace(/\/$/, '') : `http://127.0.0.1:${config.port}`;
    const accepted = await sendMail({
      to: row.client_email,
      subject: `${row.pet_name} is due for ${row.vaccine} on ${clinicDateDdMonYyyy(dueDate)}`,
      body: `Hello,\n\n${row.pet_name} is due for ${row.vaccine} on ${clinicDateDdMonYyyy(
        dueDate,
      )}.\n\nBook a visit: ${base}/book/${row.clinic_slug}?pet=${token}\n`,
    });
    if (accepted) {
      await query(
        `update vaccinations set reminder_status = 'Sent', sent_at = $2 where id = $1`,
        [row.id, new Date(now).toISOString()],
      );
      publish(row.clinic_id, { kind: 'changed', topics: ['patients'] });
    } else {
      await query('delete from reminder_sends where vaccination_id = $1', [row.id]);
    }
  }
}

async function processOverdueAnnouncements(clinicId: string, now: number): Promise<void> {
  const rows = await query<{ id: string; scheduled_at: Date; patient_name: string; name: string }>(
    `select d.id, d.scheduled_at, p.name as patient_name, s.name
       from treatment_doses d
       join treatment_schedules s on s.id = d.schedule_id
       join admissions a on a.id = s.admission_id
       join patients p on p.id = a.patient_id
      where a.clinic_id = $1 and d.status = 'open' and d.overdue_announced = false
        and d.scheduled_at <= $2
      order by d.scheduled_at`,
    [clinicId, new Date(now - settings.treatmentGraceMinutes * 60_000).toISOString()],
  );
  if (rows.length === 0) return;
  await query('update treatment_doses set overdue_announced = true where id = any($1)', [
    rows.map((row) => row.id),
  ]);
  const board = await transaction((tx) => wardBoard(tx, clinicId, now));
  const earliest = rows[0];
  announce(
    clinicId,
    `Overdue now ${board.beacons.overdue}. ${earliest.patient_name}, ${
      earliest.name
    } due ${clinicTimeHm(earliest.scheduled_at.getTime())}.`,
    'all',
  );
}

async function processStockExpiry(clinicId: string, now: number): Promise<void> {
  const items = await query<StockItemRow>('select * from stock_items where clinic_id = $1', [
    clinicId,
  ]);
  for (const item of items) {
    const crossing = await transaction((tx) => settleLowStock(tx, item, now));
    if (crossing) {
      publish(clinicId, { kind: 'changed', topics: ['stock'] });
      announce(clinicId, lowStockAnnouncement(crossing), 'manager');
    }
  }
}

async function clinicFingerprint(clinicId: string, now: number): Promise<string> {
  const appointments = await query<{ id: string; status: string; start_at: Date }>(
    `select id, status, start_at from appointments where clinic_id = $1 and status = 'booked'`,
    [clinicId],
  );
  const late = appointments
    .filter((row) => isLate({ status: 'booked', start_at: row.start_at }, now))
    .map((row) => row.id)
    .sort()
    .join(',');
  const doses = await query<{ id: string; status: string; scheduled_at: Date }>(
    `select d.id, d.status, d.scheduled_at from treatment_doses d
       join treatment_schedules s on s.id = d.schedule_id
       join admissions a on a.id = s.admission_id
      where a.clinic_id = $1`,
    [clinicId],
  );
  const doseStates = doses
    .map((row) => `${row.id}:${doseStatus(row, now)}`)
    .sort()
    .join(',');
  const items = await query<{ id: string }>('select id from stock_items where clinic_id = $1', [
    clinicId,
  ]);
  let stockState = '';
  for (const item of items) {
    const state = await transaction((tx) => itemState(tx, item.id, now));
    stockState += `${item.id}:${state.usable};`;
  }
  return `${late}|${doseStates}|${stockState}`;
}

/** Processes every time-dependent change the server clock has reached. */
export async function runTick(): Promise<void> {
  const now = serverNow();
  const clinics = await query<{ id: string }>('select id from clinics');
  await processReminders(now);
  for (const clinic of clinics) {
    await processOverdueAnnouncements(clinic.id, now);
    await processStockExpiry(clinic.id, now);
    const fingerprint = await clinicFingerprint(clinic.id, now);
    if (fingerprints.get(clinic.id) !== fingerprint) {
      fingerprints.set(clinic.id, fingerprint);
      publish(clinic.id, {
        kind: 'changed',
        topics: ['calendar', 'ward', 'beacons', 'queue', 'stock'],
      });
    }
  }
  if (now - lastQueueTick >= settings.waitTickSeconds * 1000) {
    lastQueueTick = now;
    for (const clinic of clinics) {
      publish(clinic.id, { kind: 'changed', topics: ['queue', 'beacons'] });
    }
  }
  if (Date.now() - lastMailRetry >= 5000) {
    lastMailRetry = Date.now();
    await retryQueuedMail();
  }
}

export function startTicker(): void {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    runTick()
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  }, 1000).unref();
}

export async function pushAfterClockChange(): Promise<void> {
  await runTick();
  const clinics = await query<{ id: string }>('select id from clinics');
  for (const clinic of clinics) {
    publish(clinic.id, {
      kind: 'changed',
      topics: ['calendar', 'queue', 'ward', 'beacons', 'stock', 'patients', 'invoices'],
    });
  }
}
