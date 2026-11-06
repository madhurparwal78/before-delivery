import { randomUUID } from 'node:crypto';
import { query, queryOne, transaction } from '../db.js';
import { conflict, notFound, validation } from '../http/errors.js';
import { readJsonBody, type Ctx, type Reply, type Router } from '../http/router.js';
import { actorInWorkspace, requireAction, type Actor } from '../auth.js';
import { FIELD_ERRORS } from '../../shared/copy.js';
import type { BaseKey } from '../../shared/format.js';
import {
  isValidDateString,
  isValidTimeString,
  localOccurrences,
  toInstantString,
  ZONES,
} from '../../shared/zone.js';
import {
  computeLegs,
  isValidSpeed,
  MAX_LEGS,
  minChargePct,
  roundTwoDecimals,
  type AnchoragePoint,
  type ComputedLeg,
  type LegInput,
} from '../domain/passage.js';
import { requireYacht, yachtEnergy, type YachtRow } from '../records.js';
import { json } from './helpers.js';

interface AnchorageRow {
  readonly workspace_id: string;
  readonly id: string;
  readonly name: string;
  readonly base: BaseKey;
  readonly latitude: string;
  readonly longitude: string;
  readonly seed_order: number;
}

interface PassageRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly yacht_id: string;
  readonly name: string;
  readonly status: 'draft' | 'sent';
  readonly start_anchorage_id: string;
  readonly departure_date: string;
  readonly departure_time: string;
  readonly departs_at: Date;
  readonly start_charge_pct: number;
  readonly updated_at: Date;
}

interface LegRow {
  readonly passage_id: string;
  readonly leg_index: number;
  readonly from_anchorage_id: string;
  readonly to_anchorage_id: string;
  readonly speed_kn: string;
}

async function anchorageMap(workspaceId: string): Promise<Map<string, AnchoragePoint>> {
  const anchorages = await query<AnchorageRow>(
    'SELECT * FROM anchorages WHERE workspace_id = $1 ORDER BY seed_order',
    [workspaceId],
  );
  return new Map(
    anchorages.map((anchorage) => [
      anchorage.id,
      {
        id: anchorage.id,
        name: anchorage.name,
        base: anchorage.base,
        latitude: Number(anchorage.latitude),
        longitude: Number(anchorage.longitude),
      },
    ]),
  );
}

async function listAnchorages(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  requireAction(actor, 'passages_read');
  const anchorages = await query<AnchorageRow>(
    'SELECT * FROM anchorages WHERE workspace_id = $1 ORDER BY seed_order',
    [actor.workspaceId],
  );
  return json(200, {
    anchorages: anchorages.map((anchorage) => ({
      id: anchorage.id,
      name: anchorage.name,
      base: anchorage.base,
      latitude: Number(anchorage.latitude),
      longitude: Number(anchorage.longitude),
    })),
  });
}

function passageJson(
  passage: PassageRow,
  yacht: YachtRow,
  legs: readonly ComputedLeg[],
): Record<string, unknown> {
  return {
    id: passage.id,
    yachtSlug: yacht.slug,
    name: passage.name,
    status: passage.status,
    base: yacht.base,
    startAnchorageId: passage.start_anchorage_id,
    departureDate: passage.departure_date,
    departureTime: passage.departure_time,
    departsAt: toInstantString(passage.departs_at),
    startChargePct: passage.start_charge_pct,
    legs: legs.map((leg) => ({
      index: leg.index,
      fromAnchorageId: leg.fromAnchorageId,
      toAnchorageId: leg.toAnchorageId,
      speedKn: leg.speedKn,
      distanceNm: roundTwoDecimals(leg.distanceNm),
      departsAt: toInstantString(leg.departsAt),
      arrivesAt: toInstantString(leg.arrivesAt),
      arrivalBase: leg.arrivalBase,
      arrivalChargePct: leg.arrivalChargePct,
      reserve: leg.reserve,
    })),
    minChargePct: minChargePct(legs),
    updatedAt: toInstantString(passage.updated_at),
  };
}

async function computed(passage: PassageRow, yacht: YachtRow): Promise<ComputedLeg[]> {
  const legs = await query<LegRow>(
    'SELECT * FROM passage_legs WHERE passage_id = $1 ORDER BY leg_index',
    [passage.id],
  );
  return computeLegs({
    yacht: yachtEnergy(yacht),
    anchorages: await anchorageMap(passage.workspace_id),
    startAnchorageId: passage.start_anchorage_id,
    departsAt: passage.departs_at,
    startChargePct: passage.start_charge_pct,
    legs: legs.map((leg) => ({ toAnchorageId: leg.to_anchorage_id, speedKn: Number(leg.speed_kn) })),
  });
}

interface PassageInput {
  readonly name: string;
  readonly startAnchorageId: string;
  readonly departureDate: string;
  readonly departureTime: string;
  readonly departsAt: Date;
  readonly startChargePct: number;
  readonly legs: readonly LegInput[];
}

async function readPassageInput(
  body: Record<string, unknown>,
  workspaceId: string,
  base: BaseKey,
): Promise<PassageInput> {
  const anchorages = await anchorageMap(workspaceId);
  const errors: Record<string, string> = {};

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name === '') errors.name = FIELD_ERRORS.required;
  else if ([...name].length > 80) errors.name = FIELD_ERRORS.maxLength(80);

  const startAnchorageId =
    typeof body.startAnchorageId === 'string' ? body.startAnchorageId.trim() : '';
  if (!anchorages.has(startAnchorageId)) throw notFound();

  const departureDate = typeof body.departureDate === 'string' ? body.departureDate.trim() : '';
  if (departureDate === '') errors.departureDate = FIELD_ERRORS.required;
  else if (!isValidDateString(departureDate)) errors.departureDate = FIELD_ERRORS.dateFormat;

  const departureTime = typeof body.departureTime === 'string' ? body.departureTime.trim() : '';
  if (departureTime === '') errors.departureTime = FIELD_ERRORS.required;
  else if (!isValidTimeString(departureTime)) errors.departureTime = FIELD_ERRORS.timeFormat;

  const startChargePct = body.startChargePct;
  const charge = typeof startChargePct === 'number' ? startChargePct : Number(startChargePct);
  if (!Number.isInteger(charge) || charge < 0 || charge > 100) {
    errors.startChargePct = FIELD_ERRORS.wholeRange(0, 100);
  }

  const givenLegs = Array.isArray(body.legs) ? (body.legs as unknown[]) : [];
  if (givenLegs.length > MAX_LEGS) errors.legs = FIELD_ERRORS.tooManyLegs;
  const legs: LegInput[] = [];
  let previous = startAnchorageId;
  for (const [index, entry] of givenLegs.entries()) {
    const record = (entry ?? {}) as Record<string, unknown>;
    const toAnchorageId = typeof record.toAnchorageId === 'string' ? record.toAnchorageId.trim() : '';
    if (!anchorages.has(toAnchorageId)) throw notFound();
    if (toAnchorageId === previous) {
      errors[`legs.${index}.toAnchorageId`] = FIELD_ERRORS.sameAnchorage;
    }
    const speed = typeof record.speedKn === 'number' ? record.speedKn : Number(record.speedKn);
    if (!isValidSpeed(speed)) errors[`legs.${index}.speedKn`] = FIELD_ERRORS.speed;
    legs.push({ toAnchorageId, speedKn: speed });
    previous = toAnchorageId;
  }

  let departsAt: Date | null = null;
  if (errors.departureDate === undefined && errors.departureTime === undefined) {
    const [year, month, day] = departureDate.split('-').map((part) => Number.parseInt(part, 10));
    const [hour, minute] = departureTime.split(':').map((part) => Number.parseInt(part, 10));
    const occurrences = localOccurrences(ZONES[base], year, month, day, hour, minute);
    if (occurrences.length === 0) errors.departureTime = FIELD_ERRORS.springGap;
    else departsAt = occurrences[0];
  }

  if (Object.keys(errors).length > 0) throw validation(errors);
  return {
    name,
    startAnchorageId,
    departureDate,
    departureTime,
    departsAt: departsAt as Date,
    startChargePct: charge,
    legs,
  };
}

async function listPassages(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  requireAction(actor, 'passages_read');
  const yachtSlug = ctx.query.get('yachtSlug');
  const passages = await query<PassageRow & { yacht_slug: string }>(
    `SELECT p.*, y.slug AS yacht_slug FROM passages p JOIN yachts y ON y.id = p.yacht_id
      WHERE p.workspace_id = $1 AND ($2::text IS NULL OR y.slug = $2)
      ORDER BY p.departs_at`,
    [actor.workspaceId, yachtSlug],
  );
  const visible = passages.filter((passage) => passageVisible(actor, passage));
  const result = [];
  for (const passage of visible) {
    const yacht = (await queryOne<YachtRow>('SELECT * FROM yachts WHERE id = $1', [
      passage.yacht_id,
    ])) as YachtRow;
    result.push(passageJson(passage, yacht, await computed(passage, yacht)));
  }
  return json(200, { passages: result });
}

function passageVisible(actor: Actor, passage: PassageRow): boolean {
  if (actor.role !== 'crew_member') return true;
  return passage.yacht_id === actor.yachtId && passage.status === 'sent';
}

async function requirePassage(
  actor: Actor,
  passageId: string,
): Promise<{ passage: PassageRow; yacht: YachtRow }> {
  const passage = await queryOne<PassageRow>(
    'SELECT * FROM passages WHERE id = $1 AND workspace_id = $2',
    [passageId, actor.workspaceId],
  );
  if (passage === null || !passageVisible(actor, passage)) throw notFound();
  const yacht = (await queryOne<YachtRow>('SELECT * FROM yachts WHERE id = $1', [
    passage.yacht_id,
  ])) as YachtRow;
  return { passage, yacht };
}

async function createPassage(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  requireAction(actor, 'passages_write');
  const body = readJsonBody(ctx);
  const yachtSlug = typeof body.yachtSlug === 'string' ? body.yachtSlug.trim() : '';
  if (yachtSlug === '') throw notFound();
  const yacht = await requireYacht(actor, yachtSlug);
  const input = await readPassageInput(body, actor.workspaceId, yacht.base);
  const id = randomUUID();
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO passages (id, workspace_id, yacht_id, name, status, start_anchorage_id,
          departure_date, departure_time, departs_at, start_charge_pct, created_at, updated_at)
        VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$10,$10)`,
      [
        id,
        actor.workspaceId,
        yacht.id,
        input.name,
        input.startAnchorageId,
        input.departureDate,
        input.departureTime,
        input.departsAt,
        input.startChargePct,
        ctx.now,
      ],
    );
    await insertLegs(client, id, input);
  });
  const { passage } = await requirePassage(actor, id);
  return json(201, { passage: passageJson(passage, yacht, await computed(passage, yacht)) });
}

async function insertLegs(
  client: { query: (text: string, params: unknown[]) => Promise<unknown> },
  passageId: string,
  input: PassageInput,
): Promise<void> {
  let from = input.startAnchorageId;
  for (const [index, leg] of input.legs.entries()) {
    await client.query(
      `INSERT INTO passage_legs (passage_id, leg_index, from_anchorage_id, to_anchorage_id, speed_kn)
       VALUES ($1,$2,$3,$4,$5)`,
      [passageId, index, from, leg.toAnchorageId, leg.speedKn.toFixed(1)],
    );
    from = leg.toAnchorageId;
  }
}

async function readPassage(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const { passage, yacht } = await requirePassage(actor, ctx.params.passageId);
  requireAction(actor, 'passages_read');
  return json(200, { passage: passageJson(passage, yacht, await computed(passage, yacht)) });
}

async function savePassage(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const { passage, yacht } = await requirePassage(actor, ctx.params.passageId);
  requireAction(actor, 'passages_write');
  const input = await readPassageInput(readJsonBody(ctx), actor.workspaceId, yacht.base);
  await transaction(async (client) => {
    await client.query(
      `UPDATE passages SET name = $2, status = 'draft', start_anchorage_id = $3, departure_date = $4,
          departure_time = $5, departs_at = $6, start_charge_pct = $7, updated_at = $8
        WHERE id = $1`,
      [
        passage.id,
        input.name,
        input.startAnchorageId,
        input.departureDate,
        input.departureTime,
        input.departsAt,
        input.startChargePct,
        ctx.now,
      ],
    );
    await client.query('DELETE FROM passage_legs WHERE passage_id = $1', [passage.id]);
    await insertLegs(client, passage.id, input);
  });
  const saved = await requirePassage(actor, passage.id);
  return json(200, {
    passage: passageJson(saved.passage, yacht, await computed(saved.passage, yacht)),
  });
}

async function sendPassage(ctx: Ctx): Promise<Reply> {
  const actor = await actorInWorkspace(ctx);
  const { passage, yacht } = await requirePassage(actor, ctx.params.passageId);
  requireAction(actor, 'passages_write');
  const legs = await computed(passage, yacht);
  if (legs.length === 0) throw conflict('no_legs');
  const below = legs.find((leg) => leg.reserve === 'below_reserve');
  if (below !== undefined) throw conflict('below_reserve', { legIndex: below.index });
  await query(`UPDATE passages SET status = 'sent', updated_at = $2 WHERE id = $1`, [
    passage.id,
    ctx.now,
  ]);
  const sent = await requirePassage(actor, passage.id);
  return json(200, { passage: passageJson(sent.passage, yacht, legs) });
}

export function registerPassageRoutes(router: Router): void {
  router.add('/api/w/:ws/anchorages', { GET: listAnchorages });
  router.add('/api/w/:ws/passages', { GET: listPassages, POST: createPassage });
  router.add('/api/w/:ws/passages/:passageId', { GET: readPassage, PUT: savePassage });
  router.add('/api/w/:ws/passages/:passageId/send', { POST: sendPassage });
}
