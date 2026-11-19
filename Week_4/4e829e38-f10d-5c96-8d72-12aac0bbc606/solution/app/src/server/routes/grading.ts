/** Routes that exist only while EVERYWEEK_GRADING=1: seed records and fix the server clock. */
import { config } from "../config.js";
import { isoInstant, now, parseInstant, realNow } from "../clock.js";
import { pool, transaction } from "../db.js";
import { fields, invalid, notFound, readJson, route, type Ctx } from "../http.js";
import { runDueWork } from "../schedule.js";
import { seedWorld } from "../seed.js";

function gradingOnly(ctx: Ctx): void {
  if (!config.grading || ctx.req.headers["x-everyweek-grading"] !== "1") throw notFound();
}

route("POST", "/grading/seed", async (ctx) => {
  gradingOnly(ctx);
  const body = fields(await readJson(ctx, config.seedBodyBytes));
  return transaction(async (tx) => seedWorld(tx, body, await now(tx)));
}, { open: true, status: 201 });

route("POST", "/grading/clock", async (ctx) => {
  gradingOnly(ctx);
  const body = fields(await readJson(ctx));
  const next = typeof body.now === "string" ? parseInstant(body.now) : null;
  if (!next) throw invalid({ now: "Send an ISO time like 2026-03-02T09:00:00Z" });
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(7002)");
    const stored = await client.query<{ now: Date }>("SELECT now FROM clock WHERE id = 1");
    const previous = stored.rows.length ? stored.rows[0].now : null;
    await client.query("INSERT INTO clock (id, now) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET now = $1", [next]);
    await runDueWork(previous, next, previous ?? realNow());
  } finally {
    await client.query("SELECT pg_advisory_unlock(7002)");
    client.release();
  }
  return { now: isoInstant(next) };
}, { open: true });

