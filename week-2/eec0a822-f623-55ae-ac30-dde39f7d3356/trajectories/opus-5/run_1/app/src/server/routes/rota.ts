import { randomUUID } from 'node:crypto';
import { lockKey, query, queryOne, transaction, txRows } from '../db.js';
import { notFound, preconditionFailed, restRuleRefusal, validation } from '../http/errors.js';
import { readJsonBody, type Ctx, type Reply, type Router } from '../http/router.js';
import { actorInWorkspace, requireAction } from '../auth.js';
import { FIELD_ERRORS } from '../../shared/copy.js';
import { isSaturday, toInstantString, ZONES } from '../../shared/zone.js';
import { findRestRuleBreach, weekSlots, type RotaSlot } from '../domain/rota.js';
import { crewOf, requireYacht, type CrewRow, type YachtRow } from '../records.js';
import { json } from './helpers.js';

interface RotaRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly yacht_id: string;
  readonly week_start: string;
  readonly version: number;
  readonly saved_by: string;
  readonly saved_at: Date;
}

function readWeekStart(ctx: Ctx): string {
  const value = (ctx.query.get('weekStart') ?? '').trim();
  if (!isSaturday(value)) throw validation({ weekStart: FIELD_ERRORS.saturday });
  return value;
}

async function rotaJson(
  yacht: YachtRow,
  weekStart: string,
  slots: readonly RotaSlot[],
  crew: readonly CrewRow[],
): Promise<Record<string, unknown>> {
  const rota = await queryOne<RotaRow>(
    'SELECT * FROM rotas WHERE yacht_id = $1 AND week_start = $2',
    [yacht.id, weekStart],
  );
  const work: Record<string, string[]> = {};
  for (const member of crew) work[member.id] = [];
  if (rota !== null) {
    const saved = await query<{ crew_id: string; starts_at: Date }>(
      'SELECT crew_id, starts_at FROM rota_work WHERE rota_id = $1 ORDER BY starts_at',
      [rota.id],
    );
    for (const cell of saved) {
      const bucket = work[cell.crew_id];
      if (bucket !== undefined) bucket.push(toInstantString(cell.starts_at));
    }
  }
  return {
    yachtSlug: yacht.slug,
    weekStart,
    base: yacht.base,
    version: rota === null ? 0 : rota.version,
    savedBy: rota === null ? null : rota.saved_by,
    savedAt: rota === null ? null : toInstantString(rota.saved_at),
    crew: crew.map((member) => ({
      id: member.id,
      name: member.name,
      position: member.position,
    })),
    slots: slots.map((slot) => ({
      startsAt: toInstantString(slot.startsAt),
      date: slot.date,
      label: slot.label,
    })),
    work,
  };
}

async function readRota(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const yacht = await requireYacht(actor, ctx.params.yachtSlug);
  requireAction(actor, 'rota_read');
  const weekStart = readWeekStart(ctx);
  const slots = weekSlots(ZONES[yacht.base], weekStart);
  return json(200, await rotaJson(yacht, weekStart, slots, await crewOf(yacht.id)));
}

async function saveRota(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const yacht = await requireYacht(actor, ctx.params.yachtSlug);
  requireAction(actor, 'rota_write');
  const weekStart = readWeekStart(ctx);
  const body = readJsonBody(ctx);
  const crew = await crewOf(yacht.id);
  const slots = weekSlots(ZONES[yacht.base], weekStart);
  const slotIndex = new Map(slots.map((slot, index) => [toInstantString(slot.startsAt), index]));

  const version = typeof body.version === 'number' ? body.version : Number(body.version);
  if (!Number.isInteger(version) || version < 0) {
    throw validation({ version: FIELD_ERRORS.wholeRange(0, 1_000_000) });
  }
  const given =
    body.work !== null && typeof body.work === 'object' && !Array.isArray(body.work)
      ? (body.work as Record<string, unknown>)
      : {};
  const crewIds = new Set(crew.map((member) => member.id));
  for (const crewId of Object.keys(given)) {
    if (!crewIds.has(crewId)) throw notFound();
  }
  const workByCrew = new Map<string, boolean[]>();
  for (const member of crew) {
    const cells = new Array<boolean>(slots.length).fill(false);
    const listed = given[member.id];
    for (const entry of Array.isArray(listed) ? listed : []) {
      const index = typeof entry === 'string' ? slotIndex.get(entry) : undefined;
      if (index === undefined) throw validation({ work: FIELD_ERRORS.rotaSlot });
      cells[index] = true;
    }
    workByCrew.set(member.id, cells);
  }

  await transaction(async (client) => {
    await lockKey(client, 'rota', yacht.id, weekStart);
    const existing = await txRows<RotaRow>(
      client,
      'SELECT * FROM rotas WHERE yacht_id = $1 AND week_start = $2 FOR UPDATE',
      [yacht.id, weekStart],
    );
    const storedVersion = existing.length === 0 ? 0 : existing[0].version;
    if (version !== storedVersion) {
      throw preconditionFailed('stale_rota', {
        savedBy: existing[0].saved_by,
        savedAt: toInstantString(existing[0].saved_at),
      });
    }
    for (const member of crew) {
      const breach = findRestRuleBreach(slots, workByCrew.get(member.id) as boolean[]);
      if (breach !== null) {
        throw restRuleRefusal({
          crewId: member.id,
          crewName: member.name,
          rule: breach.rule,
          windowStart: toInstantString(breach.windowStart),
          windowEnd: toInstantString(breach.windowEnd),
        });
      }
    }
    let rotaId: string;
    if (existing.length === 0) {
      rotaId = randomUUID();
      await client.query(
        `INSERT INTO rotas (id, workspace_id, yacht_id, week_start, version, saved_by, saved_at)
         VALUES ($1,$2,$3,$4,1,$5,$6)`,
        [rotaId, actor.workspaceId, yacht.id, weekStart, actor.name, ctx.now],
      );
    } else {
      rotaId = existing[0].id;
      await client.query('UPDATE rotas SET version = $2, saved_by = $3, saved_at = $4 WHERE id = $1', [
        rotaId,
        storedVersion + 1,
        actor.name,
        ctx.now,
      ]);
      await client.query('DELETE FROM rota_work WHERE rota_id = $1', [rotaId]);
    }
    for (const member of crew) {
      const cells = workByCrew.get(member.id) as boolean[];
      for (const [index, working] of cells.entries()) {
        if (!working) continue;
        await client.query(
          'INSERT INTO rota_work (rota_id, crew_id, starts_at) VALUES ($1,$2,$3)',
          [rotaId, member.id, slots[index].startsAt],
        );
      }
    }
  });
  return json(200, await rotaJson(yacht, weekStart, slots, crew));
}

export function registerRotaRoutes(router: Router): void {
  router.add('/api/w/:ws/yachts/:yachtSlug/rota', { GET: readRota, PUT: saveRota });
}
