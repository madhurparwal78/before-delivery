import { randomUUID } from "node:crypto";
import { taskAccess, teamsOf } from "../access.js";
import { now } from "../clock.js";
import { pool, transaction } from "../db.js";
import { publish, subscribe } from "../events.js";
import { route } from "../http.js";
import { RAW } from "../state.js";

/**
 * The live channel. A connection opened with `?task=<id>` is that person's presence on the task:
 * it joins when the stream opens and starts its leave timeout when it drops.
 */
route("GET", "/api/events", async (ctx) => {
  const teams = (await teamsOf(pool, ctx.personId)).map((m) => m.teamId);
  const taskId = ctx.url.searchParams.get("task");
  const access = taskId ? await taskAccess(pool, ctx.personId, taskId) : null;
  const unsubscribe = subscribe(ctx.res, ctx.personId, teams);
  const connection = randomUUID();
  if (taskId && access) {
    await transaction(async (tx) => {
      await tx.query("INSERT INTO presence (connection, task_id, person_id, joined_at) VALUES ($1,$2,$3,$4)", [connection, taskId, ctx.personId, await now(tx)]);
      await publish(tx, { t: "presence", team: access.teamId, task: taskId });
    });
  }
  ctx.req.on("close", () => {
    unsubscribe();
    if (taskId && access) {
      void transaction(async (tx) => {
        await tx.query("UPDATE presence SET left_at = $2 WHERE connection = $1", [connection, await now(tx)]);
        await publish(tx, { t: "presence", team: access.teamId, task: taskId });
      });
    }
  });
  return RAW;
});
