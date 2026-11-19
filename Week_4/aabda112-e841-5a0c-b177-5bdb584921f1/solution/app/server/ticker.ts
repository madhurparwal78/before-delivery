import { clinicHm } from '../shared/clinictime.js';
import { config } from './config.js';
import { now } from './clock.js';
import { pool, rows } from './db.js';
import { EVERY_CLINIC, publish, publishNow, subscribedClinics } from './live.js';
import { flushMail } from './mail.js';
import { processReminders } from './reminders.js';
import { lowFlagsChanged } from './stock.js';
import { beacons, doseStatus } from './ward.js';

/**
 * Everything the clock causes on its own: late flags, due and overdue doses, batches expiring at clinic midnight,
 * reminders, waiting minutes. It runs every second and once more, to completion, when the grading clock is set.
 */
let previous = now();
let lastWaitTick = Date.now();
const lastBeacons = new Map<string, string>();
let running: Promise<void> | null = null;

async function lateAndLinger(from: Date, to: Date): Promise<void> {
  const clinics = await rows<{ clinic_id: string }>(
    pool,
    `SELECT DISTINCT clinic_id FROM appointments
      WHERE status = 'booked' AND start_at + make_interval(mins => $3) > $1 AND start_at + make_interval(mins => $3) <= $2`,
    [from, to, config.lateMinutes],
  );
  for (const { clinic_id } of clinics) await publishNow(clinic_id, { t: 'calendar' });
  const lingering = await rows<{ clinic_id: string }>(
    pool,
    `SELECT DISTINCT a.clinic_id FROM admissions a
      WHERE (SELECT max(c.closed_at) FROM treatments c WHERE c.admission_id = a.id) + make_interval(hours => $3) > $1
        AND (SELECT max(c.closed_at) FROM treatments c WHERE c.admission_id = a.id) + make_interval(hours => $3) <= $2`,
    [from, to, config.admissionLingerHours],
  );
  for (const { clinic_id } of lingering) await publishNow(clinic_id, { t: 'ward' });
}

interface OpenDose {
  id: string;
  clinic_id: string;
  patient: string;
  name: string;
  scheduled_at: Date;
  seen_status: string | null;
}

/** Moves each open dose to the status the clock gives it; the dose that turns overdue is announced once. */
async function doses(at: Date): Promise<void> {
  const open = await rows<OpenDose>(
    pool,
    `SELECT t.id, a.clinic_id, p.name AS patient, t.name, t.scheduled_at, t.seen_status
       FROM treatments t JOIN admissions a ON a.id = t.admission_id JOIN patients p ON p.id = a.patient_id WHERE t.state = 'open'`,
  );
  const byStatus = new Map<string, OpenDose[]>();
  for (const d of open) {
    const status = doseStatus({ state: 'open', scheduled_at: d.scheduled_at }, at);
    if (status !== d.seen_status) byStatus.set(status, [...(byStatus.get(status) ?? []), d]);
  }
  const overdue = new Map<string, OpenDose[]>();
  const touched = new Set<string>();
  for (const [status, list] of byStatus) {
    const won = await rows<{ id: string }>(
      pool,
      'UPDATE treatments SET seen_status = $2 WHERE id = ANY($1::uuid[]) AND seen_status IS DISTINCT FROM $2 RETURNING id',
      [list.map((d) => d.id), status],
    );
    const ids = new Set(won.map((w) => w.id));
    for (const d of list.filter((x) => ids.has(x.id))) {
      touched.add(d.clinic_id);
      if (status === 'overdue') overdue.set(d.clinic_id, [...(overdue.get(d.clinic_id) ?? []), d]);
    }
  }
  for (const clinicId of touched) await publishNow(clinicId, { t: 'ward' });
  for (const [clinicId, list] of overdue) {
    const first = [...list].sort((a, b) => a.scheduled_at.getTime() - b.scheduled_at.getTime() || a.patient.localeCompare(b.patient))[0];
    const { overdue: total } = await beacons(pool, clinicId, at);
    await publishNow(clinicId, { t: 'overdue', total, patient: first.patient, treatment: first.name, due: clinicHm(first.scheduled_at) });
  }
}

/** Beacon counts that move with the clock alone (a dose entering the next hour) are pushed to open windows. */
async function beaconPush(at: Date): Promise<void> {
  for (const clinicId of subscribedClinics()) {
    const key = JSON.stringify(await beacons(pool, clinicId, at));
    if (lastBeacons.get(clinicId) !== key) {
      if (lastBeacons.has(clinicId)) await publishNow(clinicId, { t: 'ward' });
      lastBeacons.set(clinicId, key);
    }
  }
}

async function pass(): Promise<void> {
  const at = now();
  const from = previous;
  previous = at;
  await lateAndLinger(from < at ? from : at, at);
  await doses(at);
  await lowFlagsChanged(pool, null);
  await processReminders();
  await beaconPush(at);
  if (Date.now() - lastWaitTick >= config.waitTickSeconds * 1000) {
    lastWaitTick = Date.now();
    for (const clinicId of subscribedClinics()) await publish(pool, clinicId, { t: 'queue' });
  }
  await flushMail();
}

async function guarded(): Promise<void> {
  while (running) await running.catch(() => undefined);
  running = pass().finally(() => {
    running = null;
  });
  await running;
}

/** After the grading clock is set: process everything it caused, then push every window a fresh view. */
export async function settle(): Promise<void> {
  lastBeacons.clear();
  previous = new Date(Math.min(previous.getTime(), now().getTime()));
  await guarded();
  lastWaitTick = Date.now();
  for (const t of ['calendar', 'queue', 'ward', 'stock', 'patients'] as const) await publish(pool, EVERY_CLINIC, { t });
}

export function startTicker(): void {
  setInterval(() => void guarded().catch(() => undefined), 1000).unref();
}
