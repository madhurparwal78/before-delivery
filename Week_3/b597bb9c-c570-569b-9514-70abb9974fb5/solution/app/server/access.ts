import type { Person, Role } from "../shared/types";
import { one } from "./db";
import { forbidden, notFound } from "./errors";

export interface Actor extends Person {
  is_owner: boolean;
}

/** The caller's role on a project; the workspace owner owns every project, anyone else needs a membership. */
export async function roleOf(projectId: string, actor: Actor): Promise<Role | null> {
  const project = await one("SELECT 1 FROM projects WHERE id = $1", [projectId]);
  if (!project) return null;
  if (actor.is_owner) return "owner";
  const member = await one<{ role: Role }>("SELECT role FROM members WHERE project_id = $1 AND person_id = $2", [projectId, actor.id]);
  return member?.role ?? null;
}

/** 404 for a non-member, 403 for a role outside `allowed`. */
export async function requireRole(projectId: string, actor: Actor, allowed: readonly Role[]): Promise<Role> {
  const role = await roleOf(projectId, actor);
  if (!role) throw notFound();
  if (!allowed.includes(role)) throw forbidden();
  return role;
}
