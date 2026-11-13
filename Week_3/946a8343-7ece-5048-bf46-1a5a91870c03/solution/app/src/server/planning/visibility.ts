// Confidential issues: seen by the author, the assignees and members of reporter level or above. The implied read access of
// an internal or public project never counts.
import type { Queryable } from "../db.ts";
import { ROLE_LEVEL, findProject, projectAccess, type Access } from "../access.ts";

export interface Viewer {
  readonly userId: number;
  /** A member (direct or inherited) of reporter level or above sees every confidential issue of the project. */
  readonly full: boolean;
}

export function viewerOf(userId: number, access: Access): Viewer {
  return { userId, full: access.member && access.level >= ROLE_LEVEL.reporter };
}

/** SQL for "the viewer may read issue `alias`"; `userParam` and `fullParam` are placeholders such as `$2`. */
export function visibleSql(alias: string, userParam: string, fullParam: string): string {
  return `(NOT ${alias}.confidential OR ${fullParam}::boolean OR ${alias}.author_id = ${userParam}::int
    OR EXISTS (SELECT 1 FROM issue_assignees va WHERE va.issue_id = ${alias}.id AND va.user_id = ${userParam}::int))`;
}

interface Visible {
  readonly id: number;
  readonly author_id: number;
  readonly confidential: boolean;
}

/** The part of the rule that needs no lookup of assignees: an open item, its author or a full viewer. Epics have no assignees. */
export function readableWithoutAssignment(viewer: Viewer, item: { readonly author_id: number; readonly confidential: boolean }): boolean {
  return !item.confidential || viewer.full || item.author_id === viewer.userId;
}

export async function mayRead(q: Queryable, viewer: Viewer, issue: Visible): Promise<boolean> {
  if (readableWithoutAssignment(viewer, issue)) return true;
  const assigned = await q.maybe("SELECT 1 FROM issue_assignees WHERE issue_id = $1 AND user_id = $2", [issue.id, viewer.userId]);
  return assigned !== undefined;
}

/** `mayRead` for an issue known by id: the live channel asks it before it delivers a message about a confidential issue. */
export async function canSeeIssue(q: Queryable, userId: number, issueId: number): Promise<boolean> {
  const issue = await q.maybe<Visible & { project_id: number }>("SELECT id, project_id, author_id, confidential FROM issues WHERE id = $1", [issueId]);
  if (issue === undefined) return false;
  if (!issue.confidential) return true;
  const project = await findProject(q, issue.project_id);
  if (project === undefined) return false;
  return mayRead(q, viewerOf(userId, await projectAccess(q, userId, project)), issue);
}
