import { denial, type Permission, type Role } from "../shared/access.js";
import { FIELD, fail } from "./errors.js";
import type { ProjectRow } from "./project-store.js";

export function deny(role: Role, permission: Permission): void {
  const reason = denial(role, permission);
  if (reason) throw fail.denied(reason);
}

export function isWholeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/** Reads a base revision from a body field or query value; missing, malformed or above the current revision is a 422. */
export function baseRevisionOf(value: unknown, project: ProjectRow): number {
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!isWholeNumber(number) || number < 1 || number > project.revision) throw fail.invalid({ baseRevision: FIELD.baseRevision });
  return number;
}

/** Writes that rewrite the text need the latest revision and a text without errors. */
export function requireLatestValid(project: ProjectRow, baseRevision: number): void {
  if (baseRevision !== project.revision) throw fail.staleRevision(project.revision, project.text);
  if (project.error_count > 0) throw fail.schemaHasErrors();
}
