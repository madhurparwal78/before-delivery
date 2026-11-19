import type { Ctx } from './apiRoutes.js';
import { ApiError, conflict, invalid, notFound } from './errors.js';
import { jsonOk, readJsonBody, checkBody, type BodySpec } from './http.js';
import { COPY } from './apiCore.js';
import { requireRole, visibleNow } from './handlersCore.js';
import {
  addDays,
  daysInMonth,
  formatOfficeDate,
  midnightOffset,
  monthOfDate,
  officeDateString,
  officeLocalInstant,
  officeMidnightInstant,
  officeTimeString,
  offsetAbbreviation,
  parseMonth,
  secondBusinessDayAfter
} from './officeTime.js';
import { randomUUID } from 'node:crypto';

/**
 * Rotation runs keep their office wall-clock time across DST. A local time
 * skipped by spring-forward moves to the first valid minute after it and is
 * marked `shifted`. A local time repeated by fall-back means its first occurrence.
 */
export function rotationRunInstant(dateStr: string, time: string): { at: Date; shifted: boolean } {
  const at = officeLocalInstant(dateStr, time);
  const shifted = officeTimeString(at) !== time;
  return { at, shifted };
}

/** The six next runs of a schedule from now. */
export function nextRuns(intervalDays: number, atTime: string, firstRunOn: string, now: Date): Array<{ office_date: string; office_time: string; offset: string; at: string; shifted: boolean }> {
  const runs: Array<{ office_date: string; office_time: string; offset: string; at: string; shifted: boolean }> = [];
  let cursor = firstRunOn;
  let found = 0;
  while (found < 6) {
    const { at, shifted } = rotationRunInstant(cursor, atTime);
    if (at.getTime() > now.getTime()) {
      runs.push({
        office_date: cursor,
        office_time: officeTimeString(at),
        offset: offsetAbbreviation(at),
        at: at.toISOString(),
        shifted
      });
      found += 1;
    }
    cursor = addDays(cursor, intervalDays);
  }
  return runs;
}

export async function createRotation(ctx: Ctx): Promise<void> {
  requireRole(ctx, 'office_manager');
  const raw = await readJsonBody(ctx.req, ctx.res, 16384);
  if (raw instanceof ApiError) throw raw;
  const body = raw as Record<string, unknown>;
  const spec: BodySpec = {
    credential_id: { type: 'string', required: true },
    interval_days: { type: 'number', required: true },
    at_time: { type: 'string', required: true },
    first_run_on: { type: 'string', required: true }
  };
  const bodyError = checkBody(spec, body);
  if (bodyError) throw bodyError;
  const credentialId = String(body.credential_id ?? '');
  const intervalDays = Number(body.interval_days);
  const atTime = String(body.at_time ?? '');
  const firstRunOn = String(body.first_run_on ?? '');
  const credentialRows = await ctx.store.pool.query(
    'SELECT c.*, v.name AS vendor_name FROM credentials c JOIN vendors v ON v.id = c.vendor_id WHERE c.id = $1',
    [credentialId]
  );
  if (credentialRows.rows.length === 0 || !ctx.person) {
    throw invalid({ credential_id: 'Pick a login that exists.' });
  }
  const credential = credentialRows.rows[0];
  const visible = new Set(await visibleNow(ctx, ctx.person));
  if (!visible.has(String(credential.vault_id))) throw notFound();
  const existing = await ctx.store.pool.query('SELECT id FROM rotations WHERE credential_id = $1', [credentialId]);
  if (existing.rows.length > 0) throw conflict('rotation_exists', COPY.rotationExists);
  const now = ctx.store.clock.now();
  const today = officeDateString(now);
  const fields: Record<string, string> = {};
  if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 365) {
    fields.interval_days = 'Give a whole number from 1 to 365.';
  }
  if (!/^\d{2}:\d{2}$/.test(atTime) || !/^\d{4}-\d{2}-\d{2}$/.test(firstRunOn)) {
    fields.at_time = 'Give the office time as HH:MM.';
    fields.first_run_on = 'Give the first run date as a real date.';
  } else {
    const firstInstant = officeLocalInstant(firstRunOn, atTime);
    if (firstRunOn < today || firstInstant.getTime() <= now.getTime()) {
      fields.first_run_on = 'Pick a first run in the future.';
    }
  }
  if (Object.keys(fields).length > 0) throw invalid(fields);
  const id = randomUUID();
  await ctx.store.transaction(async (client) => {
    // One rotation per login: unique index guards the race.
    await client.query(
      'INSERT INTO rotations (id, credential_id, interval_days, at_time, first_run_on, created_seq) VALUES ($1,$2,$3,$4,$5,nextval(\'row_seq_seq\'::regclass)) ON CONFLICT (credential_id) DO NOTHING',
      [id, credentialId, intervalDays, atTime, firstRunOn]
    );
    const kept = await client.query('SELECT id FROM rotations WHERE credential_id = $1', [credentialId]);
    if (kept.rows.length === 0 || String(kept.rows[0].id) !== id) {
      throw conflict('rotation_exists', COPY.rotationExists);
    }
    await ctx.store.writeAudit(client, { personId: ctx.person!.id, name: ctx.person!.full_name }, [
      { action: 'rotation_schedule', subject: { kind: 'credential', id: credentialId, name: String(credential.label) } }
    ]);
  });
  jsonOk(ctx.res, 201, rotationView(ctx, id, credentialId, intervalDays, atTime, firstRunOn));
}

function rotationView(ctx: Ctx, id: string, credentialId: string, intervalDays: number, atTime: string, firstRunOn: string): Record<string, unknown> {
  return {
    id,
    credential_id: credentialId,
    interval_days: intervalDays,
    at_time: atTime,
    first_run_on: firstRunOn,
    next_runs: nextRuns(intervalDays, atTime, firstRunOn, ctx.store.clock.now())
  };
}

export async function patchRotation(ctx: Ctx): Promise<void> {
  requireRole(ctx, 'office_manager');
  const rows = await ctx.store.pool.query('SELECT * FROM rotations WHERE id = $1', [ctx.params.id]);
  if (rows.rows.length === 0) throw notFound();
  const rotation = rows.rows[0];
  const raw = await readJsonBody(ctx.req, ctx.res, 16384);
  if (raw instanceof ApiError) throw raw;
  const body = raw as Record<string, unknown>;
  const spec: BodySpec = {
    credential_id: { type: 'string', required: true },
    interval_days: { type: 'number', required: true },
    at_time: { type: 'string', required: true },
    first_run_on: { type: 'string', required: true }
  };
  const bodyError = checkBody(spec, body);
  if (bodyError) throw bodyError;
  const intervalDays = Number(body.interval_days);
  const atTime = String(body.at_time ?? '');
  const firstRunOn = String(body.first_run_on ?? '');
  const now = ctx.store.clock.now();
  const today = officeDateString(now);
  const fields: Record<string, string> = {};
  if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 365) {
    fields.interval_days = 'Give a whole number from 1 to 365.';
  }
  if (!/^\d{2}:\d{2}$/.test(atTime) || !/^\d{4}-\d{2}-\d{2}$/.test(firstRunOn)) {
    fields.at_time = 'Give the office time as HH:MM.';
    fields.first_run_on = 'Give the first run date as a real date.';
  } else if (officeLocalInstant(firstRunOn, atTime).getTime() <= now.getTime()) {
    fields.first_run_on = 'Pick a first run in the future.';
  }
  if (firstRunOn < today) fields.first_run_on = 'Pick a first run in the future.';
  if (Object.keys(fields).length > 0) throw invalid(fields);
  await ctx.store.transaction(async (client) => {
    await client.query('UPDATE rotations SET interval_days = $2, at_time = $3, first_run_on = $4 WHERE id = $1', [
      String(rotation.id),
      intervalDays,
      atTime,
      firstRunOn
    ]);
    // a schedule change replaces only future runs
    await client.query("DELETE FROM turns WHERE rotation_id = $1 AND state = 'scheduled'", [String(rotation.id)]);
    const label = await rotationLabel(ctx, String(rotation.credential_id));
    await ctx.store.writeAudit(client, { personId: ctx.person!.id, name: ctx.person!.full_name }, [
      {
        action: 'rotation_change',
        subject: { kind: 'credential', id: String(rotation.credential_id), name: label }
      }
    ]);
  });
  jsonOk(ctx.res, 200, rotationView(ctx, String(rotation.id), String(rotation.credential_id), intervalDays, atTime, firstRunOn));
}

async function rotationLabel(ctx: Ctx, credentialId: string): Promise<string> {
  const rows = await ctx.store.pool.query('SELECT label FROM credentials WHERE id = $1', [credentialId]);
  return rows.rows.length > 0 ? String(rows.rows[0].label) : '';
}


export async function getRotation(ctx: Ctx): Promise<void> {
  requireRole(ctx, 'office_manager', 'managing_partner');
  const rows = await ctx.store.pool.query('SELECT * FROM rotations WHERE id = $1', [ctx.params.id]);
  if (rows.rows.length === 0) throw notFound();
  const rotation = rows.rows[0];
  jsonOk(ctx.res, 200, rotationView(ctx, String(rotation.id), String(rotation.credential_id), Number(rotation.interval_days), String(rotation.at_time), String(rotation.first_run_on).slice(0, 10)));
}

/** The rotation calendar: one row per office day of the chosen month. */
export async function getRotationCalendar(ctx: Ctx): Promise<void> {
  requireRole(ctx, 'office_manager', 'managing_partner');
  const monthRaw = ctx.url.searchParams.get('month') ?? '';
  const now = ctx.store.clock.now();
  const month = monthRaw === '' ? monthOfDate(officeDateString(now)) : parseMonth(monthRaw);
  if (month === null) {
    // A missing or invalid value is replaced by the current office month.
    jsonOk(ctx.res, 200, {
      month: monthOfDate(officeDateString(now)),
      days: []
    });
    return;
  }
  const rotations = await ctx.store.pool.query('SELECT * FROM rotations');
  const openTurns = await ctx.store.pool.query(
    "SELECT t.*, c.label FROM turns t JOIN credentials c ON c.id = t.credential_id WHERE t.state IN ('scheduled','due','overdue')"
  );
  const credentialRows = await ctx.store.pool.query(
    'SELECT c.id, c.label, v.name AS vendor_name, v.formerly AS vendor_formerly FROM credentials c JOIN vendors v ON v.id = c.vendor_id'
  );
  const credentialInfo = new Map<string, { label: string; vendor: { name: string; formerly: string | null } }>();
  for (const row of credentialRows.rows) {
    credentialInfo.set(String(row.id), {
      label: String(row.label),
      vendor: { name: String(row.vendor_name), formerly: row.vendor_formerly ? String(row.vendor_formerly) : null }
    });
  }
  const vendorByCredential = credentialInfo;
  const turnRows = openTurns.rows;
  const days: Array<Record<string, unknown>> = [];
  const totalDays = daysInMonth(month);
  for (let day = 1; day <= totalDays; day++) {
    const dateStr = `${month}-${day < 10 ? `0${day}` : day}`;
    const entries: Array<Record<string, unknown>> = [];
    for (const rotation of rotations.rows) {
      const credentialId = String(rotation.credential_id);
      const atTime = String(rotation.at_time);
      const firstRunOn = String(rotation.first_run_on).slice(0, 10);
      const interval = Number(rotation.interval_days);
      // find whether this date is a run date
      let cursor = firstRunOn;
      let isRunDate = false;
      for (let guard = 0; guard < 2000 && cursor <= dateStr; guard++) {
        if (cursor === dateStr) {
          isRunDate = true;
          break;
        }
        cursor = addDays(cursor, interval);
      }
      if (!isRunDate) continue;
      const { at, shifted } = rotationRunInstant(dateStr, atTime);
      const instant = at;
      const state = instant.getTime() <= now.getTime() ? 'due' : 'scheduled';
      const turn = turnRows.find(
        (row) => String(row.rotation_id) === String(rotation.id) && String(row.office_date).slice(0, 10) === dateStr
      );
      entries.push({
        turn_id: turn ? String(turn.id) : null,
        rotation_id: String(rotation.id),
        credential_id: credentialId,
        label: credentialInfo.get(credentialId)?.label ?? '',
        vendor: credentialInfo.get(credentialId)?.vendor ?? { name: '', formerly: null },
        kind: 'scheduled',
        office_time: officeTimeString(at),
        offset: offsetAbbreviation(at),
        at: instant.toISOString(),
        shifted,
        due_by: secondBusinessDayAfter(dateStr),
        state: turn ? String(turn.state) : state
      });
    }
    for (const turn of turnRows) {
      if (turn.kind !== 'scope_loss') continue;
      if (String(turn.due_by).slice(0, 10) !== dateStr) continue;
      const credentialId = String(turn.credential_id);
      entries.push({
        turn_id: String(turn.id),
        rotation_id: null,
        credential_id: credentialId,
        label: String(turn.label),
        vendor: credentialInfo.get(credentialId)?.vendor ?? { name: '', formerly: null },
        kind: 'scope_loss',
        office_time: null,
        offset: midnightOffset(dateStr),
        at: null,
        shifted: false,
        due_by: dateStr,
        state: String(turn.state)
      });
    }
    days.push({
      office_date: dateStr,
      offset: midnightOffset(dateStr),
      entries
    });
  }
  jsonOk(ctx.res, 200, { month, days });
}

