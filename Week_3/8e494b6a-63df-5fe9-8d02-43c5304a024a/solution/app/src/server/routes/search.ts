// Search, histogram, fields, statistics, suggestions, analysis, snapshots, the live tail and Spoor Pipe.
import { config } from "../config";
import { now } from "../clock";
import { authorize, type Access } from "../access";
import { errors } from "../errors";
import { ok, reply, route, openStream, STREAMED, type Ctx } from "../http";
import { subscribeTail } from "../tail";
import { tailBudget } from "../rate";
import { parseIsoInstant } from "../../shared/time";
import { isKnownZone } from "../../shared/zone";
import { ANALYZERS, analyze, type Analyzer } from "../search/analysis";
import { loadStreamContext, loadUniverse, type StreamContext } from "../search/context";
import { parseFilters, type Filter } from "../search/filters";
import { labelledBuckets } from "../search/histogram";
import { runPipe } from "../search/pipe";
import { parseSort, runQuery, shape, sortMatched, type QueryRequest } from "../search/run";
import { createSnapshot, readSnapshot } from "../search/snapshots";
import { fieldList, fieldStatistics, suggest } from "../search/stats";
import { Check } from "../validate";

const DEFAULT_RANGE_MS = 900_000;

async function streamOf(ctx: Ctx, name: string, rate: boolean): Promise<{ access: Access; stream: StreamContext }> {
  const access = await authorize(ctx, { role: "viewer", keyAction: "read", stream: name, ...(rate ? { rate: "search" as const } : {}) });
  const found = access.stream as NonNullable<typeof access.stream>;
  return { access, stream: await loadStreamContext(found, access.space.id) };
}

/** The range from `from` and `to` (ISO times); each left out takes the Explore default. */
function rangeOf(from: unknown, to: unknown): { from: number; to: number } {
  const check = new Check();
  const parse = (value: unknown, field: string): number | null => {
    if (value === undefined || value === null || value === "") return null;
    const ms = typeof value === "string" ? parseIsoInstant(value) : null;
    if (ms === null) check.fail(field, "Enter a time as YYYY-MM-DDTHH:MM:SS.sssZ.");
    return ms;
  };
  const end = parse(to, "to");
  const start = parse(from, "from");
  check.done();
  const upper = end ?? now();
  return { from: start ?? upper - DEFAULT_RANGE_MS, to: upper };
}

function filtersOf(raw: unknown): Filter[] {
  const filters = parseFilters(raw);
  if (!filters) throw errors.invalid({ filters: "Send filters as a JSON list of field, op and value." });
  return filters;
}

function requestOf(source: { q?: unknown; filters?: unknown; from?: unknown; to?: unknown }): QueryRequest {
  const range = rangeOf(source.from, source.to);
  const q = typeof source.q === "string" ? source.q : "";
  return { q, filters: filtersOf(source.filters), ...range };
}

const queryParams = (ctx: Ctx) => ({
  q: ctx.query.get("q") ?? "", filters: ctx.query.get("filters"), from: ctx.query.get("from"), to: ctx.query.get("to"),
});

route("GET", "/api/search", "none", async (ctx) => {
  const { stream } = await streamOf(ctx, ctx.query.get("stream") ?? "", true);
  const check = new Check();
  const size = ctx.query.get("size") === null ? 50 : Number(ctx.query.get("size"));
  const offset = ctx.query.get("offset") === null ? 0 : Number(ctx.query.get("offset"));
  if (!Number.isInteger(size) || size < 1 || size > 100) check.fail("size", "Use a size from 1 to 100.");
  if (!Number.isInteger(offset) || offset < 0) check.fail("offset", "Use an offset of 0 or more.");
  const sort = parseSort(ctx.query.get("sort"));
  if (sort === "invalid") check.fail("sort", "Sort by <field>:asc or <field>:desc.");
  const request = requestOf(queryParams(ctx));
  check.done();
  if (offset + size > config.settings.resultWindow) {
    throw errors.resultWindow(config.settings.resultWindow);
  }
  const outcome = await runQuery(stream, request);
  const ordered = sortMatched(stream, outcome.matched, sort === "invalid" ? null : sort, request, outcome.scored);
  const only = ctx.query.get("id");
  const explain = ctx.query.get("explain") === "true";
  const picked = only === null ? ordered.slice(offset, offset + size) : ordered.filter((item) => item.event.id === only);
  return ok({
    total: only === null ? ordered.length : picked.length,
    events: picked.map((item) => shape(item, outcome.scored, explain)),
    partial: outcome.universe.partial,
    skipped_generations: outcome.universe.skipped,
  });
});

route("GET", "/api/histogram", "none", async (ctx) => {
  const { stream } = await streamOf(ctx, ctx.query.get("stream") ?? "", true);
  const zone = ctx.query.get("tz") ?? "UTC";
  if (!isKnownZone(zone)) throw errors.invalid({ tz: `Unknown time zone ${zone}.` });
  const request = requestOf(queryParams(ctx));
  const outcome = await runQuery(stream, request);
  const { interval, buckets } = labelledBuckets(outcome.matched.map((item) => item.event.ts), request.from, request.to, zone);
  return ok({ interval, buckets, total: outcome.matched.length, partial: outcome.universe.partial, skipped_generations: outcome.universe.skipped });
});

route("GET", "/api/fields", "none", async (ctx) => {
  const { stream } = await streamOf(ctx, ctx.query.get("stream") ?? "", true);
  const range = rangeOf(ctx.query.get("from"), ctx.query.get("to"));
  return ok({ fields: fieldList(stream, range.from, range.to) });
});

route("GET", "/api/fields/stats", "none", async (ctx) => {
  const { stream } = await streamOf(ctx, ctx.query.get("stream") ?? "", true);
  const request = requestOf(queryParams(ctx));
  const outcome = await runQuery(stream, request);
  return ok(fieldStatistics(stream, outcome.matched, ctx.query.get("field") ?? "", request.from, request.to));
});

route("GET", "/api/suggest", "none", async (ctx) => {
  const { stream } = await streamOf(ctx, ctx.query.get("stream") ?? "", true);
  const range = rangeOf(ctx.query.get("from"), ctx.query.get("to"));
  const cursor = Number(ctx.query.get("cursor") ?? "0");
  const text = Array.from(ctx.query.get("q") ?? "");
  const universe = await loadUniverse(stream, range.from, range.to);
  return ok(suggest(stream, universe.events, text.slice(0, Number.isInteger(cursor) && cursor >= 0 ? cursor : text.length).join(""), range.from, range.to));
});

route("POST", "/api/analyze", "json", async (ctx) => {
  await authorize(ctx, { role: "viewer", keyAction: "read" });
  const body = ctx.json();
  const check = new Check();
  if (!ANALYZERS.includes(body.analyzer as Analyzer)) check.fail("analyzer", "Choose standard, keyword or whitespace.");
  if (typeof body.text !== "string") check.fail("text", "Enter some text to analyze.");
  check.done();
  return ok({ tokens: analyze(body.analyzer as Analyzer, body.text as string) });
});

route("POST", "/api/snapshots", "json", async (ctx) => {
  const body = ctx.json();
  const { access, stream } = await streamOf(ctx, typeof body.stream === "string" ? body.stream : "", true);
  const request = requestOf(body);
  if (body.sort !== undefined && body.sort !== null && parseSort(String(body.sort)) === "invalid") throw errors.invalid({ sort: "Sort by <field>:asc or <field>:desc." });
  const made = await createSnapshot(stream, access.space.id, { ...request, sort: typeof body.sort === "string" ? body.sort : null });
  return reply(201, made);
});

route("GET", "/api/snapshots/:id", "none", async (ctx) => {
  const access = await authorize(ctx, { role: "viewer", keyAction: "read" });
  return ok(await readSnapshot(access.space.id, ctx.params.id as string, ctx.query.get("after")));
});

route("GET", "/api/tail", "none", async (ctx) => {
  const { stream } = await streamOf(ctx, ctx.query.get("stream") ?? "", false);
  const events = openStream(ctx);
  events.send("start", { stream: stream.name });
  const budget = { second: -1, sent: 0 };
  events.onClose(
    subscribeTail(stream.id, (arrived) => {
      const allowed = tailBudget(budget, arrived.length);
      for (const event of arrived.slice(0, allowed)) events.send("line", event);
      if (allowed < arrived.length) events.send("slowed", { skipped: arrived.length - allowed });
    }),
  );
  return STREAMED;
});

route("POST", "/api/pipe", "json", async (ctx) => {
  const access = await authorize(ctx, { role: "viewer", keyAction: "read", rate: "search" });
  const body = ctx.json();
  if (typeof body.pipe !== "string") throw errors.invalid({ pipe: "Enter a Spoor Pipe." });
  const zone = access.principal.kind === "user" ? access.principal.timeZone : "UTC";
  return ok(await runPipe(access, body.pipe, zone));
});
