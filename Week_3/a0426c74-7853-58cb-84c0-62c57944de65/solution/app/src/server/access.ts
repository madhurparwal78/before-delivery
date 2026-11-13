// Who may reach a sheet, version, issue, RFI or export job: the one that owns it is a drawing, and a drawing outside the
// caller's folders does not exist for them (`not_found`, before any role check).
import * as copy from '../shared/copy.ts';
import { ApiError } from '../shared/errors.ts';
import { db } from './db.ts';
import type { Role } from '../shared/types.ts';
import { roleOnDrawing, type DrawingAccess } from './roles.ts';
import type { RequestContext } from './router.ts';

const DRAWING_OF = {
  sheet: 'SELECT drawing_id FROM sheets WHERE id = $1',
  viewport: 'SELECT s.drawing_id FROM viewports v JOIN sheets s ON s.id = v.sheet_id WHERE v.id = $1',
  version: 'SELECT s.drawing_id FROM versions v JOIN sheets s ON s.id = v.sheet_id WHERE v.id = $1',
  issue: 'SELECT s.drawing_id FROM issues i JOIN versions v ON v.id = i.version_id JOIN sheets s ON s.id = v.sheet_id WHERE i.id = $1',
  rfi: `SELECT s.drawing_id FROM rfis r JOIN issues i ON i.id = r.issue_id JOIN versions v ON v.id = i.version_id
        JOIN sheets s ON s.id = v.sheet_id WHERE r.id = $1`,
  export: 'SELECT drawing_id FROM export_jobs WHERE id = $1',
  link: 'SELECT s.drawing_id FROM links l JOIN versions v ON v.id = l.version_id JOIN sheets s ON s.id = v.sheet_id WHERE l.id = $1',
} as const;

export type Owned = keyof typeof DRAWING_OF;

/** The drawing that owns the record; `not_found` for an unknown id. */
export async function drawingOf(kind: Owned, id: string): Promise<string> {
  const rows = await db.query<{ drawing_id: string }>(DRAWING_OF[kind], [id]);
  if (rows.length === 0) throw new ApiError('not_found', copy.NOT_FOUND);
  return rows[0].drawing_id;
}

export interface Access extends DrawingAccess { drawingId: string }

/**
 * The caller's role through the record's drawing; `not_found` when the record is unknown or outside their folders, and, when `minimum`
 * is given, the forbidden family when their role is below it.
 */
export async function accessTo(ctx: RequestContext, kind: Owned, id: string, minimum?: Role): Promise<Access> {
  const drawingId = await drawingOf(kind, id);
  const access = await roleOnDrawing(ctx, drawingId, minimum);
  return { drawingId, ...access };
}
