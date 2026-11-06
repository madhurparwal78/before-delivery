// The role table (Business rules · Role table). Every gate in the server asks here.
import { forbidden } from "../errors.js";
import { ROLES, type Role } from "../../shared/roles.js";

export { type Role, canEdit } from "../../shared/roles.js";

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

type Action =
  | "read"
  | "createWorkbook"
  | "manageSeason"
  | "archive"
  | "versions"
  | "restore"
  | "exports"
  | "shareLinks"
  | "manageStation";

const TABLE: Record<Action, readonly Role[]> = {
  read: ROLES,
  createWorkbook: ["lead", "data_manager"],
  manageSeason: ["lead", "data_manager"],
  archive: ["data_manager"],
  versions: ["lead", "data_manager"],
  restore: ["data_manager"],
  exports: ["lead", "data_manager"],
  shareLinks: ["data_manager"],
  manageStation: ["data_manager"],
};

export function allows(role: Role, action: Action): boolean {
  return TABLE[action].includes(role);
}


/** Endpoint gate: a role that may not use the action at all answers 403 forbidden. */
export function requireRole(role: Role, action: Action): void {
  if (!allows(role, action)) throw forbidden();
}
