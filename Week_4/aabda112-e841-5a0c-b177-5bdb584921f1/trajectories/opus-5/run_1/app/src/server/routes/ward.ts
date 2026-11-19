import { Router } from 'express';
import { parseClinicDateTime, serverNow } from '../clock';
import { newId, one, transaction, type Tx } from '../db';
import { AppError, invalid } from '../errors';
import { body, created, findPatient, ok, route } from '../http';
import { requireActor, requireCapability } from '../auth';
import { publish } from '../live';
import {
  assertGivable,
  assertReopenable,
  assertSkippable,
  doseInstants,
  doseStatus,
  KENNELS,
  kennelOccupied,
  wardBoard,
} from '../domain/ward';

export const wardRouter = Router();

wardRouter.get(
  '/api/ward/board',
  route(async (request) => {
    const actor = await requireActor(request);
    const board = await transaction((tx) => wardBoard(tx, actor.clinicId));
    return ok(board);
  }),
);

wardRouter.get(
  '/api/beacons',
  route(async (request) => {
    const actor = await requireActor(request);
    const board = await transaction((tx) => wardBoard(tx, actor.clinicId));
    return ok(board.beacons);
  }),
);

type TreatmentInput = { name: string; firstAt: number; intervalHours: number; count: number };

function readTreatments(input: Record<string, unknown>): TreatmentInput[] {
  const list = input.treatments;
  if (!Array.isArray(list) || list.length === 0) throw invalid('treatments', 'missing');
  return list.map((raw, index) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const path = `treatments.${index}`;
    if (typeof item.name !== 'string' || item.name.trim().length === 0) {
      throw invalid(`${path}.name`, 'missing');
    }
    if (item.name.trim().length > 120) throw invalid(`${path}.name`);
    const firstAt = parseClinicDateTime(item.firstAt);
    if (firstAt === 'malformed') {
      throw invalid(`${path}.firstAt`, item.firstAt === undefined ? 'missing' : 'invalid');
    }
    if (firstAt === null) throw invalid(`${path}.firstAt`);
    if (
      typeof item.intervalHours !== 'number' ||
      !Number.isInteger(item.intervalHours) ||
      item.intervalHours < 1 ||
      item.intervalHours > 24
    ) {
      throw invalid(`${path}.intervalHours`);
    }
    if (
      typeof item.count !== 'number' ||
      !Number.isInteger(item.count) ||
      item.count < 1 ||
      item.count > 28
    ) {
      throw invalid(`${path}.count`);
    }
    return {
      name: item.name.trim(),
      firstAt,
      intervalHours: item.intervalHours,
      count: item.count,
    };
  });
}

export async function createAdmission(
  tx: Tx,
  input: {
    clinicId: string;
    patientId: string;
    kennel: string;
    treatments: TreatmentInput[];
    now: number;
  },
): Promise<{ id: string; treatmentIds: string[] }> {
  if (await kennelOccupied(tx, input.clinicId, input.kennel)) {
    throw new AppError('kennel_taken', { kennel: input.kennel });
  }
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
      await tx.query(
        `insert into treatment_doses (id, schedule_id, dose_index, scheduled_at, overdue_announced)
         values ($1,$2,$3,$4,$5)`,
        [doseId, scheduleId, index, new Date(instant).toISOString(), instant <= input.now],
      );
      treatmentIds.push(doseId);
    }
  }
  return { id: admissionId, treatmentIds };
}

wardRouter.post(
  '/api/ward/admissions',
  route(async (request) => {
    const actor = await requireActor(request);
    const input = body(request);
    const patient = await findPatient(input.patientId, actor.clinicId);
    requireCapability(actor, 'ward.manage');
    const kennel = typeof input.kennel === 'string' ? input.kennel.trim() : '';
    if (!kennel) throw invalid('kennel', 'missing');
    if (!KENNELS.includes(kennel)) throw invalid('kennel');
    const treatments = readTreatments(input);
    const now = serverNow();
    const result = await transaction(async (tx) => {
      await tx.query('select pg_advisory_xact_lock(hashtext($1), 4)', [actor.clinicId]);
      return createAdmission(tx, {
        clinicId: actor.clinicId,
        patientId: patient.id,
        kennel,
        treatments,
        now,
      });
    });
    publish(actor.clinicId, { kind: 'changed', topics: ['ward', 'beacons', 'patients'] });
    return created(result);
  }),
);

type DoseContext = {
  doseId: string;
  patientName: string;
  treatmentName: string;
  scheduledAt: Date;
  status: string;
};

async function loadDose(id: unknown, clinicId: string): Promise<DoseContext> {
  if (typeof id !== 'string') throw new AppError('not_found');
  const row = await one<{
    id: string;
    status: string;
    scheduled_at: Date;
    treatment_name: string;
    patient_name: string;
  }>(
    `select d.id, d.status, d.scheduled_at, s.name as treatment_name, p.name as patient_name
       from treatment_doses d
       join treatment_schedules s on s.id = d.schedule_id
       join admissions a on a.id = s.admission_id
       join patients p on p.id = a.patient_id
      where d.id = $1 and a.clinic_id = $2`,
    [id, clinicId],
  );
  if (!row) throw new AppError('not_found');
  return {
    doseId: row.id,
    patientName: row.patient_name,
    treatmentName: row.treatment_name,
    scheduledAt: row.scheduled_at,
    status: row.status,
  };
}

async function doseResponse(clinicId: string, doseId: string): Promise<Record<string, unknown>> {
  const board = await transaction((tx) => wardBoard(tx, clinicId));
  const treatment = board.treatments.find((candidate) => candidate.id === doseId);
  if (!treatment) throw new AppError('not_found');
  return treatment as unknown as Record<string, unknown>;
}

wardRouter.post(
  '/api/treatments/:id/given',
  route(async (request) => {
    const actor = await requireActor(request);
    const dose = await loadDose(request.params.id, actor.clinicId);
    requireCapability(actor, 'ward.manage');
    const now = serverNow();
    await transaction(async (tx) => {
      const current = await tx.one<{ status: string; scheduled_at: Date }>(
        'select status, scheduled_at from treatment_doses where id = $1 for update',
        [dose.doseId],
      );
      if (!current) throw new AppError('not_found');
      assertGivable(doseStatus(current, now), dose.patientName, dose.treatmentName);
      await tx.query(
        `update treatment_doses set status = 'given', given_at = $2, given_by = $3, closed_at = $2,
           skip_reason = null where id = $1`,
        [dose.doseId, new Date(now).toISOString(), actor.id],
      );
    });
    publish(actor.clinicId, { kind: 'changed', topics: ['ward', 'beacons'] });
    return ok(await doseResponse(actor.clinicId, dose.doseId));
  }),
);

wardRouter.post(
  '/api/treatments/:id/skip',
  route(async (request) => {
    const actor = await requireActor(request);
    const dose = await loadDose(request.params.id, actor.clinicId);
    requireCapability(actor, 'ward.manage');
    const input = body(request);
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    const now = serverNow();
    await transaction(async (tx) => {
      const current = await tx.one<{ status: string; scheduled_at: Date }>(
        'select status, scheduled_at from treatment_doses where id = $1 for update',
        [dose.doseId],
      );
      if (!current) throw new AppError('not_found');
      const status = doseStatus(current, now);
      assertSkippable(status, dose.patientName, dose.treatmentName);
      if (status === 'upcoming') {
        throw new AppError('not_due', {
          patient: dose.patientName,
          treatment: dose.treatmentName,
        });
      }
      if (reason.length === 0) throw invalid('reason', 'missing');
      if (reason.length > 200) throw invalid('reason');
      await tx.query(
        `update treatment_doses set status = 'skipped', skip_reason = $2, closed_at = $3,
           given_at = null, given_by = $4 where id = $1`,
        [dose.doseId, reason, new Date(now).toISOString(), actor.id],
      );
    });
    publish(actor.clinicId, { kind: 'changed', topics: ['ward', 'beacons'] });
    return ok(await doseResponse(actor.clinicId, dose.doseId));
  }),
);

wardRouter.post(
  '/api/treatments/:id/reopen',
  route(async (request) => {
    const actor = await requireActor(request);
    const dose = await loadDose(request.params.id, actor.clinicId);
    requireCapability(actor, 'ward.manage');
    const now = serverNow();
    await transaction(async (tx) => {
      const current = await tx.one<{ status: string; scheduled_at: Date }>(
        'select status, scheduled_at from treatment_doses where id = $1 for update',
        [dose.doseId],
      );
      if (!current) throw new AppError('not_found');
      assertReopenable(doseStatus(current, now), dose.patientName, dose.treatmentName);
      await tx.query(
        `update treatment_doses set status = 'open', given_at = null, given_by = null,
           skip_reason = null, closed_at = null,
           overdue_announced = (scheduled_at <= $2) where id = $1`,
        [dose.doseId, new Date(now).toISOString()],
      );
    });
    publish(actor.clinicId, { kind: 'changed', topics: ['ward', 'beacons'] });
    return ok(await doseResponse(actor.clinicId, dose.doseId));
  }),
);

wardRouter.post(
  '/api/treatments/:id/notes',
  route(async (request) => {
    const actor = await requireActor(request);
    const dose = await loadDose(request.params.id, actor.clinicId);
    requireCapability(actor, 'ward.manage');
    const input = body(request);
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    if (text.length === 0) throw invalid('text', 'missing');
    if (text.length > 2000) throw invalid('text');
    const id = newId();
    await transaction((tx) =>
      tx.query('insert into treatment_notes (id, dose_id, text, author_id, created_at) values ($1,$2,$3,$4,$5)', [
        id,
        dose.doseId,
        text,
        actor.id,
        new Date(serverNow()).toISOString(),
      ]),
    );
    publish(actor.clinicId, { kind: 'changed', topics: ['ward'] });
    return created({ id, text, author: actor.name, createdAt: new Date(serverNow()).toISOString() });
  }),
);
