import type { Role, SheetShape } from '../../shared/model.ts';
import type { Queryable } from '../db/database.ts';
import type { App, AuthUser } from '../http/app.ts';
import { notFound } from '../http/errors.ts';
import { requireRole } from '../projects/access.ts';
import { bumpWorkbook, canOpen, staleVersion } from '../workbooks/store.ts';
import type { WorkbookRow } from '../workbooks/store.ts';

export const sheetSchema = [
  `CREATE TABLE IF NOT EXISTS sheets (
     id text PRIMARY KEY,
     workbook_id text NOT NULL REFERENCES workbooks(id),
     owner_id text REFERENCES users(id),
     name text NOT NULL,
     shape jsonb NOT NULL,
     version integer NOT NULL DEFAULT 1,
     seq bigserial
   )`,
  `CREATE INDEX IF NOT EXISTS sheets_workbook ON sheets (workbook_id)`,
  `CREATE TABLE IF NOT EXISTS calculations (
     id text PRIMARY KEY,
     sheet_id text NOT NULL REFERENCES sheets(id),
     name text NOT NULL,
     formula text NOT NULL,
     seq bigserial
   )`,
  `CREATE INDEX IF NOT EXISTS calculations_sheet ON calculations (sheet_id)`,
];

/** A sheet as stored: `shape` names fields, calculations and sets by id (see refs.ts). `owner_id` marks a personal copy. */
export interface SheetRow {
  id: string;
  workbook_id: string;
  owner_id: string | null;
  shape: SheetShape;
  version: number;
}

export interface SheetAccess {
  sheet: SheetRow;
  workbook: WorkbookRow;
  role: Role;
}

/** Stored formulas (field ids). */
export interface CalculationRow {
  id: string;
  sheet_id: string;
  name: string;
  formula: string;
}

/**
 * The sheet and its workbook for the caller: 404 for a missing sheet, a project the caller is not in, a draft the caller
 * may not see, or another user's copy.
 */
export async function openSheet(app: App, user: AuthUser, sheetId: string): Promise<SheetAccess> {
  const found = await app.db.row<{ sheet: SheetRow; workbook: WorkbookRow; role: Role }>(
    `SELECT json_build_object('id', s.id, 'workbook_id', s.workbook_id, 'owner_id', s.owner_id, 'shape', s.shape,
                              'version', s.version) AS sheet,
            json_build_object('id', w.id, 'project_id', w.project_id, 'source_id', w.source_id, 'name', w.name,
                              'state', w.state, 'version', w.version, 'certified_by', w.certified_by) AS workbook,
            m.role
       FROM sheets s
       JOIN workbooks w ON w.id = s.workbook_id
       JOIN project_members m ON m.project_id = w.project_id AND m.user_id = $2
      WHERE s.id = $1`,
    [sheetId, user.id],
  );
  if (!found || !canOpen(found.workbook.state, found.role)) throw notFound();
  if (found.sheet.owner_id !== null && found.sheet.owner_id !== user.id) throw notFound();
  return found;
}

/** Creators edit workbook sheets; explorers and creators edit their own copies. */
export function requireSheetWrite(access: SheetAccess): void {
  requireRole(access.role, access.sheet.owner_id === null ? 'creator' : 'explorer');
}

/** The version `If-Match` compares against: the workbook's, or a copy's own. */
export function sheetVersion(access: SheetAccess): number {
  return access.sheet.owner_id === null ? access.workbook.version : access.sheet.version;
}

/** Bumps the version a change to this sheet or its calculations counts against. */
export async function bumpSheet(q: Queryable, access: SheetAccess, expected: number | null = null): Promise<number> {
  if (access.sheet.owner_id === null) return bumpWorkbook(q, access.workbook.id, expected);
  const row = await q.row<{ version: number }>(
    `UPDATE sheets SET version = version + 1 WHERE id = $1 AND ($2::integer IS NULL OR version = $2) RETURNING version`,
    [access.sheet.id, expected],
  );
  if (row) return row.version;
  throw staleVersion((await q.row<{ version: number }>(`SELECT version FROM sheets WHERE id = $1`, [access.sheet.id]))?.version ?? 0);
}

export function calculationsOf(q: Queryable, sheetId: string): Promise<CalculationRow[]> {
  return q.rows<CalculationRow>(`SELECT id, sheet_id, name, formula FROM calculations WHERE sheet_id = $1 ORDER BY seq`, [
    sheetId,
  ]);
}

/** Workbook sheets (not copies) in creation order. */
export function workbookSheets(q: Queryable, workbookId: string): Promise<(SheetRow & { name: string })[]> {
  return q.rows<SheetRow & { name: string }>(
    `SELECT id, workbook_id, owner_id, name, shape, version FROM sheets
      WHERE workbook_id = $1 AND owner_id IS NULL ORDER BY seq`,
    [workbookId],
  );
}
