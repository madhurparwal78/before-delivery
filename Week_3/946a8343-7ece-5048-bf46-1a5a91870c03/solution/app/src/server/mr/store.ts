// Rows and small queries shared by the merge request files.
import type { Queryable, Say, Tx } from "../db.ts";
import { projectScope, requireAction, type Access, type Action, type ProjectRow, type UserRow } from "../access.ts";
import { notFound } from "../errors.ts";
import { now } from "../clock.ts";
import type { CheckResult } from "./checks.ts";

type MrState = "opened" | "closed" | "merged";

export interface MrRow {
  readonly id: number;
  readonly project_id: number;
  readonly iid: number;
  readonly author_id: number;
  readonly title: string;
  readonly description: string;
  readonly source: string;
  readonly target: string;
  readonly state: MrState;
  readonly delete_source_branch: boolean;
  readonly assignees: string[];
  readonly reviewers: string[];
  readonly auto_merge_by: number | null;
  readonly merged_by: string | null;
  readonly merge_commit: string | null;
  readonly checks: CheckResult[];
  readonly rules_snapshot: string;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface VersionRow {
  readonly number: number;
  readonly base: string | null;
  readonly head: string;
  readonly start: string | null;
  readonly created_at: number;
}

export interface ThreadRow {
  readonly id: number;
  readonly mr_id: number;
  readonly author_id: number;
  readonly path: string | null;
  readonly old_line: number | null;
  readonly new_line: number | null;
  readonly end_line: number | null;
  readonly version: number | null;
  readonly current_line: number | null;
  readonly current_end: number | null;
  readonly outdated: boolean;
  readonly resolved: boolean;
  readonly pending: boolean;
  readonly created_at: number;
}

export const DRAFT_PREFIX = "Draft: ";

export function isDraft(title: string): boolean {
  return title.startsWith(DRAFT_PREFIX);
}

function mrPage(iid: number): string {
  return `mr:${iid}`;
}

/** An announcement for every page showing this request. */
export function sayOnRequest(iid: number, text: string): Say {
  return { text, pages: [mrPage(iid)] };
}

async function findRequest(q: Queryable, projectId: number, iid: number): Promise<MrRow | undefined> {
  return q.maybe<MrRow>("SELECT * FROM merge_requests WHERE project_id = $1 AND iid = $2", [projectId, iid]);
}

export async function requireRequest(q: Queryable, projectId: number, iid: number): Promise<MrRow> {
  const row = await findRequest(q, projectId, iid);
  if (row === undefined) throw notFound();
  return row;
}

export interface Opened {
  readonly project: ProjectRow;
  readonly access: Access;
  readonly mr: MrRow;
}

/** For reads: the project (404 when unreadable), the request (404), then the minimum role (403). */
export async function openRequest(q: Queryable, user: UserRow, projectId: number, iid: number, action: Action): Promise<Opened> {
  const { project, access } = await projectScope(q, user, projectId);
  const mr = await requireRequest(q, project.id, iid);
  requireAction(access, action);
  return { project, access, mr };
}

/** For writes: as `openRequest`, then the project lock, then the request again so every state check sees what the winner left. */
export async function lockedRequest(tx: Tx, user: UserRow, projectId: number, iid: number, action: Action): Promise<Opened> {
  const opened = await openRequest(tx, user, projectId, iid, action);
  await tx.lockProject(opened.project.id);
  return { ...opened, mr: await requireRequest(tx, opened.project.id, iid) };
}

export async function requestById(q: Queryable, id: number): Promise<MrRow | undefined> {
  return q.maybe<MrRow>("SELECT * FROM merge_requests WHERE id = $1", [id]);
}

export async function versionsOf(q: Queryable, mrId: number): Promise<VersionRow[]> {
  return q.q<VersionRow>("SELECT number, base, head, start, created_at FROM mr_versions WHERE mr_id = $1 ORDER BY number", [mrId]);
}

export async function latestVersion(q: Queryable, mrId: number): Promise<VersionRow | undefined> {
  return q.maybe<VersionRow>(
    "SELECT number, base, head, start, created_at FROM mr_versions WHERE mr_id = $1 ORDER BY number DESC LIMIT 1",
    [mrId],
  );
}

export async function usernameOf(q: Queryable, userId: number): Promise<string> {
  return (await q.one<{ username: string }>("SELECT username FROM users WHERE id = $1", [userId])).username;
}

/** Writes a system note; the caller announces it on the message of the change it belongs to. */
export async function insertSystemNote(tx: Tx, mrId: number, author: string, body: string): Promise<void> {
  await tx.q(
    "INSERT INTO mr_notes (mr_id, thread_id, author, user_id, body, system, pending, created_at) VALUES ($1, NULL, $2, NULL, $3, true, false, $4)",
    [mrId, author, body, now()],
  );
}
export const ALREADY_MERGED = "This merge request is already merged.";

export async function unresolvedThreadCount(q: Queryable, mrId: number): Promise<number> {
  const row = await q.one<{ n: number }>("SELECT count(*) AS n FROM mr_threads WHERE mr_id = $1 AND NOT pending AND NOT resolved", [mrId]);
  return row.n;
}

export function unresolvedLeft(count: number): string {
  if (count === 0) return "Thread resolved. No unresolved threads left.";
  return `Thread resolved. ${count} unresolved ${count === 1 ? "thread" : "threads"} left.`;
}
