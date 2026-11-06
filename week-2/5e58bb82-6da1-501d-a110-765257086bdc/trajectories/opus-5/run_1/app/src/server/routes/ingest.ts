import { lineIllegalCopy } from '../../shared/copy.js';
import { pool, withTransaction } from '../db.js';
import { decideLinkState } from '../domain/linkState.js';
import { conflict, illegalTransition, invalidIngestKey, notFound, validation } from '../errors.js';
import { recordEvent, SYSTEM_ACTOR } from '../events.js';
import { jsonObject, sendJson, type Ctx, type Router } from '../http.js';
import {
  applyFix,
  asFixInput,
  fixExists,
  validateFix,
  type FixInput,
} from '../ingest.js';
import { maybeRecovering, maybeSurveying } from '../missionFlow.js';
import {
  findLine,
  findMission,
  findVesselByIngestKey,
  latestFix,
  runningLineOfVessel,
  toLine,
  type VesselRow,
} from '../repo.js';
import { recomputeHolidays } from '../state.js';
import { lockRecord } from './guards.js';
import { refuseIfOverdue } from './vessels.js';

/** The logger's vessel, taken from the ingest key alone. */
async function ingestVessel(ctx: Ctx): Promise<VesselRow> {
  const header = ctx.req.headers['x-ingest-key'];
  const key = Array.isArray(header) ? header[0] : header;
  if (key === undefined || key.length === 0) throw invalidIngestKey();
  const vessel = await findVesselByIngestKey(pool, key);
  if (!vessel) throw invalidIngestKey();
  return vessel;
}

function parseBatch(value: unknown): unknown[] | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const fixes = (value as Record<string, unknown>).fixes;
  return Array.isArray(fixes) ? fixes : null;
}

export function registerIngestRoutes(router: Router): void {
  router.add({
    method: 'POST',
    pattern: '/api/ingest/fixes',
    body: 'json',
    auth: 'ingest',
    handler: async (ctx) => {
      const vessel = await ingestVessel(ctx);
      const batch = parseBatch(ctx.body);
      if (batch !== null) {
        await ingestBatch(ctx, vessel, batch);
        return;
      }
      await ingestSingle(ctx, vessel);
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/ingest/lines/:lineId/start',
    body: 'json',
    auth: 'ingest',
    handler: async (ctx) => {
      const vessel = await ingestVessel(ctx);
      const lineId = ctx.params.lineId!;
      const record = await withTransaction(async (client) => {
        await lockRecord(client, 'vessel', vessel.id);
        const line = await findLine(client, lineId);
        if (!line || line.vessel_id !== vessel.id) throw notFound();
        await lockRecord(client, 'mission', line.mission_id);
        const mission = await findMission(client, line.mission_id);
        if (!mission) throw notFound();
        if (mission.status !== 'Launched' && mission.status !== 'Surveying') {
          throw conflict('mission_not_active', 'This mission is not under way.');
        }
        if (mission.hold !== null) {
          throw conflict('mission_on_hold', 'This survey is on hold.');
        }
        const current = await client.query<VesselRow>('SELECT * FROM vessels WHERE id = $1', [
          vessel.id,
        ]);
        refuseIfOverdue(current.rows[0]!);
        const running = await runningLineOfVessel(client, vessel.id);
        if (running) {
          throw conflict('vessel_busy', `${vessel.name} is already running ${running.label}`);
        }
        if (line.status !== 'Assigned') {
          throw illegalTransition(
            line.status,
            'Running',
            lineIllegalCopy(line.label, line.status, 'Running'),
          );
        }
        await client.query(
          `UPDATE lines SET status = 'Running', infill_order = NULL WHERE id = $1`,
          [lineId],
        );
        await recordEvent(
          client,
          line.mission_id,
          'line',
          SYSTEM_ACTOR,
          `${line.label} Assigned → Running`,
          ctx.now,
        );
        await maybeSurveying(client, line.mission_id, ctx.now);
        const updated = await findLine(client, lineId);
        return toLine(updated!, vessel.name, 0);
      });
      sendJson(ctx.res, 200, { line: record });
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/ingest/lines/:lineId/end',
    body: 'json',
    auth: 'ingest',
    handler: async (ctx) => {
      const vessel = await ingestVessel(ctx);
      const lineId = ctx.params.lineId!;
      const record = await withTransaction(async (client) => {
        await lockRecord(client, 'vessel', vessel.id);
        const line = await findLine(client, lineId);
        if (!line || line.vessel_id !== vessel.id) throw notFound();
        await lockRecord(client, 'mission', line.mission_id);
        if (line.status !== 'Running') {
          throw illegalTransition(
            line.status,
            'Surveyed',
            lineIllegalCopy(line.label, line.status, 'Surveyed'),
          );
        }
        await client.query(
          `UPDATE lines SET status = 'Surveyed', file_state = 'Awaiting upload' WHERE id = $1`,
          [lineId],
        );
        await recordEvent(
          client,
          line.mission_id,
          'line',
          SYSTEM_ACTOR,
          `${line.label} Running → Surveyed`,
          ctx.now,
        );
        await recomputeHolidays(client, line.mission_id);
        await maybeRecovering(client, line.mission_id, ctx.now);
        const updated = await findLine(client, lineId);
        return toLine(updated!, vessel.name, 0);
      });
      sendJson(ctx.res, 200, { line: record });
    },
  });
}

async function ingestSingle(ctx: Ctx, vessel: VesselRow): Promise<void> {
  const errors = validateFix(ctx.body, '');
  if (Object.keys(errors).length > 0) throw validation(errors);
  const input = asFixInput(jsonObject(ctx));

  const result = await withTransaction(async (client) => {
    await lockRecord(client, 'vessel', vessel.id);
    if (await fixExists(client, vessel.id, input.t)) return { duplicate: true as const };
    const previous = await latestFix(client, vessel.id);
    if (previous && new Date(input.t).getTime() < new Date(previous.t).getTime()) {
      throw conflict('out_of_order', "This fix is older than the vessel's latest fix");
    }
    const fix = await applyFix(client, vessel.id, input, ctx.now);
    return { duplicate: false as const, receivedAt: fix.received_at };
  });

  if (result.duplicate) {
    const fix = await latestFix(pool, vessel.id);
    sendJson(ctx.res, 200, {
      vessel_id: vessel.id,
      received_at: (fix ? new Date(fix.received_at) : ctx.now).toISOString(),
      link_state: decideLinkState(fix ? fix.received_at : null, ctx.now),
      duplicate: true,
    });
    return;
  }
  sendJson(ctx.res, 201, {
    vessel_id: vessel.id,
    received_at: new Date(result.receivedAt).toISOString(),
    link_state: 'Live',
    duplicate: false,
  });
}

async function ingestBatch(ctx: Ctx, vessel: VesselRow, fixes: unknown[]): Promise<void> {
  if (fixes.length < 1 || fixes.length > 100) {
    throw validation({ fixes: 'Send 1 to 100 fixes' });
  }
  const errors: Record<string, string> = {};
  fixes.forEach((fix, index) => {
    Object.assign(errors, validateFix(fix, `fixes.${index}.`));
  });
  // The later index of a duplicated time is the one reported.
  const seen = new Map<string, number>();
  fixes.forEach((fix, index) => {
    const t = (fix as Record<string, unknown>).t;
    if (typeof t !== 'string' || Number.isNaN(Date.parse(t))) return;
    const key = new Date(t).toISOString();
    if (seen.has(key)) errors[`fixes.${index}.t`] = 'Each fix in a batch needs its own time';
    else seen.set(key, index);
  });
  if (Object.keys(errors).length > 0) throw validation(errors);

  const inputs: FixInput[] = fixes.map((fix) => asFixInput(fix));

  const outcome = await withTransaction(async (client) => {
    await lockRecord(client, 'vessel', vessel.id);
    const previous = await latestFix(client, vessel.id);
    const latestBefore = previous ? new Date(previous.t).getTime() : null;

    const replayed: boolean[] = [];
    for (const input of inputs) {
      replayed.push(await fixExists(client, vessel.id, input.t));
    }
    for (let index = 0; index < inputs.length; index += 1) {
      if (replayed[index]) continue;
      if (latestBefore !== null && new Date(inputs[index]!.t).getTime() < latestBefore) {
        throw conflict(
          'stale_fix',
          "A fix in this batch is older than the vessel's latest fix",
          { index },
        );
      }
    }

    const fresh = inputs
      .map((input, index) => ({ input, index }))
      .filter((item) => !replayed[item.index])
      .sort((a, b) => new Date(a.input.t).getTime() - new Date(b.input.t).getTime());

    for (const item of fresh) {
      await applyFix(client, vessel.id, item.input, ctx.now);
    }

    const after = await latestFix(client, vessel.id);
    return {
      accepted: fresh.length,
      replayed: replayed.filter(Boolean).length,
      lastT: after ? new Date(after.t).toISOString() : null,
      receivedAt: after ? after.received_at : null,
    };
  });

  sendJson(ctx.res, outcome.accepted >= 1 ? 201 : 200, {
    vessel_id: vessel.id,
    accepted: outcome.accepted,
    replayed: outcome.replayed,
    link_state: decideLinkState(outcome.receivedAt, ctx.now),
    last_t: outcome.lastT,
  });
}
