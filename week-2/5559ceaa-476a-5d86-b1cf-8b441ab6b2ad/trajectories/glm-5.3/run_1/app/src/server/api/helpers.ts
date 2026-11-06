import { ApiError } from "../errors.js";
import type { Pool, PoolClient } from "pg";
import type { User } from "../../shared/types.js";
import { normalizePath } from "../paths.js";

export interface ProjectRow {
  id: string;
  title: string;
  kind: "one_to_one" | "group";
  owner_id: string;
}

export interface FileRow {
  id: string;
  project_id: string;
  path: string;
  revision: number;
  sha256: string;
  size: number;
  content: string;
}

export async function getProject(pool: Pool, projectId: string): Promise<ProjectRow> {
  const r = await pool.query(`SELECT id, title, kind, owner_id FROM projects WHERE id = $1`, [projectId]);
  if (r.rowCount === 0) throw new ApiError("not_found", "No such project.");
  return r.rows[0] as ProjectRow;
}

export async function membership(
  pool: Pool,
  projectId: string,
  userId: string,
): Promise<"mentor" | "student" | null> {
  const r = await pool.query(
    `SELECT role FROM memberships WHERE project_id = $1 AND user_id = $2`,
    [projectId, userId],
  );
  if (r.rowCount === 0) return null;
  return (r.rows[0] as { role: string }).role as "mentor" | "student";
}

export async function requireProjectView(
  pool: Pool,
  projectId: string,
  user: User,
): Promise<ProjectRow> {
  const project = await getProject(pool, projectId);
  const role = await membership(pool, projectId, user.id);
  if (role === null) throw new ApiError("not_found", "No such project.");
  return project;
}

export async function requireMentor(
  pool: Pool,
  projectId: string,
  user: User,
): Promise<ProjectRow> {
  const project = await requireProjectView(pool, projectId, user);
  const role = await membership(pool, projectId, user.id);
  if (role !== "mentor") throw new ApiError("forbidden", "Only the mentor may do this.");
  return project;
}

export async function audit(
  client: PoolClient,
  projectId: string,
  type: string,
  actor: User,
  subject: string,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events (id, project_id, type, actor_id, actor_name, subject, at)
     VALUES ($1,$2,$3,$4,$5,$6,now())`,
    [crypto.randomUUID(), projectId, type, actor.id, actor.name, subject],
  );
}

export async function auditErased(
  client: PoolClient,
  projectId: string,
  type: string,
  subject: string,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events (id, project_id, type, actor_id, actor_name, subject, at)
     VALUES ($1,$2,$3,NULL,'Erased learner',$4,now())`,
    [crypto.randomUUID(), projectId, type, subject],
  );
}

export async function fileByPath(client: PoolClient, projectId: string, path: string): Promise<FileRow | null> {
  const r = await client.query(
    `SELECT id, project_id, path, revision, sha256, size, content FROM files
     WHERE project_id = $1 AND path = $2`,
    [projectId, normalizePath(path)],
  );
  if (r.rowCount === 0) return null;
  return r.rows[0] as FileRow;
}

export async function listFiles(client: PoolClient, projectId: string): Promise<FileRow[]> {
  const r = await client.query(
    `SELECT id, project_id, path, revision, sha256, size, content FROM files
     WHERE project_id = $1 ORDER BY path`,
    [projectId],
  );
  return r.rows as FileRow[];
}

export async function sessionWithLock(
  client: PoolClient,
  sessionId: string,
): Promise<SessionRow> {
  const r = await client.query(
    `SELECT id, project_id, title, state, scheduled_for, driver_id, version
     FROM sessions WHERE id = $1 FOR UPDATE`,
    [sessionId],
  );
  if (r.rowCount === 0) throw new ApiError("not_found", "No such session.");
  return r.rows[0] as SessionRow;
}

export interface SessionRow {
  id: string;
  project_id: string;
  title: string;
  state: "scheduled" | "live" | "paused" | "ended";
  scheduled_for: Date;
  driver_id: string | null;
  version: number;
}

export function sessionOut(s: SessionRow): Record<string, unknown> {
  return {
    id: s.id,
    project_id: s.project_id,
    title: s.title,
    state: s.state,
    scheduled_for: s.scheduled_for.toISOString(),
    driver_id: s.driver_id,
    version: s.version,
  };
}
