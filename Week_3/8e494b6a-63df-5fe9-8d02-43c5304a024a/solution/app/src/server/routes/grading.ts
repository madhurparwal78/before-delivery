// The grading routes: only served when SPOOR_GRADING=1, 404 otherwise.
import { config } from "../config";
import { now, setNow } from "../clock";
import { pool } from "../db";
import { errors } from "../errors";
import { createSession, sessionCookie } from "../auth";
import { ok, reply, route, type Ctx, type Reply } from "../http";
import { currentSeq } from "../live";
import { lifecycleStep } from "../lifecycle";
import { runCheck } from "../alerts/check";
import { moveClock } from "../alerts/actions";
import { generationViews } from "../streams";
import { setStorageDown } from "../storage";
import { formatIso } from "../../shared/time";
import { seedWorld, type SeedSpec } from "../seed";
import type { Lifecycle } from "../access";

function grading(handler: (ctx: Ctx) => Promise<Reply>): (ctx: Ctx) => Promise<Reply> {
  return async (ctx) => {
    if (!config.grading) throw errors.notFound();
    return handler(ctx);
  };
}

route("POST", "/api/grading/seed", "json", grading(async (ctx) => reply(201, await seedWorld(ctx.json() as SeedSpec, "strict"))));

route("POST", "/api/grading/session", "json", grading(async (ctx) => {
  const username = String(ctx.json().username ?? "").toLowerCase();
  const { rows } = await pool.query<{ id: number }>("SELECT id FROM users WHERE username = $1", [username]);
  if (!rows[0]) throw errors.notFound();
  return reply(200, { username }, { "set-cookie": sessionCookie(await createSession(rows[0].id)) });
}));

route("POST", "/api/grading/clock", "json", grading(async (ctx) => {
  const body = ctx.json();
  const target = typeof body.set_ms === "number" ? body.set_ms : typeof body.advance_ms === "number" ? now() + body.advance_ms : null;
  if (target === null) throw errors.invalid({ set_ms: "Send set_ms or advance_ms in whole milliseconds." });
  await moveClock(() => setNow(target));
  return ok({ now: formatIso(now()), now_ms: now() });
}));

route("POST", "/api/grading/check", "json", grading(async (ctx) => {
  const body = ctx.json();
  const { rows } = await pool.query("SELECT 1 FROM rules WHERE id = $1", [Number(body.rule) || 0]);
  if (rows.length === 0) throw errors.notFound();
  return ok(await runCheck(Number(body.rule), body.fail === true));
}));

route("POST", "/api/grading/lifecycle", "json", grading(async (ctx) => {
  const body = ctx.json();
  const { rows } = await pool.query<{ id: number; space_id: number; write_generation: number; lifecycle: Lifecycle }>(
    "SELECT s.id, s.space_id, s.write_generation, s.lifecycle FROM streams s JOIN spaces sp ON sp.id = s.space_id WHERE sp.slug = $1 AND s.name = $2",
    [String(body.space), String(body.stream)],
  );
  if (!rows[0]) throw errors.notFound();
  await lifecycleStep(rows[0].id);
  const after = (await pool.query<{ write_generation: number }>("SELECT write_generation FROM streams WHERE id = $1", [rows[0].id])).rows[0];
  return ok({
    stream: body.stream, generations: await generationViews(rows[0].id, rows[0].lifecycle, after?.write_generation ?? rows[0].write_generation),
    seq: await currentSeq(rows[0].space_id),
  });
}));

route("POST", "/api/grading/storage", "json", grading(async (ctx) => {
  const { down } = ctx.json();
  if (typeof down !== "boolean") throw errors.invalid({ down: "Send true or false." });
  setStorageDown(down);
  return ok({ storage: down ? "down" : "up" });
}));

