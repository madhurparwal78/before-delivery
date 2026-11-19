import type { Role } from '../../shared/model.ts';
import type { Queryable } from '../db/database.ts';
import { newId } from '../db/ids.ts';
import type { App, AuthUser, Context } from '../http/app.ts';
import { conflict, notFound } from '../http/errors.ts';

export const workbookSchema = [
  `CREATE TABLE IF NOT EXISTS workbooks (
     id text PRIMARY KEY,
     project_id text NOT NULL REFERENCES projects(id),
     source_id text NOT NULL REFERENCES sources(id),
     name text NOT NULL,
     state text NOT NULL DEFAULT 'draft',
     version integer NOT NULL DEFAULT 1,
     certified_by text,
     seq bigserial
   )`,
  `CREATE INDEX IF NOT EXISTS workbooks_project ON workbooks (project_id)`,
  `CREATE TABLE IF NOT EXISTS parameters (
     id text PRIMARY KEY,
     workbook_id text NOT NULL REFERENCES workbooks(id),
     name text NOT NULL,
     type text NOT NULL,
     value jsonb NOT NULL,
     "values" jsonb NOT NULL,
     seq bigserial
   )`,
  `CREATE INDEX IF NOT EXISTS parameters_workbook ON parameters (workbook_id)`,
  `CREATE TABLE IF NOT EXISTS sets (
     id text PRIMARY KEY,
     workbook_id text NOT NULL REFERENCES workbooks(id),
     name text NOT NULL,
     field text NOT NULL,
     members jsonb,
     top jsonb,
     seq bigserial
   )`,
  `CREATE INDEX IF NOT EXISTS sets_workbook ON sets (workbook_id)`,
];

export type WorkbookState = 'draft' | 'published';

export interface WorkbookRow {
  id: string;
  project_id: string;
  source_id: string;
  name: string;
  state: WorkbookState;
  version: number;
  certified_by: string | null;
}

interface WorkbookAccess {
  workbook: WorkbookRow;
  role: Role;
}

const COLUMNS = `w.id, w.project_id, w.source_id, w.name, w.state, w.version, w.certified_by`;

/** A draft is seen only by creators; everyone else, like a non-member, gets the same 404. */
export function canOpen(state: WorkbookState, role: Role): boolean {
  return state === 'published' || role === 'creator';
}

export async function openWorkbook(app: App, user: AuthUser, workbookId: string): Promise<WorkbookAccess> {
  const found = await app.db.row<WorkbookRow & { role: Role }>(
    `SELECT ${COLUMNS}, m.role FROM workbooks w
       JOIN project_members m ON m.project_id = w.project_id AND m.user_id = $2
      WHERE w.id = $1`,
    [workbookId, user.id],
  );
  if (!found || !canOpen(found.state, found.role)) throw notFound();
  const { role, ...workbook } = found;
  return { workbook, role };
}

function getWorkbook(q: Queryable, workbookId: string): Promise<WorkbookRow | null> {
  return q.row<WorkbookRow>(`SELECT ${COLUMNS} FROM workbooks w WHERE w.id = $1`, [workbookId]);
}

/** The `If-Match` version: digits, optionally quoted; null when missing or not a version. */
function ifMatch(ctx: Context): number | null {
  const header = ctx.req.headers['if-match'];
  const text = (Array.isArray(header) ? header[0] : header)?.trim().replace(/^W\//, '').replace(/^"(.*)"$/, '$1');
  return text !== undefined && /^\d+$/.test(text) ? Number(text) : null;
}

export function staleVersion(current: number): Error {
  return conflict('stale_version', { version: current });
}

/** 409 `stale_version` unless the request's `If-Match` names `current`. */
export function requireVersion(ctx: Context, current: number): number {
  if (ifMatch(ctx) !== current) throw staleVersion(current);
  return current;
}

/**
 * Every change to a workbook or its sheets, dashboards, parameters, sets or calculations bumps the version by 1.
 * With `expected`, the bump happens only from that version (a concurrent change answers 409).
 */
export async function bumpWorkbook(q: Queryable, workbookId: string, expected: number | null = null): Promise<number> {
  const row = await q.row<{ version: number }>(
    `UPDATE workbooks SET version = version + 1 WHERE id = $1 AND ($2::integer IS NULL OR version = $2)
     RETURNING version`,
    [workbookId, expected],
  );
  if (row) return row.version;
  const current = await getWorkbook(q, workbookId);
  throw staleVersion(current?.version ?? 0);
}

export async function createWorkbook(q: Queryable, projectId: string, sourceId: string, name: string): Promise<WorkbookRow> {
  const workbook: WorkbookRow = {
    id: newId(),
    project_id: projectId,
    source_id: sourceId,
    name,
    state: 'draft',
    version: 1,
    certified_by: null,
  };
  await q.exec(`INSERT INTO workbooks (id, project_id, source_id, name) VALUES ($1, $2, $3, $4)`, [
    workbook.id,
    projectId,
    sourceId,
    name,
  ]);
  return workbook;
}

/** draft -> published into `projectId`, or published again: either way the certification clears. */
export async function publishWorkbook(q: Queryable, workbookId: string, projectId: string): Promise<void> {
  await q.exec(`UPDATE workbooks SET state = 'published', project_id = $2, certified_by = NULL WHERE id = $1`, [
    workbookId,
    projectId,
  ]);
}

/** Certifies a published workbook; certifying again keeps the first certifier. */
export async function certifyWorkbook(q: Queryable, workbookId: string, username: string): Promise<string> {
  const row = await q.row<{ certified_by: string }>(
    `UPDATE workbooks SET certified_by = COALESCE(certified_by, $2) WHERE id = $1 RETURNING certified_by`,
    [workbookId, username],
  );
  return row?.certified_by ?? username;
}
