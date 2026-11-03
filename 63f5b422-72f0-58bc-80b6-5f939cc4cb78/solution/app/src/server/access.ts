import { ApiError, notFound } from "../shared/errors.js";
import type { Role } from "../shared/types.js";
import { one, pool, type Db } from "./db.js";
import type { User } from "./auth.js";

/**
 * The not-found rule, decided here: any id the requester cannot read answers the same 404 everywhere.
 * Membership is read on every request, so a role change applies to the very next one.
 */
export async function roleIn(workspaceId: string, userId: string, db: Db = pool): Promise<Role | null> {
  const row = await one<{ role: Role }>(db, "SELECT role FROM members WHERE workspace_id = $1 AND user_id = $2", [workspaceId, userId]);
  return row?.role ?? null;
}

export async function memberRole(user: User, workspaceId: string, db: Db = pool): Promise<Role> {
  const role = await roleIn(workspaceId, user.id, db);
  if (!role) throw notFound();
  return role;
}

export function requireEditor(role: Role): void {
  if (role === "viewer") throw new ApiError(403, "forbidden_role", "Your role does not allow this.");
}

export function requireOwner(role: Role): void {
  if (role !== "owner") throw new ApiError(403, "forbidden_role", "Only the workspace owner can do this.");
}

/** The workspace a page, image, version, comment or invitation belongs to, or a 404. */
export async function workspaceOf(table: "page" | "image" | "version" | "comment" | "invitation", id: string): Promise<string> {
  const sql = {
    page: "SELECT id AS workspace_id FROM workspaces WHERE doc->'pages' @> jsonb_build_array(jsonb_build_object('id', $1::text))",
    image: "SELECT workspace_id FROM images WHERE id = $1",
    version: "SELECT workspace_id FROM versions WHERE id = $1",
    comment: "SELECT workspace_id FROM comments WHERE id = $1",
    invitation: "SELECT workspace_id FROM invitations WHERE id = $1",
  }[table];
  const row = await one<{ workspace_id: string }>(pool, sql, [id]);
  if (!row) throw notFound();
  return row.workspace_id;
}
