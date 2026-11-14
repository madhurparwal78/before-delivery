import { randomUUID } from "node:crypto";
import type { Role, ShareAccess, StoredShareStatus } from "../shared/access.js";
import { shareStatus } from "../shared/access.js";
import { layoutsEqual, syncLayout, type Layout } from "../shared/layout.js";
import { parseMortise, type ParseResult } from "../shared/mortise.js";
import { isUuid, type User } from "./auth.js";
import { parseLimits } from "./config.js";
import { query, type Queryable } from "./db.js";
import { fail } from "./errors.js";

export interface ProjectRow {
  id: string;
  owner_id: string;
  owner_name: string;
  name: string;
  text: string;
  last_valid_text: string;
  layout: Layout;
  revision: number;
  error_count: number;
  created_at: Date;
  updated_at: Date;
}

const PROJECT_SELECT = `SELECT p.id, p.owner_id, u.display_name AS owner_name, p.name, p.text, p.last_valid_text, p.layout,
  p.revision, p.error_count, p.created_at, p.updated_at FROM projects p JOIN users u ON u.id = p.owner_id`;

export async function loadProject(db: Queryable, id: string, lock = false): Promise<ProjectRow | null> {
  if (!isUuid(id)) return null;
  const rows = await db.query<ProjectRow>(`${PROJECT_SELECT} WHERE p.id = $1${lock ? " FOR UPDATE OF p" : ""}`, [id]);
  return rows.rows[0] ?? null;
}

export async function memberRole(db: Queryable, projectId: string, userId: string): Promise<"editor" | "viewer" | null> {
  const rows = await db.query<{ role: string }>("SELECT role FROM members WHERE project_id = $1 AND user_id = $2", [projectId, userId]);
  const role = rows.rows[0]?.role;
  return role === "editor" || role === "viewer" ? role : null;
}

export async function roleFor(db: Queryable, project: ProjectRow, user: User): Promise<Role | null> {
  if (project.owner_id === user.id) return "owner";
  return memberRole(db, project.id, user.id);
}

export interface ProjectAccess {
  project: ProjectRow;
  role: Role;
}

/** Resolves a project the caller can open; anything else is the generic not-found. */
export async function projectAccess(db: Queryable, projectId: string, user: User, lock = false): Promise<ProjectAccess> {
  const project = await loadProject(db, projectId, lock);
  if (!project) throw fail.notFound();
  const role = await roleFor(db, project, user);
  if (!role) throw fail.notFound();
  return { project, role };
}

export interface ShareRow {
  id: string;
  project_id: string;
  token: string;
  access: ShareAccess;
  status: StoredShareStatus;
  email: string | null;
  invitation_status: "queued" | "sent" | "failed" | null;
  invitation_sent_at: Date | null;
  expires_at: Date;
  created_at: Date;
  replaced_by: string | null;
}

/** An active share by token, judged on the server clock, or null. */
export async function activeShare(db: Queryable, token: string): Promise<ShareRow | null> {
  const rows = await db.query<ShareRow>("SELECT * FROM shares WHERE token = $1", [token]);
  const share = rows.rows[0];
  if (!share || shareStatus(share.status, share.expires_at, new Date()) !== "active") return null;
  return share;
}

export function parseText(text: string): ParseResult {
  return parseMortise(text, parseLimits);
}

export function projectJson(project: ProjectRow, role: Role, extra: Record<string, unknown> = {}) {
  return {
    id: project.id,
    name: project.name,
    role,
    revision: project.revision,
    text: project.text,
    layout: project.layout,
    errorCount: project.error_count,
    owner: { id: project.owner_id, displayName: project.owner_name },
    updatedAt: project.updated_at.toISOString(),
    ...extra,
  };
}

export interface Committed {
  revision: number;
  text: string;
  layout: Layout;
  layoutChanged: boolean;
}

/**
 * Records a new revision of the text in the edit log. A valid parse brings the layout in step
 * (or takes the given layout); text with errors keeps the layout of the last valid parse.
 */
export async function commitText(db: Queryable, project: ProjectRow, text: string, author: User, layout?: Layout): Promise<Committed> {
  const parse = parseText(text);
  const valid = parse.errors.length === 0;
  const base = layout ?? project.layout;
  const nextLayout = valid ? syncLayout(base, parse.model) : base;
  const revision = project.revision + 1;
  const now = new Date();
  await db.query("INSERT INTO edits (project_id, revision, text, author_id, created_at) VALUES ($1, $2, $3, $4, $5)", [
    project.id,
    revision,
    text,
    author.id,
    now,
  ]);
  await db.query(
    `UPDATE projects SET text = $2, last_valid_text = CASE WHEN $3 THEN $2 ELSE last_valid_text END, layout = $4,
       revision = $5, error_count = $6, updated_at = $7 WHERE id = $1`,
    [project.id, text, valid, JSON.stringify(nextLayout), revision, parse.errors.length, now],
  );
  project.text = text;
  if (valid) project.last_valid_text = text;
  const layoutChanged = !layoutsEqual(nextLayout, project.layout);
  project.layout = nextLayout;
  project.revision = revision;
  project.error_count = parse.errors.length;
  project.updated_at = now;
  return { revision, text, layout: nextLayout, layoutChanged };
}

export async function saveLayout(db: Queryable, project: ProjectRow, layout: Layout): Promise<void> {
  const now = new Date();
  await db.query("UPDATE projects SET layout = $2, updated_at = $3 WHERE id = $1", [project.id, JSON.stringify(layout), now]);
  project.layout = layout;
  project.updated_at = now;
}

/** Creates a project at revision 1 with its first edit-log entry. */
export async function insertProject(db: Queryable, owner: User, name: string, text: string, layout: Layout): Promise<string> {
  const id = randomUUID();
  const parse = parseText(text);
  const valid = parse.errors.length === 0;
  const synced = valid ? syncLayout(layout, parse.model) : layout;
  const now = new Date();
  await db.query(
    `INSERT INTO projects (id, owner_id, name, text, last_valid_text, layout, revision, error_count, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $8)`,
    [id, owner.id, name, text, valid ? text : "", JSON.stringify(synced), parse.errors.length, now],
  );
  await db.query("INSERT INTO edits (project_id, revision, text, author_id, created_at) VALUES ($1, 1, $2, $3, $4)", [
    id,
    text,
    owner.id,
    now,
  ]);
  return id;
}

export async function countProjects(): Promise<number> {
  const rows = await query<{ n: string }>("SELECT count(*) AS n FROM projects");
  return Number(rows[0]!.n);
}
