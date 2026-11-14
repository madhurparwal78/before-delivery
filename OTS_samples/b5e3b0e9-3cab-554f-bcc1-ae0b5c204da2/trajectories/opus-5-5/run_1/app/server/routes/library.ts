import { timers } from '../config.js';
import { requireInstructor } from '../auth.js';
import { newId, one, query } from '../db.js';
import { ApiError, notFound, ok, type Router } from '../http.js';
import { Airfield, BUILT_IN, validateLayout } from '../layouts.js';
import { EVENT_KINDS, type Scenario, type ScheduledEvent, type TrafficItem } from '../sim/model.js';
import { getObject, putObject, STORAGE_MESSAGES, StorageError, storageUnavailable } from '../storage.js';
import { parseClock } from '../../shared/time.js';
import type { Layout } from '../../shared/types.js';

export interface AerodromeRow {
  id: string;
  school_id: string | null;
  name: string;
  code: string;
  layout: Layout;
  imported: boolean;
}

export async function seedBuiltIns(): Promise<void> {
  for (const { id, layout } of BUILT_IN) {
    await query(
      `INSERT INTO aerodromes (id, school_id, name, code, layout, imported) VALUES ($1, NULL, $2, $3, $4, false)
       ON CONFLICT (id) DO NOTHING`,
      [id, layout.name, layout.code, JSON.stringify(layout)],
    );
  }
}

/** An aerodrome this school may use: a shared one or one of its own imports. */
export async function aerodromeFor(schoolId: string, id: string): Promise<AerodromeRow> {
  const row = await one<AerodromeRow>('SELECT * FROM aerodromes WHERE id = $1 AND (school_id IS NULL OR school_id = $2)', [
    id,
    schoolId,
  ]);
  if (!row) throw notFound();
  return row;
}

export async function insertAerodrome(schoolId: string | null, layout: Layout, imported: boolean, id = newId()): Promise<string> {
  await query('INSERT INTO aerodromes (id, school_id, name, code, layout, imported) VALUES ($1, $2, $3, $4, $5, $6)', [
    id,
    schoolId,
    layout.name,
    layout.code,
    JSON.stringify(layout),
    imported,
  ]);
  return id;
}

const invalid = (message: string) => new ApiError(422, { error: 'scenario_invalid', message });

const isWhole = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);

/** Checks a scenario body against its aerodrome and returns the stored form. */
export async function validateScenario(body: Record<string, unknown>, schoolId: string): Promise<Scenario> {
  const aerodromeId = typeof body.aerodrome === 'string' ? body.aerodrome : '';
  const aerodrome = await aerodromeFor(schoolId, aerodromeId);
  const field = new Airfield(aerodrome.layout);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const traffic: TrafficItem[] = [];
  const rows = Array.isArray(body.traffic) ? (body.traffic as Record<string, unknown>[]) : [];
  const seen = new Set<string>();
  const stands = field.stands();
  for (const row of rows) {
    const callsign = typeof row.callsign === 'string' ? row.callsign : String(row.callsign ?? '');
    if (!/^[A-Z]{5}$/.test(callsign)) throw invalid(`Callsign ${callsign} must be 5 capital letters.`);
    if (seen.has(callsign)) throw invalid(`Callsign ${callsign} is used more than once.`);
    seen.add(callsign);
    const kind = row.kind === 'arr' ? 'arr' : row.kind === 'dep' ? 'dep' : null;
    if (!kind) throw invalid(`Kind for ${callsign} must be dep or arr.`);
    const blank = (value: unknown) => value === null || value === undefined || value === '';
    const stand = blank(row.stand) ? null : String(row.stand);
    if (kind === 'dep' && (stand === null || !stands.includes(stand))) {
      throw invalid(`Stand ${stand ?? ''} is not on ${aerodrome.name}.`);
    }
    const type = typeof row.type === 'string' ? row.type.trim() : '';
    if (!type) throw invalid(`Type for ${callsign} is required.`);
    if (!['L', 'M', 'H', 'J'].includes(String(row.wake))) throw invalid(`Wake for ${callsign} must be L, M, H or J.`);
    if (!['VFR', 'IFR'].includes(String(row.rules))) throw invalid(`Rules for ${callsign} must be VFR or IFR.`);
    const holdingPoint = blank(row.holdingPoint) ? null : String(row.holdingPoint);
    if (kind === 'dep' && (holdingPoint === null || !field.isHoldingPoint(holdingPoint))) {
      throw invalid(`Holding point ${holdingPoint ?? ''} is not on ${aerodrome.name}.`);
    }
    const runway = blank(row.runway) ? null : String(row.runway);
    if (kind === 'arr' && (runway === null || !field.isThreshold(runway))) {
      throw invalid(`Runway ${runway ?? ''} is not on ${aerodrome.name}.`);
    }
    const appearAt = row.appearAt ?? 0;
    if (!isWhole(appearAt) || appearAt < 0) throw invalid(`Appear at for ${callsign} must be a whole number of seconds.`);
    const due = row.dueSeconds;
    if (kind === 'arr' && (!isWhole(due) || due < 1)) throw invalid(`Due seconds for ${callsign} must be a whole number above 0.`);
    const slot = blank(row.slotSeconds) ? null : row.slotSeconds;
    if (slot !== null && (!isWhole(slot) || slot < 0)) throw invalid(`Slot seconds for ${callsign} must be a whole number.`);
    traffic.push({
      callsign,
      type,
      wake: row.wake as TrafficItem['wake'],
      rules: row.rules as TrafficItem['rules'],
      kind,
      stand: kind === 'dep' ? stand : null,
      holdingPoint: kind === 'dep' ? holdingPoint : null,
      runway: kind === 'arr' ? runway : null,
      appearAt,
      dueSeconds: kind === 'arr' ? (due as number) : null,
      slotSeconds: kind === 'dep' ? (slot as number | null) : null,
      overrunsHold: kind === 'dep' && row.overrunsHold === true,
    });
  }
  if (!name) throw invalid('Scenario name is required.');
  const runwayInUse = String(body.runwayInUse ?? '');
  if (!field.isThreshold(runwayInUse)) throw invalid(`Runway ${runwayInUse} is not on ${aerodrome.name}.`);
  if (!isWhole(body.windDir) || body.windDir < 0 || body.windDir > 360) throw invalid('Wind direction must be 0 to 360.');
  if (!isWhole(body.windKt) || body.windKt < 0) throw invalid('Wind speed must be a whole number of knots.');
  const start = parseClock(String(body.startSimTime ?? ''));
  if (start === null) throw invalid('Start time must be HH:MM:SS.');
  if (!isWhole(body.durationSeconds) || body.durationSeconds < 1 || start + body.durationSeconds > 86399) {
    throw invalid('Duration seconds must be a whole number that ends the exercise by 23:59:59.');
  }
  if (!isWhole(body.seed)) throw invalid('Seed must be a whole number.');
  const every = body.readbackErrorEvery ?? null;
  if (every !== null && (!isWhole(every) || every < 0)) throw invalid('Readback error interval must be a whole number.');
  const events: ScheduledEvent[] = [];
  for (const event of Array.isArray(body.events) ? (body.events as Record<string, unknown>[]) : []) {
    if (!EVENT_KINDS.includes(event.kind as ScheduledEvent['kind']) || !isWhole(event.at) || event.at < 0) {
      throw invalid('Each event needs a kind and a whole number of seconds.');
    }
    events.push({
      at: event.at,
      kind: event.kind as ScheduledEvent['kind'],
      ...(typeof event.callsign === 'string' ? { callsign: event.callsign } : {}),
      ...(isWhole(event.windDir) ? { windDir: event.windDir } : {}),
      ...(isWhole(event.windKt) ? { windKt: event.windKt } : {}),
    });
  }
  return {
    name,
    aerodrome: aerodrome.id,
    runwayInUse,
    windDir: body.windDir,
    windKt: body.windKt,
    startSimTime: String(body.startSimTime),
    durationSeconds: body.durationSeconds,
    seed: body.seed,
    readbackErrorEvery: every as number | null,
    traffic,
    events,
  };
}

export async function insertScenario(schoolId: string, scenario: Scenario): Promise<string> {
  const id = newId();
  await query('INSERT INTO scenarios (id, school_id, data) VALUES ($1, $2, $3)', [id, schoolId, JSON.stringify(scenario)]);
  return id;
}

export function registerLibraryRoutes(router: Router): void {
  router.add('GET', '/api/aerodromes', async (ctx) => {
    const { school } = await requireInstructor(ctx);
    const rows = await query<AerodromeRow>(
      'SELECT id, name, code, imported FROM aerodromes WHERE school_id IS NULL OR school_id = $1 ORDER BY seq',
      [school.id],
    );
    return ok(rows.map((row) => ({ id: row.id, name: row.name, code: row.code, imported: row.imported })));
  });

  router.add('GET', '/api/aerodromes/:id', async (ctx) => {
    const { school } = await requireInstructor(ctx);
    const row = await aerodromeFor(school.id, ctx.params.id!);
    return ok({ id: row.id, name: row.name, code: row.code, imported: row.imported, layout: row.layout });
  });

  router.add('POST', '/api/aerodromes/import', async (ctx) => {
    const { school } = await requireInstructor(ctx);
    let bytes: Buffer;
    try {
      bytes = await ctx.readBody(timers.layoutMaxBytes);
    } catch (error) {
      if (error instanceof ApiError && error.status === 413) {
        throw new ApiError(413, {
          error: 'layout_too_large',
          message: `Layout file is over the limit of ${timers.layoutMaxBytes} bytes.`,
        });
      }
      throw error;
    }
    const result = validateLayout(bytes);
    if (!result.ok) throw new ApiError(422, { error: 'layout_invalid', lines: result.lines });
    const id = newId();
    try {
      await putObject(`layouts/${id}/original.json`, bytes);
    } catch (error) {
      if (error instanceof StorageError) throw storageUnavailable(STORAGE_MESSAGES.layout);
      throw error;
    }
    await insertAerodrome(school.id, result.layout, true, id);
    return ok({ id, name: result.layout.name, code: result.layout.code }, 201);
  });

  router.add('GET', '/api/aerodromes/:id/original', async (ctx) => {
    const { school } = await requireInstructor(ctx);
    const row = await aerodromeFor(school.id, ctx.params.id!);
    if (!row.imported) throw notFound();
    let bytes: Buffer | null;
    try {
      bytes = await getObject(`layouts/${row.id}/original.json`);
    } catch (error) {
      if (error instanceof StorageError) throw storageUnavailable(STORAGE_MESSAGES.layoutRead);
      throw error;
    }
    if (!bytes) throw notFound();
    return {
      status: 200,
      body: bytes,
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="original.json"' },
    };
  });

  router.add('GET', '/api/scenarios', async (ctx) => {
    const { school } = await requireInstructor(ctx);
    const rows = await query<{ id: string; name: string }>(
      "SELECT id, data->>'name' AS name FROM scenarios WHERE school_id = $1 ORDER BY seq",
      [school.id],
    );
    return ok(rows);
  });

  router.add('POST', '/api/scenarios', async (ctx) => {
    const { school } = await requireInstructor(ctx);
    const scenario = await validateScenario(await ctx.json(), school.id);
    return ok({ id: await insertScenario(school.id, scenario) }, 201);
  });

  const ownScenario = async (schoolId: string, id: string) => {
    const row = await one<{ id: string; data: Scenario }>('SELECT id, data FROM scenarios WHERE id = $1 AND school_id = $2', [
      id,
      schoolId,
    ]);
    if (!row) throw notFound();
    return row;
  };

  router.add('GET', '/api/scenarios/:id', async (ctx) => {
    const { school } = await requireInstructor(ctx);
    const row = await ownScenario(school.id, ctx.params.id!);
    return ok({ id: row.id, ...row.data });
  });

  router.add('PUT', '/api/scenarios/:id', async (ctx) => {
    const { school } = await requireInstructor(ctx);
    const row = await ownScenario(school.id, ctx.params.id!);
    const scenario = await validateScenario(await ctx.json(), school.id);
    await query('UPDATE scenarios SET data = $2 WHERE id = $1', [row.id, JSON.stringify(scenario)]);
    return ok({ id: row.id, ...scenario });
  });
}
