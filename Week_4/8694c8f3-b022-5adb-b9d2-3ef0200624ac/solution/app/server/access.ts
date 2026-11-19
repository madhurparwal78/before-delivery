import type { Database, Queryable } from "./db.ts";
import { rows } from "./db.ts";
import { forbidden, notFound } from "./errors.ts";
import type { RequestContext } from "./http.ts";
import { requireUser } from "./http.ts";
import { UUID_PATTERN } from "../shared/ops.ts";
import type { Role } from "../shared/types.ts";

export interface Membership {
  setId: string;
  role: Role;
  userId: string;
}

export async function roleIn(q: Queryable, setId: string, userId: string): Promise<Role | null> {
  const [member] = await rows<{ role: Role }>(q, "SELECT role FROM members WHERE set_id = $1 AND user_id = $2", [setId, userId]);
  return member?.role ?? null;
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export async function requireMember(db: Database, ctx: RequestContext, param = "id"): Promise<Membership> {
  const user = requireUser(ctx);
  const setId = ctx.params[param] ?? "";
  const role = isUuid(setId) ? await roleIn(db, setId, user.id) : null;
  if (!role) throw notFound();
  return { setId, role, userId: user.id };
}

export function requireRole(membership: Membership, allowed: readonly Role[]): void {
  if (!allowed.includes(membership.role)) throw forbidden();
}

export const CAN_EDIT: readonly Role[] = ["owner", "editor"];
export const OWNER_ONLY: readonly Role[] = ["owner"];
