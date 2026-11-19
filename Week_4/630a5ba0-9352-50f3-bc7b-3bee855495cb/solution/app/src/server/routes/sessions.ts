import { createHash } from "node:crypto";
import type { CalendarItem } from "../../shared/types.js";
import { dayBounds, daysBetween, isTime, isoInstant, localToInstant, todayIn, wallOf } from "../../shared/time.js";
import { planner, requireWritable } from "../auth.js";
import { place } from "../columns.js";
import { config } from "../config.js";
import { sql, type Tx } from "../db.js";
import { sessionJson, touched, type SessionRow } from "../days.js";
import { HttpError, json, parseJson, route } from "../http.js";
import { expandRoutines, occurrenceItem, routinesOf } from "../routines.js";
import { dayInPast, isUuid, lockTask, versionConflict, writeReply } from "./tasks.js";
import * as check from "../validate.js";

/** A session lasts its task's estimate and must end by local midnight of its start date. */
function sessionEnd(start: number, estimate: number | null, zone: string): number {
  if (estimate === null) throw new HttpError(422, "estimate_required", "Add an estimate first.");
  const end = start + estimate * 60_000;
  if (end > dayBounds(wallOf(start, zone).date, zone).end) {
    throw new HttpError(422, "crosses_midnight", "It would run past midnight.");
  }
  return end;
}

/** Validates a requested date and start time; returns the start instant. */
function sessionStart(body: Record<string, unknown>, zone: string): number {
  check.settle({
    date: check.date(body.date),
    startTime:
      typeof body.startTime === "string" && isTime(body.startTime) && /:(00|30)$/.test(body.startTime)
        ? null
        : "Start on the hour or half hour, written as HH:MM.",
  });
  const date = String(body.date);
  if (date < todayIn(zone, Date.now())) throw dayInPast();
  return localToInstant(date, String(body.startTime), zone);
}

const SESSION_COLUMNS = sql`s.id, s.task_id, t.title, s.starts_at, s.ends_at, s.version`;

/** Canonical JSON: keys sorted at every depth (modules/idempotency). */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

type KeyRow = { fingerprint: string; status: number; body: unknown; expired: boolean };

route(
  "POST",
  "/api/sessions",
  async (ctx) => {
    const who = await planner(ctx);
    const { member } = who;
    const key = ctx.req.headers["idempotency-key"];
    if (typeof key !== "string" || key.length < 1 || key.length > 200) {
      throw new HttpError(400, "idempotency_key_required", "Send an Idempotency-Key header of 1 to 200 characters.");
    }
    const body = parseJson(ctx);
    const fingerprint = createHash("sha256")
      .update(canonicalJson({ taskId: body.taskId ?? null, date: body.date ?? null, startTime: body.startTime ?? null }))
      .digest("hex");
    const outcome = await sql.begin(async (tx) => {
      const claimed = await tx`
        INSERT INTO idempotency_keys (member_id, key, fingerprint) VALUES (${member.id}, ${key}, ${fingerprint})
        ON CONFLICT (member_id, key) DO NOTHING RETURNING key`;
      if (claimed.length === 0) {
        const [stored] = await tx<KeyRow[]>`
          SELECT fingerprint, status, body, created_at < now() - make_interval(secs => ${config.idempotencyTtlSeconds}) AS expired
          FROM idempotency_keys WHERE member_id = ${member.id} AND key = ${key} FOR UPDATE`;
        if (!stored.expired) {
          if (stored.fingerprint !== fingerprint) {
            throw new HttpError(422, "idempotency_key_mismatch", "That Idempotency-Key was already used with a different request.");
          }
          return { replayed: true, status: stored.status, body: stored.body };
        }
        await tx`UPDATE idempotency_keys SET fingerprint = ${fingerprint}, status = NULL, body = NULL, created_at = now()
                 WHERE member_id = ${member.id} AND key = ${key}`;
      }
      const taskId = typeof body.taskId === "string" && isUuid(body.taskId) ? body.taskId : null;
      if (!taskId) throw new HttpError(404, "not_found", "That task doesn't exist.");
      const task = await lockTask(tx, member.id, taskId);
      requireWritable(who.workspace);
      if (task.session) throw new HttpError(409, "already_scheduled", "It's already on the calendar.");
      const start = sessionStart(body, member.time_zone);
      const end = sessionEnd(start, task.estimate_minutes, member.time_zone);
      const date = String(body.date);
      await tx`INSERT INTO sessions (task_id, member_id, starts_at, ends_at) VALUES (${task.id}, ${member.id}, ${new Date(start)}, ${new Date(end)})`.catch(
        (error: unknown) => {
          if (error instanceof Error && "code" in error && error.code === "23505") {
            throw new HttpError(409, "already_scheduled", "It's already on the calendar.");
          }
          throw error;
        },
      );
      await tx`UPDATE tasks SET version = version + 1, updated_at = clock_timestamp() WHERE id = ${task.id}`;
      if (task.day_date !== date) await place(tx, member.id, [task.id], date, null, [task.day_date]);
      const reply = await writeReply(tx, who, task.id, touched(task.day_date, date));
      const result = { session: reply.task.session, task: reply.task, days: reply.days };
      await tx`UPDATE idempotency_keys SET status = 201, body = ${tx.json(result)}
               WHERE member_id = ${member.id} AND key = ${key}`;
      return { replayed: false, status: 201, body: result };
    });
    return json(outcome.status, outcome.body, outcome.replayed ? { "Idempotent-Replayed": "true" } : undefined);
  },
  "json",
);

async function lockSession(tx: Tx, memberId: string, sessionId: string): Promise<SessionRow> {
  // Lock order is always task, then session, as in every other write.
  const [locked] = isUuid(sessionId)
    ? await tx`SELECT t.id FROM sessions s JOIN tasks t ON t.id = s.task_id
               WHERE s.id = ${sessionId} AND s.member_id = ${memberId} FOR UPDATE OF t`
    : [];
  if (locked) await tx`SELECT id FROM sessions WHERE id = ${sessionId} FOR UPDATE`;
  const [row] = locked
    ? await tx<SessionRow[]>`SELECT ${SESSION_COLUMNS} FROM sessions s JOIN tasks t ON t.id = s.task_id WHERE s.id = ${sessionId}`
    : [];
  if (!row) throw new HttpError(404, "not_found", "That session doesn't exist.");
  return row;
}

route(
  "PATCH",
  "/api/sessions/{id}",
  async (ctx) => {
    const who = await planner(ctx);
    const { member } = who;
    const reply = await sql.begin(async (tx) => {
      const session = await lockSession(tx, member.id, ctx.params.id);
      requireWritable(who.workspace);
      const body = parseJson(ctx);
      if (body.version !== session.version) {
        if (typeof body.version !== "number") check.settle({ version: "Send the version this move is based on." });
        throw versionConflict(sessionJson(session, member.time_zone));
      }
      const start = sessionStart(body, member.time_zone);
      const [task] = await tx<{ estimate_minutes: number | null; day_date: string | null }[]>`
        SELECT estimate_minutes, to_char(day_date, 'YYYY-MM-DD') AS day_date FROM tasks WHERE id = ${session.task_id} FOR UPDATE`;
      const end = sessionEnd(start, task.estimate_minutes, member.time_zone);
      const date = String(body.date);
      await tx`UPDATE sessions SET starts_at = ${new Date(start)}, ends_at = ${new Date(end)}, version = version + 1 WHERE id = ${session.id}`;
      if (task.day_date !== date) {
        await tx`UPDATE tasks SET version = version + 1, updated_at = clock_timestamp() WHERE id = ${session.task_id}`;
        await place(tx, member.id, [session.task_id], date, null, [task.day_date]);
      }
      const written = await writeReply(tx, who, session.task_id, touched(task.day_date, date));
      return { session: written.task.session, task: written.task, days: written.days };
    });
    return json(200, reply);
  },
  "json",
);

route("DELETE", "/api/sessions/{id}", async (ctx) => {
  const who = await planner(ctx);
  const raw = ctx.url.searchParams.get("version");
  await sql.begin(async (tx) => {
    const session = await lockSession(tx, who.member.id, ctx.params.id);
    requireWritable(who.workspace);
    if (raw === null || !/^\d+$/.test(raw)) check.settle({ version: "Send the version this removal is based on." });
    if (Number(raw) !== session.version) throw versionConflict(sessionJson(session, who.member.time_zone));
    await tx`DELETE FROM sessions WHERE id = ${session.id}`;
  });
  return { status: 204 };
});

/**
 * After a profile zone change, sessions keep their instant; when a session's local date moves, its
 * task's dayDate follows and both versions add 1.
 */
export async function moveSessionsToZone(tx: Tx, memberId: string, zone: string): Promise<void> {
  const rows = await tx<{ id: string; task_id: string; starts_at: Date; day_date: string | null }[]>`
    SELECT s.id, s.task_id, s.starts_at, to_char(t.day_date, 'YYYY-MM-DD') AS day_date
    FROM sessions s JOIN tasks t ON t.id = s.task_id WHERE s.member_id = ${memberId} FOR UPDATE OF s, t`;
  for (const row of rows) {
    const date = wallOf(row.starts_at.getTime(), zone).date;
    if (date === row.day_date) continue;
    await tx`UPDATE sessions SET version = version + 1 WHERE id = ${row.id}`;
    await tx`UPDATE tasks SET version = version + 1, updated_at = clock_timestamp() WHERE id = ${row.task_id}`;
    await place(tx, memberId, [row.task_id], date, null, [row.day_date]);
  }
}

route("GET", "/api/calendar", async (ctx) => {
  const { member } = await planner(ctx);
  const from = ctx.url.searchParams.get("from") ?? "";
  const to = ctx.url.searchParams.get("to") ?? "";
  check.settle({ from: check.date(from), to: check.date(to) });
  const span = daysBetween(from, to);
  if (span < 0 || span > 30) {
    throw new HttpError(422, "validation_failed", "Ask for a range of 1 to 31 days.", { fields: { to: "Ask for a range of 1 to 31 days." } });
  }
  const zone = member.time_zone;
  const low = new Date(dayBounds(from, zone).start);
  const high = new Date(dayBounds(to, zone).end);
  const [sessions, meetings, routines] = await Promise.all([
    sql<SessionRow[]>`
      SELECT ${SESSION_COLUMNS} FROM sessions s JOIN tasks t ON t.id = s.task_id
      WHERE s.member_id = ${member.id} AND s.starts_at >= ${low} AND s.starts_at < ${high} ORDER BY s.starts_at`,
    sql<{ id: string; summary: string; starts_at: Date; ends_at: Date }[]>`
      SELECT id, summary, starts_at, ends_at FROM meetings
      WHERE member_id = ${member.id} AND starts_at < ${high} AND ends_at > ${low} ORDER BY starts_at`,
    routinesOf(sql, member.id),
  ]);
  const items: CalendarItem[] = [
    ...sessions.map((s) => ({ kind: "session" as const, ...sessionJson(s, zone) })),
    ...meetings.map((m) => {
      const start = wallOf(m.starts_at.getTime(), zone);
      return {
        kind: "meeting" as const,
        id: m.id,
        title: m.summary,
        date: start.date,
        startTime: start.time,
        endTime: wallOf(m.ends_at.getTime(), zone).time,
        start: isoInstant(m.starts_at.getTime()),
        end: isoInstant(m.ends_at.getTime()),
      };
    }),
    ...expandRoutines(routines, from, to, zone).map((o) => occurrenceItem(o, zone)),
  ];
  return json(200, { timeZone: zone, items });
});

