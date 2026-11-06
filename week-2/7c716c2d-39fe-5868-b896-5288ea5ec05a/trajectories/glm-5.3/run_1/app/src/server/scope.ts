import type { Client, Pool } from "./db.ts";
import type { CalendarState } from "./calendar.ts";
import { calendarEffectiveOn, isCounted } from "./calendar.ts";
import { partsFor } from "./tz.ts";
import { nowMs } from "./clock.ts";
import { ApiError } from "./errors.ts";

export interface PersonRow {
  id: string;
  workspace_id: string;
  name: string;
  email: string;
  handle: string;
  role: "owner" | "member" | "guest";
  removed: boolean;
}

export interface Ctx {
  person: PersonRow;
  workspace: { id: string; name: string; slug: string; seat_limit: number };
  role: "owner" | "member" | "guest";
  client: Client;
  now: number;
  states: CalendarState[];
  zone: string;
  today: string;
  isWorkingDay: boolean;
}

export async function loadPerson(client: Client, personId: string): Promise<PersonRow | null> {
  const res = await client.query<PersonRow & { role: string }>(
    "SELECT id, workspace_id, name, email, handle, role, removed FROM people WHERE id = $1",
    [personId]
  );
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return { ...row, role: row.role as PersonRow["role"] };
}

export async function requireCtx(client: Client, personId: string): Promise<Ctx> {
  const person = await loadPerson(client, personId);
  if (!person || person.removed) throw new ApiError("unauthenticated", "Sign in again.");
  const ws = await client.query<{ id: string; name: string; slug: string; seat_limit: number }>(
    "SELECT id, name, slug, seat_limit FROM workspaces WHERE id = $1",
    [person.workspace_id]
  );
  if (ws.rows.length === 0) throw new ApiError("unauthenticated", "Sign in again.");
  const now = nowMs();
  const states = await loadCalendarStates(client, person.workspace_id);
  const seed = states[0];
  const today = partsFor(seed.time_zone, now).date;
  const cal = calendarEffectiveOn(states, today);
  const isWorkingDay = isCounted(cal, today);
  return {
    person,
    workspace: ws.rows[0],
    role: person.role,
    client,
    now,
    states,
    zone: cal.time_zone,
    today,
    isWorkingDay,
  };
}

/** The calendar states of a workspace, oldest first. State 0 is the seed. */
export async function loadCalendarStates(client: Client | Pool, workspaceId: string): Promise<CalendarState[]> {
  const res = await client.query<{
    time_zone: string;
    working_weekdays: number[];
    holidays: unknown;
    cycle_anchor: string;
    effective_from: string;
  }>(
    "SELECT time_zone, working_weekdays, holidays, cycle_anchor, effective_from FROM calendar_states WHERE workspace_id = $1 ORDER BY seq",
    [workspaceId]
  );
  return res.rows.map((r) => ({
    time_zone: r.time_zone,
    working_weekdays: r.working_weekdays,
    holidays: r.holidays as { date: string; name: string }[],
    cycle_anchor: r.cycle_anchor,
    effective_from: r.effective_from,
  }));
}

// ---------------------------------------------------------------------------
// Visibility: the single decision for what one person can see.
// ---------------------------------------------------------------------------

export interface VisibleScope {
  projectIds: Set<string>;
  channelIds: Set<string>;
  /** People this person can see (for pickers and member lists). */
  personIds: Set<string>;
}

export async function visibleScope(ctx: Ctx): Promise<VisibleScope> {
  const { client, person, role } = ctx;
  if (role !== "guest") {
    const projects = await client.query<{ id: string }>(
      "SELECT id FROM projects WHERE workspace_id = $1",
      [person.workspace_id]
    );
    const channels = await client.query<{ id: string }>(
      "SELECT c.id FROM channels c JOIN channel_members m ON m.channel_id = c.id WHERE m.person_id = $1",
      [person.id]
    );
    const people = await client.query<{ id: string }>(
      "SELECT id FROM people WHERE workspace_id = $1 AND NOT removed",
      [person.workspace_id]
    );
    return {
      projectIds: new Set(projects.rows.map((r) => r.id)),
      channelIds: new Set(channels.rows.map((r) => r.id)),
      personIds: new Set(people.rows.map((r) => r.id)),
    };
  }
  const projects = await client.query<{ id: string }>(
    "SELECT project_id AS id FROM project_guests WHERE person_id = $1",
    [person.id]
  );
  const channels = await client.query<{ id: string }>(
    "SELECT c.id FROM channels c JOIN channel_members m ON m.channel_id = c.id WHERE m.person_id = $1",
    [person.id]
  );
  const people = await client.query<{ id: string }>(
    `SELECT DISTINCT p.id FROM people p
     WHERE p.workspace_id = $1 AND NOT p.removed AND (
       p.role IN ('owner','member')
       OR p.id IN (SELECT person_id FROM project_guests WHERE project_id = ANY($2::uuid[]))
       OR p.id IN (SELECT m.person_id FROM channel_members m JOIN channels c ON c.id = m.channel_id
                    WHERE c.workspace_id = $1 AND m.channel_id = ANY($3::uuid[]))
     )`,
    [person.workspace_id, projects.rows.map((r) => r.id), channels.rows.map((r) => r.id)]
  );
  return {
    projectIds: new Set(projects.rows.map((r) => r.id)),
    channelIds: new Set(channels.rows.map((r) => r.id)),
    personIds: new Set(people.rows.map((r) => r.id)),
  };
}

/** Can this person see this project now? */
export async function canSeeProject(ctx: Ctx, projectId: string): Promise<boolean> {
  const scope = await visibleScope(ctx);
  return scope.projectIds.has(projectId);
}

/** Can this person see this channel's messages? */
export async function canSeeChannel(ctx: Ctx, channelId: string): Promise<boolean> {
  const scope = await visibleScope(ctx);
  return scope.channelIds.has(channelId);
}
