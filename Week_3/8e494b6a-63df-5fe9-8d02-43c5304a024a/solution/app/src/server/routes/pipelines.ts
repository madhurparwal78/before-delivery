// Pipelines: list, save (version + 1) and simulate.
import { pool } from "../db";
import { errors } from "../errors";
import { authorize } from "../access";
import { ok, reply, route } from "../http";
import { currentSeq } from "../live";
import { findPipeline, processorProblem, savePipeline, simulate, type Processor } from "../ingest/pipelines";
import { Check, STREAM_NAME } from "../validate";

route("GET", "/api/pipelines", "none", async (ctx) => {
  const access = await authorize(ctx, { role: "viewer" });
  const { rows } = await pool.query<{ name: string; version: number; processors: unknown }>(
    "SELECT name, version, processors FROM pipelines WHERE space_id = $1 ORDER BY name", [access.space.id],
  );
  return ok({ pipelines: rows });
});

route("PUT", "/api/pipelines/:name", "json", async (ctx) => {
  const access = await authorize(ctx, { role: "admin" });
  const body = ctx.json();
  const name = ctx.params.name as string;
  const check = new Check();
  if (!STREAM_NAME.test(name)) check.fail("name", "Use 1 to 40 characters: a-z, 0-9 or -.");
  const problem = processorProblem(body.processors);
  if (problem) check.fail("processors", problem);
  check.done();
  const saved = await savePipeline(access.space.id, name, body.processors as Processor[]);
  return reply(saved.created ? 201 : 200, {
    name, version: saved.version, processors: body.processors, message: "Pipeline saved. Only new events are affected.", seq: await currentSeq(access.space.id),
  });
});

route("POST", "/api/pipelines/:name/simulate", "json", async (ctx) => {
  const access = await authorize(ctx);
  const pipeline = await findPipeline(access.space.id, ctx.params.name as string);
  if (!pipeline) throw errors.notFound();
  access.require("editor");
  const body = ctx.json();
  if (typeof body.lines !== "string") throw errors.invalid({ lines: "Paste sample events, one JSON object per line." });
  return ok({ results: simulate(pipeline, body.lines) });
});
