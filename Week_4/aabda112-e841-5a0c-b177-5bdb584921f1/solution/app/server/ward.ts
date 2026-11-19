import { KENNELS, type TreatmentStatus } from '../shared/domain.js';
import { clinicInstant } from '../shared/clinictime.js';
import { config } from './config.js';
import { now } from './clock.js';
import { type Db, one, pool, rows, transaction } from './db.js';
import { AppError, invalid } from './errors.js';
import { route } from './http.js';
import { publish } from './live.js';
import { type Body, loadIn, ref, text } from './support.js';

interface DoseRow {
  id: string;
  admission_id: string;
  clinic_id: string;
  patient_id: string;
  patient_name: string;
  kennel: string;
  name: string;
  idx: number;
  scheduled_at: Date;
  state: 'open' | 'given' | 'skipped';
  closed_at: Date | null;
  given_by_name: string | null;
  skip_reason: string | null;
  seen_status: string | null;
}

/**
 * The one due/overdue rule, in elapsed minutes on the server clock: upcoming before the scheduled time, due until
 * the grace has passed, overdue from that moment on.
 */
export function doseStatus(dose: Pick<DoseRow, 'state' | 'scheduled_at'>, at: Date): TreatmentStatus {
  if (dose.state === 'given') return 'given';
  if (dose.state === 'skipped') return 'skipped';
  const late = (at.getTime() - dose.scheduled_at.getTime()) / 60_000;
  if (late < 0) return 'upcoming';
  return late < config.treatmentGraceMinutes ? 'due' : 'overdue';
}

const DOSES = `
  SELECT t.id, t.admission_id, a.clinic_id, a.patient_id, p.name AS patient_name, a.kennel, t.name, t.idx,
         t.scheduled_at, t.state, t.closed_at, t.skip_reason, t.seen_status, g.name AS given_by_name
    FROM treatments t
    JOIN admissions a ON a.id = t.admission_id
    JOIN patients p ON p.id = a.patient_id
    LEFT JOIN users g ON g.id = t.given_by`;

/** An admission is active while any dose is open and for ADMISSION_LINGER_HOURS after its last dose was closed. */
const ACTIVE_ADMISSION = `
  (EXISTS (SELECT 1 FROM treatments o WHERE o.admission_id = a.id AND o.state = 'open')
   OR (SELECT max(c.closed_at) FROM treatments c WHERE c.admission_id = a.id) + make_interval(hours => $2) > $3)`;

const GROUP_ORDER: Record<TreatmentStatus, number> = { overdue: 0, due: 1, upcoming: 2, given: 3, skipped: 3 };

interface Beacons {
  waiting: number;
  overdue: number;
  dueWithinHour: number;
}

function beaconsOf(doses: Pick<DoseRow, 'state' | 'scheduled_at'>[], waiting: number, at: Date): Beacons {
  let overdue = 0;
  let dueWithinHour = 0;
  for (const dose of doses) {
    const status = doseStatus(dose, at);
    if (status === 'overdue') overdue++;
    else if ((status === 'due' || status === 'upcoming') && dose.scheduled_at.getTime() <= at.getTime() + 3_600_000) dueWithinHour++;
  }
  return { waiting, overdue, dueWithinHour };
}

async function waitingCount(db: Db, clinicId: string): Promise<number> {
  return (await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM appointments WHERE clinic_id = $1 AND status = 'checked-in'`, [clinicId]))!.n;
}

async function activeDoses(db: Db, clinicId: string, at: Date): Promise<DoseRow[]> {
  return rows<DoseRow>(db, `${DOSES} WHERE a.clinic_id = $1 AND ${ACTIVE_ADMISSION}`, [clinicId, config.admissionLingerHours, at]);
}

export async function beacons(db: Db, clinicId: string, at: Date): Promise<Beacons> {
  const open = await rows<DoseRow>(db, `${DOSES} WHERE a.clinic_id = $1 AND t.state = 'open'`, [clinicId]);
  return beaconsOf(open, await waitingCount(db, clinicId), at);
}

async function board(db: Db, clinicId: string, at: Date) {
  const doses = await activeDoses(db, clinicId, at);
  const notes = doses.length
    ? await rows<{ id: string; treatment_id: string; text: string; author: string | null; created_at: Date }>(
        db,
        `SELECT n.id, n.treatment_id, n.text, u.name AS author, n.created_at FROM treatment_notes n
           LEFT JOIN users u ON u.id = n.author_id WHERE n.treatment_id = ANY($1::uuid[]) ORDER BY n.seq`,
        [doses.map((d) => d.id)],
      )
    : [];
  const ordered = doses
    .map((d) => ({ d, status: doseStatus(d, at) }))
    .sort((x, y) => GROUP_ORDER[x.status] - GROUP_ORDER[y.status] || x.d.scheduled_at.getTime() - y.d.scheduled_at.getTime() || x.d.patient_name.localeCompare(y.d.patient_name) || x.d.idx - y.d.idx);
  return {
    beacons: beaconsOf(doses.filter((d) => d.state === 'open'), await waitingCount(db, clinicId), at),
    treatments: ordered.map(({ d, status }) => shapeDose(d, status, notes.filter((n) => n.treatment_id === d.id))),
  };
}

function shapeDose(d: DoseRow, status: TreatmentStatus, notes: { id: string; text: string; author: string | null; created_at: Date }[]) {
  return {
    id: d.id,
    patientId: d.patient_id,
    patientName: d.patient_name,
    kennel: d.kennel,
    name: d.name,
    scheduledAt: d.scheduled_at.toISOString(),
    status,
    givenAt: d.state === 'given' ? d.closed_at?.toISOString() ?? null : null,
    givenBy: d.state === 'given' ? d.given_by_name : null,
    skipReason: d.state === 'skipped' ? d.skip_reason : null,
    notes: notes.map((n) => ({ id: n.id, text: n.text, author: n.author, createdAt: n.created_at.toISOString() })),
  };
}

async function loadDose(db: Db, clinicId: string, id: string): Promise<DoseRow> {
  return loadIn<DoseRow>(db, `${DOSES} WHERE t.id = $1 AND a.clinic_id = $2`, id, clinicId);
}

async function oneDose(db: Db, clinicId: string, id: string) {
  const dose = await loadDose(db, clinicId, id);
  const notes = await rows<{ id: string; text: string; author: string | null; created_at: Date }>(
    db,
    `SELECT n.id, n.text, u.name AS author, n.created_at FROM treatment_notes n LEFT JOIN users u ON u.id = n.author_id WHERE n.treatment_id = $1 ORDER BY n.seq`,
    [id],
  );
  return shapeDose(dose, doseStatus(dose, now()), notes);
}

const pair = (d: Pick<DoseRow, 'patient_name' | 'name'>) => `${d.patient_name}, ${d.name}`;

async function wardChanged(db: Db, clinicId: string): Promise<void> {
  await publish(db, clinicId, { t: 'ward' });
  await publish(db, clinicId, { t: 'patients' });
}

export interface TreatmentPlan {
  name: string;
  firstAt: Date;
  intervalHours: number;
  count: number;
}

/** One admission with its doses: dose k is the first dose plus k times the interval, in elapsed hours. */
export async function admit(
  db: Db,
  clinicId: string,
  patientId: string,
  kennel: string,
  plans: TreatmentPlan[],
  closedDoses: (plan: number) => number[] = () => [],
  at: Date = now(),
): Promise<{ id: string; treatmentIds: string[][] }> {
  const admission = (await one<{ id: string }>(db, 'INSERT INTO admissions (clinic_id, patient_id, kennel) VALUES ($1, $2, $3) RETURNING id', [clinicId, patientId, kennel]))!;
  const ids: string[][] = [];
  for (const [p, plan] of plans.entries()) {
    const closed = new Set(closedDoses(p));
    const created: string[] = [];
    for (let k = 0; k < plan.count; k++) {
      const scheduled = new Date(plan.firstAt.getTime() + k * plan.intervalHours * 3_600_000);
      const open = !closed.has(k);
      const status = doseStatus({ state: open ? 'open' : 'given', scheduled_at: scheduled }, at);
      const row = await one<{ id: string }>(
        db,
        `INSERT INTO treatments (admission_id, name, idx, scheduled_at, state, closed_at, seen_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [admission.id, plan.name, k, scheduled, open ? 'open' : 'given', open ? null : at, open ? status : null],
      );
      created.push(row!.id);
    }
    ids.push(created);
  }
  return { id: admission.id, treatmentIds: ids };
}

function parsePlans(body: Body): TreatmentPlan[] {
  const raw = body.treatments;
  if (raw === undefined) throw invalid('treatments', 'treatments', true);
  if (!Array.isArray(raw) || raw.length === 0) throw invalid('treatments', 'treatments');
  return raw.map((item, i) => {
    const entry = (item ?? {}) as Body;
    const path = (key: string) => `treatments.${i}.${key}`;
    const field = (key: string, label: string) => ({ key: path(key), label });
    const nameField = field('name', 'Treatment');
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (entry.name === undefined || name === '') throw invalid(nameField.key, nameField.label, true);
    if ([...name].length > 120) throw invalid(nameField.key, nameField.label);
    const dose = field('firstAt', 'First dose');
    if (entry.firstAt === undefined || entry.firstAt === '') throw invalid(dose.key, dose.label, true);
    const m = typeof entry.firstAt === 'string' ? /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/.exec(entry.firstAt) : null;
    const firstAt = m ? clinicInstant(m[1], Number(m[2]), Number(m[3])) : null;
    if (!firstAt) throw invalid(dose.key, dose.label);
    const interval = field('intervalHours', 'Every (hours)');
    const doses = field('count', 'Doses');
    return {
      name,
      firstAt,
      intervalHours: wholeAt(entry, 'intervalHours', 1, 24, interval),
      count: wholeAt(entry, 'count', 1, 28, doses),
    };
  });
}

function wholeAt(entry: Body, key: string, min: number, max: number, field: { key: string; label: string }): number {
  const raw = entry[key];
  if (raw === undefined || raw === null) throw invalid(field.key, field.label, true);
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min || raw > max) throw invalid(field.key, field.label);
  return raw;
}

export function registerWardRoutes(): void {
  route('GET', '/api/ward/board', async (ctx) => {
    const user = await ctx.user();
    ctx.send(200, await board(pool, user.clinicId, now()));
  });

  route('GET', '/api/beacons', async (ctx) => {
    const user = await ctx.user();
    ctx.send(200, await beacons(pool, user.clinicId, now()));
  });

  route('POST', '/api/ward/admissions', async (ctx) => {
    const user = await ctx.user();
    const body = await ctx.json();
    const patient = await ref(body, 'patientId', (id) => one<{ id: string }>(pool, 'SELECT id FROM patients WHERE id = $1 AND clinic_id = $2', [id, user.clinicId]));
    ctx.allow(user, 'ward.act');
    if (!patient) throw invalid('patientId', 'Patient', true);
    const kennel = text(body, 'kennel');
    if (!KENNELS.includes(kennel)) throw invalid('kennel', 'Kennel');
    const plans = parsePlans(body);
    const made = await transaction(user.clinicId, async (db) => {
      const taken = await one(
        db,
        `SELECT 1 FROM admissions a WHERE a.clinic_id = $1 AND a.kennel = $2
            AND EXISTS (SELECT 1 FROM treatments o WHERE o.admission_id = a.id AND o.state = 'open')`,
        [user.clinicId, kennel],
      );
      if (taken) throw new AppError('kennel_taken', `Kennel ${kennel} is already occupied.`);
      const result = await admit(db, user.clinicId, patient.id, kennel, plans);
      await wardChanged(db, user.clinicId);
      return result;
    });
    ctx.send(201, { id: made.id, treatmentIds: made.treatmentIds.flat() });
  });

  const doseAction = (action: 'given' | 'reopen' | 'skip' | 'notes') =>
    route('POST', `/api/treatments/:id/${action}`, async (ctx) => {
      const user = await ctx.user();
      await loadDose(pool, user.clinicId, ctx.params.id);
      ctx.allow(user, 'ward.act');
      const body = action === 'skip' || action === 'notes' ? await ctx.json() : {};
      const result = await transaction(user.clinicId, async (db) => {
        const dose = await loadDose(db, user.clinicId, ctx.params.id);
        const at = now();
        const status = doseStatus(dose, at);
        if (action === 'notes') {
          const value = text(body, 'text', { max: 1000, label: 'Note' });
          const added = await one<{ id: string }>(
            db,
            'INSERT INTO treatment_notes (treatment_id, text, author_id, created_at) VALUES ($1, $2, $3, $4) RETURNING id',
            [dose.id, value, user.id, at],
          );
          await wardChanged(db, user.clinicId);
          return { status: 201, body: { id: added!.id, text: value, author: user.name, createdAt: at.toISOString() } };
        }
        if (action === 'reopen') {
          if (dose.state === 'open') throw new AppError('not_closed', `${pair(dose)} is not given or skipped.`);
          const reopened = { state: 'open' as const, scheduled_at: dose.scheduled_at };
          await db.query(`UPDATE treatments SET state = 'open', closed_at = NULL, given_by = NULL, skip_reason = NULL, seen_status = $2 WHERE id = $1`, [dose.id, doseStatus(reopened, at)]);
        } else {
          if (status === 'given') throw new AppError('already_given', `${pair(dose)} was already given.`);
          if (status === 'skipped') throw new AppError('already_skipped', `${pair(dose)} was skipped.`);
          if (status === 'upcoming') throw new AppError('not_due', `${pair(dose)} is not due yet.`);
          if (action === 'given') {
            await db.query(`UPDATE treatments SET state = 'given', closed_at = $2, given_by = $3, seen_status = NULL WHERE id = $1`, [dose.id, at, user.id]);
          } else {
            const reason = text(body, 'reason', { max: 200 });
            await db.query(`UPDATE treatments SET state = 'skipped', closed_at = $2, given_by = $3, skip_reason = $4, seen_status = NULL WHERE id = $1`, [dose.id, at, user.id, reason]);
          }
        }
        await wardChanged(db, user.clinicId);
        return { status: 200, body: null };
      });
      ctx.send(result.status, result.body ?? (await oneDose(pool, user.clinicId, ctx.params.id)));
    });

  doseAction('given');
  doseAction('reopen');
  doseAction('skip');
  doseAction('notes');
}

