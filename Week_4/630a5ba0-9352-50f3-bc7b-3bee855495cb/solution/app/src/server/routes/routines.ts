import { isTime } from "../../shared/time.js";
import { planner, requireWritable } from "../auth.js";
import { sql } from "../db.js";
import { HttpError, json, parseJson, route } from "../http.js";
import { routineJson, routinesOf, type RoutineRow } from "../routines.js";
import { isUuid } from "./tasks.js";
import * as check from "../validate.js";

route("GET", "/api/routines", async (ctx) => {
  const { member } = await planner(ctx);
  return json(200, { routines: (await routinesOf(sql, member.id)).map(routineJson) });
});

route(
  "POST",
  "/api/routines",
  async (ctx) => {
    const who = await planner(ctx);
    requireWritable(who.workspace);
    const body = parseJson(ctx);
    check.settle({
      name: check.text(body.name, "a name", 80),
      startTime: typeof body.startTime === "string" && isTime(body.startTime) ? null : "Use a start time written as HH:MM.",
      durationMinutes: check.stepped(body.durationMinutes, 5, 240, 5, "minutes"),
      repeats: body.repeats === "daily" || body.repeats === "weekdays" ? null : "Choose Every day or Weekdays.",
    });
    const [row] = await sql<RoutineRow[]>`
      INSERT INTO routines (member_id, name, start_time, duration_minutes, repeats)
      VALUES (${who.member.id}, ${String(body.name).trim()}, ${String(body.startTime)}, ${Number(body.durationMinutes)}, ${String(body.repeats)})
      RETURNING id, name, start_time, duration_minutes, repeats`;
    return json(201, { routine: routineJson(row) });
  },
  "json",
);

route("DELETE", "/api/routines/{id}", async (ctx) => {
  const who = await planner(ctx);
  const [found] = isUuid(ctx.params.id)
    ? await sql`SELECT id FROM routines WHERE id = ${ctx.params.id} AND member_id = ${who.member.id}`
    : [];
  if (!found) throw new HttpError(404, "not_found", "That routine doesn't exist.");
  requireWritable(who.workspace);
  await sql`DELETE FROM routines WHERE id = ${ctx.params.id} AND member_id = ${who.member.id}`;
  return { status: 204 };
});
