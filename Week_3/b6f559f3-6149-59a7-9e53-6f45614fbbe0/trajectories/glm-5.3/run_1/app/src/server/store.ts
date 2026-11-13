// Store helpers: sessions, memberships, visibility, and the derived counters.
import type { Pool } from 'pg';
import type { App } from './app';
import { notFound, forbidden, unauthenticated } from './errors';
import { COPY } from '../domain/copy';
import { createHash, randomBytes } from 'node:crypto';

export interface Person {
  id: string;
  name: string;
  email: string;
  workspaceId: string;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

export function hashPassword(password: string): string {
  return createHash('sha256').update(`hs:${password}`).digest('hex');
}

export async function personBySession(
  pool: Pool,
  token: string | undefined,
): Promise<Person | null> {
  if (!token) return null;
  const res = await pool.query<{ id: string; name: string; email: string; workspace_id: string }>(
    `SELECT p.id, p.name, p.email, p.workspace_id
     FROM sessions s JOIN people p ON p.id = s.person_id
     WHERE s.token = $1`,
    [token],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { id: row.id, name: row.name, email: row.email, workspaceId: row.workspace_id };
}

export async function allWorkspacesOf(
  pool: Pool,
  personId: string,
): Promise<{ id: string; name: string; role: string }[]> {
  const res = await pool.query<{ id: string; name: string }>(
    `SELECT w.id, w.name FROM workspaces w
     JOIN people p ON p.workspace_id = w.id WHERE p.id = $1`,
    [personId],
  );
  return res.rows.map((r): { id: string; name: string; role: string } => ({ id: r.id, name: r.name, role: 'owner' }));
}

export async function requirePerson(app: App, token: string | undefined): Promise<Person> {
  const person = await personBySession(app.pool, token);
  if (!person) throw unauthenticated();
  return person;
}

export interface ProjectRow {
  id: string;
  name: string;
  workspace_id: string;
  status: string;
  trashed_at: Date | null;
  purge_at: Date | null;
  import_original_key: string | null;
}

export async function projectById(pool: Pool, id: string): Promise<ProjectRow | null> {
  const res = await pool.query<ProjectRow>(
    `SELECT id, name, workspace_id, status, trashed_at, purge_at, import_original_key
     FROM projects WHERE id = $1`,
    [id],
  );
  return res.rows[0] ?? null;
}

export async function membership(
  pool: Pool,
  projectId: string,
  personId: string,
): Promise<'Owner' | 'Editor' | 'Viewer' | null> {
  const res = await pool.query<{ role: string }>(
    `SELECT role FROM members WHERE project_id = $1 AND person_id = $2`,
    [projectId, personId],
  );
  const role = res.rows[0]?.role;
  if (role === 'Owner' || role === 'Editor' || role === 'Viewer') return role;
  return null;
}

// A person sees only projects they are a member of. Unknown, another
// workspace's, and purged projects all answer 404.
export async function openProject(
  app: App,
  projectId: string,
  person: Person | null,
): Promise<{ project: ProjectRow; role: 'Owner' | 'Editor' | 'Viewer' }> {
  if (!person) throw unauthenticated();
  const project = await projectById(app.pool, projectId);
  if (!project) throw notFound();
  const role = await membership(app.pool, projectId, person.id);
  if (!role) throw notFound();
  return { project, role };
}

export function requireEditor(role: 'Owner' | 'Editor' | 'Viewer'): void {
  if (role === 'Viewer') throw forbidden(COPY.viewerEdit);
}

export async function activeMemberIds(
  pool: Pool,
  projectId: string,
  role: 'Owner' | 'Editor' | 'Viewer',
): Promise<string[]> {
  const res = await pool.query<{ person_id: string }>(
    `SELECT person_id FROM members WHERE project_id = $1 AND role = $2`,
    [projectId, role],
  );
  return res.rows.map((r) => r.person_id);
}

export async function requirePersonRoute(ctx: { app: App; cookies: Record<string, string> }): Promise<Person> {
  const person = await personBySession(ctx.app.pool, ctx.cookies['hs_session']);
  if (!person) throw unauthenticated();
  return person;
}

export async function openProjectById(
  app: App,
  _ctx: { cookies: Record<string, string> },
  projectId: string,
  person: Person | null,
): Promise<{ project: ProjectRow; role: 'Owner' | 'Editor' | 'Viewer' }> {
  if (!person) throw unauthenticated();
  const project = await projectById(app.pool, projectId);
  if (!project) throw notFound();
  const role = await membership(app.pool, projectId, person.id);
  if (!role) throw notFound();
  return { project, role };
}

export interface ProjectSummary {
  id: string;
  name: string;
  workspaceId: string;
  status: string;
  role: 'Owner' | 'Editor' | 'Viewer';
  layerCount: number;
  liveVersion: number | null;
  editorCount: number;
  viewerCount: number;
  trashedAt: string | null;
  purgeAt: string | null;
}

export async function projectSummary(
  app: App,
  projectId: string,
  role: 'Owner' | 'Editor' | 'Viewer',
): Promise<ProjectSummary> {
  const project = await projectById(app.pool, projectId);
  if (!project) throw notFound();
  // Derived counters, recomputed from stored rows on every read.
  const counts = await app.pool.query<{
    layer_count: string;
    editor_count: string;
    viewer_count: string;
    live_version: number | null;
  }>(
    `SELECT
       (SELECT count(*) FROM scenes s WHERE s.project_id = $1) AS scene_count,
       (SELECT count(*) FROM members m WHERE m.project_id = $1 AND m.role = 'Editor') AS editor_count,
       (SELECT count(*) FROM members m WHERE m.project_id = $1 AND m.role = 'Viewer') AS viewer_count,
       (SELECT max(number) FROM versions v WHERE v.project_id = $1 AND v.status = 'live') AS live_version`,
    [projectId],
  );
  const row = counts.rows[0]!;
  // layerCount: every layer in every scene, excluding groups and the camera.
  const scenes = await app.pool.query<{ doc: unknown }>(
    `SELECT doc FROM scenes WHERE project_id = $1 ORDER BY ord`,
    [projectId],
  );
  let layerCount = 0;
  for (const s of scenes.rows) {
    const doc = s.doc as { layers?: { kind: string }[] };
    for (const l of doc.layers ?? []) {
      if (l.kind !== 'Group' && l.kind !== 'Camera') layerCount += 1;
    }
  }
  return {
    id: project.id,
    name: project.name,
    workspaceId: project.workspace_id,
    status: project.status,
    role,
    layerCount,
    liveVersion: row.live_version ?? null,
    editorCount: Number(row.editor_count),
    viewerCount: Number(row.viewer_count),
    trashedAt: project.trashed_at ? project.trashed_at.toISOString() : null,
    purgeAt: project.purge_at ? project.purge_at.toISOString() : null,
  };
}
