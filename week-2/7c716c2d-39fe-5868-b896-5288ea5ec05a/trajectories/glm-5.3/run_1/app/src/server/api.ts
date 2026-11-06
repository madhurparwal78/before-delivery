import type { IncomingMessage, ServerResponse } from "node:http";
import { withClient, inTransaction, query, isDatabaseOk } from "./db.ts";
import type { Client } from "./db.ts";
import type { Config } from "./env.ts";
import { nowMs } from "./clock.ts";
import { ApiError, errorCodes } from "./errors.ts";
import { uuid, sha256, newSessionToken, verifySecret } from "./ids.ts";
import type { AuthedRequest } from "./http.ts";
import { writeJson, writeError, parseCookies } from "./http.ts";
import * as store from "./store.ts";
import * as billing from "./billing.ts";
import * as jobs from "./jobs.ts";
import * as mail from "./mail.ts";
import * as storage from "./storage.ts";
import { handleEventsEndpoint } from "./dispatch.ts";
import {
  calendarEffectiveOn,
  currentCycleNumber,
  cycleSpan,
  dayInfo,
  isCounted,
  nextCountedOnOrAfter,
  validateCalendarSpec,
  type CalendarState,
} from "./calendar.ts";
import { addDays, codePointLength, isBlank, isUnstorableText, parseDate } from "./text.ts";
import { instantInZone, localMidnightInstant, partsFor } from "./tz.ts";
import { Ctx, PersonRow, loadCalendarStates, loadPerson, visibleScope } from "./scope.ts";
import {
  attachmentsFor,
  docJsonFor,
  inviteJson,
  inviteStatusOf,
  knockJson,
  knockStatusOf,
  messageById,
  messageJsonFor,
  roomJson,
  optionalText,
} from "./proj.ts";
import { parseMultipart } from "./multipart.ts";
import {
  issueByKeyVisible,
  issuesListOrder,
  issueJson,
  STATUS_EDGES,
  STATUS_LABELS,
  type IssueRow,
  type CycleJson,
} from "./domain.ts";

export interface RouteContext {
  cfg: Config;
  person: PersonRow | null;
  params: Record<string, string>;
  url: URL;
  req: IncomingMessage;
  res: ServerResponse;
  body: unknown;
  client: Client | null;
  events: number[];
  headers: Record<string, string | string[] | undefined>;
  cookies: () => Record<string, string>;
  nowMs: () => number;
}

type Handler = (rc: RouteContext) => Promise<unknown | void>;

interface Route {
  method: string;
  pattern: string;
  handler: Handler;
  auth: "public" | "any" | "owner";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ctxOf(rc: RouteContext): Promise<Ctx> {
  if (!rc.client || !rc.person) throw new ApiError("unauthenticated", "Sign in again.");
  const person = await loadPerson(rc.client, rc.person.id);
  if (!person || person.removed) throw new ApiError("unauthenticated", "Sign in again.");
  const ws = await rc.client.query<{ id: string; name: string; slug: string; seat_limit: number }>(
    "SELECT id, name, slug, seat_limit FROM workspaces WHERE id = $1",
    [person.workspace_id]
  );
  if (ws.rows.length === 0) throw new ApiError("unauthenticated", "Sign in again.");
  const now = rc.nowMs();
  const states = await loadCalendarStates(rc.client, person.workspace_id);
  const today = partsFor(states[0].time_zone, now).date;
  const cal = calendarEffectiveOn(states, today);
  return {
    person,
    workspace: ws.rows[0],
    role: person.role,
    client: rc.client,
    now,
    states,
    zone: cal.time_zone,
    today,
    isWorkingDay: isCounted(cal, today),
  };
}

// ---------------------------------------------------------------------------
// Auth and account
// ---------------------------------------------------------------------------

const createAccount: Handler = async (rc) => {
  const body = rc.body as Record<string, unknown>;
  const name = body.name;
  const email = body.email;
  const password = body.password;
  if (typeof name !== "string" || isBlank(name) || codePointLength(name) > 80 || isUnstorableText(name)) {
    throw new ApiError("validation", "Give your name.", { name: "Give your name." });
  }
  if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email)) {
    throw new ApiError("validation", "Give your email.", { email: "Give your email." });
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    throw new ApiError("validation", "Use 8 to 128 characters.", { password: "Use 8 to 128 characters." });
  }
  const existing = await rc.client!.query("SELECT id FROM people WHERE lower(email) = lower($1)", [email]);
  if (existing.rows.length > 0) {
    throw new ApiError("email_taken", "An account with that email already exists.");
  }
  const id = uuid();
  await rc.client!.query(
    "INSERT INTO people (id, workspace_id, name, email, handle, role, password_hex, removed, created_at) VALUES ($1,null,$2,$3,null,null,$4,false,$5)",
    [id, name, email, sha256(password), store.isoNow()]
  );
  const token = newSessionToken();
  await rc.client!.query("INSERT INTO sessions (token, person_id, created_at, last_seen) VALUES ($1,$2,$3,$3)", [
    token,
    id,
    store.isoNow(),
  ]);
  setSessionCookie(rc, token);
  return { status: 201, body: { person: { id, name, email, handle: null, role: null } } };
};

function setSessionCookie(rc: RouteContext, token: string): void {
  writeCookieHeader(rc, `tr_session=${token}; Path=/; HttpOnly; SameSite=Lax`);
}

function writeCookieHeader(rc: RouteContext, value: string): void {
  const prev = rc.res.getHeader("Set-Cookie");
  const list = prev ? (Array.isArray(prev) ? prev.map(String) : [String(prev)]) : [];
  list.push(value);
  rc.res.setHeader("Set-Cookie", list);
}

const signIn: Handler = async (rc) => {
  const body = rc.body as Record<string, unknown>;
  const email = body.email;
  const password = body.password;
  if (typeof email !== "string" || typeof password !== "string") {
    throw new ApiError("invalid_credentials", "That email and password don't match.");
  }
  const person = await rc.client!.query<PersonRow>(
    "SELECT id, workspace_id, name, email, handle, role, removed FROM people WHERE lower(email) = lower($1)",
    [email]
  );
  if (person.rows.length === 0) {
    throw new ApiError("invalid_credentials", "That email and password don't match.");
  }
  const row = person.rows[0];
  const secret = await rc.client!.query<{ password_hex: string }>("SELECT password_hex FROM people WHERE id = $1", [row.id]);
  if (!verifySecret(secret.rows[0].password_hex, password)) {
    throw new ApiError("invalid_credentials", "That email and password don't match.");
  }
  const token = newSessionToken();
  await rc.client!.query("INSERT INTO sessions (token, person_id, created_at, last_seen) VALUES ($1,$2,$3,$3)", [
    token,
    row.id,
    store.isoNow(),
  ]);
  setSessionCookie(rc, token);
  const workspace = await workspaceOf(rc.client!, row.workspace_id, row, rc.cfg);
  return { status: 200, body: { person: personJson(row), workspace } };
};

async function workspaceOf(client: Client, workspaceId: string, person: PersonRow, cfg: Config): Promise<unknown> {
  const ws = await client.query<{ id: string; name: string; slug: string; seat_limit: number }>(
    "SELECT id, name, slug, seat_limit FROM workspaces WHERE id = $1",
    [workspaceId]
  );
  if (ws.rows.length === 0) return null;
  const states = await loadCalendarStates(client, workspaceId);
  const now = nowMs();
  const today = partsFor(states[0].time_zone, now).date;
  const cal = calendarEffectiveOn(states, today);
  const seats = person.role === "owner" ? await seatCounts(client, workspaceId, cfg) : null;
  return {
    id: ws.rows[0].id,
    name: ws.rows[0].name,
    slug: ws.rows[0].slug,
    time_zone: cal.time_zone,
    working_weekdays: cal.working_weekdays,
    holidays: cal.holidays,
    cycle_anchor: states[0].cycle_anchor,
    today,
    is_working_day: isCounted(cal, today),
    next_digest_at: await jobs.nextDigestAt(workspaceId),
    seats,
  };
}

async function seatCounts(client: Client, workspaceId: string, cfg: Config): Promise<{ limit: number; active: number; pending: number } | null> {
  const ws = await client.query<{ name: string; seat_limit: number }>(
    "SELECT name, seat_limit FROM workspaces WHERE id = $1",
    [workspaceId]
  );
  if (ws.rows.length === 0) return null;
  const active = await client.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM people WHERE workspace_id = $1 AND NOT removed",
    [workspaceId]
  );
  const pending = await client.query<{ n: string; created_at: Date }>(
    "SELECT created_at FROM invites WHERE workspace_id = $1 AND status = 'pending'",
    [workspaceId]
  );
  let pendingCount = 0;
  for (const row of pending.rows) {
    if (inviteStatusOf({ status: "pending", created_at: row.created_at }, cfg.inviteTtlSeconds, nowMs()) === "pending") {
      pendingCount++;
    }
  }
  let limit = ws.rows[0].seat_limit;
  let state: billing.BillingState;
  try {
    const calStates = await loadCalendarStates(client, workspaceId);
    const today = partsFor(calStates[0].time_zone, nowMs()).date;
    state = await billing.readBillingState(cfg, workspaceId, ws.rows[0].name, limit);
    if (state.scheduledOn !== null && state.scheduledLimit !== null && state.scheduledOn <= today) {
      state = await billing.applyScheduledReduction(cfg, workspaceId, ws.rows[0].name, limit, today);
    }
    limit = state.limit;
  } catch {
    state = billing.lastKnown(workspaceId, limit);
    limit = state.limit;
  }
  if (limit !== ws.rows[0].seat_limit) {
    await client.query("UPDATE workspaces SET seat_limit = $1 WHERE id = $2", [limit, workspaceId]);
  }
  return { limit, active: Number(active.rows[0].n), pending: pendingCount };
}

function personJson(p: PersonRow): { id: string; name: string; email: string; handle: string | null; role: string | null } {
  return {
    id: p.id,
    name: p.name,
    email: p.email,
    handle: p.handle || null,
    role: p.role || null,
  };
}

const signOut: Handler = async (rc) => {
  const token = rc.cookies()["tr_session"];
  if (token) {
    await rc.client!.query("DELETE FROM sessions WHERE token = $1", [token]);
  }
  writeCookieHeader(rc, "tr_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  return { status: 204 };
};

const me: Handler = async (rc) => {
  const person = rc.person!;
  const workspace = await workspaceOf(rc.client!, person.workspace_id, person, rc.cfg);
  return { status: 200, body: { person: personJson(person), workspace } };
};

const changePassword: Handler = async (rc) => {
  const body = rc.body as Record<string, unknown>;
  const person = rc.person!;
  const current = body.current_password;
  const next = body.new_password;
  if (typeof current !== "string" || typeof next !== "string") {
    throw new ApiError("validation", "Use 8 to 128 characters.", { new_password: "Use 8 to 128 characters." });
  }
  const secret = await rc.client!.query<{ password_hex: string }>("SELECT password_hex FROM people WHERE id = $1", [person.id]);
  if (!verifySecret(secret.rows[0].password_hex, current)) {
    throw new ApiError("invalid_credentials", "That current password isn't right.");
  }
  if (next.length < 8 || next.length > 128) {
    throw new ApiError("validation", "Use 8 to 128 characters.", { new_password: "Use 8 to 128 characters." });
  }
  await rc.client!.query("UPDATE people SET password_hex = $1 WHERE id = $2", [sha256(next), person.id]);
  // Every other session ends; the current one stays. Open streams get one revoked event.
  const token = rc.cookies()["tr_session"];
  const sessions = await rc.client!.query<{ token: string }>("SELECT token FROM sessions WHERE person_id = $1", [person.id]);
  for (const s of sessions.rows) {
    if (s.token === token) continue;
    await rc.client!.query("DELETE FROM sessions WHERE token = $1", [s.token]);
  }
  if (person.workspace_id) {
    await revokeStreamsForPerson(rc.client!, person.id, person.workspace_id, "workspace", person.workspace_id, rc.events);
  }
  return { status: 204 };
};

async function revokeStreamsForPerson(
  client: Client,
  personId: string,
  workspaceId: string,
  scope: "channel" | "project" | "workspace",
  scopeId: string,
  events: number[]
): Promise<void> {
  const id = await store.emitEvent(client, workspaceId, "revoked", {
    person_id: personId,
    scope,
    scope_id: scopeId,
  });
  events.push(id);
}

// ---------------------------------------------------------------------------
// Workspace and calendar
// ---------------------------------------------------------------------------

const getWorkspace: Handler = async (rc) => {
  const person = rc.person!;
  return { status: 200, body: await workspaceOf(rc.client!, person.workspace_id, person, rc.cfg) };
};

const putCalendar: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  if (ctx.role !== "owner") throw new ApiError("forbidden", "Only the owner can change the calendar.");
  const body = rc.body as Record<string, unknown>;
  const states = await loadCalendarStates(rc.client!, ctx.workspace.id);
  const storedAnchor = states[0].cycle_anchor;
  const current = currentCycleNumber(states, ctx.now);
  const anchorStarted = ctx.today > storedAnchor;
  const { spec, fields } = validateCalendarSpec(body, anchorStarted, storedAnchor);
  if (!spec) {
    throw new ApiError("validation", "Calendar not saved.", fields);
  }
  // The save applies from the workspace's current date, in the zone before the change.
  const seq = await rc.client!.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM calendar_states WHERE workspace_id = $1",
    [ctx.workspace.id]
  );
  await rc.client!.query(
    "INSERT INTO calendar_states (workspace_id, seq, effective_from, time_zone, working_weekdays, holidays, cycle_anchor) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [ctx.workspace.id, Number(seq.rows[0].n), ctx.today, spec.time_zone, spec.working_weekdays, JSON.stringify(spec.holidays), spec.cycle_anchor]
  );
  return { status: 200, body: await workspaceOf(rc.client!, ctx.workspace.id, ctx.person!, rc.cfg) };
};

// ---------------------------------------------------------------------------
// Cycles
// ---------------------------------------------------------------------------

async function cycleJsonFor(rc: RouteContext, ctx: Ctx, number: number): Promise<CycleJson> {
  const client = rc.client!;
  const states = ctx.states;
  const now = ctx.now;
  const current = currentCycleNumber(states, now);
  const finished = number < current;
  // Finished cycles keep a stored snapshot; write it now if this is the first read.
  if (finished) {
    return finishedCycleJson(rc, ctx, number);
  }
  const firstCounted = await firstCountedDateOfCycle(rc, states, number);
  const span = store.cycleDates(states, firstCounted);
  const nextFirst = span.nextFirst;
  const days = [];
  let d = span.countedDates[0];
  while (d < nextFirst) {
    days.push(dayInfo(calendarEffectiveOn(states, d), d));
    d = addDays(d, 1);
  }
  const startsAtMs = store.cycleBoundary(states, span.countedDates[0]);
  const endsAtMs = store.cycleBoundary(states, nextFirst);
  const scope = await visibleScope(ctx);
  const rows = await visibleIssuesOfScope(client, scope);
  const cycleByNumber = await cycleBoundaries(states, current);
  const memberIssues = rows.filter((r) => {
    const eff = effectiveCycleOf(r, current, now, cycleByNumber);
    return eff === number;
  });
  const burndown: { date: string; open: number }[] = [];
  const countedDates = span.countedDates;
  for (const date of countedDates) {
    if (date > ctx.today) break;
    const dayEnd = store.cycleBoundary(states, addDays(date, 1));
    const open = memberIssues.filter((r) => !r.closed_at || Date.parse(r.closed_at) >= dayEnd).length;
    burndown.push({ date, open });
  }
  return {
    number,
    starts_at: instantInZone(calendarEffectiveOn(states, span.countedDates[0]).time_zone, startsAtMs),
    ends_at: instantInZone(calendarEffectiveOn(states, nextFirst).time_zone, endsAtMs),
    first_working_date: span.countedDates[0],
    last_working_date: span.countedDates[9],
    calendar_days: days.length,
    working_day_count: 10,
    days,
    burndown,
    issue_keys: memberIssues.map((r) => `${r.project_key}-${r.number}`),
    is_current: number === current,
    is_finished: false,
  };
}

async function visibleIssuesOfScope(client: Client, scope: { projectIds: Set<string> }): Promise<IssueRow[]> {
  const ids = [...scope.projectIds];
  if (ids.length === 0) return [];
  const res = await client.query<IssueRow>(
    `SELECT i.id, i.project_id, p.key AS project_key, i.number, i.title, i.description,
            i.status, i.assignee_id, i.parent_id, pi.number AS parent_number, i.cycle_number,
            i.due_date, i.closed_at
     FROM issues i JOIN projects p ON p.id = i.project_id
     LEFT JOIN issues pi ON pi.id = i.parent_id
     WHERE i.project_id = ANY($1::uuid[])`,
    [ids]
  );
  return res.rows;
}

async function cycleBoundaries(states: CalendarState[], upTo: number): Promise<Map<number, { startsAtMs: number; endsAtMs: number }>> {
  const map = new Map<number, { startsAtMs: number; endsAtMs: number }>();
  let firstCounted = nextCountedOnOrAfter(states[0], states[0].cycle_anchor);
  for (let n = 1; n <= upTo; n++) {
    const span = store.cycleDates(states, firstCounted);
    map.set(n, {
      startsAtMs: store.cycleBoundary(states, span.countedDates[0]),
      endsAtMs: store.cycleBoundary(states, span.nextFirst),
    });
    firstCounted = span.nextFirst;
  }
  return map;
}

function effectiveCycleOf(row: IssueRow, current: number, nowMs: number, byNumber: Map<number, { startsAtMs: number; endsAtMs: number }>): number | null {
  if (row.cycle_number === null) return null;
  if (row.status === "done" || row.status === "cancelled") {
    if (!row.closed_at) return row.cycle_number;
    const closed = Date.parse(row.closed_at);
    for (const [num, span] of byNumber) {
      if (closed >= span.startsAtMs && closed < span.endsAtMs) return num;
    }
    return row.cycle_number;
  }
  const span = byNumber.get(row.cycle_number);
  if (span && nowMs >= span.endsAtMs) return current;
  return row.cycle_number;
}

async function firstCountedDateOfCycle(rc: RouteContext, states: CalendarState[], number: number): Promise<string> {
  let firstCounted = nextCountedOnOrAfter(states[0], states[0].cycle_anchor);
  for (let n = 1; n < number; n++) {
    const span = store.cycleDates(states, firstCounted);
    firstCounted = span.nextFirst;
  }
  return firstCounted;
}

interface FinishedRecord {
  starts_at: string;
  ends_at: string;
  first_working_date: string;
  last_working_date: string;
  days: CycleJson["days"];
  issues: { key: string; project_id: string; closed_at: string | null }[];
  burndown_all: { date: string; open: number }[];
  issue_keys_all: string[];
}

async function finishedCycleJson(rc: RouteContext, ctx: Ctx, number: number): Promise<CycleJson> {
  const client = rc.client!;
  // Ensure the snapshot exists: it is written however late the record is written.
  const existing = await client.query<{ record: string }>(
    "SELECT record FROM finished_cycles WHERE workspace_id = $1 AND number = $2",
    [ctx.workspace.id, number]
  );
  let record: FinishedRecord | null = null;
  if (existing.rows.length > 0) {
    record = JSON.parse(existing.rows[0].record) as FinishedRecord;
  } else {
    record = await writeFinishedRecord(rc, ctx, number);
  }
  if (!record) throw new ApiError("not_found", "That cycle doesn't exist.");
  const scope = await visibleScope(ctx);
  const visibleIssues = record.issues.filter((i) => scope.projectIds.has(i.project_id));
  const burndown = record.burndown_all.map((entry) => ({
    date: entry.date,
    open: visibleIssues.filter((i) => {
      if (i.closed_at === null) return true;
      const dayEnd = store.cycleBoundary(ctx.states, addDays(entry.date, 1));
      return Date.parse(i.closed_at) >= dayEnd;
    }).length,
  }));
  const issueKeys = visibleIssues.map((i) => i.key);
  const current = currentCycleNumber(ctx.states, ctx.now);
  return {
    number,
    starts_at: record.starts_at,
    ends_at: record.ends_at,
    first_working_date: record.first_working_date,
    last_working_date: record.last_working_date,
    calendar_days: record.days.length,
    working_day_count: 10,
    days: record.days,
    burndown,
    issue_keys: issueKeys,
    is_current: false,
    is_finished: true,
  };
}

async function writeFinishedRecord(rc: RouteContext, ctx: Ctx, number: number): Promise<FinishedRecord | null> {
  const client = rc.client!;
  const states = ctx.states;
  const firstCounted = await firstCountedDateOfCycle(rc, states, number);
  const span = store.cycleDates(states, firstCounted);
  const days: CycleJson["days"] = [];
  let d = span.countedDates[0];
  while (d < span.nextFirst) {
    days.push(dayInfo(calendarEffectiveOn(states, d), d));
    d = addDays(d, 1);
  }
  const startsAtMs = store.cycleBoundary(states, span.countedDates[0]);
  const endsAtMs = store.cycleBoundary(states, span.nextFirst);
  // Member issues: the issues that reported this cycle at its end.
  const rows = await client.query<IssueRow>(
    `SELECT i.id, i.project_id, p.key AS project_key, i.number, i.status, i.closed_at, i.cycle_number
     FROM issues i JOIN projects p ON p.id = i.project_id
     WHERE i.workspace_id = $1`,
    [ctx.workspace.id]
  );
  const byNumber = await cycleBoundaries(states, number);
  const members = rows.rows.filter((r) => effectiveCycleOf(r, number, endsAtMs, byNumber) === number);
  const issues = members.map((r) => ({
    key: `${r.project_key}-${r.number}`,
    project_id: r.project_id,
    closed_at: r.closed_at ? new Date(r.closed_at).toISOString() : null,
  }));
  const burndownAll: { date: string; open: number }[] = [];
  for (const date of span.countedDates) {
    const dayEnd = store.cycleBoundary(states, addDays(date, 1));
    const open = members.filter((r) => !r.closed_at || Date.parse(r.closed_at) >= dayEnd).length;
    burndownAll.push({ date, open });
  }
  const record: FinishedRecord = {
    starts_at: instantInZone(calendarEffectiveOn(states, span.countedDates[0]).time_zone, startsAtMs),
    ends_at: instantInZone(calendarEffectiveOn(states, span.nextFirst).time_zone, endsAtMs),
    first_working_date: span.countedDates[0],
    last_working_date: span.countedDates[9],
    days,
    issues,
    burndown_all: burndownAll,
    issue_keys_all: members.map((r) => `${r.project_key}-${r.number}`),
  };
  await client.query(
    `INSERT INTO finished_cycles (workspace_id, number, record, created_at) VALUES ($1,$2,$3,$4)
     ON CONFLICT (workspace_id, number) DO NOTHING`,
    [ctx.workspace.id, number, JSON.stringify(record), store.isoNow()]
  );
  return record;
}

const getCyclesCurrent: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  const current = currentCycleNumber(ctx.states, ctx.now);
  return { status: 200, body: await cycleJsonFor(rc, ctx, current) };
};

const getCycle: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  const n = Number(rc.params.number);
  if (!Number.isInteger(n) || n < 1 || n > 1000) {
    throw new ApiError("not_found", "That cycle doesn't exist.");
  }
  const current = currentCycleNumber(ctx.states, ctx.now);
  if (n > current) throw new ApiError("not_found", "That cycle doesn't exist.");
  return { status: 200, body: await cycleJsonFor(rc, ctx, n) };
};

// ---------------------------------------------------------------------------
// Projects and members
// ---------------------------------------------------------------------------

const getProjects: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  const scope = await visibleScope(ctx);
  const rows = await rc.client!.query<{ id: string; key: string; name: string }>(
    "SELECT id, key, name FROM projects WHERE id = ANY($1::uuid[]) ORDER BY key",
    [[...scope.projectIds]]
  );
  return { status: 200, body: { projects: rows.rows } };
};

const getMembers: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  const scope = await visibleScope(ctx);
  const rows = await rc.client!.query<{ id: string; name: string; email: string; handle: string; role: string }>(
    "SELECT id, name, email, handle, role FROM people WHERE id = ANY($1::uuid[]) ORDER BY name",
    [[...scope.personIds]]
  );
  return { status: 200, body: { members: rows.rows.map((r) => ({ ...r, handle: r.handle || null, role: r.role || null })) } };
};

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

const getIssues: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  const scope = await visibleScope(ctx);
  let rows = await visibleIssuesOfScope(rc.client!, scope);
  const project = rc.url.searchParams.get("project");
  const cycle = rc.url.searchParams.get("cycle");
  const status = rc.url.searchParams.get("status");
  if (project) {
    if (!scope.projectIds.has(project)) {
      throw new ApiError("not_found", "That project doesn't exist or isn't shared with you.");
    }
    rows = rows.filter((r) => r.project_id === project);
  }
  const current = currentCycleNumber(ctx.states, ctx.now);
  const byNumber = await cycleBoundaries(ctx.states, current);
  if (cycle === "none") {
    rows = rows.filter((r) => effectiveCycleOf(r, current, ctx.now, byNumber) === null);
  } else if (cycle === "all") {
    // every issue
  } else if (cycle !== null) {
    const n = Number(cycle);
    if (!Number.isInteger(n) || n < 1 || n > 1000) {
      throw new ApiError("validation", "That cycle doesn't exist.", { cycle: "That cycle doesn't exist." });
    }
    if (n < current) {
      // Finished cycles keep their member issues.
      const snap = await rc.client!.query<{ record: string }>(
        "SELECT record FROM finished_cycles WHERE workspace_id = $1 AND number = $2",
        [ctx.workspace.id, n]
      );
      if (snap.rows.length === 0) {
        await finishedCycleJson(rc, ctx, n);
      }
      const record = JSON.parse(snap.rows[0]?.record ?? "{}") as FinishedRecord;
      const keys = new Set((record.issues ?? []).filter((i) => scope.projectIds.has(i.project_id)).map((i) => i.key));
      rows = rows.filter((r) => keys.has(`${r.project_key}-${r.number}`));
    } else {
      rows = rows.filter((r) => effectiveCycleOf(r, current, ctx.now, byNumber) === n);
    }
  } else {
    rows = rows.filter((r) => effectiveCycleOf(r, current, ctx.now, byNumber) === current);
  }
  if (status) {
    rows = rows.filter((r) => r.status === status);
  }
  const ordered = issuesListOrder(rows);
  const out = [];
  for (const row of ordered) {
    out.push(await issueJson(ctx, row));
  }
  return { status: 200, body: { issues: out } };
};

const postIssue: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  const body = rc.body as Record<string, unknown>;
  const created = await store.createIssue(
    ctx,
    {
      project_id: String(body.project_id ?? ""),
      title: body.title as string,
      description: typeof body.description === "string" ? body.description : "",
      assignee_id: (body.assignee_id as string) ?? null,
      parent_key: (body.parent_key as string) ?? null,
      cycle_number: body.cycle_number === undefined || body.cycle_number === null ? null : Number(body.cycle_number),
      due_date: (body.due_date as string) ?? null,
    },
    rc.events
  );
  const json = await issueJson(ctx, created);
  return { status: 201, body: { ...json, due_date_snapped: false } };
};

const getIssue: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  const scope = await visibleScope(ctx);
  const row = await issueByKeyVisible(ctx, scope, rc.params.key);
  if (!row) throw new ApiError("not_found", "That item doesn't exist or isn't shared with you.");
  return { status: 200, body: await issueJson(ctx, row) };
};

const patchIssue: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  const scope = await visibleScope(ctx);
  const row = await issueByKeyVisible(ctx, scope, rc.params.key);
  if (!row) throw new ApiError("not_found", "That item doesn't exist or isn't shared with you.");
  const body = rc.body as Record<string, unknown>;
  let fresh = row;
  if (body.title !== undefined || body.description !== undefined) {
    fresh = await store.patchIssueText(ctx, fresh, { title: body.title as string | undefined, description: body.description as string | undefined }, rc.events);
  }
  if (body.assignee_id !== undefined) {
    fresh = await store.assignIssue(ctx, fresh, (body.assignee_id as string) ?? null, rc.events);
  }
  if (body.cycle_number !== undefined) {
    fresh = await store.setIssueCycle(ctx, fresh, body.cycle_number === null ? null : Number(body.cycle_number), rc.events);
  }
  let snapped = false;
  if (body.due_date !== undefined) {
    const result = await store.setDueDate(ctx, fresh, (body.due_date as string) ?? null, rc.events);
    fresh = result.row;
    snapped = result.snapped;
  }
  return { status: 200, body: { ...(await issueJson(ctx, fresh)), due_date_snapped: snapped } };
};

const transitionIssueHandler: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  const scope = await visibleScope(ctx);
  const row = await issueByKeyVisible(ctx, scope, rc.params.key);
  if (!row) throw new ApiError("not_found", "That item doesn't exist or isn't shared with you.");
  const body = rc.body as Record<string, unknown>;
  const to = String(body.to ?? "");
  const fresh = await store.transitionIssue(ctx, row, to, rc.events);
  return { status: 200, body: await issueJson(ctx, fresh) };
};

// ---------------------------------------------------------------------------
// Channels, messages, unread
// ---------------------------------------------------------------------------

const getChannels: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  const rows = await rc.client!.query<{ id: string; name: string }>(
    `SELECT c.id, c.name FROM channels c JOIN channel_members m ON m.channel_id = c.id
     WHERE m.person_id = $1 ORDER BY c.name`,
    [ctx.person.id]
  );
  const counts = await store.unreadCountsFor(rc.client!, ctx.person.id);
  return {
    status: 200,
    body: {
      channels: rows.rows.map((r) => ({
        id: r.id,
        name: r.name,
        unread: counts.channels[r.id] ?? 0,
      })),
    },
  };
};

async function channelMember(rc: RouteContext): Promise<Ctx> {
  const ctx = await ctxOf(rc);
  const channelId = rc.params.id;
  const scope = await visibleScope(ctx);
  if (!scope.channelIds.has(channelId)) {
    throw new ApiError("not_found", "That item doesn't exist or isn't shared with you.");
  }
  return ctx;
};

const getChannelMessages: Handler = async (rc) => {
  const ctx = await channelMember(rc);
  const rows = await rc.client!.query<{ id: string }>(
    "SELECT id FROM messages WHERE channel_id = $1 AND thread_root_id IS NULL AND NOT deleted ORDER BY id",
    [rc.params.id]
  );
  const messages = [];
  for (const row of rows.rows) {
    const m = await messageById(rc.client!, Number(row.id));
    if (m) messages.push(await messageJsonFor(rc.client!, m, ctx.person.id, ctx.zone));
  }
  const typingRows = await rc.client!.query<{ person_id: string }>(
    `SELECT t.person_id FROM typing t JOIN people p ON p.id = t.person_id
     WHERE t.channel_id = $1 AND t.last_signal > $2 ORDER BY p.name, t.person_id`,
    [rc.params.id, new Date(rc.nowMs() - 5000).toISOString()]
  );
  return { status: 200, body: { messages, typing: typingRows.rows.map((r) => r.person_id) } };
};

const postMessage: Handler = async (rc) => {
  const ctx = await channelMember(rc);
  const body = rc.body as Record<string, unknown>;
  const result = await store.sendMessage(
    ctx,
    rc.params.id,
    body.body as string,
    body.thread_root_id === undefined || body.thread_root_id === null ? null : Number(body.thread_root_id),
    (rc.headers["idempotency-key"] as string) ?? null,
    rc.events
  );
  const m = await messageById(rc.client!, result.id);
  return { status: 201, body: await messageJsonFor(rc.client!, m!, ctx.person.id, ctx.zone) };
};

const getThread: Handler = async (rc) => {
  const ctx = await channelMember(rc);
  const rootId = Number(rc.params.id);
  const root = await messageById(rc.client!, rootId);
  if (!root || root.channel_id !== rc.params.channelId || root.thread_root_id !== null) {
    throw new ApiError("not_found", "That item doesn't exist or isn't shared with you.");
  }
  const replies = await rc.client!.query<{ id: string }>(
    "SELECT id FROM messages WHERE thread_root_id = $1 AND NOT deleted ORDER BY id",
    [rootId]
  );
  const out = [];
  for (const row of replies.rows) {
    const m = await messageById(rc.client!, Number(row.id));
    if (m) out.push(await messageJsonFor(rc.client!, m, ctx.person.id, ctx.zone));
  }
  return {
    status: 200,
    body: { root: await messageJsonFor(rc.client!, root, ctx.person.id, ctx.zone), replies: out },
  };
};

const deleteMessageHandler: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  const row = await messageById(rc.client!, Number(rc.params.id));
  if (!row || row.deleted) throw new ApiError("not_found", "That item doesn't exist or isn't shared with you.");
  const scope = await visibleScope(ctx);
  if (!scope.channelIds.has(row.channel_id)) {
    throw new ApiError("not_found", "That item doesn't exist or isn't shared with you.");
  }
  if (ctx.role !== "owner" && row.author_id !== ctx.person.id) {
    throw new ApiError("forbidden", "Only the author or the owner can delete a message.");
  }
  await store.deleteMessage(
    ctx,
    { id: Number(row.id), channel_id: row.channel_id, thread_root_id: row.thread_root_id ? Number(row.thread_root_id) : null },
    rc.events
  );
  return { status: 204 };
};

const markChannelRead: Handler = async (rc) => {
  const ctx = await channelMember(rc);
  const body = rc.body as Record<string, unknown>;
  const upTo = Number(body.up_to);
  if (!Number.isInteger(upTo)) {
    throw new ApiError("validation", "Give the message id.", { up_to: "Give the message id." });
  }
  const exists = await rc.client!.query<{ id: string }>(
    "SELECT id FROM messages WHERE channel_id = $1 AND id = $2",
    [rc.params.id, upTo]
  );
  if (exists.rows.length === 0) {
    throw new ApiError("validation", "Give a message in this channel.", { up_to: "Give a message in this channel." });
  }
  await store.markReadUpTo(rc.client!, ctx.person.id, "channel", rc.params.id, upTo);
  const counts = await store.unreadCountsFor(rc.client!, ctx.person.id);
  return { status: 200, body: counts };
};

const markThreadRead: Handler = async (rc) => {
  const ctx = await channelMember(rc);
  const body = rc.body as Record<string, unknown>;
  const upTo = Number(body.up_to);
  if (!Number.isInteger(upTo)) {
    throw new ApiError("validation", "Give the message id.", { up_to: "Give the message id." });
  }
  const exists = await rc.client!.query<{ id: string }>(
    "SELECT id FROM messages WHERE thread_root_id = $1 AND id = $2",
    [rc.params.id, upTo]
  );
  if (exists.rows.length === 0) {
    throw new ApiError("validation", "Give a message in this thread.", { up_to: "Give a message in this thread." });
  }
  await store.markReadUpTo(rc.client!, ctx.person.id, "thread", rc.params.id, upTo);
  const counts = await store.unreadCountsFor(rc.client!, ctx.person.id);
  return { status: 200, body: counts };
};

const getUnread: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  return { status: 200, body: await store.unreadCountsFor(rc.client!, ctx.person.id) };
};

const getInbox: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  const counts = await store.unreadCountsFor(rc.client!, ctx.person.id);
  void counts;
  const rows = await rc.client!.query<{ id: string }>(
    `SELECT m.id FROM messages m
     JOIN channel_members cm ON cm.channel_id = m.channel_id AND cm.person_id = $1
     WHERE NOT m.deleted AND m.author_id <> $1 AND (
       $1::uuid = ANY(m.mentions)
       OR (
         m.thread_root_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM messages root_or_reply
           WHERE (root_or_reply.id = m.thread_root_id OR root_or_reply.thread_root_id = m.thread_root_id)
             AND root_or_reply.author_id = $1 AND NOT root_or_reply.deleted
         )
       )
       AND m.id > CASE
         WHEN m.thread_root_id IS NULL
         THEN COALESCE((SELECT last_read FROM read_markers r WHERE r.person_id = $1 AND r.scope = 'channel' AND r.scope_id = m.channel_id::text), 0)
         ELSE COALESCE((SELECT last_read FROM read_markers r WHERE r.person_id = $1 AND r.scope = 'thread' AND r.scope_id = m.thread_root_id::text), 0)
       END
     )
     ORDER BY m.id DESC`,
    [ctx.person.id]
  );
  const items = [];
  for (const row of rows.rows) {
    const m = await messageById(rc.client!, Number(row.id));
    if (m) items.push(await messageJsonFor(rc.client!, m, ctx.person.id, ctx.zone));
  }
  return { status: 200, body: { items } };
};

const postTyping: Handler = async (rc) => {
  const ctx = await channelMember(rc);
  await rc.client!.query(
    `INSERT INTO typing (person_id, channel_id, last_signal) VALUES ($1,$2,$3)
     ON CONFLICT (person_id, channel_id) DO UPDATE SET last_signal = EXCLUDED.last_signal`,
    [ctx.person.id, rc.params.id, store.isoNow()]
  );
  const list = await rc.client!.query<{ person_id: string }>(
    `SELECT t.person_id FROM typing t JOIN people p ON p.id = t.person_id
     WHERE t.channel_id = $1 AND t.last_signal > $2 ORDER BY p.name, t.person_id`,
    [rc.params.id, new Date(rc.nowMs() - 5000).toISOString()]
  );
  const id = await store.emitEvent(rc.client!, ctx.workspace.id, "typing", {
    channel_id: rc.params.id,
    typing: list.rows.map((r) => r.person_id),
  });
  rc.events.push(id);
  return { status: 204 };
};

// ---------------------------------------------------------------------------
// Docs
// ---------------------------------------------------------------------------

const getDocs: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  const scope = await visibleScope(ctx);
  const rows = await rc.client!.query<{ id: string; project_id: string; title: string; version: number; updated_by: string | null; updated_at: Date }>(
    "SELECT id, project_id, title, version, updated_by, updated_at FROM docs WHERE project_id = ANY($1::uuid[]) ORDER BY title",
    [[...scope.projectIds]]
  );
  const out = [];
  for (const row of rows.rows) {
    out.push({
      id: row.id,
      project_id: row.project_id,
      title: row.title,
      version: row.version,
      updated_by: row.updated_by,
      updated_at: instantInZone(ctx.zone, Date.parse(row.updated_at.toISOString())),
    });
  }
  return { status: 200, body: { docs: out } };
};

const postDoc: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  if (ctx.role === "guest") throw new ApiError("forbidden", "Guests can't create docs.");
  const body = rc.body as Record<string, unknown>;
  const scope = await visibleScope(ctx);
  if (!scope.projectIds.has(String(body.project_id ?? ""))) {
    throw new ApiError("not_found", "That project doesn't exist or isn't shared with you.");
  }
  const title = body.title;
  const text = body.body ?? "";
  if (typeof title !== "string" || isBlank(title) || codePointLength(title) > 200 || isUnstorableText(title)) {
    throw new ApiError("validation", "Give the doc a title.", { title: "Give the doc a title." });
  }
  if (typeof text !== "string" || codePointLength(text) > 200000 || isUnstorableText(text)) {
    throw new ApiError("validation", "A doc can be up to 200,000 characters.", { body: "A doc can be up to 200,000 characters." });
  }
  const id = uuid();
  await rc.client!.query(
    "INSERT INTO docs (id, workspace_id, project_id, title, body, version, updated_by, updated_at, created_at) VALUES ($1,$2,$3,$4,$5,1,$6,$7,$7)",
    [id, ctx.workspace.id, body.project_id, title, text, ctx.person.id, store.isoNow()]
  );
  await rc.client!.query(
    "INSERT INTO doc_versions (doc_id, version, title, body, saved_at, saved_by) VALUES ($1,1,$2,$3,$4,$5)",
    [id, title, text, store.isoNow(), ctx.person.id]
  );
  rc.events.push(
    await store.emitEvent(rc.client!, ctx.workspace.id, "doc", {
      id,
      project_id: body.project_id,
      version: 1,
      updated_by: ctx.person.id,
    })
  );
  return { status: 201, body: await docJsonFor(rc.client!, id, ctx.zone) };
};

async function docVisible(rc: RouteContext): Promise<Ctx> {
  const ctx = await ctxOf(rc);
  const scope = await visibleScope(ctx);
  const doc = await rc.client!.query<{ id: string; project_id: string }>(
    "SELECT id, project_id FROM docs WHERE id = $1",
    [rc.params.id]
  );
  if (doc.rows.length === 0 || !scope.projectIds.has(doc.rows[0].project_id)) {
    throw new ApiError("not_found", "That item doesn't exist or isn't shared with you.");
  }
  return ctx;
};

const getDoc: Handler = async (rc) => {
  const ctx = await docVisible(rc);
  return { status: 200, body: await docJsonFor(rc.client!, rc.params.id, ctx.zone) };
};

const putDoc: Handler = async (rc) => {
  const ctx = await docVisible(rc);
  if (ctx.role === "guest") throw new ApiError("forbidden", "Guests can't save docs.");
  const body = rc.body as Record<string, unknown>;
  const doc = await store.saveDoc(
    ctx,
    rc.params.id,
    body.title as string,
    body.body as string,
    Number(body.base_version),
    rc.events
  );
  return { status: 200, body: await docJsonFor(rc.client!, doc.id, ctx.zone) };
};

const getDocVersions: Handler = async (rc) => {
  const ctx = await docVisible(rc);
  if (ctx.role === "guest") throw new ApiError("forbidden", "Guests can't list versions.");
  const rows = await rc.client!.query<{ version: number; saved_at: Date; saved_by: string; title: string; body: string }>(
    "SELECT version, saved_at, saved_by, title, body FROM doc_versions WHERE doc_id = $1 ORDER BY version DESC",
    [rc.params.id]
  );
  return {
    status: 200,
    body: {
      versions: rows.rows.map((r) => ({
        version: r.version,
        saved_at: instantInZone(ctx.zone, Date.parse(r.saved_at.toISOString())),
        saved_by: r.saved_by,
        title: r.title,
        body: r.body,
      })),
    },
  };
};

const postDocRestore: Handler = async (rc) => {
  const ctx = await docVisible(rc);
  if (ctx.role === "guest") throw new ApiError("forbidden", "Guests can't restore docs.");
  const body = rc.body as Record<string, unknown>;
  const doc = await store.restoreDocVersion(ctx, rc.params.id, Number(body.version), Number(body.base_version), rc.events);
  return { status: 200, body: await docJsonFor(rc.client!, doc.id, ctx.zone) };
};

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

async function handleUpload(
  rc: RouteContext,
  parentType: "issue" | "message" | "doc",
  parentId: string
): Promise<unknown> {
  if (!jobs.storageAvailable()) {
    throw new ApiError("storage_unavailable", "Storage is unavailable.");
  }
  const file = (rc.body as { file?: { filename?: string; data?: Buffer; contentType?: string } }).file;
  if (!file || !file.data) {
    throw new ApiError("validation", "Give the file.", { file: "Give the file." });
  }
  const filename = file.filename ?? "";
  if (filename.length === 0 || codePointLength(filename) > 255) {
    throw new ApiError("validation", "That file name is too long. Use 255 characters or fewer.", { file: "That file name is too long. Use 255 characters or fewer." });
  }
  const size = file.data.length;
  if (size === 0) {
    throw new ApiError("validation", `${filename} is empty and was not attached.`, { file: `${filename} is empty and was not attached.` });
  }
  if (size > 10000000) {
    throw new ApiError("too_large", `${filename} is too large and was not attached.`);
  }
  const contentType = file.contentType && file.contentType.length > 0 ? file.contentType : "application/octet-stream";
  const id = uuid();
  const workspaceSlug = (await rc.client!.query<{ slug: string }>("SELECT slug FROM workspaces WHERE id = $1", [rc.person!.workspace_id])).rows[0]?.slug ?? "ws";
  const key = storage.storageKeyFor(workspaceSlug, id, filename);
  // The object is stored first; the row follows only once MinIO accepted it.
  await storage.putObject(key, file.data, contentType);
  try {
    await rc.client!.query(
      "INSERT INTO attachments (id, workspace_id, parent_type, parent_id, filename, size, content_type, storage_key, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [id, rc.person!.workspace_id, parentType, parentId, filename, size, contentType, key, store.isoNow()]
    );
  } catch (e) {
    await storage.deleteObject(key);
    throw e;
  }
  return {
    status: 201,
    body: {
      id,
      filename,
      size,
      content_type: contentType,
      parent: { type: parentType, id: parentId },
    },
  };
}

const postIssueAttachment: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  const scope = await visibleScope(ctx);
  const row = await issueByKeyVisible(ctx, scope, rc.params.key);
  if (!row) throw new ApiError("not_found", "That item doesn't exist or isn't shared with you.");
  return handleUpload(rc, "issue", row.id);
};

const postMessageAttachment: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  const message = await messageById(rc.client!, Number(rc.params.id));
  if (!message || message.deleted) throw new ApiError("not_found", "That item doesn't exist or isn't shared with you.");
  const scope = await visibleScope(ctx);
  if (!scope.channelIds.has(message.channel_id)) {
    throw new ApiError("not_found", "That item doesn't exist or isn't shared with you.");
  }
  if (message.author_id !== ctx.person.id) {
    throw new ApiError("not_author", "Only the author can attach files to a message.");
  }
  return handleUpload(rc, "message", String(message.id));
};

const postDocAttachment: Handler = async (rc) => {
  await docVisible(rc);
  return handleUpload(rc, "doc", rc.params.id);
};

const getAttachment: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  const row = await rc.client!.query<{ id: string; parent_type: string; parent_id: string; filename: string; size: string; content_type: string; storage_key: string }>(
    "SELECT id, parent_type, parent_id, filename, size, content_type, storage_key FROM attachments WHERE id = $1",
    [rc.params.id]
  );
  if (row.rows.length === 0) throw new ApiError("not_found", "That item doesn't exist or isn't shared with you.");
  const att = row.rows[0];
  if (att.parent_type !== "workspace" && !rc.person!.workspace_id) {
    throw new ApiError("not_found", "That item doesn't exist or isn't shared with you.");
  }
  const scope = await visibleScope(ctx);
  let visible = false;
  if (att.parent_type === "issue") {
    const issue = await rc.client!.query<{ project_id: string }>("SELECT project_id FROM issues WHERE id = $1", [att.parent_id]);
    visible = issue.rows.length > 0 && scope.projectIds.has(issue.rows[0].project_id);
  } else if (att.parent_type === "doc") {
    const doc = await rc.client!.query<{ project_id: string }>("SELECT project_id FROM docs WHERE id = $1", [att.parent_id]);
    visible = doc.rows.length > 0 && scope.projectIds.has(doc.rows[0].project_id);
  } else if (att.parent_type === "message") {
    const msg = await messageById(rc.client!, Number(att.parent_id));
    visible = msg !== null && !msg.deleted && scope.channelIds.has(msg.channel_id);
  }
  if (!visible) throw new ApiError("not_found", "That item doesn't exist or isn't shared with you.");
  if (!jobs.storageAvailable()) {
    throw new ApiError("storage_unavailable", "Storage is unavailable.");
  }
  let bytes: Buffer;
  try {
    bytes = await storage.getObject(att.storage_key);
  } catch {
    throw new ApiError("storage_unavailable", "Storage is unavailable.");
  }
  const names = storage.downloadFilename(att.filename);
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "Content-Length": String(att.size),
    "Content-Disposition": `attachment; filename="${names.fallback}"; filename*=UTF-8''${names.encoded}`,
    "Content-Type": storage.downloadContentType(att.content_type),
  };
  return { status: 200, raw: bytes, headers };
};

// ---------------------------------------------------------------------------
// Office
// ---------------------------------------------------------------------------

async function floorBody(rc: RouteContext, ctx: Ctx): Promise<unknown> {
  const rooms = await rc.client!.query<{ id: string }>(
    "SELECT id FROM rooms WHERE workspace_id = $1 ORDER BY seq",
    [ctx.workspace.id]
  );
  const out = [];
  for (const r of rooms.rows) {
    const room = await roomJson(rc.client!, r.id);
    if (room) out.push(room);
  }
  const me_ = await rc.client!.query<{ room_id: string }>(
    "SELECT room_id FROM room_occupants WHERE person_id = $1",
    [ctx.person!.id]
  );
  return { rooms: out, me: { room_id: me_.rows[0]?.room_id ?? null, status: "active" } };
}

const getFloor: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  return { status: 200, body: await floorBody(rc, ctx) };
};

const postJoinRoom: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  const room = await rc.client!.query<{ id: string; kind: string }>(
    "SELECT id, kind FROM rooms WHERE id = $1 AND workspace_id = $2",
    [rc.params.id, ctx.workspace.id]
  );
  if (room.rows.length === 0) throw new ApiError("not_found", "That item doesn't exist or isn't shared with you.");
  const kind = room.rows[0].kind;
  const occupants = await rc.client!.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM room_occupants WHERE room_id = $1",
    [rc.params.id]
  );
  const count = Number(occupants.rows[0].n);
  if (kind === "private" && count > 0) {
    const inside = await rc.client!.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM room_occupants WHERE room_id = $1 AND person_id = $2",
      [rc.params.id, ctx.person.id]
    );
    if (Number(inside.rows[0].n) === 0) {
      const knock = await rc.client!.query<{ id: string; status: string; created_at: Date }>(
        "SELECT id, status, created_at FROM knocks WHERE room_id = $1 AND person_id = $2 AND status = 'let_in' ORDER BY created_at DESC LIMIT 1",
        [rc.params.id, ctx.person.id]
      );
      const fresh =
        knock.rows.length > 0 &&
        knock.rows[0].status === "let_in" &&
        Date.parse(knock.rows[0].created_at.toISOString()) + rc.cfg.knockTtlSeconds * 1000 > rc.nowMs();
      if (!fresh) throw new ApiError("knock_required", "Knock to join this room.");
    }
  }
  await joinRoom(rc, ctx, rc.params.id);
  return { status: 200, body: await floorBody(rc, ctx) };
};

async function joinRoom(rc: RouteContext, ctx: Ctx, roomId: string): Promise<void> {
  await rc.client!.query("DELETE FROM room_occupants WHERE person_id = $1", [ctx.person.id]);
  await rc.client!.query("INSERT INTO room_occupants (room_id, person_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [
    roomId,
    ctx.person.id,
  ]);
  const room = await roomJson(rc.client!, roomId);
  if (room) rc.events.push(await store.emitEvent(rc.client!, ctx.workspace.id, "room", room));
}

const postLeaveRoom: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  const current = await rc.client!.query<{ room_id: string }>(
    "SELECT room_id FROM room_occupants WHERE person_id = $1",
    [ctx.person.id]
  );
  await rc.client!.query("DELETE FROM room_occupants WHERE person_id = $1", [ctx.person.id]);
  for (const row of current.rows) {
    const room = await roomJson(rc.client!, row.room_id);
    if (room) rc.events.push(await store.emitEvent(rc.client!, ctx.workspace.id, "room", room));
  }
  return { status: 204 };
};

const postPresence: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  await touchPresence(rc, ctx, "active");
  return { status: 204 };
};

async function touchPresence(rc: RouteContext, ctx: Ctx, status: "active" | "away"): Promise<void> {
  const was = await rc.client!.query<{ status: string }>("SELECT status FROM presence WHERE person_id = $1", [ctx.person!.id]);
  await rc.client!.query(
    `INSERT INTO presence (person_id, workspace_id, status, last_heartbeat) VALUES ($1,$2,$3,$4)
     ON CONFLICT (person_id) DO UPDATE SET status = EXCLUDED.status, last_heartbeat = EXCLUDED.last_heartbeat`,
    [ctx.person!.id, ctx.workspace.id, status, store.isoNow()]
  );
  if (was.rows.length === 0 || was.rows[0].status !== status) {
    rc.events.push(
      await store.emitEvent(rc.client!, ctx.workspace.id, "presence", { person_id: ctx.person!.id, status })
    );
  }
}

const postKnock: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  const room = await rc.client!.query<{ id: string; kind: string }>(
    "SELECT id, kind FROM rooms WHERE id = $1 AND workspace_id = $2",
    [rc.params.id, ctx.workspace.id]
  );
  if (room.rows.length === 0) throw new ApiError("not_found", "That item doesn't exist or isn't shared with you.");
  if (room.rows[0].kind !== "private") throw new ApiError("room_open", "This room is open; join it directly.");
  const inside = await rc.client!.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM room_occupants WHERE room_id = $1 AND person_id = $2",
    [rc.params.id, ctx.person.id]
  );
  if (Number(inside.rows[0].n) > 0) throw new ApiError("already_inside", "You are already in this room.");
  const occupants = await rc.client!.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM room_occupants WHERE room_id = $1",
    [rc.params.id]
  );
  if (Number(occupants.rows[0].n) === 0) {
    throw new ApiError("room_empty", "This room is empty; join it directly.");
  }
  const waiting = await rc.client!.query<{ id: string; room_id: string; person_id: string; status: string; created_at: Date }>(
    "SELECT id, room_id, person_id, status, created_at FROM knocks WHERE room_id = $1 AND person_id = $2 AND status = 'waiting' LIMIT 1",
    [rc.params.id, ctx.person.id]
  );
  let knock = waiting.rows[0];
  if (knock) {
    return { status: 200, body: knockJson(knock, ctx.zone, rc.cfg.knockTtlSeconds) };
  }
  const id = uuid();
  await rc.client!.query(
    "INSERT INTO knocks (id, room_id, person_id, status, created_at) VALUES ($1,$2,$3,'waiting',$4)",
    [id, rc.params.id, ctx.person.id, store.isoNow()]
  );
  const row = await rc.client!.query<{ id: string; room_id: string; person_id: string; status: string; created_at: Date }>(
    "SELECT id, room_id, person_id, status, created_at FROM knocks WHERE id = $1",
    [id]
  );
  knock = row.rows[0];
  rc.events.push(await store.emitEvent(rc.client!, ctx.workspace.id, "knock", { id }));
  return { status: 201, body: knockJson(knock, ctx.zone, rc.cfg.knockTtlSeconds) };
};

const getMyKnock: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  const row = await rc.client!.query<{ id: string; room_id: string; person_id: string; status: string; created_at: Date }>(
    "SELECT id, room_id, person_id, status, created_at FROM knocks WHERE room_id = $1 AND person_id = $2 ORDER BY created_at DESC LIMIT 1",
    [rc.params.id, ctx.person.id]
  );
  if (row.rows.length === 0) throw new ApiError("not_found", "You haven't knocked on this room.");
  return { status: 200, body: knockJson(row.rows[0], ctx.zone, rc.cfg.knockTtlSeconds) };
};

const getRoomKnocks: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  const inside = await rc.client!.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM room_occupants WHERE room_id = $1 AND person_id = $2",
    [rc.params.id, ctx.person.id]
  );
  if (Number(inside.rows[0].n) === 0) throw new ApiError("not_in_room", "You are not in this room.");
  const rows = await rc.client!.query<{ id: string; room_id: string; person_id: string; status: string; created_at: Date }>(
    "SELECT id, room_id, person_id, status, created_at FROM knocks WHERE room_id = $1 AND status = 'waiting' ORDER BY created_at",
    [rc.params.id]
  );
  const now = rc.nowMs();
  const out = rows.rows
    .map((r) => ({ row: r, createdMs: Date.parse(r.created_at.toISOString()) }))
    .filter((r) => r.createdMs + rc.cfg.knockTtlSeconds * 1000 > now)
    .map((r) => knockJson(r.row, ctx.zone, rc.cfg.knockTtlSeconds));
  return { status: 200, body: { knocks: out } };
};

const getKnock: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  const row = await rc.client!.query<{ id: string; room_id: string; person_id: string; status: string; created_at: Date }>(
    "SELECT id, room_id, person_id, status, created_at FROM knocks WHERE id = $1",
    [rc.params.id]
  );
  if (row.rows.length === 0) throw new ApiError("not_found", "That item doesn't exist or isn't shared with you.");
  const knock = row.rows[0];
  const inside = await rc.client!.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM room_occupants WHERE room_id = $1 AND person_id = $2",
    [knock.room_id, ctx.person.id]
  );
  if (knock.person_id !== ctx.person.id && Number(inside.rows[0].n) === 0) {
    throw new ApiError("not_found", "That item doesn't exist or isn't shared with you.");
  }
  return { status: 200, body: knockJson(knock, ctx.zone, rc.cfg.knockTtlSeconds) };
};

const answerKnock: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  const body = rc.body as Record<string, unknown>;
  const answer = String(body.answer ?? "");
  if (answer !== "let_in" && answer !== "not_now") {
    throw new ApiError("validation", "Answer with let_in or not_now.", { answer: "Answer with let_in or not_now." });
  }
  await rc.client!.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`knock:${rc.params.id}`]);
  const row = await rc.client!.query<{ id: string; room_id: string; person_id: string; status: string; created_at: Date }>(
    "SELECT id, room_id, person_id, status, created_at FROM knocks WHERE id = $1",
    [rc.params.id]
  );
  if (row.rows.length === 0) throw new ApiError("not_found", "That item doesn't exist or isn't shared with you.");
  const knock = row.rows[0];
  const inside = await rc.client!.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM room_occupants WHERE room_id = $1 AND person_id = $2",
    [knock.room_id, ctx.person.id]
  );
  if (Number(inside.rows[0].n) === 0) throw new ApiError("not_in_room", "You are not in this room.");
  if (knock.status !== "waiting") {
    throw new ApiError(knock.status === "expired" ? "knock_expired" : "knock_answered", "That knock can't be answered.");
  }
  const createdMs = Date.parse(knock.created_at.toISOString());
  if (createdMs + rc.cfg.knockTtlSeconds * 1000 <= rc.nowMs()) {
    await rc.client!.query("UPDATE knocks SET status = 'expired' WHERE id = $1", [knock.id]);
    rc.events.push(await store.emitEvent(rc.client!, ctx.workspace.id, "knock", { id: knock.id }));
    throw new ApiError("knock_expired", "That knock has expired.");
  }
  await rc.client!.query("UPDATE knocks SET status = $1, answered_at = $2 WHERE id = $3", [
    answer,
    store.isoNow(),
    knock.id,
  ]);
  if (answer === "let_in") {
    await rc.client!.query("DELETE FROM room_occupants WHERE person_id = $1", [knock.person_id]);
    await rc.client!.query("INSERT INTO room_occupants (room_id, person_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [
      knock.room_id,
      knock.person_id,
    ]);
    const room = await roomJson(rc.client!, knock.room_id);
    if (room) rc.events.push(await store.emitEvent(rc.client!, ctx.workspace.id, "room", room));
  }
  const fresh = await rc.client!.query<{ id: string; room_id: string; person_id: string; status: string; created_at: Date }>(
    "SELECT id, room_id, person_id, status, created_at FROM knocks WHERE id = $1",
    [knock.id]
  );
  rc.events.push(await store.emitEvent(rc.client!, ctx.workspace.id, "knock", { id: knock.id }));
  return { status: 200, body: knockJson(fresh.rows[0], ctx.zone, rc.cfg.knockTtlSeconds) };
};

// ---------------------------------------------------------------------------
// Members management (owner)
// ---------------------------------------------------------------------------

const removeMember: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  if (ctx.role !== "owner") throw new ApiError("forbidden", "Only the owner can remove people.");
  const target = await rc.client!.query<{ id: string; role: string; workspace_id: string }>(
    "SELECT id, role, workspace_id FROM people WHERE id = $1",
    [rc.params.id]
  );
  if (target.rows.length === 0 || target.rows[0].workspace_id !== ctx.workspace.id) {
    throw new ApiError("not_found", "That item doesn't exist or isn't shared with you.");
  }
  if (target.rows[0].role === "owner") {
    throw new ApiError("owner_required", "The owner can't be removed.");
  }
  const personId = rc.params.id;
  await rc.client!.query("UPDATE people SET removed = true WHERE id = $1", [personId]);
  await rc.client!.query("DELETE FROM sessions WHERE person_id = $1", [personId]);
  await rc.client!.query("DELETE FROM channel_members WHERE person_id = $1", [personId]);
  await rc.client!.query("DELETE FROM project_guests WHERE person_id = $1", [personId]);
  const current = await rc.client!.query<{ room_id: string }>(
    "SELECT room_id FROM room_occupants WHERE person_id = $1",
    [personId]
  );
  await rc.client!.query("DELETE FROM room_occupants WHERE person_id = $1", [personId]);
  for (const row of current.rows) {
    const room = await roomJson(rc.client!, row.room_id);
    if (room) rc.events.push(await store.emitEvent(rc.client!, ctx.workspace.id, "room", room));
  }
  const knocks = await rc.client!.query<{ id: string }>(
    "UPDATE knocks SET status = 'expired' WHERE person_id = $1 AND status = 'waiting' RETURNING id",
    [personId]
  );
  for (const k of knocks.rows) {
    rc.events.push(await store.emitEvent(rc.client!, ctx.workspace.id, "knock", { id: k.id }));
  }
  await rc.client!.query("DELETE FROM typing WHERE person_id = $1", [personId]);
  await rc.client!.query("DELETE FROM presence WHERE person_id = $1", [personId]);
  await rc.client!.query("DELETE FROM outbox WHERE to_email = (SELECT email FROM people WHERE id = $1) AND status = 'held'", [personId]);
  await revokeStreamsForPerson(rc.client!, personId, ctx.workspace.id, "workspace", ctx.workspace.id, rc.events);
  return { status: 204 };
};

const postProjectMember: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  if (ctx.role !== "owner") throw new ApiError("forbidden", "Only the owner can change project members.");
  const project = await rc.client!.query<{ id: string }>(
    "SELECT id FROM projects WHERE id = $1 AND workspace_id = $2",
    [rc.params.id, ctx.workspace.id]
  );
  if (project.rows.length === 0) throw new ApiError("not_found", "That item doesn't exist or isn't shared with you.");
  const person = await rc.client!.query<{ id: string; role: string; workspace_id: string }>(
    "SELECT id, role, workspace_id FROM people WHERE id = $1",
    [String((rc.body as Record<string, unknown>).person_id ?? "")]
  );
  if (person.rows.length === 0 || person.rows[0].workspace_id !== ctx.workspace.id) {
    throw new ApiError("validation", "Give the person.", { person_id: "Give the person." });
  }
  if (person.rows[0].role !== "guest") {
    throw new ApiError("validation", "Only guests are added to projects.", { person_id: "Only guests are added to projects." });
  }
  await rc.client!.query(
    "INSERT INTO project_guests (project_id, person_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
    [rc.params.id, person.rows[0].id]
  );
  return { status: 204 };
};

const deleteProjectMember: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  if (ctx.role !== "owner") throw new ApiError("forbidden", "Only the owner can change project members.");
  const result = await rc.client!.query(
    "DELETE FROM project_guests WHERE project_id = $1 AND person_id = $2",
    [rc.params.id, rc.params.personId]
  );
  if (result.rowCount === 0) {
    throw new ApiError("not_found", "That item doesn't exist or isn't shared with you.");
  }
  // A guest who lost a project hears about it at once, with fresh unread counts.
  await revokeStreamsForPerson(rc.client!, rc.params.personId, ctx.workspace.id, "project", rc.params.id, rc.events);
  const { unreadCountsFor } = await import("./store.ts");
  const counts = await unreadCountsFor(rc.client!, rc.params.personId);
  rc.events.push(
    await store.emitEvent(rc.client!, ctx.workspace.id, "unread", { person_id: rc.params.personId, counts })
  );
  return { status: 204 };
};

const postChannelMember: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  if (ctx.role !== "owner") throw new ApiError("forbidden", "Only the owner can change channel members.");
  const channel = await rc.client!.query<{ id: string; workspace_id: string }>(
    "SELECT id, workspace_id FROM channels WHERE id = $1",
    [rc.params.id]
  );
  if (channel.rows.length === 0 || channel.rows[0].workspace_id !== ctx.workspace.id) {
    throw new ApiError("not_found", "That item doesn't exist or isn't shared with you.");
  }
  const person = await rc.client!.query<{ id: string; workspace_id: string; removed: boolean }>(
    "SELECT id, workspace_id, removed FROM people WHERE id = $1",
    [String((rc.body as Record<string, unknown>).person_id ?? "")]
  );
  if (person.rows.length === 0 || person.rows[0].workspace_id !== ctx.workspace.id || person.rows[0].removed) {
    throw new ApiError("validation", "Give the person.", { person_id: "Give the person." });
  }
  await rc.client!.query(
    "INSERT INTO channel_members (channel_id, person_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
    [rc.params.id, person.rows[0].id]
  );
  // Being added sets the marker to the channel's newest message.
  const newest = await rc.client!.query<{ id: string }>(
    "SELECT id FROM messages WHERE channel_id = $1 ORDER BY id DESC LIMIT 1",
    [rc.params.id]
  );
  if (newest.rows.length > 0) {
    await store.markReadUpTo(rc.client!, person.rows[0].id, "channel", rc.params.id, Number(newest.rows[0].id));
  }
  const counts = await store.unreadCountsFor(rc.client!, person.rows[0].id);
  rc.events.push(
    await store.emitEvent(rc.client!, ctx.workspace.id, "unread", { person_id: person.rows[0].id, counts })
  );
  return { status: 204 };
};

const deleteChannelMember: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  if (ctx.role !== "owner") throw new ApiError("forbidden", "Only the owner can change channel members.");
  const personId = rc.params.personId;
  const result = await rc.client!.query<{ channel_id: string }>(
    "DELETE FROM channel_members WHERE channel_id = $1 AND person_id = $2 RETURNING channel_id",
    [rc.params.id, personId]
  );
  if (result.rowCount === 0) {
    throw new ApiError("not_found", "That item doesn't exist or isn't shared with you.");
  }
  // Held mention mail from this channel for this person goes in the same change.
  await rc.client!.query(
    `DELETE FROM outbox o
     USING messages m
     WHERE o.ref_table = 'messages' AND o.ref_id = m.id::text
       AND m.channel_id = $1 AND o.to_email = (SELECT email FROM people WHERE id = $2)
       AND o.status = 'held'`,
    [rc.params.id, personId]
  );
  await revokeStreamsForPerson(rc.client!, personId, ctx.workspace.id, "channel", rc.params.id, rc.events);
  const counts = await store.unreadCountsFor(rc.client!, personId);
  rc.events.push(await store.emitEvent(rc.client!, ctx.workspace.id, "unread", { person_id: personId, counts }));
  return { status: 204 };
};

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

const getInvites: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  if (ctx.role !== "owner") throw new ApiError("forbidden", "Only the owner can see invites.");
  const rows = await rc.client!.query<{ id: string; email: string; role: string; project_ids: string[]; channel_ids: string[]; status: string; created_at: Date }>(
    "SELECT id, email, role, project_ids, channel_ids, status, created_at FROM invites WHERE workspace_id = $1 ORDER BY created_at",
    [ctx.workspace.id]
  );
  const now = rc.nowMs();
  return {
    status: 200,
    body: {
      invites: rows.rows.map((r) =>
        inviteJson(rc.client!, r, ctx.zone, rc.cfg.inviteTtlSeconds, ctx.workspace.name, now)
      ),
    },
  };
};

const postInvite: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  if (ctx.role !== "owner") throw new ApiError("forbidden", "Only the owner can invite people.");
  const body = rc.body as Record<string, unknown>;
  const email = String(body.email ?? "");
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    throw new ApiError("validation", "Give the email.", { email: "Give the email." });
  }
  const role = String(body.role ?? "");
  if (role !== "member" && role !== "guest") {
    throw new ApiError("validation", "Choose member or guest.", { role: "Choose member or guest." });
  }
  const projectIds = Array.isArray(body.project_ids) ? (body.project_ids as string[]) : [];
  const channelIds = Array.isArray(body.channel_ids) ? (body.channel_ids as string[]) : [];
  if (role === "guest" && projectIds.length === 0 && channelIds.length === 0) {
    throw new ApiError("validation", "Guests must name at least one project or channel.", { role: "Guests must name at least one project or channel." });
  }
  // Workspace scoping of the named projects and channels.
  const projects = await rc.client!.query<{ id: string }>(
    "SELECT id FROM projects WHERE workspace_id = $1 AND id = ANY($2::uuid[])",
    [ctx.workspace.id, projectIds]
  );
  const channels = await rc.client!.query<{ id: string }>(
    "SELECT id FROM channels WHERE workspace_id = $1 AND id = ANY($2::uuid[])",
    [ctx.workspace.id, channelIds]
  );
  const seats = await seatCounts(rc.client!, ctx.workspace.id, rc.cfg);
  if (!jobs.billingAvailable() && !seats) {
    throw new ApiError("billing_unavailable", "Can't check seats right now.");
  }
  const active = await rc.client!.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM people WHERE workspace_id = $1 AND NOT removed",
    [ctx.workspace.id]
  );
  const pendingInvites = await rc.client!.query<{ created_at: Date }>(
    "SELECT created_at FROM invites WHERE workspace_id = $1 AND status = 'pending'",
    [ctx.workspace.id]
  );
  let pending = 0;
  for (const row of pendingInvites.rows) {
    if (inviteStatusOf({ status: "pending", created_at: row.created_at }, rc.cfg.inviteTtlSeconds, rc.nowMs()) === "pending") {
      pending++;
    }
  }
  // The seat check needs the confirmed limit, read fresh.
  let limit: number;
  try {
    const state = await billing.readBillingState(rc.cfg, ctx.workspace.id, ctx.workspace.name, ctx.workspace.seat_limit);
    limit = state.limit;
  } catch {
    throw new ApiError("billing_unavailable", "Can't check seats right now.");
  }
  if (Number(active.rows[0].n) + pending >= limit) {
    throw new ApiError("workspace_full", "No free seats. Add a seat before inviting.");
  }
  const existingPerson = await rc.client!.query<{ id: string }>(
    "SELECT id FROM people WHERE lower(email) = lower($1) AND workspace_id = $2 AND NOT removed",
    [email, ctx.workspace.id]
  );
  if (existingPerson.rows.length > 0) {
    throw new ApiError("already_member", "That email is already in this workspace.");
  }
  const existingInvite = await rc.client!.query<{ id: string; created_at: Date; status: string }>(
    "SELECT id, created_at, status FROM invites WHERE workspace_id = $1 AND lower(email) = lower($2) AND status = 'pending'",
    [ctx.workspace.id, email]
  );
  for (const row of existingInvite.rows) {
    if (inviteStatusOf({ status: "pending", created_at: row.created_at }, rc.cfg.inviteTtlSeconds, rc.nowMs()) === "pending") {
      throw new ApiError("invite_pending", "That email already has a pending invite.");
    }
  }
  const id = uuid();
  await rc.client!.query(
    "INSERT INTO invites (id, workspace_id, email, role, project_ids, channel_ids, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)",
    [id, ctx.workspace.id, email, role, projects.rows.map((r) => r.id), channels.rows.map((r) => r.id), store.isoNow()]
  );
  await mail.queueMail(rc.client!, {
    workspaceId: ctx.workspace.id,
    kind: "invite",
    toEmail: email,
    subject: `You're invited to ${ctx.workspace.name} on Tallyroom`,
    body: `${ctx.person.name} has invited you to ${ctx.workspace.name} on Tallyroom. Sign in or create an account at ${rc.cfg.publicUrl} with the address this email was sent to.`,
    refTable: "invites",
    refId: id,
  });
  const row = await rc.client!.query<{ id: string; email: string; role: string; project_ids: string[]; channel_ids: string[]; status: string; created_at: Date }>(
    "SELECT id, email, role, project_ids, channel_ids, status, created_at FROM invites WHERE id = $1",
    [id]
  );
  return {
    status: 201,
    body: inviteJson(rc.client!, row.rows[0], ctx.zone, rc.cfg.inviteTtlSeconds, ctx.workspace.name, rc.nowMs()),
  };
};

const revokeInvite: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  if (ctx.role !== "owner") throw new ApiError("forbidden", "Only the owner can revoke invites.");
  const row = await rc.client!.query<{ id: string; status: string }>(
    "SELECT id, status FROM invites WHERE id = $1 AND workspace_id = $2",
    [rc.params.id, ctx.workspace.id]
  );
  if (row.rows.length === 0) throw new ApiError("not_found", "That item doesn't exist or isn't shared with you.");
  if (row.rows[0].status !== "pending") throw new ApiError("invite_not_pending", "That invite isn't pending.");
  await rc.client!.query("UPDATE invites SET status = 'revoked' WHERE id = $1", [rc.params.id]);
  await rc.client!.query("DELETE FROM outbox WHERE ref_table = 'invites' AND ref_id = $1 AND status = 'held'", [rc.params.id]);
  const fresh = await rc.client!.query<{ id: string; email: string; role: string; project_ids: string[]; channel_ids: string[]; status: string; created_at: Date }>(
    "SELECT id, email, role, project_ids, channel_ids, status, created_at FROM invites WHERE id = $1",
    [rc.params.id]
  );
  return {
    status: 200,
    body: inviteJson(rc.client!, fresh.rows[0], ctx.zone, rc.cfg.inviteTtlSeconds, ctx.workspace.name, rc.nowMs()),
  };
};

const getMyInvites: Handler = async (rc) => {
  const person = rc.person!;
  const rows = await rc.client!.query<{ id: string; email: string; role: string; project_ids: string[]; channel_ids: string[]; status: string; created_at: Date; workspace_id: string }>(
    "SELECT i.id, i.email, i.role, i.project_ids, i.channel_ids, i.status, i.created_at, i.workspace_id FROM invites i WHERE lower(i.email) = lower($1)",
    [person.email]
  );
  const out = [];
  for (const row of rows.rows) {
    const ws = await rc.client!.query<{ name: string }>("SELECT name FROM workspaces WHERE id = $1", [row.workspace_id]);
    const states = await loadCalendarStates(rc.client!, row.workspace_id);
    const zone = states[states.length - 1]?.time_zone ?? "UTC";
    out.push(inviteJson(rc.client!, row, zone, rc.cfg.inviteTtlSeconds, ws.rows[0]?.name ?? "", rc.nowMs()));
  }
  return { status: 200, body: { invites: out } };
};

const acceptInvite: Handler = async (rc) => {
  const person = rc.person!;
  const row = await rc.client!.query<{ id: string; email: string; role: string; project_ids: string[]; channel_ids: string[]; status: string; created_at: Date; workspace_id: string }>(
    "SELECT id, email, role, project_ids, channel_ids, status, created_at, workspace_id FROM invites WHERE id = $1",
    [rc.params.id]
  );
  if (row.rows.length === 0 || row.rows[0].email.toLowerCase() !== person.email.toLowerCase()) {
    throw new ApiError("not_found", "That item doesn't exist or isn't shared with you.");
  }
  if (person.workspace_id) {
    throw new ApiError("already_in_workspace", "You're already in a workspace.");
  }
  const invite = row.rows[0];
  const status = inviteStatusOf(invite, rc.cfg.inviteTtlSeconds, rc.nowMs());
  if (status === "expired") throw new ApiError("invite_expired", "This invite has expired.");
  if (status === "revoked") throw new ApiError("invite_revoked", "This invite was withdrawn.");
  if (status === "accepted") throw new ApiError("invite_accepted", "This invite was already accepted.");
  // Accepting checks the seat limit again, with a lock so two acceptances can't both win.
  await rc.client!.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`seats:${invite.workspace_id}`]);
  let limit: number;
  try {
    const ws = await rc.client!.query<{ name: string; seat_limit: number }>(
      "SELECT name, seat_limit FROM workspaces WHERE id = $1",
      [invite.workspace_id]
    );
    const state = await billing.readBillingState(rc.cfg, invite.workspace_id, ws.rows[0].name, ws.rows[0].seat_limit);
    limit = state.limit;
  } catch {
    throw new ApiError("billing_unavailable", "We can't check seats right now.");
  }
  const active = await rc.client!.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM people WHERE workspace_id = $1 AND NOT removed",
    [invite.workspace_id]
  );
  if (Number(active.rows[0].n) >= limit) {
    throw new ApiError("workspace_full", "This workspace is full.");
  }
  await rc.client!.query("UPDATE people SET workspace_id = $1, role = $2 WHERE id = $3", [
    invite.workspace_id,
    invite.role,
    person.id,
  ]);
  await rc.client!.query("UPDATE invites SET status = 'accepted' WHERE id = $1", [invite.id]);
  if (invite.role === "member") {
    const defaults = await rc.client!.query<{ id: string }>(
      "SELECT c.id FROM channels c WHERE c.workspace_id = $1 AND c.name IN ('general','random')",
      [invite.workspace_id]
    );
    for (const channel of defaults.rows) {
      await rc.client!.query(
        "INSERT INTO channel_members (channel_id, person_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        [channel.id, person.id]
      );
      const newest = await rc.client!.query<{ id: string }>(
        "SELECT id FROM messages WHERE channel_id = $1 ORDER BY id DESC LIMIT 1",
        [channel.id]
      );
      if (newest.rows.length > 0) {
        await store.markReadUpTo(rc.client!, person.id, "channel", channel.id, Number(newest.rows[0].id));
      }
    }
  } else {
    for (const channelId of invite.channel_ids ?? []) {
      await rc.client!.query(
        "INSERT INTO channel_members (channel_id, person_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        [channelId, person.id]
      );
      const newest = await rc.client!.query<{ id: string }>(
        "SELECT id FROM messages WHERE channel_id = $1 ORDER BY id DESC LIMIT 1",
        [channelId]
      );
      if (newest.rows.length > 0) {
        await store.markReadUpTo(rc.client!, person.id, "channel", channelId, Number(newest.rows[0].id));
      }
    }
    for (const projectId of invite.project_ids ?? []) {
      await rc.client!.query(
        "INSERT INTO project_guests (project_id, person_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        [projectId, person.id]
      );
    }
  }
  const freshPerson = await loadPerson(rc.client!, person.id);
  const workspace = await workspaceOf(rc.client!, invite.workspace_id, freshPerson!, rc.cfg);
  return { status: 200, body: { person: personJson(freshPerson!), workspace } };
};

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

async function billingJson(rc: RouteContext, ctx: Ctx, state: billing.BillingState, billingStatus: "ok" | "unavailable"): Promise<unknown> {
  const active = await rc.client!.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM people WHERE workspace_id = $1 AND NOT removed",
    [ctx.workspace.id]
  );
  const pendingRows = await rc.client!.query<{ created_at: Date }>(
    "SELECT created_at FROM invites WHERE workspace_id = $1 AND status = 'pending'",
    [ctx.workspace.id]
  );
  let pending = 0;
  for (const row of pendingRows.rows) {
    if (inviteStatusOf({ status: "pending", created_at: row.created_at }, rc.cfg.inviteTtlSeconds, rc.nowMs()) === "pending") {
      pending++;
    }
  }
  return {
    limit: state.limit,
    active: Number(active.rows[0].n),
    pending,
    price_per_seat: "8.00",
    currency: "USD",
    monthly_total: (state.limit * 8).toFixed(2),
    billing_status: billingStatus,
    account_external_key: `tallyroom-${ctx.workspace.id}`,
    scheduled_limit: state.scheduledLimit,
    scheduled_on: state.scheduledOn,
  };
}

const getBilling: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  if (ctx.role !== "owner") throw new ApiError("forbidden", "Only the owner can see billing.");
  try {
    const states = await loadCalendarStates(rc.client!, ctx.workspace.id);
    const today = partsFor(states[0].time_zone, rc.nowMs()).date;
    let state = await billing.readBillingState(rc.cfg, ctx.workspace.id, ctx.workspace.name, ctx.workspace.seat_limit);
    if (state.scheduledOn !== null && state.scheduledLimit !== null && state.scheduledOn <= today) {
      state = await billing.applyScheduledReduction(rc.cfg, ctx.workspace.id, ctx.workspace.name, ctx.workspace.seat_limit, today);
    }
    if (state.limit !== ctx.workspace.seat_limit) {
      await rc.client!.query("UPDATE workspaces SET seat_limit = $1 WHERE id = $2", [state.limit, ctx.workspace.id]);
    }
    return { status: 200, body: await billingJson(rc, ctx, state, jobs.billingAvailable() ? "ok" : "unavailable") };
  } catch (e) {
    if (e instanceof billing.BillingUnavailable) {
      const state = billing.lastKnown(ctx.workspace.id, ctx.workspace.seat_limit);
      return {
        status: 200,
        body: await billingJson(rc, ctx, state, "unavailable"),
      };
    }
    throw e;
  }
};

const putSeats: Handler = async (rc) => {
  const ctx = await ctxOf(rc);
  if (ctx.role !== "owner") throw new ApiError("forbidden", "Only the owner can change seats.");
  const body = rc.body as Record<string, unknown>;
  const seats = Number(body.seats);
  if (!Number.isInteger(seats) || seats < 1 || seats > 40) {
    throw new ApiError("validation", "Choose between 1 and 40 seats.", { seats: "Choose between 1 and 40 seats." });
  }
  const active = await rc.client!.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM people WHERE workspace_id = $1 AND NOT removed",
    [ctx.workspace.id]
  );
  if (seats < Number(active.rows[0].n)) {
    throw new ApiError("seats_below_active", "You have people in this workspace. Remove someone before lowering seats below that.");
  }
  let state: billing.BillingState;
  try {
    const current = await billing.readBillingState(rc.cfg, ctx.workspace.id, ctx.workspace.name, ctx.workspace.seat_limit);
    if (seats > current.limit) {
      state = await billing.raiseSeats(rc.cfg, ctx.workspace.id, ctx.workspace.name, seats, ctx.workspace.seat_limit);
    } else if (seats < current.limit) {
      state = await billing.scheduleReduction(rc.cfg, ctx.workspace.id, ctx.workspace.name, seats, ctx.workspace.seat_limit);
    } else {
      state = await billing.clearSchedule(rc.cfg, ctx.workspace.id, ctx.workspace.name, ctx.workspace.seat_limit);
    }
  } catch (e) {
    if (e instanceof billing.BillingUnavailable) {
      console.error("seat change failed:", e.message);
      throw new ApiError("billing_unavailable", "Seat limit not changed. It stays at the current limit until billing is back.");
    }
    throw e;
  }
  if (state.limit !== ctx.workspace.seat_limit) {
    await rc.client!.query("UPDATE workspaces SET seat_limit = $1 WHERE id = $2", [state.limit, ctx.workspace.id]);
  }
  return { status: 200, body: await billingJson(rc, ctx, state, "ok") };
};

// ---------------------------------------------------------------------------
// Health and status
// ---------------------------------------------------------------------------

const getHealth: Handler = async () => {
  return { status: 200, body: { status: "ok" } };
};

const getStatus: Handler = async (rc) => {
  const states = jobs.serviceStates();
  let held: number | null = null;
  if (states.database) {
    const person = rc.person;
    try {
      if (person && person.role === "owner") {
        held = await mail.countHeld();
      }
    } catch {
      held = null;
    }
  }
  return {
    status: 200,
    body: {
      database: states.database ? "ok" : "unavailable",
      mail: states.database ? (await mailDelayed(rc) ? "delayed" : "ok") : "unavailable",
      storage: states.storage ? "ok" : "unavailable",
      billing: states.billing ? "ok" : "unavailable",
      held_mail: held,
    },
  };
};

async function mailDelayed(rc: RouteContext): Promise<boolean> {
  try {
    const held = await mail.countHeld();
    return held > 0;
  } catch {
    return false;
  }
  void rc;
}

// ---------------------------------------------------------------------------
// Route table and dispatcher
// ---------------------------------------------------------------------------

const routes: Route[] = [
  { method: "GET", pattern: "/api/health", handler: getHealth, auth: "public" },
  { method: "GET", pattern: "/api/status", handler: getStatus, auth: "public" },
  { method: "POST", pattern: "/api/accounts", handler: createAccount, auth: "public" },
  { method: "POST", pattern: "/api/session", handler: signIn, auth: "public" },
  { method: "DELETE", pattern: "/api/session", handler: signOut, auth: "any" },
  { method: "GET", pattern: "/api/me", handler: me, auth: "any" },
  { method: "POST", pattern: "/api/account/password", handler: changePassword, auth: "any" },
  { method: "GET", pattern: "/api/workspace", handler: getWorkspace, auth: "any" },
  { method: "PUT", pattern: "/api/workspace/calendar", handler: putCalendar, auth: "owner" },
  { method: "GET", pattern: "/api/cycles/current", handler: getCyclesCurrent, auth: "any" },
  { method: "GET", pattern: "/api/cycles/{number}", handler: getCycle, auth: "any" },
  { method: "GET", pattern: "/api/projects", handler: getProjects, auth: "any" },
  { method: "POST", pattern: "/api/projects/{id}/members", handler: postProjectMember, auth: "owner" },
  { method: "DELETE", pattern: "/api/projects/{id}/members/{personId}", handler: deleteProjectMember, auth: "owner" },
  { method: "GET", pattern: "/api/issues", handler: getIssues, auth: "any" },
  { method: "POST", pattern: "/api/issues", handler: postIssue, auth: "any" },
  { method: "GET", pattern: "/api/issues/{key}", handler: getIssue, auth: "any" },
  { method: "PATCH", pattern: "/api/issues/{key}", handler: patchIssue, auth: "any" },
  { method: "POST", pattern: "/api/issues/{key}/transition", handler: transitionIssueHandler, auth: "any" },
  { method: "POST", pattern: "/api/issues/{key}/attachments", handler: postIssueAttachment, auth: "any" },
  { method: "GET", pattern: "/api/channels", handler: getChannels, auth: "any" },
  { method: "GET", pattern: "/api/channels/{id}/messages", handler: getChannelMessages, auth: "any" },
  { method: "POST", pattern: "/api/channels/{id}/messages", handler: postMessage, auth: "any" },
  { method: "GET", pattern: "/api/messages/{id}/thread", handler: getThread, auth: "any" },
  { method: "DELETE", pattern: "/api/messages/{id}", handler: deleteMessageHandler, auth: "any" },
  { method: "POST", pattern: "/api/channels/{id}/read", handler: markChannelRead, auth: "any" },
  { method: "POST", pattern: "/api/threads/{id}/read", handler: markThreadRead, auth: "any" },
  { method: "GET", pattern: "/api/unread", handler: getUnread, auth: "any" },
  { method: "GET", pattern: "/api/inbox", handler: getInbox, auth: "any" },
  { method: "POST", pattern: "/api/channels/{id}/typing", handler: postTyping, auth: "any" },
  { method: "POST", pattern: "/api/channels/{id}/members", handler: postChannelMember, auth: "owner" },
  { method: "DELETE", pattern: "/api/channels/{id}/members/{personId}", handler: deleteChannelMember, auth: "owner" },
  { method: "GET", pattern: "/api/docs", handler: getDocs, auth: "any" },
  { method: "POST", pattern: "/api/docs", handler: postDoc, auth: "any" },
  { method: "GET", pattern: "/api/docs/{id}", handler: getDoc, auth: "any" },
  { method: "PUT", pattern: "/api/docs/{id}", handler: putDoc, auth: "any" },
  { method: "GET", pattern: "/api/docs/{id}/versions", handler: getDocVersions, auth: "any" },
  { method: "POST", pattern: "/api/docs/{id}/restore", handler: postDocRestore, auth: "any" },
  { method: "POST", pattern: "/api/docs/{id}/attachments", handler: postDocAttachment, auth: "any" },
  { method: "POST", pattern: "/api/messages/{id}/attachments", handler: postMessageAttachment, auth: "any" },
  { method: "GET", pattern: "/api/attachments/{id}", handler: getAttachment, auth: "any" },
  { method: "GET", pattern: "/api/floor", handler: getFloor, auth: "any" },
  { method: "POST", pattern: "/api/rooms/{id}/join", handler: postJoinRoom, auth: "any" },
  { method: "POST", pattern: "/api/rooms/leave", handler: postLeaveRoom, auth: "any" },
  { method: "POST", pattern: "/api/presence/heartbeat", handler: postPresence, auth: "any" },
  { method: "POST", pattern: "/api/rooms/{id}/knocks", handler: postKnock, auth: "any" },
  { method: "GET", pattern: "/api/rooms/{id}/knocks/mine", handler: getMyKnock, auth: "any" },
  { method: "GET", pattern: "/api/rooms/{id}/knocks", handler: getRoomKnocks, auth: "any" },
  { method: "GET", pattern: "/api/knocks/{id}", handler: getKnock, auth: "any" },
  { method: "POST", pattern: "/api/knocks/{id}/answer", handler: answerKnock, auth: "any" },
  { method: "GET", pattern: "/api/members", handler: getMembers, auth: "any" },
  { method: "DELETE", pattern: "/api/members/{id}", handler: removeMember, auth: "owner" },
  { method: "GET", pattern: "/api/invites", handler: getInvites, auth: "owner" },
  { method: "POST", pattern: "/api/invites", handler: postInvite, auth: "owner" },
  { method: "DELETE", pattern: "/api/invites/{id}", handler: revokeInvite, auth: "owner" },
  { method: "GET", pattern: "/api/invites/mine", handler: getMyInvites, auth: "any" },
  { method: "POST", pattern: "/api/invites/{id}/accept", handler: acceptInvite, auth: "any" },
  { method: "GET", pattern: "/api/billing", handler: getBilling, auth: "owner" },
  { method: "PUT", pattern: "/api/billing/seats", handler: putSeats, auth: "owner" },
];

function matchRoute(method: string, path: string): { route: Route; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    const rp = route.pattern.split("/").filter(Boolean);
    const pp = path.split("/").filter(Boolean);
    if (rp.length !== pp.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < rp.length; i++) {
      if (rp[i].startsWith("{") && rp[i].endsWith("}")) {
        params[rp[i].slice(1, -1)] = decodeURIComponent(pp[i]);
      } else if (rp[i] !== pp[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return null;
}

const IDEMPOTENT_ENDPOINTS = new Set(["POST /api/channels/{id}/messages", "POST /api/invites", "PUT /api/billing/seats"]);

interface IdempotentResult {
  status: number;
  body: unknown;
  replay: boolean;
}

/**
 * The idempotency record: one stored response per person, endpoint and key.
 * A repeat with the same body replays; a different body answers idempotency_conflict.
 * A 503 is never stored, so a retry after an outage runs normally.
 */
async function runIdempotent(
  rc: RouteContext,
  endpointPattern: string,
  key: string,
  bodyHash: string,
  run: () => Promise<IdempotentResult>
): Promise<IdempotentResult & { replayHeader?: boolean }> {
  const client = rc.client!;
  const inserted = await client.query(
    `INSERT INTO idempotency (key, person_id, endpoint, body_hash, status, response, created_at)
     VALUES ($1,$2,$3,$4,0,'null'::jsonb,$5)
     ON CONFLICT DO NOTHING`,
    [key, rc.person!.id, endpointPattern, bodyHash, store.isoNow()]
  );
  if (inserted.rowCount === 0) {
    // Another request holds this key: wait for its row and compare the body.
    const existing = await client.query<{ body_hash: string; status: number; response: unknown }>(
      "SELECT body_hash, status, response FROM idempotency WHERE person_id = $1 AND endpoint = $2 AND key = $3 FOR UPDATE",
      [rc.person!.id, endpointPattern, key]
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      if (row.body_hash !== bodyHash) {
        throw new ApiError("idempotency_conflict", "That idempotency key was used with a different body.");
      }
      if (row.status === 0) {
        // The holder is still running; treat as a replay of nothing yet.
        throw new ApiError("validation", "Try again in a moment.");
      }
      const stored = row.response as { status: number; body: unknown };
      return { status: stored.status, body: stored.body, replay: true, replayHeader: true };
    }
    // The row vanished (expired); run normally.
  }
  const result = await run();
  if (result.status === 503) {
    await client.query("DELETE FROM idempotency WHERE person_id = $1 AND endpoint = $2 AND key = $3", [
      rc.person!.id,
      endpointPattern,
      key,
    ]);
    return result;
  }
  await client.query(
    "UPDATE idempotency SET status = $1, response = $2 WHERE person_id = $3 AND endpoint = $4 AND key = $5",
    [result.status, JSON.stringify({ status: result.status, body: result.body }), rc.person!.id, endpointPattern, key]
  );
  return result;
}

/**
 * The API entry point. Error precedence:
 * body checks, database, unauthenticated, replay, not_found, forbidden, validation.
 */
export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: Config,
  rawBody: Buffer,
  cookies: Record<string, string>
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const method = (req.method ?? "GET").toUpperCase();
  const matched = matchRoute(method, url.pathname);
  if (!matched) {
    writeJson(res, 404, { error: { code: "not_found", message: "That path doesn't exist." } });
    return;
  }
  const { route, params } = matched;
  let body: unknown = {};
  if (rawBody.length > 0) {
    if (route.pattern === "/api/issues/{key}/attachments" || route.pattern === "/api/messages/{id}/attachments" || route.pattern === "/api/docs/{id}/attachments") {
      body = { file: parseMultipart(rawBody, req.headers["content-type"] ?? "").file };
    } else {
      try {
        body = JSON.parse(rawBody.toString("utf8"));
      } catch {
        writeJson(res, 422, { error: { code: "validation", message: "The request body is not valid JSON." } });
        return;
      }
    }
  }
  const events: number[] = [];
  let person: PersonRow | null = null;
  await withClient(async (client) => {
    // Presence refresh: any request counts as activity.
    const token = cookies["tr_session"];
    if (token) {
      const session = await client.query<{ person_id: string }>(
        "SELECT person_id FROM sessions WHERE token = $1",
        [token]
      );
      if (session.rows.length > 0) {
        const loaded = await loadPerson(client, session.rows[0].person_id);
        if (loaded && !loaded.removed) {
          person = loaded;
          if (loaded.workspace_id) {
            await client.query(
              `INSERT INTO presence (person_id, workspace_id, status, last_heartbeat) VALUES ($1,$2,'active',$3)
               ON CONFLICT (person_id) DO UPDATE SET last_heartbeat = EXCLUDED.last_heartbeat`,
              [loaded.id, loaded.workspace_id, store.isoNow()]
            );
          }
        }
      }
    }
    const rc: RouteContext = {
      cfg,
      person,
      params,
      url,
      req,
      res,
      body,
      client,
      events,
      headers: req.headers,
      cookies: () => cookies,
      nowMs: () => nowMs(),
    };
    if (route.auth !== "public" && !person) {
      throw new ApiError("unauthenticated", "Sign in again.");
    }
    if (route.auth === "owner" && person && person.role !== "owner") {
      // Signed-in person without a workspace, or a non-owner: forbidden.
      throw new ApiError("forbidden", "Only the owner can do that.");
    }
    if (route.auth === "any" && person && !person.workspace_id && !["/api/me", "/api/account/password", "/api/invites/mine", "/api/session", "/api/status", "/api/invites/{id}/accept"].includes(route.pattern)) {
      throw new ApiError("forbidden", "Join a workspace first.");
    }

    // Idempotency, after authentication.
    const endpointKey = `${route.method} ${route.pattern}`;
    const handler = route.handler;
    let result: { status: number; body?: unknown; raw?: Buffer; headers?: Record<string, string>; replayHeader?: boolean };
    if (IDEMPOTENT_ENDPOINTS.has(endpointKey)) {
      const key = (req.headers["idempotency-key"] as string | undefined)?.slice(0, 100) ?? null;
      if (key && key.length > 0) {
        const bodyHash = sha256(rawBody.toString("utf8"));
        const run = async (): Promise<IdempotentResult> => {
          const r = await handler({ ...rc, params: { ...params } });
          if (r && typeof r === "object" && "status" in r) {
            return { status: (r as { status: number }).status, body: (r as { body?: unknown }).body, replay: false };
          }
          return { status: 204, body: null, replay: false };
        };
        const idem = await runIdempotent(rc, endpointKey, key, bodyHash, run);
        result = { status: idem.status, body: idem.body, replayHeader: idem.replayHeader };
      } else {
        result = (await handler(rc)) as typeof result;
      }
    } else {
      result = (await handler(rc)) as typeof result;
    }
    if (result && result.raw !== undefined) {
      res.writeHead(result.status, result.headers);
      res.end(result.raw);
    } else if (result.status === 204) {
      res.writeHead(204);
      res.end();
    } else {
      writeJson(res, result.status, result.body ?? {}, result.replayHeader ? { "Idempotent-Replay": "true" } : undefined);
    }
  }).catch((err: unknown) => {
    respondWithError(res, err);
  });
}

function respondWithError(res: ServerResponse, err: unknown): void {
  if (res.writableEnded) return;
  if (err instanceof ApiError) {
    writeError(res, err);
    return;
  }
  if (err instanceof billing.BillingUnavailable) {
    writeError(res, new ApiError("billing_unavailable", "Billing is unavailable."));
    return;
  }
  if (err instanceof storage.StorageUnavailable) {
    writeError(res, new ApiError("storage_unavailable", "Storage is unavailable."));
    return;
  }
  writeError(res, new ApiError("database_unavailable", "The database is unreachable."));
}

/** The status body, computed without the database when it is down. */
export function statusBody(cfg: Config, isOwner: boolean | null, held: number | null): Record<string, unknown> {
  const states = jobs.serviceStates();
  const mailState = !states.database
    ? mail.lastFailureRecent()
      ? "delayed"
      : "ok"
    : held !== null
      ? held > 0 || mail.lastFailureRecent()
        ? "delayed"
        : "ok"
      : mail.lastFailureRecent()
        ? "delayed"
        : "ok";
  return {
    database: states.database ? "ok" : "unavailable",
    mail: mailState,
    storage: states.storage ? "ok" : "unavailable",
    billing: states.billing ? "ok" : "unavailable",
    held_mail: isOwner && states.database ? held : null,
  };
}
