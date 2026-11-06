import type { Client } from "./db.ts";
import { uuid } from "./ids.ts";
import { nowMs } from "./clock.ts";
import { ApiError } from "./errors.ts";
import type { Ctx } from "./scope.ts";
import { visibleScope } from "./scope.ts";
import { STATUS_EDGES, issueByKeyVisible, type IssueRow } from "./domain.ts";
import {
  calendarEffectiveOn,
  currentCycleNumber,
  isCounted,
  nextCountedDay,
  cycleSpan,
  type CalendarState,
} from "./calendar.ts";
import { instantInZone, localMidnightInstant } from "./tz.ts";
import { codePointLength, isBlank, isUnstorableText, parseDate } from "./text.ts";
import { queueMail } from "./mail.ts";

export function isoNow(): string {
  return new Date(nowMs()).toISOString();
}

/** Store one event row and notify, inside the caller's transaction. */
export async function emitEvent(
  client: Client,
  workspaceId: string,
  name: string,
  data: unknown
): Promise<number> {
  const res = await client.query<{ id: string }>(
    "INSERT INTO events (workspace_id, name, data, created_at) VALUES ($1,$2,$3,$4) RETURNING id",
    [workspaceId, name, JSON.stringify(data), isoNow()]
  );
  const id = Number(res.rows[0].id);
  await client.query("SELECT pg_notify('tally_events', $1)", [JSON.stringify({ ids: [id] })]);
  return id;
}

/** The current cycle number, from the calendar states and the server clock. */
export function currentCycle(states: CalendarState[], now: number): number {
  return currentCycleNumber(states, now);
}

/** The span of one cycle: its 10 counted dates and the next cycle's first counted date. */
export function cycleDates(states: CalendarState[], firstCounted: string): { countedDates: string[]; nextFirst: string } {
  return cycleSpan(states, firstCounted);
}

/** The calendar in effect on a date: the single decision point for counted days. */
export function calendarForDate(states: CalendarState[], date: string): CalendarState {
  return calendarEffectiveOn(states, date);
}

/** The instant a cycle boundary lands on: local midnight, resolving clock changes. */
export function cycleBoundary(states: CalendarState[], date: string): number {
  return localMidnightInstant(calendarEffectiveOn(states, date).time_zone, date);
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export interface CreateIssueBody {
  project_id: string;
  title: string;
  description: string;
  assignee_id: string | null;
  parent_key: string | null;
  cycle_number: number | null;
  due_date: string | null;
}

export async function createIssue(ctx: Ctx, body: CreateIssueBody, events: number[]): Promise<IssueRow> {
  const { client, workspace } = ctx;
  if (typeof body.title !== "string" || isBlank(body.title)) {
    throw new ApiError("validation", "Give the issue a title.", { title: "Give the issue a title." });
  }
  if (isUnstorableText(body.title)) {
    throw new ApiError("validation", "That text cannot be stored.", { title: "That text cannot be stored." });
  }
  if (codePointLength(body.title) > 200) {
    throw new ApiError("validation", "Titles can be up to 200 characters.", { title: "Titles can be up to 200 characters." });
  }
  const description = body.description ?? "";
  if (typeof description !== "string" || isUnstorableText(description)) {
    throw new ApiError("validation", "That text cannot be stored.", { description: "That text cannot be stored." });
  }
  if (codePointLength(description) > 20000) {
    throw new ApiError("validation", "Descriptions can be up to 20,000 characters.", { description: "Descriptions can be up to 20,000 characters." });
  }
  const scope = await visibleScope(ctx);
  if (!scope.projectIds.has(body.project_id)) {
    throw new ApiError("not_found", "That project doesn't exist or isn't shared with you.");
  }
  if (body.assignee_id && !scope.personIds.has(body.assignee_id)) {
    throw new ApiError("validation", "That person can't be assigned.", { assignee_id: "That person can't be assigned." });
  }
  let parentId: string | null = null;
  if (body.parent_key) {
    const parent = await issueByKeyVisible(ctx, scope, body.parent_key);
    if (!parent || parent.parent_id || parent.project_id !== body.project_id) {
      throw new ApiError("validation", "The parent must be a top-level issue in the same project.", { parent_key: "The parent must be a top-level issue in the same project." });
    }
    parentId = parent.id;
  }
  let cycleNumber: number | null = null;
  if (body.cycle_number !== null && body.cycle_number !== undefined) {
    const n = Number(body.cycle_number);
    if (!Number.isInteger(n) || n < 1 || n > 1000) {
      throw new ApiError("validation", "That cycle doesn't exist.", { cycle_number: "That cycle doesn't exist." });
    }
    if (n < currentCycle(ctx.states, ctx.now)) {
      throw new ApiError("cycle_closed", `Cycle ${n} has ended.`);
    }
    cycleNumber = n;
  }
  let dueDate: string | null = null;
  if (body.due_date !== null && body.due_date !== undefined) {
    const parsed = parseDate(body.due_date);
    if (!parsed) {
      throw new ApiError("validation", "Enter a date as YYYY-MM-DD.", { due_date: "Enter a date as YYYY-MM-DD." });
    }
    const cal = calendarForDate(ctx.states, parsed);
    dueDate = isCounted(cal, parsed) ? parsed : nextCountedDay(cal, parsed);
  }
  const number = await nextIssueNumber(client, body.project_id);
  const id = uuid();
  await client.query(
    `INSERT INTO issues (id, workspace_id, project_id, number, title, description, status, assignee_id, parent_id, cycle_number, due_date, closed_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,'backlog',$7,$8,$9,$10,null,$11,$11)`,
    [id, workspace.id, body.project_id, number, body.title, description, body.assignee_id ?? null, parentId, cycleNumber, dueDate, isoNow()]
  );
  const row = (await loadIssueRow(client, id))!;
  events.push(await emitIssueEvent(ctx, row));
  return row;
}

export async function nextIssueNumber(client: Client, projectId: string): Promise<number> {
  // Simultaneous creates never share a number: lock on the project id.
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [projectId]);
  const res = await client.query<{ n: string }>(
    "SELECT coalesce(max(number), 0) + 1 AS n FROM issues WHERE project_id = $1",
    [projectId]
  );
  return Number(res.rows[0].n);
}

export async function loadIssueRow(client: Client, id: string): Promise<IssueRow | null> {
  const res = await client.query<IssueRow>(
    `SELECT i.id, i.project_id, p.key AS project_key, i.number, i.title, i.description,
            i.status, i.assignee_id, i.parent_id, pi.number AS parent_number, i.cycle_number,
            i.due_date, i.closed_at
     FROM issues i JOIN projects p ON p.id = i.project_id
     LEFT JOIN issues pi ON pi.id = i.parent_id
     WHERE i.id = $1`,
    [id]
  );
  return res.rows[0] ?? null;
}

export async function emitIssueEvent(ctx: Ctx, row: IssueRow): Promise<number> {
  return emitEvent(ctx.client, ctx.workspace.id, "issue", { key: `${row.project_key}-${row.number}`, id: row.id });
}

/** A parent cannot be done while any sub-issue is still open. */
export async function transitionIssue(ctx: Ctx, row: IssueRow, to: string, events: number[]): Promise<IssueRow> {
  const legal = STATUS_EDGES[row.status] ?? [];
  if (!legal.includes(to)) {
    throw new ApiError("illegal_transition", "That move isn't allowed.");
  }
  if (to === "done" || to === "cancelled") {
    const open = await ctx.client.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM issues WHERE parent_id = $1 AND status NOT IN ('done','cancelled')",
      [row.id]
    );
    if (Number(open.rows[0].n) > 0) {
      throw new ApiError("open_sub_issues", "This issue has open sub-issues.");
    }
  }
  const closedAt = to === "done" || to === "cancelled" ? isoNow() : null;
  await ctx.client.query(
    "UPDATE issues SET status = $1, closed_at = $2, updated_at = $3 WHERE id = $4",
    [to, closedAt, isoNow(), row.id]
  );
  const fresh = (await loadIssueRow(ctx.client, row.id))!;
  events.push(await emitIssueEvent(ctx, fresh));
  return fresh;
}

export async function assignIssue(ctx: Ctx, row: IssueRow, assigneeId: string | null, events: number[]): Promise<IssueRow> {
  if (assigneeId) {
    const person = await ctx.client.query<{ id: string }>(
      "SELECT id FROM people WHERE id = $1 AND workspace_id = $2 AND NOT removed",
      [assigneeId, ctx.workspace.id]
    );
    if (person.rows.length === 0) {
      throw new ApiError("validation", "That person can't be assigned.", { assignee_id: "That person can't be assigned." });
    }
  }
  await ctx.client.query("UPDATE issues SET assignee_id = $1, updated_at = $2 WHERE id = $3", [
    assigneeId,
    isoNow(),
    row.id,
  ]);
  const fresh = (await loadIssueRow(ctx.client, row.id))!;
  events.push(await emitIssueEvent(ctx, fresh));
  return fresh;
}

export interface DueDateResult {
  row: IssueRow;
  snapped: boolean;
}

export async function setDueDate(ctx: Ctx, row: IssueRow, dueDate: string | null, events: number[]): Promise<DueDateResult> {
  let stored: string | null = null;
  let snapped = false;
  if (dueDate !== null) {
    const parsed = parseDate(dueDate);
    if (!parsed) {
      throw new ApiError("validation", "Enter a date as YYYY-MM-DD.", { due_date: "Enter a date as YYYY-MM-DD." });
    }
    const cal = calendarForDate(ctx.states, parsed);
    if (isCounted(cal, parsed)) {
      stored = parsed;
    } else {
      stored = nextCountedDay(cal, parsed);
      snapped = true;
    }
  }
  await ctx.client.query("UPDATE issues SET due_date = $1, updated_at = $2 WHERE id = $3", [
    stored,
    isoNow(),
    row.id,
  ]);
  const fresh = (await loadIssueRow(ctx.client, row.id))!;
  events.push(await emitIssueEvent(ctx, fresh));
  return { row: fresh, snapped };
}

export async function setIssueCycle(ctx: Ctx, row: IssueRow, cycleNumber: number | null, events: number[]): Promise<IssueRow> {
  if (cycleNumber !== null) {
    if (!Number.isInteger(cycleNumber) || cycleNumber < 1 || cycleNumber > 1000) {
      throw new ApiError("validation", "That cycle doesn't exist.", { cycle_number: "That cycle doesn't exist." });
    }
    if (cycleNumber < currentCycle(ctx.states, ctx.now)) {
      throw new ApiError("cycle_closed", `Cycle ${cycleNumber} has ended.`);
    }
  }
  await ctx.client.query("UPDATE issues SET cycle_number = $1, updated_at = $2 WHERE id = $3", [
    cycleNumber,
    isoNow(),
    row.id,
  ]);
  const fresh = (await loadIssueRow(ctx.client, row.id))!;
  events.push(await emitIssueEvent(ctx, fresh));
  return fresh;
}

export async function patchIssueText(
  ctx: Ctx,
  row: IssueRow,
  patch: { title?: string; description?: string },
  events: number[]
): Promise<IssueRow> {
  if (patch.title !== undefined) {
    if (typeof patch.title !== "string" || isBlank(patch.title) || codePointLength(patch.title) > 200 || isUnstorableText(patch.title)) {
      throw new ApiError("validation", "Give the issue a title.", { title: "Give the issue a title." });
    }
  }
  if (patch.description !== undefined) {
    if (typeof patch.description !== "string" || codePointLength(patch.description) > 20000 || isUnstorableText(patch.description)) {
      throw new ApiError("validation", "Descriptions can be up to 20,000 characters.", { description: "Descriptions can be up to 20,000 characters." });
    }
  }
  await ctx.client.query(
    "UPDATE issues SET title = coalesce($1, title), description = coalesce($2, description), updated_at = $3 WHERE id = $4",
    [patch.title ?? null, patch.description ?? null, isoNow(), row.id]
  );
  const fresh = (await loadIssueRow(ctx.client, row.id))!;
  events.push(await emitIssueEvent(ctx, fresh));
  return fresh;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export async function channelMemberIds(client: Client, channelId: string): Promise<string[]> {
  const res = await client.query<{ person_id: string }>(
    "SELECT m.person_id FROM channel_members m JOIN people p ON p.id = m.person_id WHERE m.channel_id = $1 AND NOT p.removed",
    [channelId]
  );
  return res.rows.map((r) => r.person_id);
}

/** Mentions: @handle matched case-insensitively against members of that channel. */
export async function resolveMentions(client: Client, channelId: string, body: string): Promise<string[]> {
  const members = await client.query<{ id: string; handle: string }>(
    "SELECT p.id, p.handle FROM channel_members m JOIN people p ON p.id = m.person_id WHERE m.channel_id = $1 AND NOT p.removed",
    [channelId]
  );
  const mentioned: string[] = [];
  for (const m of members.rows) {
    const re = new RegExp(`(^|[^A-Za-z0-9_])@${escapeRegex(m.handle)}([^A-Za-z0-9_]|$)`, "i");
    if (re.test(body)) mentioned.push(m.id);
  }
  return mentioned;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function sendMessage(
  ctx: Ctx,
  channelId: string,
  bodyText: string,
  threadRootId: number | null,
  clientKey: string | null,
  events: number[]
): Promise<{ id: number; mentions: string[] }> {
  const { client } = ctx;
  if (typeof bodyText !== "string" || isBlank(bodyText)) {
    throw new ApiError("validation", "Messages can't be empty.", { body: "Messages can't be empty." });
  }
  if (isUnstorableText(bodyText)) {
    throw new ApiError("validation", "That text cannot be stored.", { body: "That text cannot be stored." });
  }
  if (codePointLength(bodyText) > 4000) {
    throw new ApiError("validation", "Messages can be up to 4000 characters.", { body: "Messages can be up to 4000 characters." });
  }
  if (threadRootId !== null) {
    const root = await client.query<{ id: string; channel_id: string; thread_root_id: string | null; deleted: boolean }>(
      "SELECT id, channel_id, thread_root_id, deleted FROM messages WHERE id = $1",
      [threadRootId]
    );
    if (root.rows.length === 0 || root.rows[0].channel_id !== channelId || root.rows[0].thread_root_id !== null || root.rows[0].deleted) {
      throw new ApiError("validation", "The thread root must be a top-level message in this channel.", { thread_root_id: "The thread root must be a top-level message in this channel." });
    }
  }
  const mentions = await resolveMentions(client, channelId, bodyText);
  const res = await client.query<{ id: string }>(
    "INSERT INTO messages (workspace_id, channel_id, author_id, body, thread_root_id, client_key, mentions, created_at, deleted) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false) RETURNING id",
    [ctx.workspace.id, channelId, ctx.person.id, bodyText, threadRootId, clientKey, mentions, isoNow()]
  );
  const id = Number(res.rows[0].id);
  await markReadUpTo(client, ctx.person.id, "channel", channelId, id);
  if (threadRootId !== null) {
    await markReadUpTo(client, ctx.person.id, "thread", String(threadRootId), id);
  }
  await client.query("DELETE FROM typing WHERE person_id = $1 AND channel_id = $2", [ctx.person.id, channelId]);
  events.push(await emitEvent(client, ctx.workspace.id, threadRootId === null ? "message" : "thread_reply", { id }));
  await emitUnreadForChannel(ctx, channelId, events);
  for (const personId of mentions) {
    if (personId === ctx.person.id) continue;
    await queueMentionMail(ctx, channelId, id, personId);
  }
  return { id, mentions };
}

export async function queueMentionMail(ctx: Ctx, channelId: string, messageId: number, personId: string): Promise<void> {
  const person = await ctx.client.query<{ email: string }>("SELECT email FROM people WHERE id = $1", [personId]);
  if (person.rows.length === 0) return;
  const channel = await ctx.client.query<{ name: string }>("SELECT name FROM channels WHERE id = $1", [channelId]);
  await queueMail(ctx.client, {
    workspaceId: ctx.workspace.id,
    kind: "mention",
    toEmail: person.rows[0].email,
    subject: `${ctx.person.name} mentioned you in #${channel.rows[0]?.name ?? ""}`,
    body: `${ctx.person.name} mentioned you in #${channel.rows[0]?.name ?? ""} on Tallyroom.`,
    refTable: "messages",
    refId: String(messageId),
  });
}

export async function markReadUpTo(client: Client, personId: string, scope: string, scopeId: string, upTo: number): Promise<void> {
  await client.query(
    `INSERT INTO read_markers (person_id, scope, scope_id, last_read) VALUES ($1,$2,$3,$4)
     ON CONFLICT (person_id, scope, scope_id) DO UPDATE SET last_read = GREATEST(read_markers.last_read, EXCLUDED.last_read)`,
    [personId, scope, scopeId, upTo]
  );
}

export async function unreadCountsFor(client: Client, personId: string): Promise<{ channels: Record<string, number>; inbox: number }> {
  const channels = await client.query<{ channel_id: string; n: string }>(
    `SELECT cm.channel_id, count(m.id)::text AS n
     FROM channel_members cm
     LEFT JOIN messages m ON m.channel_id = cm.channel_id AND m.thread_root_id IS NULL AND NOT m.deleted
       AND m.author_id <> $1 AND m.id > COALESCE((SELECT last_read FROM read_markers r WHERE r.person_id = $1 AND r.scope = 'channel' AND r.scope_id = cm.channel_id::text), 0)
     WHERE cm.person_id = $1
     GROUP BY cm.channel_id`,
    [personId]
  );
  const inbox = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM messages m
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
     )`,
    [personId]
  );
  const out: Record<string, number> = {};
  for (const row of channels.rows) out[row.channel_id] = Number(row.n);
  return { channels: out, inbox: Number(inbox.rows[0].n) };
}

export async function emitUnreadForChannel(ctx: Ctx, channelId: string, events: number[]): Promise<void> {
  const members = await channelMemberIds(ctx.client, channelId);
  await emitUnreadForPeople(ctx, members, events);
}

export async function emitUnreadForPeople(ctx: Ctx, personIds: string[], events: number[]): Promise<void> {
  for (const personId of personIds) {
    const counts = await unreadCountsFor(ctx.client, personId);
    events.push(await emitEvent(ctx.client, ctx.workspace.id, "unread", { person_id: personId, counts }));
  }
}

export async function deleteMessage(
  ctx: Ctx,
  row: { id: number; channel_id: string; thread_root_id: number | null },
  events: number[]
): Promise<void> {
  const { client } = ctx;
  const ids = await client.query<{ id: string }>(
    "SELECT id FROM messages WHERE id = $1 OR thread_root_id = $1",
    [row.id]
  );
  const idList = ids.rows.map((r) => String(r.id));
  await client.query("DELETE FROM outbox WHERE ref_table = 'messages' AND ref_id = ANY($1::text[]) AND status = 'held'", [idList]);
  await client.query("UPDATE messages SET deleted = true, deleted_at = $1 WHERE id = ANY($2::bigint[])", [isoNow(), idList.map(Number)]);
  const atts = await client.query<{ id: string; storage_key: string }>(
    "SELECT id, storage_key FROM attachments WHERE parent_type = 'message' AND parent_id = ANY($1::text[])",
    [idList]
  );
  if (atts.rows.length > 0) {
    await client.query("DELETE FROM attachments WHERE id = ANY($1::uuid[])", [atts.rows.map((a) => a.id)]);
    for (const a of atts.rows) {
      await client.query(
        "INSERT INTO attachment_deletions (id, workspace_id, storage_key, created_at) VALUES ($1,$2,$3,$4)",
        [uuid(), ctx.workspace.id, a.storage_key, isoNow()]
      );
    }
  }
  events.push(await emitEvent(client, ctx.workspace.id, "message_deleted", {
    id: row.id,
    channel_id: row.channel_id,
    thread_root_id: row.thread_root_id,
  }));
  await emitUnreadForChannel(ctx, row.channel_id, events);
}

// ---------------------------------------------------------------------------
// Docs
// ---------------------------------------------------------------------------

export interface DocRow {
  id: string;
  project_id: string;
  title: string;
  body: string;
  version: number;
  updated_by: string | null;
  updated_at: Date;
}

export async function saveDoc(
  ctx: Ctx,
  docId: string,
  title: string,
  body: string,
  baseVersion: number,
  events: number[]
): Promise<DocRow> {
  const { client } = ctx;
  if (typeof title !== "string" || isBlank(title) || codePointLength(title) > 200 || isUnstorableText(title)) {
    throw new ApiError("validation", "Give the doc a title.", { title: "Give the doc a title." });
  }
  if (typeof body !== "string" || codePointLength(body) > 200000 || isUnstorableText(body)) {
    throw new ApiError("validation", "A doc can be up to 200,000 characters.", { body: "A doc can be up to 200,000 characters." });
  }
  if (!Number.isInteger(baseVersion) || baseVersion < 1) {
    throw new ApiError("validation", "Give the base version.", { base_version: "Give the base version." });
  }
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`doc:${docId}`]);
  const current = await client.query<{ version: number }>("SELECT version FROM docs WHERE id = $1", [docId]);
  if (current.rows.length === 0) {
    throw new ApiError("not_found", "That doc doesn't exist or isn't shared with you.");
  }
  const storedVersion = current.rows[0].version;
  if (storedVersion !== baseVersion) {
    const err = new ApiError("version_conflict", "A newer version was saved.");
    err.current = await docJsonFromRow(await loadDoc(client, docId), ctx.zone);
    throw err;
  }
  const newVersion = storedVersion + 1;
  await client.query(
    "UPDATE docs SET title = $1, body = $2, version = $3, updated_by = $4, updated_at = $5 WHERE id = $6",
    [title, body, newVersion, ctx.person.id, isoNow(), docId]
  );
  await client.query(
    "INSERT INTO doc_versions (doc_id, version, title, body, saved_at, saved_by) VALUES ($1,$2,$3,$4,$5,$6)",
    [docId, newVersion, title, body, isoNow(), ctx.person.id]
  );
  const doc = await loadDoc(client, docId);
  events.push(await emitDocEvent(ctx, doc!));
  return doc!;
}

/** The conflict body carries the stored doc byte for byte as saved. */
async function docJsonFromRow(doc: DocRow | null, zone: string): Promise<Record<string, unknown> | null> {
  if (!doc) return null;
  return {
    id: doc.id,
    project_id: doc.project_id,
    title: doc.title,
    body: doc.body,
    version: doc.version,
    updated_by: doc.updated_by,
    updated_at: instantInZone(zone, Date.parse(doc.updated_at.toISOString())),
    attachments: [],
  };
}

export async function loadDoc(client: Client, docId: string): Promise<DocRow | null> {
  const res = await client.query<DocRow>(
    "SELECT id, project_id, title, body, version, updated_by, updated_at FROM docs WHERE id = $1",
    [docId]
  );
  return res.rows[0] ?? null;
}

export async function emitDocEvent(ctx: Ctx, doc: { id: string; project_id: string; version: number }): Promise<number> {
  return emitEvent(ctx.client, ctx.workspace.id, "doc", {
    id: doc.id,
    project_id: doc.project_id,
    version: doc.version,
    updated_by: ctx.person.id,
  });
}

export async function restoreDocVersion(
  ctx: Ctx,
  docId: string,
  version: number,
  baseVersion: number,
  events: number[]
): Promise<DocRow> {
  const { client } = ctx;
  if (!Number.isInteger(version) || version < 1) {
    throw new ApiError("validation", "That version doesn't exist.", { version: "That version doesn't exist." });
  }
  if (!Number.isInteger(baseVersion) || baseVersion < 1) {
    throw new ApiError("validation", "Give the base version.", { base_version: "Give the base version." });
  }
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`doc:${docId}`]);
  const current = await client.query<{ version: number }>("SELECT version FROM docs WHERE id = $1", [docId]);
  if (current.rows.length === 0) {
    throw new ApiError("not_found", "That doc doesn't exist or isn't shared with you.");
  }
  if (version === current.rows[0].version) {
    throw new ApiError("validation", "That version is the current one.", { version: "That version is the current one." });
  }
  const source = await client.query<{ title: string; body: string }>(
    "SELECT title, body FROM doc_versions WHERE doc_id = $1 AND version = $2",
    [docId, version]
  );
  if (source.rows.length === 0) {
    throw new ApiError("validation", "That version doesn't exist.", { version: "That version doesn't exist." });
  }
  if (current.rows[0].version !== baseVersion) {
    const err = new ApiError("version_conflict", "A newer version was saved.");
    err.current = await docJsonFromRow(await loadDoc(client, docId), ctx.zone);
    throw err;
  }
  const newVersion = current.rows[0].version + 1;
  await client.query(
    "UPDATE docs SET title = $1, body = $2, version = $3, updated_by = $4, updated_at = $5 WHERE id = $6",
    [source.rows[0].title, source.rows[0].body, newVersion, ctx.person.id, isoNow(), docId]
  );
  await client.query(
    "INSERT INTO doc_versions (doc_id, version, title, body, saved_at, saved_by) VALUES ($1,$2,$3,$4,$5,$6)",
    [docId, newVersion, source.rows[0].title, source.rows[0].body, isoNow(), ctx.person.id]
  );
  const doc = await loadDoc(client, docId);
  events.push(await emitDocEvent(ctx, doc!));
  return doc!;
}
