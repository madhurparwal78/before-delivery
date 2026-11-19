import { timingSafeEqual } from "node:crypto";
import { setWorldClock, worldNow } from "./clock.js";
import { config } from "./config.js";
import { one } from "./db.js";
import { invalid, notFound, reply, SETUP_LIMIT, type Context, type Reply, type Router } from "./http.js";
import { setMinioDown } from "./storage.js";
import { setValkeyDown } from "./valkey.js";
import { createWorld } from "./world.js";
import { newId, type Person } from "./people.js";
import { runDueWork } from "./sweeper.js";
import { sendDueReminders } from "./gatherings.js";

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** The grading routes need the key in the header, and no session. A wrong, missing or unset key is a 404. */
function keyed(ctx: Context): void {
  const given = String(ctx.req.headers["x-grading-key"] ?? "");
  const wanted = config.gradingKey;
  if (wanted === "" || given.length !== wanted.length || !timingSafeEqual(Buffer.from(given), Buffer.from(wanted))) throw notFound();
}

export function gradingRoutes(router: Router<Person>): void {
  router.add(
    "POST",
    "/api/grading/setup",
    async (ctx): Promise<Reply> => {
      keyed(ctx);
      return reply(201, await createWorld(ctx.json(), newId()));
    },
    { anonymous: true, bodyLimit: SETUP_LIMIT },
  );

  router.add(
    "POST",
    "/api/grading/clock",
    async (ctx): Promise<Reply> => {
      keyed(ctx);
      const body = ctx.json();
      const worldId = typeof body.worldId === "string" ? body.worldId : "";
      if (!(await one("SELECT 1 AS ok FROM worlds WHERE id = $1", [worldId]))) throw notFound();
      const wanted = body.now;
      if (wanted !== null && (typeof wanted !== "string" || !INSTANT.test(wanted) || Number.isNaN(Date.parse(wanted)))) throw invalid("Give a valid time.");
      await setWorldClock(worldId, wanted === null ? null : new Date(wanted as string));
      await runDueWork(worldId);
      await sendDueReminders(worldId);
      return reply(200, { worldId, now: (await worldNow(worldId)).toISOString() });
    },
    { anonymous: true },
  );

  router.add(
    "POST",
    "/api/grading/outage",
    (ctx): Reply => {
      keyed(ctx);
      const { service, down } = ctx.json();
      if ((service !== "valkey" && service !== "minio") || typeof down !== "boolean") throw invalid("Choose valkey or minio.");
      (service === "valkey" ? setValkeyDown : setMinioDown)(down);
      return reply(200, { service, down });
    },
    { anonymous: true },
  );
}
