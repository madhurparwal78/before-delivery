import { Hono } from "hono";
import { clockNow } from "../clock.ts";
import { config } from "../config.ts";
import { advanceTo } from "../engine.ts";
import { exclusive, pool, rows } from "../db.ts";
import { HttpError, notFound } from "../errors.ts";
import { buildSeed, resetAll } from "../seed.ts";
import { latestHeight } from "../workspace.ts";
import { jsonBody } from "./context.ts";

const MAX_ADVANCE_MS = 86_400_000;

export const gradingRoutes = new Hono();

gradingRoutes.use("*", async (c, next) => {
  if (config.gradingKey === "" || c.req.header("X-Grading-Key") !== config.gradingKey) throw notFound();
  await next();
});

gradingRoutes.post("/reset", (c) =>
  exclusive(async () => {
    await resetAll();
    return c.json({ clock: config.startAt.toISOString() });
  }),
);

gradingRoutes.post("/seed", (c) => exclusive(async () => c.json(await buildSeed())));

gradingRoutes.post("/clock", async (c) => {
  const body = await jsonBody(c);
  const advance = body.advanceMs;
  if (typeof advance !== "number" || !Number.isInteger(advance) || advance < 0 || advance > MAX_ADVANCE_MS) {
    throw new HttpError(422, { errors: { advanceMs: "Give a whole number of milliseconds from 0 to 86400000." } });
  }
  return exclusive(async () => {
    await advanceTo(new Date(clockNow().getTime() + advance));
    const heights: Record<string, number> = {};
    for (const { id } of await rows<{ id: string }>(pool, "SELECT id FROM workspaces ORDER BY id")) heights[id] = await latestHeight(pool, id);
    return c.json({ clock: clockNow().toISOString(), heights });
  });
});
