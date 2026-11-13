/**
 * Search, histogram, fields, statistics, suggestions, snapshots, tail, analyze and pipe routes.
 */
import type { Request, Response, Router } from "express";
import { analyze } from "../shared/analyze";
import { QueryError, queryDepth, relativeDate, parseQuery, collectLeaves } from "../shared/query";
import type { Filter, FlattenedEvent } from "../shared/types";
import { buildBuckets, chooseInterval } from "../shared/histogram";
import { flatten, fmtFixed, roundHalfAway, valuesOf } from "../shared/util";
import { formatInZone, isValidTimeZone } from "../shared/tz";
import { config } from "./config";
import { nowMs } from "./clock";
import { ApiError, errors } from "./errors";
import { nextId, withDb } from "./db";
import {
  type GenerationRow,
  type StreamRow,
  fieldConflicts,
  listGenerations,
  requireStream,
  streamEventCount,
  unionMapping,
  readSegment,
  generationEventCount,
} from "./events";
import { runSearch, toEvent, type SearchParams, type LoadedEvent } from "./search";
import { hitRate, keyStreamAllowed, loadContext, needKeyAction, needRole, rateIdentity, type Ctx } from "./context";
import { broadcastToSpace, nextSeq } from "./bus";
import { parsePipe, PipeError } from "../shared/pipe";

async function ctxFor(req: Request, spaceParam: string | null): Promise<{ ctx: Ctx; db: import("pg").PoolClient }> {
  return withDb(async (db) => {
    const ctx = await loadContext(db, req, spaceParam);
    if (!ctx) throw errors.notFound();
    return { ctx, db };
  });
}

function parseFilters(raw: unknown): Filter[] {
  if (raw === undefined || raw === null || raw === "") return [];
  const parsed = JSON.parse(String(raw)) as Filter[];
  if (!Array.isArray(parsed)) throw errors.invalid({ filters: "Check the highlighted fields." });
  return parsed.filter((f) => f && typeof f.field === "string");
}

function parseRange(query: Record<string, unknown>, now: number): { fromMs: number; toMs: number } {
  const toRaw = query.to ? String(query.to) : new Date(now).toISOString();
  const fromRaw = query.from ? String(query.from) : new Date(now - 900000).toISOString();
  const to = Date.parse(toRaw);
  const from = Date.parse(fromRaw);
  if (isNaN(to) || isNaN(from)) throw errors.invalid({ range: "Check the highlighted fields." });
  return { fromMs: from, toMs: to };
}

function queryOrEmpty(q: unknown): string {
  return typeof q === "string" ? q : "";
}

/** Build the search params and run the published query limits. */
async function buildParams(
  db: import("pg").PoolClient,
  ctx: Ctx,
  req: Request,
  streamName: string,
): Promise<SearchParams> {
  const stream = await requireStream(db, ctx.spaceId, streamName);
  const now = nowMs();
  const q = queryOrEmpty(req.query.q);
  const c = config().settings;
  if (q.length > c.query_max_len) throw errors.queryTooLong(c.query_max_len);
  if (queryDepth(q) > c.query_max_depth) throw errors.queryTooDeep(c.query_max_depth);
  const { fromMs, toMs } = parseRange(req.query as Record<string, unknown>, now);
  const size = Math.min(100, Math.max(1, Number(req.query.size ?? 50)));
  const offset = Math.max(0, Number(req.query.offset ?? 0));
  if (offset + size > c.result_window) {
    throw errors.resultWindow(c.result_window);
  }
  const sort = typeof req.query.sort === "string" ? req.query.sort : null;
  return {
    stream,
    spaceSlug: ctx.spaceSlug,
    q,
    fromMs,
    toMs,
    filters: parseFilters(req.query.filters),
    sort,
    size,
    offset,
    explain: req.query.explain === "true",
    id: typeof req.query.id === "string" ? req.query.id : null,
  };
}

export function searchRoutes(router: Router): void {
  router.get("/api/search", async (req: Request, res: Response) => {
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "viewer");
    hitRate("search", rateIdentity(ctx));
    const resolvedStream = await requireStream(db, ctx.spaceId, String(req.query.stream ?? ""));
    needKeyAction(ctx, "read", resolvedStream.name);
    keyStreamAllowed(ctx, resolvedStream.name);
    const params = await buildParams(db, ctx, req, String(req.query.stream ?? ""));
    try {
      const result = await runSearch(db, params);
      const events = result.events.map((e) => {
        if (params.explain) {
          const score = result.scores.get(e._id);
          if (score) {
            return {
              ...e,
              explanation: {
                value: score.score,
                text: `Score ${score.score}`,
                children: score.parts.map((p) => ({
                  value: p.value,
                  leaf: p.leaf,
                  field: p.field,
                  idf: p.idf,
                  tf_norm: p.tf_norm,
                  boost: p.boost,
                  text: p.text,
                })),
              },
            };
          }
        }
        return e;
      });
      res.json({
        total: result.total,
        events,
        partial: result.partial,
        skipped_generations: result.skipped_generations,
      });
    } catch (err) {
      translateQueryError(err);
    }
  });

  router.get("/api/histogram", async (req: Request, res: Response) => {
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "viewer");
    hitRate("search", rateIdentity(ctx));
    const resolvedStream = await requireStream(db, ctx.spaceId, String(req.query.stream ?? ""));
    needKeyAction(ctx, "read", resolvedStream.name);
    keyStreamAllowed(ctx, resolvedStream.name);
    const params = await buildParams(db, ctx, req, String(req.query.stream ?? ""));
    try {
      const result = await runSearch(db, { ...params, size: 100000, offset: 0 });
      const tz = typeof req.query.tz === "string" && isValidTimeZone(req.query.tz) ? req.query.tz : "UTC";
      const [intervalName, intervalMs] = chooseInterval(params.toMs - params.fromMs);
      const buckets = buildBuckets(tz, params.fromMs, params.toMs, intervalName, intervalMs);
      for (const b of buckets) {
        b.count = result.ordered.filter((le) => {
          const t = le.row.ts.getTime();
          return t >= b.start && t < b.end;
        }).length;
      }
      res.json({
        interval: intervalName,
        buckets: buckets.map((b) => ({
          start: new Date(b.start).toISOString(),
          end: new Date(b.end).toISOString(),
          count: b.count,
          label: b.label,
        })),
        total: result.total,
        partial: result.partial,
        skipped_generations: result.skipped_generations,
      });
    } catch (err) {
      translateQueryError(err);
    }
  });

  router.get("/api/fields", async (req: Request, res: Response) => {
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "viewer");
    hitRate("search", rateIdentity(ctx));
    const stream = await requireStream(db, ctx.spaceId, String(req.query.stream ?? ""));
    needKeyAction(ctx, "read", stream.name);
    keyStreamAllowed(ctx, stream.name);
    const now = nowMs();
    const { fromMs, toMs } = parseRange(req.query as Record<string, unknown>, now);
    const gens = await listGenerations(db, stream.id);
    const conflicts = await fieldConflicts(db, gens);
    const mapping = new Map<string, string>();
    for (const g of gens) {
      const m = await db.query<{ field: string; type: string }>(
        "SELECT field, type FROM mappings WHERE generation_id = $1",
        [g.id],
      );
      for (const row of m.rows) {
        if (!mapping.has(row.field)) mapping.set(row.field, row.type);
      }
    }
    const fields = [...mapping.entries()]
      .map(([field, type]) => ({
        field,
        type,
        ...(conflicts.has(field) ? { conflict: conflicts.get(field) } : {}),
      }))
      .sort((a, b) => (a.field < b.field ? -1 : 1));
    res.json({ fields });
  });

  router.get("/api/fields/stats", async (req: Request, res: Response) => {
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "viewer");
    hitRate("search", rateIdentity(ctx));
    const stream0 = await requireStream(db, ctx.spaceId, String(req.query.stream ?? ""));
    needKeyAction(ctx, "read", stream0.name);
    keyStreamAllowed(ctx, stream0.name);
    const field = String(req.query.field ?? "");
    const params = await buildParams(db, ctx, req, String(req.query.stream ?? ""));
    const gens = await listGenerations(db, params.stream.id);
    const conflicts = await fieldConflicts(db, gens);
    if (conflicts.has(field)) {
      throw errors.fieldConflict(conflicts.get(field)!);
    }
    try {
      const result = await runSearch(db, { ...params, size: 100000, offset: 0 });
      let present = 0;
      const counts = new Map<string, number>();
      for (const le of result.ordered) {
        const flat = flatten(le.row.fields);
        const raw = flat[field];
        if (raw === undefined) continue;
        present += 1;
        const seen = new Set<string>();
        for (const v of valuesOf(raw)) {
          const key = typeof v === "object" ? JSON.stringify(v) : String(v);
          if (seen.has(key)) continue;
          seen.add(key);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
      const top = [...counts.entries()]
        .map(([value, count]) => ({
          value,
          count,
          share: fmtFixed((count / Math.max(1, present)) * 100, 1),
        }))
        .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.value < b.value ? -1 : 1))
        .slice(0, 5);
      res.json({ field, present, total: result.total, top });
    } catch (err) {
      translateQueryError(err);
    }
  });

  router.get("/api/suggest", async (req: Request, res: Response) => {
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "viewer");
    const stream = await requireStream(db, ctx.spaceId, String(req.query.stream ?? ""));
    needKeyAction(ctx, "read", stream.name);
    keyStreamAllowed(ctx, stream.name);
    const q = queryOrEmpty(req.query.q);
    const cursor = Math.max(0, Number(req.query.cursor ?? 0));
    const now = nowMs();
    const { fromMs, toMs } = parseRange(req.query as Record<string, unknown>, now);
    const gens = await listGenerations(db, stream.id);
    const mapping = await unionMapping(db, gens);

    // What is being typed right before the caret?
    let kind: "field" | "operator" | "value" | "none" = "none";
    let fragment = "";
    let fieldOfValue: string | null = null;
    let afterOp = "";
    const before = q.slice(0, cursor);
    const valueStart = Math.max(before.lastIndexOf(":"), before.lastIndexOf(">"), before.lastIndexOf("<"));
    const opMatch = /([:><]=?)\s*([^:><\s]*)$/.exec(before);
    if (opMatch) {
      kind = "value";
      afterOp = opMatch[2];
      const opPos = before.length - opMatch[0].length;
      const fieldText = before.slice(0, opPos).trim();
      const fieldMatch = /([A-Za-z0-9_@.\-]+)$/.exec(fieldText);
      fieldOfValue = fieldMatch ? fieldMatch[1] : null;
      fragment = afterOp;
    } else {
      const wordMatch = /([A-Za-z0-9_@.\-]*)$/.exec(before);
      const word = wordMatch ? wordMatch[1] : "";
      if (word !== "" && !before.trim().endsWith(word + " ")) {
        // still typing a field name, unless an operator already closed it
        const precededByOp = /[:><]\s*$/.test(before.slice(0, before.length - word.length));
        if (precededByOp) {
          kind = "value";
          fieldOfValue = lastFieldOf(before.slice(0, before.length - word.length));
          fragment = word;
        } else {
          kind = "field";
          fragment = word;
        }
      } else if (word === "" && before !== "" && /[:><]=?\s*$/.test(before)) {
        kind = "operator";
        fragment = "";
      } else if (word !== "") {
        kind = "field";
        fragment = word;
      }
    }

    const items: { label: string; insert: string; count?: number }[] = [];
    if (kind === "field") {
      const matches = [...mapping.keys()]
        .filter((f) => f.startsWith(fragment))
        .sort()
        .slice(0, 10);
      items.push(...matches.map((f) => ({ label: f, insert: f })));
      if (items.length === 0 && fragment === "") {
        items.push(...[...mapping.keys()].sort().slice(0, 10).map((f) => ({ label: f, insert: f })));
      }
    } else if (kind === "operator") {
      const fieldText = before.trim();
      const fieldMatch = /([A-Za-z0-9_@.\-]+)$/.exec(fieldText);
      const field = fieldMatch ? fieldMatch[1] : null;
      const type = field ? mapping.get(field) : undefined;
      if (type === "number" || type === "date") {
        items.push(
          { label: ":", insert: ":" },
          { label: ">", insert: ">" },
          { label: ">=", insert: ">=" },
          { label: "<", insert: "<" },
          { label: "<=", insert: "<=" },
        );
      } else {
        items.push({ label: ":", insert: ":" });
      }
    } else if (kind === "value" && fieldOfValue) {
      const type = mapping.get(fieldOfValue);
      const counts = new Map<string, number>();
      const params = {
        stream,
        spaceSlug: ctx.spaceSlug,
        q: "",
        fromMs,
        toMs,
        filters: [],
        sort: null,
        size: 100000,
        offset: 0,
        explain: false,
        id: null,
      };
      const result = await runSearch(db, params);
      for (const le of result.ordered) {
        const flat = flatten(le.row.fields);
        const raw = flat[fieldOfValue];
        const candidates: string[] =
          type === "text"
            ? valuesOf(raw).filter((v): v is string => typeof v === "string").flatMap((v) => analyze("standard", v).map((t) => t.token))
            : valuesOf(raw).map((v) => String(v));
        const seen = new Set<string>();
        for (const c of candidates) {
          if (seen.has(c)) continue;
          seen.add(c);
          counts.set(c, (counts.get(c) ?? 0) + 1);
        }
      }
      const lower = fragment.toLowerCase();
      const list = [...counts.entries()]
        .filter(([value]) => value.toLowerCase().startsWith(lower))
        .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : 1))
        .slice(0, 10);
      for (const [value, count] of list) {
        items.push({ label: value, insert: wrapValue(value), count });
      }
    }
    res.json({ kind, items });
  });

  router.post("/api/analyze", async (req: Request, res: Response) => {
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "viewer");
    needKeyAction(ctx, "read");
    const body = req.body as { analyzer?: unknown; text?: unknown };
    const analyzer = typeof body.analyzer === "string" ? body.analyzer : "";
    const text = typeof body.text === "string" ? body.text : "";
    if (!["standard", "keyword", "whitespace"].includes(analyzer)) {
      throw errors.invalid({ analyzer: "Check the highlighted fields." });
    }
    const tokens = analyze(analyzer, text);
    res.json({ tokens });
  });

  router.post("/api/snapshots", async (req: Request, res: Response) => {
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "viewer");
    needKeyAction(ctx, "read");
    hitRate("search", rateIdentity(ctx));
    const body = req.body as Record<string, unknown>;
    const streamName = String(body.stream ?? "");
    const stream = await requireStream(db, ctx.spaceId, streamName);
    keyStreamAllowed(ctx, stream.name);
    const now = nowMs();
    const q = typeof body.q === "string" ? body.q : "";
    const c = config().settings;
    if (q.length > c.query_max_len) throw errors.queryTooLong(c.query_max_len);
    if (queryDepth(q) > c.query_max_depth) throw errors.queryTooDeep(c.query_max_depth);
    const fromMs = Date.parse(String(body.from ?? new Date(now - 900000).toISOString()));
    const toMs = Date.parse(String(body.to ?? new Date(now).toISOString()));
    const filters = Array.isArray(body.filters) ? (body.filters as Filter[]) : [];
    const sort = typeof body.sort === "string" ? body.sort : null;
    const params: SearchParams = {
      stream,
      spaceSlug: ctx.spaceSlug,
      q,
      fromMs,
      toMs,
      filters,
      sort,
      size: 100000,
      offset: 0,
      explain: false,
      id: null,
    };
    try {
      const result = await runSearch(db, params);
      const id = nextId();
      await db.query(
        `INSERT INTO snapshots (id, space_id, stream_id, q, filters, sort, from_ms, to_ms, total, event_ids, created_at, last_used_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),now())`,
        [
          id,
          ctx.spaceId,
          stream.id,
          q,
          JSON.stringify(filters),
          sort,
          fromMs,
          toMs,
          result.total,
          result.ordered.map((le) => le.row.id),
        ],
      );
      res.status(201).json({
        id,
        total: result.total,
        partial: result.partial,
        skipped_generations: result.skipped_generations,
      });
    } catch (err) {
      translateQueryError(err);
    }
  });

  router.get("/api/snapshots/:id", async (req: Request, res: Response) => {
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "viewer");
    needKeyAction(ctx, "read");
    const pageSize = config().settings.page_size;
    const after = req.query.after ? Number(req.query.after) : 0;
    const row = await db.query(
      "SELECT * FROM snapshots WHERE id = $1 AND space_id = $2",
      [req.params.id, ctx.spaceId],
    );
    const snap = row.rows[0];
    if (!snap) throw errors.notFound();
    const ttl = config().settings.snapshot_ttl_ms;
    const lastUsed = new Date(snap.last_used_at).getTime();
    if (nowMs() >= lastUsed + ttl) {
      throw errors.snapshotExpired();
    }
    await db.query("UPDATE snapshots SET last_used_at = now() WHERE id = $1", [req.params.id]);
    const ids: string[] = snap.event_ids;
    const start = Math.min(after, ids.length);
    const pageIds = ids.slice(start, start + pageSize);
    const stream = await db.query<StreamRow>("SELECT id, space_id, name FROM streams WHERE id = $1", [
      snap.stream_id,
    ]);
    const events: FlattenedEvent[] = [];
    for (const id of pageIds) {
      const found = await db.query(
        "SELECT id, generation_id, event_id, ts, fields, pipeline FROM events WHERE id = $1",
        [id],
      );
      if (found.rows[0]) {
        const gen = await db.query("SELECT number, phase FROM generations WHERE id = $1", [
          found.rows[0].generation_id,
        ]);
        events.push(
          toEvent(
            {
              row: found.rows[0],
              generation: { ...gen.rows[0], phase: gen.rows[0].phase } as GenerationRow,
            },
            null,
          ),
        );
      }
    }
    const next = start + pageSize < ids.length ? start + pageSize : null;
    // new_events: stored since the snapshot that match
    const created = new Date(snap.created_at).getTime();
    const params: SearchParams = {
      stream: stream.rows[0],
      spaceSlug: ctx.spaceSlug,
      q: snap.q,
      fromMs: Number(snap.from_ms),
      toMs: Number(snap.to_ms),
      filters: snap.filters,
      sort: null,
      size: 100000,
      offset: 0,
      explain: false,
      id: null,
    };
    let newEvents = 0;
    try {
      const result = await runSearch(db, params);
      newEvents = result.ordered.filter((le) => le.row.ts.getTime() > created).length;
    } catch {
      newEvents = 0;
    }
    res.json({ events, next, total: snap.total, new_events: newEvents });
  });

  router.get("/api/tail", async (req: Request, res: Response) => {
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "viewer");
    const stream = await requireStream(db, ctx.spaceId, String(req.query.stream ?? ""));
    needKeyAction(ctx, "read", stream.name);
    keyStreamAllowed(ctx, stream.name);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`event: start\ndata: ${JSON.stringify({ stream: stream.name })}\n\n`);
    const { addTailClient, removeTailClient } = await import("./tail.js");
    addTailClient(res, stream.id);
    req.on("close", () => removeTailClient(res));
  });

  router.post("/api/pipe", async (req: Request, res: Response) => {
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "viewer");
    needKeyAction(ctx, "read");
    hitRate("search", rateIdentity(ctx));
    const body = req.body as { pipe?: unknown };
    const text = typeof body.pipe === "string" ? body.pipe : "";
    const c = config().settings;
    if (text.length > c.query_max_len) throw errors.queryTooLong(c.query_max_len);
    try {
      const pipe = parsePipe(text);
      const { runPipe } = await import("./pipe-run.js");
      const result = await runPipe(db, ctx, pipe);
      res.json(result);
    } catch (err) {
      if (err instanceof PipeError) {
        throw errors.pipeSyntax(err.text, err.position);
      }
      if (err instanceof QueryError) {
        throw errors.querySyntax(err.text, err.position);
      }
      throw err;
    }
  });
}

function lastFieldOf(before: string): string | null {
  const m = /([A-Za-z0-9_@.\-]+)\s*[:><]=?\s*$/.exec(before);
  return m ? m[1] : null;
}

function wrapValue(value: string): string {
  if (/^[A-Za-z0-9\-_./]*$/.test(value) && value !== "") return value;
  return `"${value.replace(/(["\\])/g, "\\$1")}"`;
}

/** Map query errors to API errors, in the published shape. */
export function translateQueryError(err: unknown): void {
  if (err instanceof QueryError) {
    if (err.code !== "query_syntax") {
      const fn = (errors as unknown as Record<string, (n: number) => ApiError>)[err.code];
      throw fn(config().settings.query_max_len);
    }
    throw errors.querySyntax(err.text, err.position);
  }
  throw err;
}
