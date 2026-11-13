// Traces and objectives.
import { now } from "../clock";
import { pool } from "../db";
import { errors } from "../errors";
import { authorize, findStream } from "../access";
import { ok, reply, route } from "../http";
import { currentSeq } from "../live";
import { FILTER_OPS, type FilterOp } from "../search/filters";
import { Check } from "../validate";
import { buildTrace, traceProblem, type SpanInput } from "../traces";
import { DEFAULT_OBJECTIVE_WINDOW_MS, loadObjectives, objectiveView } from "../objectives";

const isWhole = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

function spansOf(raw: unknown, check: Check): SpanInput[] {
  if (!Array.isArray(raw)) {
    check.fail("spans", "Send the spans as a list.");
    return [];
  }
  const spans: SpanInput[] = [];
  raw.forEach((item, index) => {
    const span = item as Record<string, unknown>;
    const ok =
      typeof span === "object" && span !== null && typeof span.span_id === "string" && span.span_id !== "" &&
      (span.parent_id === null || typeof span.parent_id === "string") && typeof span.service === "string" && typeof span.name === "string" &&
      isWhole(span.start_ms) && isWhole(span.duration_ms);
    if (ok) spans.push(span as unknown as SpanInput);
    else check.fail("spans", `Span ${index + 1} needs span_id, parent_id, service, name, start_ms and duration_ms in whole milliseconds.`);
  });
  return spans;
}

route("POST", "/api/traces", "json", async (ctx) => {
  const access = await authorize(ctx, { role: "editor" });
  const body = ctx.json();
  const traceId = typeof body.trace_id === "string" ? body.trace_id : "";
  const { rows: taken } = await pool.query("SELECT 1 FROM traces WHERE space_id = $1 AND trace_id = $2", [access.space.id, traceId]);
  if (taken.length > 0) throw errors.nameTaken({ trace_id: "That name is already used." });
  const check = new Check();
  check.text(body, "trace_id", "Enter a trace id.", 80);
  const spans = spansOf(body.spans, check);
  check.done();
  const problem = traceProblem(spans);
  if (problem) throw errors.traceInvalid(problem);
  await pool.query("INSERT INTO traces (space_id, trace_id, spans, created_ms) VALUES ($1, $2, $3, $4)", [access.space.id, traceId, JSON.stringify(spans), now()]);
  return reply(201, { trace_id: traceId, spans: spans.length });
});

route("GET", "/api/traces", "none", async (ctx) => {
  const access = await authorize(ctx, { role: "viewer" });
  const { rows } = await pool.query<{ trace_id: string; spans: SpanInput[] }>(
    "SELECT trace_id, spans FROM traces WHERE space_id = $1 ORDER BY created_ms DESC, id DESC", [access.space.id],
  );
  return ok({
    traces: rows.map((row) => ({
      trace_id: row.trace_id, spans: row.spans.length, services: [...new Set(row.spans.map((span) => span.service))].sort(),
      duration_ms: Math.max(0, ...row.spans.map((span) => span.start_ms + span.duration_ms)) - Math.min(...row.spans.map((span) => span.start_ms)),
    })),
  });
});

route("GET", "/api/traces/:id", "none", async (ctx) => {
  const access = await authorize(ctx, { role: "viewer" });
  const { rows } = await pool.query<{ trace_id: string; spans: SpanInput[] }>(
    "SELECT trace_id, spans FROM traces WHERE space_id = $1 AND trace_id = $2", [access.space.id, ctx.params.id],
  );
  if (!rows[0]) throw errors.notFound();
  return ok(buildTrace(rows[0].trace_id, rows[0].spans));
});

route("GET", "/api/objectives", "none", async (ctx) => {
  const access = await authorize(ctx, { role: "viewer" });
  return ok({ objectives: await Promise.all((await loadObjectives(access.space.id)).map(objectiveView)) });
});

route("POST", "/api/objectives", "json", async (ctx) => {
  const access = await authorize(ctx, { role: "editor" });
  const body = ctx.json();
  const service = typeof body.service === "string" ? body.service : "";
  const name = typeof body.name === "string" ? body.name : "";
  const { rows: taken } = await pool.query("SELECT 1 FROM objectives WHERE space_id = $1 AND (service = $2 OR name = $3)", [access.space.id, service, name]);
  if (taken.length > 0) throw errors.nameTaken({ service: "That name is already used." });
  const check = new Check();
  check.text(body, "service", "Enter a service.", 80);
  check.text(body, "name", "Enter an objective name.", 80);
  if (typeof body.stream !== "string" || !(await findStream(access.space.id, body.stream))) check.fail("stream", "Choose a stream in this space.");
  const target = String(body.target);
  if (typeof body.target !== "number" || !/^\d{1,2}(\.\d{1,3})?$/.test(target) || body.target <= 0 || body.target >= 100) {
    check.fail("target", "Enter a target above 0 and below 100, with up to 3 decimals.");
  }
  const windowMs = body.objective_window_ms === undefined ? DEFAULT_OBJECTIVE_WINDOW_MS : check.whole(body, "objective_window_ms", "Enter a window in whole milliseconds.", 1);
  const bad = body.bad as Record<string, unknown> | undefined;
  if (!bad || typeof bad.field !== "string" || !FILTER_OPS.includes(bad.op as FilterOp)) check.fail("bad", "Describe the bad events with a field, an operator and a value.");
  check.done();
  const { rows } = await pool.query<{ id: number }>(
    "INSERT INTO objectives (space_id, service, name, stream, target, objective_window_ms, bad) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
    [access.space.id, service, name, body.stream, target, windowMs, JSON.stringify(bad)],
  );
  const created = (await loadObjectives(access.space.id)).find((row) => row.id === (rows[0] as { id: number }).id) as NonNullable<Awaited<ReturnType<typeof loadObjectives>>[number]>;
  return reply(201, { ...(await objectiveView(created)), seq: await currentSeq(access.space.id) });
});
