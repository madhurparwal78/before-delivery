import { now } from '../clock.js';
import { copy } from '../copy.js';
import { ApiError, invalid, notFound } from '../errors.js';
import { isUniqueViolation, query } from '../db.js';
import { withAudit } from '../audit.js';
import { readBody, text, whole } from '../fields.js';
import {
  daysInMonth,
  isOfficeDate,
  isOfficeMonth,
  isOfficeTimeOfDay,
  officeDate,
  officeMidnight,
  officeMonth,
  officeOffset,
} from '../officeTime.js';
import { newId } from '../secretStore.js';
import { loadCredential, loadCredentials, loadVendors } from '../domain/credentials.js';
import { dueByAfter, nextRuns, runsInMonth, type RotationRow, type Run } from '../domain/turns.js';
import type { TurnRow } from '../types.js';
import type { Route } from '../http.js';

const DESK_STAFF = ['office_manager', 'managing_partner'] as const;

async function loadRotation(id: string): Promise<RotationRow | null> {
  const rows = await query<RotationRow>('select * from rotations where id = $1', [id]);
  return rows[0] ?? null;
}

function runJson(run: Run): Record<string, unknown> {
  return {
    office_date: run.office_date,
    office_time: run.office_time,
    offset: run.offset,
    at: run.at.toISOString(),
    shifted: run.shifted,
  };
}

function scheduleJson(rotation: RotationRow, at: Date): Record<string, unknown> {
  return {
    id: rotation.id,
    credential_id: rotation.credential_id,
    interval_days: rotation.interval_days,
    at_time: rotation.at_time,
    first_run_on: rotation.first_run_on,
    next_runs: nextRuns(rotation, at, 6).map(runJson),
  };
}

function checkSchedule(
  fields: Record<string, string>,
  intervalDays: number,
  atTime: string,
  firstRunOn: string,
  at: Date,
): void {
  if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 365) {
    fields.interval_days = 'Use a whole number from 1 to 365.';
  }
  if (!isOfficeTimeOfDay(atTime)) fields.at_time = 'Use a time like 02:30.';
  if (!isOfficeDate(firstRunOn) || firstRunOn < officeDate(at)) {
    fields.first_run_on = 'Pick today or a later date.';
  }
}

export const rotationRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/rotations',
    roles: ['office_manager'],
    handler: async (ctx) => {
      const body = readBody(ctx.body, {
        credential_id: { kind: 'string' },
        interval_days: { kind: 'integer' },
        at_time: { kind: 'string' },
        first_run_on: { kind: 'string' },
      });
      const at = now();
      const credential = await loadCredential(text(body, 'credential_id'));
      if (credential === null) throw notFound();
      const existing = await query<{ id: string }>('select id from rotations where credential_id = $1', [
        credential.id,
      ]);
      if (existing.length > 0) throw new ApiError(409, 'rotation_exists', copy.rotationExists);

      const intervalDays = whole(body, 'interval_days');
      const atTime = text(body, 'at_time');
      const firstRunOn = text(body, 'first_run_on');
      const fields: Record<string, string> = {};
      checkSchedule(fields, intervalDays, atTime, firstRunOn, at);
      if (Object.keys(fields).length > 0) throw invalid(fields);
      const draft: RotationRow = {
        id: newId(),
        credential_id: credential.id,
        interval_days: intervalDays,
        at_time: atTime,
        first_run_on: firstRunOn,
        created_at: at,
      };
      if (nextRuns(draft, at, 1).length === 0) throw invalid({ first_run_on: 'Pick a first run in the future.' });

      try {
        await withAudit(async (client, write) => {
          await client.query(
            `insert into rotations (id, credential_id, interval_days, at_time, first_run_on)
             values ($1,$2,$3,$4,$5)`,
            [draft.id, credential.id, intervalDays, atTime, firstRunOn],
          );
          await write({
            actor: { personId: ctx.caller.person.id, name: ctx.caller.person.full_name },
            action: 'rotation_schedule',
            subject: { kind: 'credential', id: credential.id, name: credential.label },
            details: { interval_days: intervalDays, at_time: atTime, first_run_on: firstRunOn },
          });
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new ApiError(409, 'rotation_exists', copy.rotationExists);
        throw error;
      }
      const saved = await loadRotation(draft.id);
      if (saved === null) throw notFound();
      return { status: 201, body: scheduleJson(saved, at) };
    },
  },
  {
    method: 'PATCH',
    path: '/api/rotations/:id',
    roles: ['office_manager'],
    handler: async (ctx) => {
      const rotation = await loadRotation(ctx.params.id as string);
      if (rotation === null) throw notFound();
      const body = readBody(ctx.body, {
        credential_id: { kind: 'string' },
        interval_days: { kind: 'integer' },
        at_time: { kind: 'string' },
        first_run_on: { kind: 'string' },
      });
      const at = now();
      const credential = await loadCredential(text(body, 'credential_id'));
      const intervalDays = whole(body, 'interval_days');
      const atTime = text(body, 'at_time');
      const firstRunOn = text(body, 'first_run_on');
      const fields: Record<string, string> = {};
      if (credential === null || credential.id !== rotation.credential_id) {
        fields.credential_id = 'A schedule stays with its login.';
      }
      checkSchedule(fields, intervalDays, atTime, firstRunOn, at);
      if (Object.keys(fields).length > 0) throw invalid(fields);

      await withAudit(async (client, write) => {
        await client.query('update rotations set interval_days = $2, at_time = $3, first_run_on = $4 where id = $1', [
          rotation.id,
          intervalDays,
          atTime,
          firstRunOn,
        ]);
        await write({
          actor: { personId: ctx.caller.person.id, name: ctx.caller.person.full_name },
          action: 'rotation_change',
          subject: { kind: 'credential', id: rotation.credential_id, name: credential?.label ?? '' },
          details: { interval_days: intervalDays, at_time: atTime, first_run_on: firstRunOn },
        });
      });
      const saved = await loadRotation(rotation.id);
      if (saved === null) throw notFound();
      return { status: 200, body: scheduleJson(saved, at) };
    },
  },
  {
    method: 'GET',
    path: '/api/rotations/calendar',
    roles: DESK_STAFF,
    handler: async (ctx) => {
      const at = now();
      const given = ctx.query.get('month');
      if (given !== null && !isOfficeMonth(given)) throw invalid({ month: 'Use a month like 2027-01.' });
      const month = given ?? officeMonth(at);
      const credentials = await loadCredentials(null);
      const vendors = await loadVendors();
      const rotations = await query<RotationRow>('select * from rotations');
      const turns = await query<TurnRow>('select * from turns');

      const year = Number(month.slice(0, 4));
      const monthNumber = Number(month.slice(5, 7));
      const days: Record<string, unknown>[] = [];
      for (let day = 1; day <= daysInMonth(year, monthNumber); day += 1) {
        const date = `${month}-${String(day).padStart(2, '0')}`;
        const entries: Record<string, unknown>[] = [];
        for (const rotation of rotations) {
          const credential = credentials.find((entry) => entry.id === rotation.credential_id);
          if (credential === undefined) continue;
          const vendor = vendors.find((entry) => entry.id === credential.vendor_id);
          for (const run of runsInMonth(rotation, month)) {
            if (run.office_date !== date) continue;
            const turn = turns.find(
              (entry) => entry.rotation_id === rotation.id && entry.run_at?.getTime() === run.at.getTime(),
            );
            entries.push({
              turn_id: turn?.id ?? null,
              rotation_id: rotation.id,
              credential_id: credential.id,
              label: credential.label,
              vendor: { name: vendor?.name ?? '', formerly: vendor?.formerly ?? null },
              kind: 'scheduled',
              office_time: run.office_time,
              offset: run.offset,
              at: run.at.toISOString(),
              shifted: run.shifted,
              due_by: dueByAfter(run.office_date),
              state: turn?.state ?? 'scheduled',
            });
          }
        }
        for (const turn of turns) {
          if (turn.kind !== 'scope_loss' || turn.due_by !== date) continue;
          const credential = credentials.find((entry) => entry.id === turn.credential_id);
          if (credential === undefined) continue;
          const vendor = vendors.find((entry) => entry.id === credential.vendor_id);
          entries.push({
            turn_id: turn.id,
            rotation_id: null,
            credential_id: credential.id,
            label: credential.label,
            vendor: { name: vendor?.name ?? '', formerly: vendor?.formerly ?? null },
            kind: 'scope_loss',
            office_time: null,
            offset: officeOffset(officeMidnight(date)),
            at: null,
            shifted: false,
            due_by: turn.due_by,
            state: turn.state,
          });
        }
        days.push({ office_date: date, offset: officeOffset(officeMidnight(date)), entries });
      }
      return { status: 200, body: { month, days } };
    },
  },
  {
    method: 'GET',
    path: '/api/rotations/:id',
    handler: async (ctx) => {
      const rotation = await loadRotation(ctx.params.id as string);
      if (rotation === null) throw notFound();
      return { status: 200, body: scheduleJson(rotation, now()) };
    },
  },
];
