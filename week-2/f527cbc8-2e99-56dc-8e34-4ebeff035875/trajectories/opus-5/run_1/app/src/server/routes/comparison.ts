import { query, queryOne, withClient, type Db } from '../db.js';
import { json, route, type Ctx } from '../http.js';
import { ValidationError, conflict, fieldMessages } from '../errors.js';
import {
  differenceValue,
  isHoof,
  readoutLines,
  type Alignment,
  type Hoof,
} from '../domain/marks.js';
import { currentMarks, photoJson, type MarksRow } from './visits.js';
import { visibleHorse } from './shared.js';

/**
 * The comparison the stage draws: two marked visits of one hoof with their stored
 * lines, angles, labels, signed differences and exact readout lines.
 */
export interface MarkedVisit {
  visit_id: string;
  business_date: string;
}

export async function markedVisits(
  db: Db,
  horseId: string,
  hoof: Hoof,
  includeOpen: boolean,
): Promise<MarkedVisit[]> {
  return await query<MarkedVisit>(
    db,
    `SELECT v.id AS visit_id, to_char(v.business_date,'YYYY-MM-DD') AS business_date
     FROM visits v
     WHERE v.horse_id = $1
       AND ($3 OR v.status <> 'open')
       AND EXISTS (SELECT 1 FROM hoof_marks m WHERE m.visit_id = v.id AND m.hoof = $2 AND m.current)
     ORDER BY v.business_date DESC, v.created_at DESC`,
    [horseId, hoof, includeOpen],
  );
}

interface SideRow {
  marks: MarksRow;
  businessDate: string;
  /** Visits are ordered by business date and then by when they were opened, so two
   *  visits on one date still have an earlier and a later one. */
  createdAt: Date;
  visitId: string;
}

async function loadSide(db: Db, visitId: string, hoof: Hoof): Promise<SideRow | null> {
  const visit = await queryOne<{ id: string; business_date: string; created_at: Date }>(
    db,
    `SELECT id, to_char(business_date,'YYYY-MM-DD') AS business_date, created_at
     FROM visits WHERE id = $1`,
    [visitId],
  );
  if (visit === null) return null;
  const marks = await currentMarks(db, visitId, hoof);
  if (marks === null) return null;
  return { marks, businessDate: visit.business_date, createdAt: visit.created_at, visitId };
}

function isEarlier(previous: SideRow, current: SideRow): boolean {
  if (previous.businessDate !== current.businessDate) {
    return previous.businessDate < current.businessDate;
  }
  return previous.createdAt.getTime() < current.createdAt.getTime();
}

async function sideBody(
  db: Db,
  side: SideRow,
  hoof: Hoof,
  options: { vetLinkId?: string | null; forVet: boolean },
): Promise<Record<string, unknown>> {
  const photo = await queryOne<Parameters<typeof photoJson>[1]>(
    db,
    `SELECT id, visit_id, hoof, phase, content_type, width, height, thumbnail_status, thumbnail_key
     FROM photos WHERE visit_id = $1 AND hoof = $2 AND phase = 'after' AND deleted_at IS NULL`,
    [side.visitId, hoof],
  );
  const body: Record<string, unknown> = {
    business_date: side.businessDate,
    photo:
      photo === null
        ? null
        : await photoJson(db, photo, {
            vetLinkId: options.vetLinkId ?? null,
            omitIds: options.forVet,
          }),
    hoof_wall: {
      x1: side.marks.wall_x1,
      y1: side.marks.wall_y1,
      x2: side.marks.wall_x2,
      y2: side.marks.wall_y2,
      angle: Number(side.marks.wall_angle),
    },
    pastern: {
      x1: side.marks.past_x1,
      y1: side.marks.past_y1,
      x2: side.marks.past_x2,
      y2: side.marks.past_y2,
      angle: Number(side.marks.past_angle),
    },
    alignment: side.marks.alignment,
  };
  if (!options.forVet) body.visit_id = side.visitId;
  return body;
}

export interface ComparisonOptions {
  hoof: Hoof;
  previousVisitId?: string | null;
  currentVisitId?: string | null;
  includeOpen: boolean;
  forVet: boolean;
  vetLinkId?: string | null;
}

export type ComparisonOutcome =
  | { kind: 'ok'; body: Record<string, unknown> }
  | { kind: 'not_enough' }
  | { kind: 'invalid'; field: string };

export async function buildComparison(
  db: Db,
  horse: { id: string; name: string },
  options: ComparisonOptions,
): Promise<ComparisonOutcome> {
  const visits = await markedVisits(db, horse.id, options.hoof, options.includeOpen);
  let previousId = options.previousVisitId ?? null;
  let currentId = options.currentVisitId ?? null;

  if (previousId === null && currentId === null) {
    if (visits.length < 2) return { kind: 'not_enough' };
    currentId = (visits[0] as MarkedVisit).visit_id;
    previousId = (visits[1] as MarkedVisit).visit_id;
  }
  if (previousId === null || currentId === null) return { kind: 'invalid', field: 'previous' };

  const previous = await loadSide(db, previousId, options.hoof);
  const current = await loadSide(db, currentId, options.hoof);
  if (previous === null) return { kind: 'invalid', field: 'previous' };
  if (current === null) return { kind: 'invalid', field: 'current' };
  if (!isEarlier(previous, current)) return { kind: 'invalid', field: 'previous' };

  const previousSide = {
    wallAngle: Number(previous.marks.wall_angle),
    pasternAngle: Number(previous.marks.past_angle),
    alignment: previous.marks.alignment as Alignment,
  };
  const currentSide = {
    wallAngle: Number(current.marks.wall_angle),
    pasternAngle: Number(current.marks.past_angle),
    alignment: current.marks.alignment as Alignment,
  };

  const body: Record<string, unknown> = {
    hoof: options.hoof,
    previous: await sideBody(db, previous, options.hoof, options),
    current: await sideBody(db, current, options.hoof, options),
    difference: {
      hoof_wall: differenceValue(previousSide.wallAngle, currentSide.wallAngle),
      pastern: differenceValue(previousSide.pasternAngle, currentSide.pasternAngle),
    },
    readout: readoutLines(previousSide, currentSide),
  };
  if (!options.forVet) {
    body.horse = { id: horse.id, name: horse.name };
    body.marked_visits = visits
      .slice()
      .reverse()
      .map((visit) => ({ visit_id: visit.visit_id, business_date: visit.business_date }));
  }
  return { kind: 'ok', body };
}

export function registerComparisonRoutes(): void {
  route({
    method: 'GET',
    path: '/api/horses/:id/comparison',
    roles: ['farrier', 'apprentice', 'owner'],
    tokenAccess: 'read_only',
    handler: async (ctx: Ctx) => {
      const hoof = ctx.url.searchParams.get('hoof');
      if (!isHoof(hoof)) throw new ValidationError({ hoof: fieldMessages.required });
      const body = await withClient(async (db) => {
        const horse = await visibleHorse(db, ctx.caller, ctx.params.id as string);
        const outcome = await buildComparison(db, horse, {
          hoof,
          previousVisitId: ctx.url.searchParams.get('previous'),
          currentVisitId: ctx.url.searchParams.get('current'),
          includeOpen: ctx.caller.role !== 'owner',
          forVet: false,
        });
        if (outcome.kind === 'not_enough') throw conflict('not_enough_marked_visits');
        if (outcome.kind === 'invalid') {
          throw new ValidationError({ [outcome.field]: fieldMessages.required });
        }
        return outcome.body;
      });
      return json(200, body);
    },
  });
}

