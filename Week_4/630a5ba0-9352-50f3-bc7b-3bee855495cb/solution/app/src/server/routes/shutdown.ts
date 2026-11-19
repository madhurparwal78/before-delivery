import type { ShutdownPreview } from "../../shared/types.js";
import { addDays, dayBounds, dayLabel, todayIn, wallOf } from "../../shared/time.js";
import { planner, requireWritable, type Planner } from "../auth.js";
import { place } from "../columns.js";
import { sql, type Db } from "../db.js";
import { json, route } from "../http.js";
import { attemptNow, enqueue } from "../outbox.js";
import { expandRoutines, routinesOf } from "../routines.js";

/** The shutdown lists for the member's local today; tomorrowFirst is the earliest session or routine. */
async function preview(db: Db, who: Planner): Promise<ShutdownPreview> {
  const { member } = who;
  const zone = member.time_zone;
  const date = todayIn(zone, Date.now());
  const tomorrow = addDays(date, 1);
  const bounds = dayBounds(tomorrow, zone);
  const [today, sessions, routines] = await Promise.all([
    db<{ id: string; title: string; status: string }[]>`
      SELECT id, title, status FROM tasks WHERE member_id = ${member.id} AND day_date = ${date}::date
      ORDER BY position, created_at`,
    db<{ title: string; starts_at: Date }[]>`
      SELECT t.title, s.starts_at FROM sessions s JOIN tasks t ON t.id = s.task_id
      WHERE s.member_id = ${member.id} AND s.starts_at >= ${new Date(bounds.start)} AND s.starts_at < ${new Date(bounds.end)}`,
    routinesOf(db, member.id),
  ]);
  const candidates = [
    ...sessions.map((s) => ({ title: s.title, at: s.starts_at.getTime() })),
    ...expandRoutines(routines, tomorrow, tomorrow, zone).map((o) => ({ title: o.name, at: o.start })),
  ].sort((a, b) => a.at - b.at);
  const first = candidates[0];
  return {
    date,
    done: today.filter((t) => t.status === "done").map(({ id, title }) => ({ id, title })),
    carriedOver: today.filter((t) => t.status === "open").map(({ id, title }) => ({ id, title })),
    tomorrowFirst: first ? { title: first.title, startTime: wallOf(first.at, zone).time } : null,
  };
}

function digestText(result: ShutdownPreview): string {
  const tomorrow = addDays(result.date, 1);
  return [
    `Done: ${result.done.length}`,
    ...result.done.map((t) => `- ${t.title}`),
    "",
    `Carried over to ${dayLabel(tomorrow)}: ${result.carriedOver.length}`,
    ...result.carriedOver.map((t) => `- ${t.title}`),
    "",
    result.tomorrowFirst
      ? `Tomorrow starts with: ${result.tomorrowFirst.title} at ${result.tomorrowFirst.startTime}`
      : "Tomorrow starts with: nothing scheduled",
  ].join("\n");
}

route("GET", "/api/shutdown/preview", async (ctx) => {
  return json(200, await preview(sql, await planner(ctx)));
});

route(
  "POST",
  "/api/shutdown",
  async (ctx) => {
    const who = await planner(ctx);
    requireWritable(who.workspace);
    const { member } = who;
    const outcome = await sql.begin(async (tx) => {
      await tx`SELECT id FROM members WHERE id = ${member.id} FOR UPDATE`;
      const before = await preview(tx, who);
      const tomorrow = addDays(before.date, 1);
      const carried = before.carriedOver.map((t) => t.id);
      if (carried.length) {
        await tx`SELECT id FROM tasks WHERE id = ANY(${carried}::uuid[]) ORDER BY id FOR UPDATE`;
        await tx`DELETE FROM sessions WHERE task_id = ANY(${carried}::uuid[])`;
        await tx`UPDATE tasks SET version = version + 1, updated_at = clock_timestamp() WHERE id = ANY(${carried}::uuid[])`;
        await place(tx, member.id, carried, tomorrow, 0, [before.date]);
      }
      const result = await preview(tx, who);
      const lists = { ...before, tomorrowFirst: result.tomorrowFirst };
      const [fresh] = await tx`
        INSERT INTO digests (member_id, local_date) VALUES (${member.id}, ${before.date}::date)
        ON CONFLICT DO NOTHING RETURNING local_date`;
      const job = fresh
        ? await enqueue(tx, member.workspace_id, "mail", {
            to: member.email,
            subject: `Shutdown for ${dayLabel(before.date)}`,
            text: digestText(lists),
          })
        : null;
      return { lists, job };
    });
    const digest = outcome.job === null ? "already_sent" : (await attemptNow(outcome.job)).done ? "sent" : "queued";
    return json(200, { ...outcome.lists, digest });
  },
  "json",
);
