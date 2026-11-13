// Project isolation (step 4: unknown or foreign answers 404) and the authority table (step 5: 403).
import type { Role } from "../shared/api.js";
import type { User } from "./auth.js";
import type { Db } from "./db.js";
import { ApiError } from "./errors.js";

export interface Membership { id: string; slug: string; name: string; role: Role }

export type Action =
  | "ingest" | "promote" | "start" | "recheck" | "approve" | "reject" | "break_freeze" | "rollback"
  | "edit_defaults" | "edit_windows" | "schedule_freeze";

const AUTHORITY: Record<Action, readonly Role[]> = {
  ingest: ["service_developer", "platform_engineer"],
  promote: ["service_developer", "platform_engineer"],
  start: ["service_developer", "platform_engineer"],
  recheck: ["service_developer", "platform_engineer"],
  approve: ["release_manager"],
  reject: ["release_manager"],
  break_freeze: ["oncall_sre"],
  rollback: ["oncall_sre"],
  edit_defaults: ["platform_engineer"],
  edit_windows: ["platform_engineer"],
  schedule_freeze: ["platform_engineer"],
};

export function notFound(what: string): ApiError {
  return new ApiError("not_found", `${what} was not found.`);
}

export function authorize(member: Membership, action: Action): void {
  if (!AUTHORITY[action].includes(member.role)) throw new ApiError("forbidden", "Your role in this project cannot do that.");
}

export async function projectFor(db: Db, user: User, slug: string): Promise<Membership> {
  const { rows } = await db.query<Membership>(
    `SELECT p.id, p.slug, p.name, m.role FROM projects p JOIN memberships m ON m.project_id = p.id
      WHERE p.slug = $1 AND m.user_id = $2`, [slug, user.id]);
  if (!rows[0]) throw notFound("The project");
  return rows[0];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** The project of a promotion the caller may see; a promotion elsewhere answers as unknown. */
export async function promotionProject(db: Db, user: User, promotionId: string): Promise<Membership> {
  if (!isUuid(promotionId)) throw notFound("The promotion");
  const { rows } = await db.query<Membership>(
    `SELECT p.id, p.slug, p.name, m.role FROM promotions x JOIN projects p ON p.id = x.project_id
       JOIN memberships m ON m.project_id = p.id AND m.user_id = $2 WHERE x.id = $1`, [promotionId, user.id]);
  if (!rows[0]) throw notFound("The promotion");
  return rows[0];
}
