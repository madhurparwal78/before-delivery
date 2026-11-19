import type { JsonObject } from "../shared/json.js";
import { type SessionUser, requireUser } from "./auth.js";
import { db } from "./db.js";
import { fail } from "./errors.js";
import type { Ctx } from "./http.js";

/** Who may do what: the caller's current role in a project is read on every request. */

export type Role = "owner" | "editor" | "reader";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string): boolean => UUID.test(value);

interface ProjectAccess {
  project: { id: string; name: string; ownerId: string };
  role: Role;
}

interface CollectionAccess extends ProjectAccess {
  collection: { id: string; name: string; sequence: number; validator: JsonObject | null };
}

export async function projectAccess(user: SessionUser, projectId: string): Promise<ProjectAccess> {
  if (!isUuid(projectId)) return fail("not_found");
  const result = await db.query<{ id: string; name: string; owner_id: string; role: Role }>(
    "SELECT p.id, p.name, p.owner_id, m.role FROM projects p JOIN members m ON m.project_id = p.id WHERE p.id = $1 AND m.user_id = $2",
    [projectId, user.id],
  );
  const row = result.rows[0];
  return row ? { project: { id: row.id, name: row.name, ownerId: row.owner_id }, role: row.role } : fail("not_found");
}

export async function collectionAccess(user: SessionUser, projectId: string, collectionId: string): Promise<CollectionAccess> {
  const access = await projectAccess(user, projectId);
  if (!isUuid(collectionId)) return fail("not_found");
  const result = await db.query<{ id: string; name: string; sequence: string; validator: string | null }>(
    "SELECT id, name, sequence, validator FROM collections WHERE id = $1 AND project_id = $2",
    [collectionId, projectId],
  );
  const row = result.rows[0];
  if (!row) return fail("not_found");
  const validator = row.validator === null ? null : (JSON.parse(row.validator) as JsonObject);
  return { ...access, collection: { id: row.id, name: row.name, sequence: Number(row.sequence), validator } };
}

export function requireWriter(role: Role): void {
  if (role === "reader") fail("read_only");
}

export function requireOwner(role: Role): void {
  if (role !== "owner") fail("read_only");
}

/** The signed-in caller with their access to the collection named in the route. */
export async function openCollection(ctx: Ctx): Promise<CollectionAccess & { user: SessionUser }> {
  const user = await requireUser(ctx);
  return { user, ...(await collectionAccess(user, ctx.params["pid"] as string, ctx.params["cid"] as string)) };
}
