// Who may do what, and which fields each audience may see about a person.
import type { Person, Role, SharedPerson, User } from "../shared/api.ts";
import { one, type Db } from "./db.ts";
import { fail } from "./http.ts";

type Action = "read" | "write" | "review" | "decide" | "export" | "own";

const GRANTS: Record<Role, readonly Action[]> = {
  owner: ["read", "write", "review", "decide", "export", "own"],
  editor: ["read", "write", "review", "decide", "export"],
  reviewer: ["read", "review"],
  viewer: ["read"],
};

function may(role: Role, action: Action): boolean {
  return GRANTS[role].includes(action);
}

interface ProjectRow {
  id: string;
  workspace_id: string;
  title: string;
  template: string;
  revision: number;
}

interface Access {
  project: ProjectRow;
  role: Role;
}

/** The caller's current membership, read fresh; a non-member gets the same answer as a missing project. */
export async function membership(db: Db, userId: string, projectId: string): Promise<Access> {
  const row = await one<ProjectRow & { role: Role }>(
    db,
    `SELECT p.id, p.workspace_id, p.title, p.template, p.revision, m.role
       FROM projects p JOIN memberships m ON m.project_id = p.id AND m.user_id = $2
      WHERE p.id = $1`,
    [projectId, userId],
  );
  if (!row) throw fail.notFound();
  const { role, ...project } = row;
  return { project, role };
}

export function requireRole(access: Access, action: Action): void {
  if (!may(access.role, action)) throw fail.forbidden();
}

export interface PersonRow {
  id: string;
  email: string;
  display_name: string;
  handle: string;
}

/** The person themself, and owners in their own project's member list. */
export function userShape(row: PersonRow): User {
  return { id: row.id, email: row.email, displayName: row.display_name, handle: row.handle };
}

/** Every other reference to a person for members. */
export function personShape(row: Pick<PersonRow, "id" | "display_name" | "handle">): Person {
  return { id: row.id, displayName: row.display_name, handle: row.handle };
}

/** Anyone holding a share link sees a display name only. */
export function sharedPerson(person: Person): SharedPerson {
  return { displayName: person.displayName };
}
