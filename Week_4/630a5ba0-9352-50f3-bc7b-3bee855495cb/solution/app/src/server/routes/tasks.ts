import { isDate, todayIn } from "../../shared/time.js";
import type { Session, Task } from "../../shared/types.js";
import { planner, requireWritable, type Planner } from "../auth.js";
import { place } from "../columns.js";
import { sql, type Tx } from "../db.js";
import { backlogOf, boardDates, buildDays, taskRows, taskJson, touched, type TaskRow } from "../days.js";
import { HttpError, json, parseJson, route } from "../http.js";
import * as check from "../validate.js";

export function dayInPast(): HttpError {
  return new HttpError(422, "day_in_past", "That day has already passed.");
}

export function versionConflict(current: Task | Session): HttpError {
  return new HttpError(409, "version_conflict", "It was changed on another device.", { current });
}

/** Locks the caller's task row, then reads it fresh. 404 when it is not the caller's. */
export async function lockTask(tx: Tx, memberId: string, taskId: string): Promise<TaskRow> {
  const [locked] = await tx`SELECT id FROM tasks WHERE id = ${taskId}::uuid AND member_id = ${memberId} FOR UPDATE`;
  const [row] = locked ? await taskRows(tx, memberId, taskId) : [];
  if (!row) throw new HttpError(404, "not_found", "That task doesn't exist.");
  return row;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function writeReply(tx: Tx, who: Planner, taskId: string, dates: string[]) {
  const { member } = who;
  const [task] = await taskRows(tx, member.id, taskId);
  return {
    task: taskJson(task, member.time_zone),
    days: await buildDays(tx, member.id, member.time_zone, member.threshold_minutes, dates),
  };
}

route("GET", "/api/board", async (ctx) => {
  const { member } = await planner(ctx);
  const today = todayIn(member.time_zone, Date.now());
  const start = ctx.url.searchParams.get("start") ?? today;
  if (!isDate(start)) throw new HttpError(422, "validation_failed", "Use a start date written as YYYY-MM-DD.", { fields: { start: "Use a date written as YYYY-MM-DD." } });
  const [days, backlog] = await Promise.all([
    buildDays(sql, member.id, member.time_zone, member.threshold_minutes, boardDates(start)),
    backlogOf(sql, member.id, today),
  ]);
  return json(200, {
    today,
    timeZone: member.time_zone,
    thresholdMinutes: member.threshold_minutes,
    days,
    backlog: backlog.map((t) => taskJson(t, member.time_zone)),
  });
});

route(
  "POST",
  "/api/tasks",
  async (ctx) => {
    const who = await planner(ctx);
    requireWritable(who.workspace);
    const { member } = who;
    const body = parseJson(ctx);
    const estimate = body.estimateMinutes ?? null;
    const dayDate = body.dayDate ?? null;
    check.settle({
      title: check.text(body.title, "a title", 200),
      estimateMinutes: check.estimate(estimate),
      dayDate: dayDate === null ? null : check.date(dayDate),
    });
    if (typeof dayDate === "string" && dayDate < todayIn(member.time_zone, Date.now())) throw dayInPast();
    const reply = await sql.begin(async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        INSERT INTO tasks (member_id, title, estimate_minutes, position)
        VALUES (${member.id}, ${String(body.title).trim()}, ${estimate as number | null}, 0)
        RETURNING id`;
      await place(tx, member.id, [row.id], dayDate as string | null, dayDate === null ? 0 : null);
      return writeReply(tx, who, row.id, touched(dayDate as string | null));
    });
    return json(201, reply);
  },
  "json",
);

route(
  "PATCH",
  "/api/tasks/{id}",
  async (ctx) => {
    const who = await planner(ctx);
    const { member } = who;
    if (!isUuid(ctx.params.id)) throw new HttpError(404, "not_found", "That task doesn't exist.");
    const reply = await sql.begin(async (tx) => {
      const task = await lockTask(tx, member.id, ctx.params.id);
      requireWritable(who.workspace);
      const body = parseJson(ctx);
      if (body.version !== task.version) {
        if (typeof body.version !== "number") check.settle({ version: "Send the version this change is based on." });
        throw versionConflict(taskJson(task, member.time_zone));
      }
      const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
      check.settle({
        title: has("title") ? check.text(body.title, "a title", 200) : null,
        estimateMinutes: has("estimateMinutes") ? check.estimate(body.estimateMinutes) : null,
        dayDate: has("dayDate") && body.dayDate !== null ? check.date(body.dayDate) : null,
        position: has("position") && !(Number.isInteger(body.position) && Number(body.position) >= 0) ? "Use a whole number from 0." : null,
        status: has("status") && body.status !== "open" && body.status !== "done" ? "Use open or done." : null,
      });
      const dayDate = has("dayDate") ? (body.dayDate as string | null) : task.day_date;
      const moving = dayDate !== task.day_date;
      if (moving && dayDate !== null && dayDate < todayIn(member.time_zone, Date.now())) throw dayInPast();
      const estimate = has("estimateMinutes") ? (body.estimateMinutes as number | null) : task.estimate_minutes;
      if (!moving && task.session !== null && estimate !== null && estimate !== task.estimate_minutes) {
        // A session lasts its task's estimate; crosses_midnight applies only to creating and moving one.
        await tx`UPDATE sessions SET ends_at = starts_at + make_interval(mins => ${estimate}), version = version + 1
                 WHERE id = ${task.session.id}`;
      }
      if (moving) await tx`DELETE FROM sessions WHERE task_id = ${task.id}`;
      await tx`
        UPDATE tasks SET
          title = ${has("title") ? String(body.title).trim() : task.title},
          estimate_minutes = ${estimate},
          status = ${has("status") ? String(body.status) : task.status},
          version = version + 1,
          updated_at = clock_timestamp()
        WHERE id = ${task.id}`;
      if (moving || has("position")) {
        await place(tx, member.id, [task.id], dayDate, has("position") ? Number(body.position) : null, [task.day_date]);
      }
      return writeReply(tx, who, task.id, touched(task.day_date, dayDate));
    });
    return json(200, reply);
  },
  "json",
);

route("GET", "/api/tasks/suggest", async (ctx) => {
  const { member } = await planner(ctx);
  const q = ctx.url.searchParams.get("q") ?? "";
  if (q.length < 1 || q.length > 100) {
    throw new HttpError(422, "validation_failed", "Type 1 to 100 characters.", { fields: { q: "Type 1 to 100 characters." } });
  }
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await sql<{ id: string; title: string; estimate_minutes: number | null }[]>`
    SELECT id, title, estimate_minutes FROM tasks
    WHERE member_id = ${member.id} AND status = 'open' AND title ILIKE ${pattern}
    ORDER BY updated_at DESC LIMIT 8`;
  return json(200, { suggestions: rows.map((r) => ({ id: r.id, title: r.title, estimateMinutes: r.estimate_minutes })) });
});
