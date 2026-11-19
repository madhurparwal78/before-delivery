import { settings } from '../config';
import { serverNow } from '../clock';
import type { Tx } from '../db';
import { AppError } from '../errors';

export type DoseStatus = 'upcoming' | 'due' | 'overdue' | 'given' | 'skipped';

export type DoseRow = {
  id: string;
  schedule_id: string;
  dose_index: number;
  scheduled_at: Date;
  status: string;
  given_at: Date | null;
  given_by: string | null;
  skip_reason: string | null;
  closed_at: Date | null;
};

export const KENNELS = Array.from({ length: 12 }, (_, index) => `K${index + 1}`);

/** The one place a dose's state is decided, always on the server clock. */
export function doseStatus(row: Pick<DoseRow, 'status' | 'scheduled_at'>, now = serverNow()): DoseStatus {
  if (row.status === 'given') return 'given';
  if (row.status === 'skipped') return 'skipped';
  const scheduled = row.scheduled_at.getTime();
  if (now < scheduled) return 'upcoming';
  if (now < scheduled + settings.treatmentGraceMinutes * 60_000) return 'due';
  return 'overdue';
}

export function doseInstants(firstAt: number, intervalHours: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => firstAt + index * intervalHours * 3_600_000);
}

export function assertGivable(status: DoseStatus, patient: string, treatment: string): void {
  if (status === 'given') throw new AppError('already_given', { patient, treatment });
  if (status === 'skipped') throw new AppError('already_skipped', { patient, treatment });
  if (status === 'upcoming') throw new AppError('not_due', { patient, treatment });
}

export function assertSkippable(status: DoseStatus, patient: string, treatment: string): void {
  if (status === 'given') throw new AppError('already_given', { patient, treatment });
  if (status === 'skipped') throw new AppError('already_skipped', { patient, treatment });
}

export function assertReopenable(status: DoseStatus, patient: string, treatment: string): void {
  if (status !== 'given' && status !== 'skipped') {
    throw new AppError('not_closed', { patient, treatment });
  }
}

export type BoardTreatment = {
  id: string;
  patientId: string;
  patientName: string;
  kennel: string;
  name: string;
  scheduledAt: string;
  status: DoseStatus;
  givenAt: string | null;
  givenBy: string | null;
  skipReason: string | null;
  notes: { id: string; text: string; author: string; createdAt: string }[];
};

const GROUP_ORDER: Record<DoseStatus, number> = {
  overdue: 0,
  due: 1,
  upcoming: 2,
  given: 3,
  skipped: 3,
};

type BoardRow = DoseRow & {
  treatment_name: string;
  kennel: string;
  patient_id: string;
  patient_name: string;
  admission_id: string;
  given_by_name: string | null;
};

export async function wardBoard(
  tx: Tx,
  clinicId: string,
  now = serverNow(),
): Promise<{ treatments: BoardTreatment[]; beacons: { waiting: number; overdue: number; dueWithinHour: number } }> {
  const rows = await tx.query<BoardRow>(
    `select d.*, s.name as treatment_name, a.kennel, a.id as admission_id,
            p.id as patient_id, p.name as patient_name, g.name as given_by_name
       from treatment_doses d
       join treatment_schedules s on s.id = d.schedule_id
       join admissions a on a.id = s.admission_id
       join patients p on p.id = a.patient_id
       left join users g on g.id = d.given_by
      where a.clinic_id = $1`,
    [clinicId],
  );
  const byAdmission = new Map<string, BoardRow[]>();
  for (const row of rows) {
    const list = byAdmission.get(row.admission_id) ?? [];
    list.push(row);
    byAdmission.set(row.admission_id, list);
  }
  const lingerMs = settings.admissionLingerHours * 3_600_000;
  const visible: BoardRow[] = [];
  for (const doses of byAdmission.values()) {
    const open = doses.some((dose) => dose.status === 'open');
    if (open) {
      visible.push(...doses);
      continue;
    }
    const lastClosed = Math.max(
      ...doses.map((dose) => (dose.closed_at ? dose.closed_at.getTime() : 0)),
    );
    if (lastClosed > 0 && now < lastClosed + lingerMs) visible.push(...doses);
  }
  const noteRows = visible.length
    ? await tx.query<{
        id: string;
        dose_id: string;
        text: string;
        author: string | null;
        created_at: Date;
      }>(
        `select n.id, n.dose_id, n.text, u.name as author, n.created_at
           from treatment_notes n left join users u on u.id = n.author_id
          where n.dose_id = any($1) order by n.created_at`,
        [visible.map((row) => row.id)],
      )
    : [];

  const treatments: BoardTreatment[] = visible
    .map((row) => ({
      id: row.id,
      patientId: row.patient_id,
      patientName: row.patient_name,
      kennel: row.kennel,
      name: row.treatment_name,
      scheduledAt: row.scheduled_at.toISOString(),
      status: doseStatus(row, now),
      givenAt: row.given_at ? row.given_at.toISOString() : null,
      givenBy: row.given_by_name,
      skipReason: row.skip_reason,
      notes: noteRows
        .filter((note) => note.dose_id === row.id)
        .map((note) => ({
          id: note.id,
          text: note.text,
          author: note.author ?? '',
          createdAt: note.created_at.toISOString(),
        })),
    }))
    .sort((a, b) => {
      const groups = GROUP_ORDER[a.status] - GROUP_ORDER[b.status];
      if (groups !== 0) return groups;
      return a.scheduledAt < b.scheduledAt ? -1 : a.scheduledAt > b.scheduledAt ? 1 : 0;
    });

  const waitingRow = await tx.one<{ count: string }>(
    `select count(*)::text as count from appointments
      where clinic_id = $1 and status = 'checked-in'`,
    [clinicId],
  );
  const overdue = treatments.filter((treatment) => treatment.status === 'overdue').length;
  const dueWithinHour = treatments.filter(
    (treatment) =>
      (treatment.status === 'due' || treatment.status === 'upcoming') &&
      Date.parse(treatment.scheduledAt) <= now + 3_600_000,
  ).length;
  return {
    treatments,
    beacons: { waiting: Number(waitingRow?.count ?? 0), overdue, dueWithinHour },
  };
}

export async function kennelOccupied(
  tx: Tx,
  clinicId: string,
  kennel: string,
): Promise<boolean> {
  const row = await tx.one<{ id: string }>(
    `select a.id from admissions a
       join treatment_schedules s on s.admission_id = a.id
       join treatment_doses d on d.schedule_id = s.id
      where a.clinic_id = $1 and a.kennel = $2 and d.status = 'open'
      limit 1`,
    [clinicId, kennel],
  );
  return row !== null;
}
