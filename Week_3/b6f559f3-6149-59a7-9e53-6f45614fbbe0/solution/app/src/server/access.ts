/** Project visibility, roles and the derived counters. Every project route opens its project here. */
import { MESSAGES } from '../shared/messages';
import type { ProjectSummary, Role } from '../shared/types';
import { now } from './clock';
import { query, type Queryable } from './db';
import { fail, forbidden, notFound, type Ctx, type Person } from './http';

interface SummaryRow {
  id: string;
  name: string;
  workspace_id: string;
  status: 'active' | 'trashed';
  role: Role;
  layer_count: number;
  live_version: number | null;
  editor_count: number;
  viewer_count: number;
  trashed_at: Date | null;
  purge_at: Date | null;
}

/**
 * The one query behind every project summary. Counters are recomputed from rows on every read.
 * A project past its purge date is invisible: it answers 404 even before the purge job removes its rows.
 */
const SUMMARY_SQL = `
  SELECT p.id, p.name, p.workspace_id, p.status, m.role, p.trashed_at, p.purge_at,
    (SELECT count(*) FROM layers l WHERE l.project_id = p.id AND l.kind <> 'Group')::int AS layer_count,
    (SELECT max(v.number) FROM versions v WHERE v.project_id = p.id AND v.status = 'live')::int AS live_version,
    (SELECT count(*) FROM members x WHERE x.project_id = p.id AND x.role = 'Editor')::int AS editor_count,
    (SELECT count(*) FROM members x WHERE x.project_id = p.id AND x.role = 'Viewer')::int AS viewer_count
  FROM projects p
  JOIN members m ON m.project_id = p.id AND m.person_id = $1
  WHERE (p.purge_at IS NULL OR p.purge_at > $2)`;

const toSummary = (row: SummaryRow): ProjectSummary => ({
  id: row.id,
  name: row.name,
  workspaceId: row.workspace_id,
  status: row.status,
  role: row.role,
  layerCount: row.layer_count,
  liveVersion: row.live_version,
  editorCount: row.editor_count,
  viewerCount: row.viewer_count,
  trashedAt: row.trashed_at ? row.trashed_at.toISOString() : null,
  purgeAt: row.purge_at ? row.purge_at.toISOString() : null,
});

export async function listProjects(personId: string, status: 'active' | 'trashed', client?: Queryable): Promise<ProjectSummary[]> {
  const at = await now(client);
  const run = client ? (await client.query<SummaryRow>(`${SUMMARY_SQL} AND p.status = $3 ORDER BY p.created_at, p.id`, [personId, at, status])).rows : await query<SummaryRow>(`${SUMMARY_SQL} AND p.status = $3 ORDER BY p.created_at, p.id`, [personId, at, status]);
  return run.map(toSummary);
}

/** The project as `personId` sees it, or null when they cannot open it. */
export async function findProject(personId: string, projectId: string, client?: Queryable): Promise<ProjectSummary | null> {
  if (projectId.includes('\u0000')) return null;
  const at = await now(client);
  const sql = `${SUMMARY_SQL} AND p.id = $3`;
  const rows = client ? (await client.query<SummaryRow>(sql, [personId, at, projectId])).rows : await query<SummaryRow>(sql, [personId, at, projectId]);
  const row = rows[0];
  return row ? toSummary(row) : null;
}

/** 401 when signed out, 404 when the person cannot open the project. The single visibility check. */
export async function openProject(ctx: Ctx, projectId: string): Promise<{ person: Person; project: ProjectSummary }> {
  const person = await ctx.requirePerson();
  const project = await findProject(person.id, projectId);
  if (!project) return notFound();
  return { person, project };
}

const canEdit = (role: Role): boolean => role !== 'Viewer';

/** 403 for viewers. */
export function requireEditor(project: ProjectSummary): void {
  if (!canEdit(project.role)) forbidden(MESSAGES.viewerRefusal);
}

/** 403 with the given copy unless the person owns the project. */
export function requireOwner(project: ProjectSummary, message: string): void {
  if (project.role !== 'Owner') forbidden(message);
}

/**
 * Locks the project row until the transaction ends and returns its status. `update` serialises writers on the row;
 * `share` only keeps the project from being trashed underneath a long write.
 */
export async function lockProject(client: Queryable, projectId: string, mode: 'update' | 'share'): Promise<ProjectSummary['status']> {
  const sql = `SELECT status FROM projects WHERE id = $1 FOR ${mode === 'update' ? 'UPDATE' : 'SHARE'}`;
  const row = (await client.query<{ status: ProjectSummary['status'] }>(sql, [projectId])).rows[0];
  return row ? row.status : notFound();
}

/** The one 409 for writing to a trashed project. */
export function refuseTrashed(status: ProjectSummary['status']): void {
  if (status === 'trashed') fail(409, 'trashed', MESSAGES.trashed);
}

/** Inside a write transaction: the project must still be active, and stays so until the transaction ends. */
export async function assertActive(client: Queryable, projectId: string): Promise<void> {
  refuseTrashed(await lockProject(client, projectId, 'share'));
}
