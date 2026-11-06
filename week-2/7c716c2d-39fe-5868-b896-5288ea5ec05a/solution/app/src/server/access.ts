// Per-viewer visibility: the one place that decides which projects, channels, people and stream
// events a person may see.
import type { Db } from "./db.js";

export type Role = "owner" | "member" | "guest";

export interface Viewer {
  id: string;
  name: string;
  email: string;
  handle: string;
  role: Role;
  workspaceId: string;
  sessionId: string;
}

export interface PersonRow {
  id: string;
  name: string;
  email: string;
  handle: string;
  role: Role | null;
  workspace_id: string | null;
  session_id?: string;
}

/** The person as a workspace viewer, or null when they belong to no workspace. */
export function viewerOf(person: PersonRow): Viewer | null {
  if (!person.workspace_id || !person.role) return null;
  return { id: person.id, name: person.name, email: person.email, handle: person.handle, role: person.role, workspaceId: person.workspace_id, sessionId: person.session_id ?? "" };
}

export function personJson(row: Pick<PersonRow, "id" | "name" | "email" | "handle" | "role">): Record<string, unknown> {
  return { id: row.id, name: row.name, email: row.email, handle: row.handle, role: row.role };
}

/** Projects the viewer currently shares: all of them for the owner and members, granted ones for guests. */
export async function visibleProjectIds(db: Db, viewer: Viewer): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT p.id FROM projects p
     WHERE p.workspace_id = $1
       AND ($2 <> 'guest' OR EXISTS (SELECT 1 FROM project_guests g WHERE g.project_id = p.id AND g.person_id = $3))
     ORDER BY p.key`,
    [viewer.workspaceId, viewer.role, viewer.id],
  );
  return rows.map((r) => r.id);
}

export async function canSeeProject(db: Db, viewer: Viewer, projectId: string): Promise<boolean> {
  return (await visibleProjectIds(db, viewer)).includes(projectId);
}

export async function isChannelMember(db: Db, personId: string, channelId: string): Promise<boolean> {
  const { rows } = await db.query("SELECT 1 FROM channel_members WHERE person_id = $1 AND channel_id = $2", [personId, channelId]);
  return rows.length > 0;
}

/** People the viewer may see: everyone for the owner and members; for a guest the owner, the
 * members and guests who share one of their projects or channels. Active people only. */
export async function visiblePeople(db: Db, viewer: Viewer): Promise<PersonRow[]> {
  const { rows } = await db.query<PersonRow>(
    `SELECT id, name, email, handle, role, workspace_id FROM people p
     WHERE p.workspace_id = $1
       AND ($2 <> 'guest' OR p.role <> 'guest' OR p.id = $3
            OR EXISTS (SELECT 1 FROM project_guests a JOIN project_guests b ON a.project_id = b.project_id WHERE a.person_id = $3 AND b.person_id = p.id)
            OR EXISTS (SELECT 1 FROM channel_members a JOIN channel_members b ON a.channel_id = b.channel_id WHERE a.person_id = $3 AND b.person_id = p.id))
     ORDER BY lower(p.name), p.id`,
    [viewer.workspaceId, viewer.role, viewer.id],
  );
  return rows;
}

/** People who can see a project (the assignee rule): active owner and members, plus its guests. */
export async function projectAudience(db: Db, workspaceId: string, projectId: string): Promise<PersonRow[]> {
  const { rows } = await db.query<PersonRow>(
    `SELECT id, name, email, handle, role, workspace_id FROM people p
     WHERE p.workspace_id = $1
       AND (p.role <> 'guest' OR EXISTS (SELECT 1 FROM project_guests g WHERE g.project_id = $2 AND g.person_id = p.id))
     ORDER BY lower(p.name), p.id`,
    [workspaceId, projectId],
  );
  return rows;
}

export interface StreamEvent {
  id: number;
  name: string;
  channel_id: string | null;
  project_id: string | null;
  recipients: string[] | null;
  sessions: string[] | null;
  data: Record<string, unknown>;
}

export interface StreamAccess {
  active: boolean;
  channels: Set<string>;
  projects: Set<string>;
}

/** What one person's stream may carry right now. */
export async function streamAccess(db: Db, viewer: Viewer): Promise<StreamAccess> {
  const { rows } = await db.query<{ workspace_id: string | null; channels: string[] | null }>(
    "SELECT p.workspace_id, (SELECT array_agg(channel_id) FROM channel_members m WHERE m.person_id = p.id) AS channels FROM people p WHERE p.id = $1",
    [viewer.id],
  );
  const row = rows[0];
  return { active: row?.workspace_id === viewer.workspaceId, channels: new Set(row?.channels ?? []), projects: new Set(await visibleProjectIds(db, viewer)) };
}

/** The per-event check, made when the event is written to a person's stream. */
export function mayReceive(access: StreamAccess, personId: string, sessionId: string, event: StreamEvent): boolean {
  const revokedWorkspace = event.name === "revoked" && event.data.scope === "workspace";
  if (!access.active && !revokedWorkspace) return false;
  if (event.recipients && !event.recipients.includes(personId)) return false;
  if (event.sessions && !event.sessions.includes(sessionId)) return false;
  if (event.channel_id && !access.channels.has(event.channel_id)) return false;
  if (event.project_id && !access.projects.has(event.project_id)) return false;
  return true;
}

/** The event body this person receives. */
export function projectBody(personId: string, event: StreamEvent): Record<string, unknown> {
  if (event.name !== "message" && event.name !== "thread_reply") return event.data;
  return { ...event.data, client_key: clientKeyFor(personId, event.data.author_id, event.data.client_key) };
}

/** `client_key` belongs to the author alone, in every response and event. */
export function clientKeyFor<T>(readerId: string, authorId: unknown, key: T): T | null {
  return authorId === readerId ? key : null;
}
