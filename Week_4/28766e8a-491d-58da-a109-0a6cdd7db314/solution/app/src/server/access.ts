// Steps 2 and 3 of the error precedence for everything under a diagram: the not-found rule
// (missing, or not a member) and the role check (brief: Error precedence, Roles).
import { ApiError } from "../shared/errors";
import type { Role } from "../shared/types";
import type { SessionUser } from "./auth";
import { pool, type Queryable } from "./db";

export interface Access {
  user: SessionUser;
  diagramId: string;
  title: string;
  ownerName: string;
  role: Role;
}

export async function diagramAccess(user: SessionUser, diagramId: string, db: Queryable = pool): Promise<Access> {
  const { rows } = await db.query<{ title: string; role: Role; owner_name: string }>(
    `SELECT d.title, m.role, o.name AS owner_name
       FROM diagrams d JOIN members m ON m.diagram_id = d.id AND m.user_id = $2 JOIN users o ON o.id = d.owner_id
      WHERE d.id = $1`, [diagramId, user.id]);
  const row = rows[0];
  if (!row) throw new ApiError("not_found");
  return { user, diagramId, title: row.title, ownerName: row.owner_name, role: row.role };
}

/** 403 forbidden_role unless the role passes the check. */
export function requireRole(access: Access, allowed: (role: Role) => boolean, message?: string): void {
  if (!allowed(access.role)) throw new ApiError("forbidden_role", message);
}
