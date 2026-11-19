import { atLeast, roleIn } from './auth.js';
import { forbidden, notFound, type Ctx, type SessionUser } from './http.js';
import { loadSheetRecord, loadWorkbookRecord, type SheetRecord, type WorkbookRecord } from './domain/sheetquery.js';
import { q1 } from './db.js';
import type { Role } from '../shared/types.js';

export const SAMPLE_SHEET_ID = 'sample-sheet';

export function signedIn(ctx: Ctx): SessionUser {
  if (ctx.user === null) notFound();
  return ctx.user;
}

export async function workbookAccess(
  ctx: Ctx,
  workbookId: string,
  min: Role = 'viewer',
): Promise<{ workbook: WorkbookRecord; role: Role; user: SessionUser }> {
  const user = signedIn(ctx);
  const workbook = await loadWorkbookRecord(workbookId);
  if (workbook === null) notFound();
  const role = await roleIn(workbook.project_id, user.id);
  if (role === null) notFound();
  if (workbook.state === 'draft' && role !== 'creator') notFound();
  if (!atLeast(role, min)) forbidden();
  return { workbook, role, user };
}

export async function sheetAccess(
  ctx: Ctx,
  sheetId: string,
  min: Role = 'viewer',
): Promise<{ sheet: SheetRecord; workbook: WorkbookRecord; role: Role; user: SessionUser }> {
  const user = signedIn(ctx);
  const sheet = await loadSheetRecord(sheetId);
  if (sheet === null) notFound();
  if (sheet.owner_id !== null && sheet.owner_id !== user.id) notFound();
  const access = await workbookAccess(ctx, sheet.workbook_id, min);
  return { sheet, ...access };
}

export async function sourceAccess(
  ctx: Ctx,
  sourceId: string,
  min: Role = 'viewer',
): Promise<{ sourceId: string; projectId: string; role: Role; user: SessionUser }> {
  const user = signedIn(ctx);
  const source = await q1<{ project_id: string }>('SELECT project_id FROM sources WHERE id = $1', [sourceId]);
  if (source === null) notFound();
  const role = await roleIn(source.project_id, user.id);
  if (role === null) notFound();
  if (!atLeast(role, min)) forbidden();
  return { sourceId, projectId: source.project_id, role, user };
}
