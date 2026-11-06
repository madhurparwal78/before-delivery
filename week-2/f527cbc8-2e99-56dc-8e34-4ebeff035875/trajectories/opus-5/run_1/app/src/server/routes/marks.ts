import { now } from '../clock.js';
import { query, queryOne, withClient, withTransaction, type Db } from '../db.js';
import { json, route, type Ctx } from '../http.js';
import { newId } from '../util.js';
import {
  ValidationError,
  conflict,
  fieldMessages,
  notFound,
  staleMarks,
} from '../errors.js';
import { appendEvent, horseChannel } from '../stream.js';
import { practice } from '../domain/practice.js';
import {
  alignmentOf,
  isHoof,
  lineAngle,
  lineFitsPhoto,
  type Hoof,
  type Line,
} from '../domain/marks.js';
import {
  MARKS_COLUMNS,
  currentMarks,
  loadVisit,
  marksJson,
  visibleVisit,
  type MarksRow,
  type VisitRow,
} from './visits.js';

/**
 * Hoof marks. Both angles, the alignment label and a new version are computed once on
 * the server; each save must name the current version, and a save over a newer version
 * answers 412 with the stored marks.
 */
const STAFF = ['farrier', 'apprentice'] as const;

function readLine(value: unknown, field: string): Line {
  if (typeof value !== 'object' || value === null) {
    throw new ValidationError({ [field]: fieldMessages.coordinates });
  }
  const raw = value as Record<string, unknown>;
  const numbers = (['x1', 'y1', 'x2', 'y2'] as const).map((key) => {
    const candidate = raw[key];
    const parsed = typeof candidate === 'number' ? candidate : Number(candidate);
    if (!Number.isFinite(parsed)) throw new ValidationError({ [field]: fieldMessages.coordinates });
    return parsed;
  });
  return {
    x1: numbers[0] as number,
    y1: numbers[1] as number,
    x2: numbers[2] as number,
    y2: numbers[3] as number,
  };
}

/** Mark points are checked against the stored upright photo's width and height. */
async function afterPhotoSize(db: Db, visitId: string, hoof: Hoof): Promise<{ width: number; height: number } | null> {
  return await queryOne<{ width: number; height: number }>(
    db,
    `SELECT width, height FROM photos
     WHERE visit_id = $1 AND hoof = $2 AND phase = 'after' AND deleted_at IS NULL`,
    [visitId, hoof],
  );
}

function readVersion(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  throw new ValidationError({ version: fieldMessages.required });
}

async function assertVersionMatches(
  db: Db,
  visit: VisitRow,
  hoof: Hoof,
  given: number | null,
  forStaff: boolean,
  timeZone: string,
): Promise<MarksRow | null> {
  const stored = await currentMarks(db, visit.id, hoof);
  const expected = stored === null ? null : stored.version;
  if (given !== expected) {
    throw staleMarks(stored === null ? null : marksJson(stored, forStaff, timeZone));
  }
  return stored;
}

async function insertMarks(
  db: Db,
  visit: VisitRow,
  hoof: Hoof,
  lines: { wall: Line; pastern: Line },
  angles: { wall: number; pastern: number },
  nextVersion: number,
  savedBy: string,
  restoredFrom: number | null,
  at: Date,
): Promise<MarksRow> {
  await query(db, 'UPDATE hoof_marks SET current = false WHERE visit_id = $1 AND hoof = $2 AND current', [
    visit.id,
    hoof,
  ]);
  await query(
    db,
    `INSERT INTO hoof_marks (id, visit_id, hoof, version, wall_x1, wall_y1, wall_x2, wall_y2,
                             past_x1, past_y1, past_x2, past_y2, wall_angle, past_angle,
                             alignment, saved_by, saved_at, restored_from, current)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,true)`,
    [
      newId(),
      visit.id,
      hoof,
      nextVersion,
      lines.wall.x1,
      lines.wall.y1,
      lines.wall.x2,
      lines.wall.y2,
      lines.pastern.x1,
      lines.pastern.y1,
      lines.pastern.x2,
      lines.pastern.y2,
      angles.wall,
      angles.pastern,
      alignmentOf(angles.wall, angles.pastern),
      savedBy,
      at,
      restoredFrom,
    ],
  );
  const saved = await currentMarks(db, visit.id, hoof);
  if (saved === null) throw new Error('marks vanished');
  return saved;
}

async function announceMarks(
  db: Db,
  visit: VisitRow,
  hoof: Hoof,
  version: number | null,
  at: Date,
): Promise<void> {
  await appendEvent(
    db,
    horseChannel(visit.horse_id, 'staff'),
    'marks_saved',
    { visit_id: visit.id, hoof, version },
    at,
  );
  // The owner's stream never carries an event about an open visit.
  if (visit.status !== 'open') {
    await appendEvent(
      db,
      horseChannel(visit.horse_id, 'owner'),
      'marks_saved',
      { visit_id: visit.id, hoof, version },
      at,
    );
  }
}

export function registerMarksRoutes(): void {
  route({
    method: 'PUT',
    path: '/api/visits/:id/hooves/:hoof/marks',
    roles: STAFF,
    bodyKind: 'json',
    handler: async (ctx: Ctx) => {
      const visitId = ctx.params.id as string;
      const hoof = ctx.params.hoof;
      if (!isHoof(hoof)) throw notFound();
      await withClient((db) => visibleVisit(db, ctx.caller, visitId));
      const body = ctx.body<{ version?: unknown; hoof_wall?: unknown; pastern?: unknown }>();
      const given = readVersion(body.version);

      const result = await withTransaction(async (db) => {
        const at = now();
        const { timeZone } = await practice(db);
        const visit = await loadVisit(db, visitId, true);
        if (visit === null) throw notFound();

        const stored = await assertVersionMatches(db, visit, hoof, given, true, timeZone);
        if (visit.status !== 'open') throw conflict('visit_closed');
        const size = await afterPhotoSize(db, visit.id, hoof);
        if (size === null) throw conflict('photo_required');

        const wall = readLine(body.hoof_wall, 'hoof_wall');
        const pastern = readLine(body.pastern, 'pastern');
        const errors: Record<string, string> = {};
        if (!lineFitsPhoto(wall, size.width, size.height)) errors.hoof_wall = fieldMessages.coordinates;
        if (!lineFitsPhoto(pastern, size.width, size.height)) errors.pastern = fieldMessages.coordinates;
        if (Object.keys(errors).length > 0) throw new ValidationError(errors);

        const angles = { wall: lineAngle(wall), pastern: lineAngle(pastern) };
        const nextVersion = (stored?.version ?? 0) + 1;
        const saved = await insertMarks(
          db,
          visit,
          hoof,
          { wall, pastern },
          angles,
          nextVersion,
          ctx.caller.userId,
          null,
          at,
        );
        await announceMarks(db, visit, hoof, saved.version, at);
        return marksJson(saved, true, timeZone);
      });
      return json(200, result);
    },
  });

  route({
    method: 'GET',
    path: '/api/visits/:id/hooves/:hoof/marks/history',
    roles: STAFF,
    tokenAccess: 'read_only',
    handler: async (ctx: Ctx) => {
      const hoof = ctx.params.hoof;
      if (!isHoof(hoof)) throw notFound();
      const rows = await withClient(async (db) => {
        const visit = await visibleVisit(db, ctx.caller, ctx.params.id as string);
        const { timeZone } = await practice(db);
        const history = await query<MarksRow>(
          db,
          `SELECT ${MARKS_COLUMNS} FROM hoof_marks m JOIN users u ON u.id = m.saved_by
           WHERE m.visit_id = $1 AND m.hoof = $2 ORDER BY m.version`,
          [visit.id, hoof],
        );
        return history.map((entry) => {
          const body = marksJson(entry, true, timeZone);
          delete body.hoof;
          return body;
        });
      });
      return json(200, rows);
    },
  });

  route({
    method: 'POST',
    path: '/api/visits/:id/hooves/:hoof/marks/restore',
    roles: STAFF,
    bodyKind: 'json',
    handler: async (ctx: Ctx) => {
      const visitId = ctx.params.id as string;
      const hoof = ctx.params.hoof;
      if (!isHoof(hoof)) throw notFound();
      await withClient((db) => visibleVisit(db, ctx.caller, visitId));
      const body = ctx.body<{ version?: unknown; restore_version?: unknown }>();
      const given = readVersion(body.version);

      const result = await withTransaction(async (db) => {
        const at = now();
        const { timeZone } = await practice(db);
        const visit = await loadVisit(db, visitId, true);
        if (visit === null) throw notFound();

        const stored = await assertVersionMatches(db, visit, hoof, given, true, timeZone);
        if (visit.status !== 'open') throw conflict('visit_closed');

        const wanted = typeof body.restore_version === 'number' ? body.restore_version : Number.NaN;
        const source = await queryOne<MarksRow>(
          db,
          `SELECT ${MARKS_COLUMNS} FROM hoof_marks m JOIN users u ON u.id = m.saved_by
           WHERE m.visit_id = $1 AND m.hoof = $2 AND m.version = $3`,
          [visit.id, hoof, wanted],
        );
        if (source === null) {
          throw new ValidationError({ restore_version: fieldMessages.unknownRestoreVersion });
        }

        // A restore copies the stored lines, angles and label; it never recomputes them.
        await query(db, 'UPDATE hoof_marks SET current = false WHERE visit_id = $1 AND hoof = $2 AND current', [
          visit.id,
          hoof,
        ]);
        const nextVersion = (stored?.version ?? 0) + 1;
        await query(
          db,
          `INSERT INTO hoof_marks (id, visit_id, hoof, version, wall_x1, wall_y1, wall_x2, wall_y2,
                                   past_x1, past_y1, past_x2, past_y2, wall_angle, past_angle,
                                   alignment, saved_by, saved_at, restored_from, current)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,true)`,
          [
            newId(),
            visit.id,
            hoof,
            nextVersion,
            source.wall_x1,
            source.wall_y1,
            source.wall_x2,
            source.wall_y2,
            source.past_x1,
            source.past_y1,
            source.past_x2,
            source.past_y2,
            source.wall_angle,
            source.past_angle,
            source.alignment,
            ctx.caller.userId,
            at,
            source.version,
          ],
        );
        const saved = await currentMarks(db, visit.id, hoof);
        if (saved === null) throw new Error('marks vanished');
        await announceMarks(db, visit, hoof, saved.version, at);
        return marksJson(saved, true, timeZone);
      });
      return json(200, result);
    },
  });
}
