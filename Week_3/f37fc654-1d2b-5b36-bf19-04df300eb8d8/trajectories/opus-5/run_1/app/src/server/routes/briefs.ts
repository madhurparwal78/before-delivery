import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { ApiError, ValidationError, notFound } from '../http/errors.js';
import { bodyObject, pathParam, route } from '../http/handler.js';
import { requireCaller, requireRole, type Caller } from '../http/session.js';
import { briefFor, type BriefRow } from '../domain/access.js';
import {
  ensureLeadFunder,
  ensureMilestoneRows,
  findCommission,
  issueQuote,
  shapeCommission,
} from '../domain/commissions.js';
import { FIELD_ERRORS } from '../../shared/copy.js';
import {
  ADDON_ORDER,
  findVenue,
  type AddOn,
  type Audience,
  type DoorWall,
  type InstallationType,
} from '../../shared/seed.js';

export const briefsRouter = Router();

const INSTALLATION_TYPES: readonly InstallationType[] = [
  'camera-reactive-wall', 'portrait-kiosk', 'projection-room',
];
const DOOR_WALLS: readonly DoorWall[] = ['front', 'back', 'left', 'right'];
const AUDIENCES: readonly Audience[] = ['up-to-25', '25-100', '100-300', 'over-300'];

interface BriefShape {
  id: string;
  answers: Record<string, unknown>;
  answeredThrough: number;
  nextStep: number | null;
  commissionId: string | null;
}

function shapeBrief(row: BriefRow): BriefShape {
  return {
    id: row.id,
    answers: row.answers,
    answeredThrough: row.answered_through,
    nextStep: row.answered_through >= 6 ? null : row.answered_through + 1,
    commissionId: row.commission_id,
  };
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** A room dimension: 4 to 60 metres inclusive, in half-metre steps. */
function roomDimensionIsValid(value: unknown): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (value < 4 || value > 60) return false;
  return Math.abs(value * 2 - Math.round(value * 2)) < 1e-9;
}

/** Validate one step's answer, with the published field messages. */
function validateStep(step: number, answer: Record<string, unknown>): Record<string, unknown> {
  const errors: Record<string, string> = {};
  switch (step) {
    case 1: {
      const installationType = asString(answer['installationType']);
      const title = asString(answer['title']).trim();
      if (!INSTALLATION_TYPES.includes(installationType as InstallationType)) {
        errors['installationType'] = FIELD_ERRORS.installationType;
      }
      if (title.length < 2 || title.length > 80) errors['title'] = FIELD_ERRORS.title;
      if (Object.keys(errors).length > 0) throw new ValidationError(errors);
      return { installationType, title };
    }
    case 2: {
      const venueId = asString(answer['venueId']);
      if (!findVenue(venueId)) throw new ValidationError({ venueId: FIELD_ERRORS.venueId });
      return { venueId };
    }
    case 3: {
      const widthM = answer['widthM'];
      const depthM = answer['depthM'];
      if (!roomDimensionIsValid(widthM)) errors['widthM'] = FIELD_ERRORS.widthM;
      if (!roomDimensionIsValid(depthM)) errors['depthM'] = FIELD_ERRORS.depthM;
      if (Object.keys(errors).length > 0) throw new ValidationError(errors);
      return { widthM, depthM };
    }
    case 4: {
      const doorWall = asString(answer['doorWall']);
      if (!DOOR_WALLS.includes(doorWall as DoorWall)) {
        throw new ValidationError({ doorWall: FIELD_ERRORS.doorWall });
      }
      return { doorWall };
    }
    case 5: {
      const audience = asString(answer['audience']);
      if (!AUDIENCES.includes(audience as Audience)) {
        throw new ValidationError({ audience: FIELD_ERRORS.audience });
      }
      return { audience };
    }
    case 6: {
      const rawAddOns = answer['addOns'];
      const addOns = Array.isArray(rawAddOns) ? rawAddOns : [];
      const valid = addOns.every((a) => ADDON_ORDER.includes(a as AddOn));
      const unique = new Set(addOns).size === addOns.length;
      if (!valid || !unique) errors['addOns'] = FIELD_ERRORS.addOns;
      const notes = answer['notes'] === undefined || answer['notes'] === null
        ? ''
        : asString(answer['notes']);
      if (notes.length > 2000) errors['notes'] = FIELD_ERRORS.notes;
      if (Object.keys(errors).length > 0) throw new ValidationError(errors);
      return {
        addOns: ADDON_ORDER.filter((a) => addOns.includes(a)),
        notes,
      };
    }
    default:
      throw notFound();
  }
}

briefsRouter.post(
  '/api/briefs',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    requireRole(caller, 'client', 'producer');
    const id = randomUUID();
    const inserted = await query<BriefRow>(
      `INSERT INTO briefs (id, client_id) VALUES ($1, $2)
       RETURNING id, client_id, answers, answered_through, commission_id`,
      [id, caller.user.id],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error('brief insert produced no row');
    res.status(201).json(shapeBrief(row));
  }),
);

briefsRouter.get(
  '/api/briefs/:briefId',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const brief = await briefFor(pathParam(req, 'briefId'), caller);
    res.json(shapeBrief(brief));
  }),
);

briefsRouter.put(
  '/api/briefs/:briefId/steps/:step',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const brief = await briefFor(pathParam(req, 'briefId'), caller);
    const step = Number.parseInt(pathParam(req, 'step'), 10);
    if (!Number.isInteger(step) || step < 1 || step > 6) throw notFound();
    if (brief.commission_id !== null) throw new ApiError(409, 'brief_completed');
    if (step > brief.answered_through + 1) throw new ApiError(409, 'step_out_of_order');

    const body = bodyObject(req);
    const rawAnswer = body['answer'];
    const answer =
      rawAnswer !== null && typeof rawAnswer === 'object' && !Array.isArray(rawAnswer)
        ? (rawAnswer as Record<string, unknown>)
        : {};
    const validated = validateStep(step, answer);

    const answers = { ...brief.answers, ...validated };
    const answeredThrough = Math.max(brief.answered_through, step);
    const updated = await query<BriefRow>(
      `UPDATE briefs SET answers = $2, answered_through = $3
        WHERE id = $1
        RETURNING id, client_id, answers, answered_through, commission_id`,
      [brief.id, JSON.stringify(answers), answeredThrough],
    );
    const row = updated.rows[0];
    if (!row) throw new Error('brief update produced no row');
    res.json(shapeBrief(row));
  }),
);

briefsRouter.post(
  '/api/briefs/:briefId/complete',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const brief = await briefFor(pathParam(req, 'briefId'), caller);
    if (brief.commission_id !== null) {
      const existing = await findCommission(brief.commission_id);
      if (!existing) throw notFound();
      res.status(200).json(await shapeCommission(existing));
      return;
    }
    if (brief.answered_through < 6) throw new ApiError(409, 'brief_incomplete');

    const commission = await createCommissionFromBrief(brief, caller);
    res.status(201).json(await shapeCommission(commission));
  }),
);

/** Completing a brief creates one commission in state briefed. */
async function createCommissionFromBrief(brief: BriefRow, caller: Caller) {
  const answers = brief.answers;
  const venue = findVenue(asString(answers['venueId']));
  if (!venue) throw new ApiError(409, 'brief_incomplete');
  const addOns = Array.isArray(answers['addOns']) ? (answers['addOns'] as AddOn[]) : [];

  const commissionId = randomUUID();
  await withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO commissions
         (id, client_id, brief_id, title, state, installation_type, venue_id,
          width_m, depth_m, door_wall, audience, notes, size_option, add_ons)
       VALUES ($1, $2, $3, $4, 'briefed', $5, $6, $7, $8, $9, $10, $11, 'compact', $12)`,
      [
        commissionId,
        brief.client_id,
        brief.id,
        asString(answers['title']).trim(),
        asString(answers['installationType']),
        venue.id,
        Number(answers['widthM']),
        Number(answers['depthM']),
        asString(answers['doorWall']),
        asString(answers['audience']),
        asString(answers['notes']),
        addOns,
      ],
    );
    await tx.query('UPDATE briefs SET commission_id = $2 WHERE id = $1', [brief.id, commissionId]);
    await ensureLeadFunder(tx, commissionId, caller.user.name);
    await ensureMilestoneRows(tx, commissionId);
    const created = await tx.query<Parameters<typeof issueQuote>[1]>(
      'SELECT * FROM commissions WHERE id = $1',
      [commissionId],
    );
    const row = created.rows[0];
    if (row) await issueQuote(tx, row, venue);
  });

  const commission = await findCommission(commissionId);
  if (!commission) throw new Error('commission insert produced no row');
  return commission;
}
