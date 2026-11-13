/**
 * Streams, events, search, histogram, fields, suggestions, snapshots, analyze and tail routes.
 */
import type { Request, Response, Router } from "express";
import type { PoolClient } from "pg";
import { analyze } from "../shared/analyze";
import { QueryError, queryDepth } from "../shared/query";
import type { Filter, FlattenedEvent, GenerationInfo } from "../shared/types";
import { buildBuckets, chooseInterval } from "../shared/histogram";
import { flatten, isIsoDate, roundHalfAway, valuesOf } from "../shared/util";
import { config } from "./config";
import { nowMs } from "./clock";
import { errors } from "./errors";
import { nextId, withDb } from "./db";
import {
  type GenerationRow,
  type StreamRow,
  STREAM_MAX_EVENTS,
  checkAndInfer,
  eventsById,
  fieldConflicts,
  generationMapping,
  insertEvent,
  listGenerations,
  readSegment,
  requireStream,
  streamEventCount,
  unionMapping,
  writeGenerationRow,
} from "./events";
import { runSearch, toEvent, type SearchParams } from "./search";
import { hitRate, keyStreamAllowed, loadContext, needKeyAction, needRole, rateIdentity, type Ctx } from "./context";
import { broadcastToSpace, nextSeq } from "./bus";
import { generationsInfo } from "./lifecycle";
import { validateProcessors, runPipeline, type Processor } from "./pipelines";

interface RouteCtx {
  ctx: Ctx;
  db: PoolClient;
}

async function ctxFor(req: Request, spaceParam: string | null): Promise<RouteCtx> {
  return withDb(async (db) => {
    const ctx = await loadContext(db, req, spaceParam);
    if (!ctx) throw errors.notFound();
    return { ctx, db };
  });
}

function parseIntoFilters(raw: unknown): Filter[] {
  if (raw === undefined || raw === null || raw === "") return [];
  const parsed = JSON.parse(String(raw)) as Filter[];
  if (!Array.isArray(parsed)) throw errors.invalid({ filters: "Check the highlighted fields." });
  return parsed;
}

export function streamRoutes(router: Router): void {
  router.get("/api/streams", async (req: Request, res: Response) => {
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "viewer");
    needKeyAction(ctx, "read");
    const rows = await db.query<StreamRow>("SELECT id, space_id, name FROM streams WHERE space_id = $1 ORDER BY name", [
      ctx.spaceId,
    ]);
    const streams = [];
    for (const s of rows.rows) {
      const gens = await listGenerations(db, s.id);
      const write = gens.reduce((a, b) => (b.number > a.number ? b : a));
      const events = await streamEventCount(db, s.id);
      const failures = await db.query<{ n: string }>("SELECT count(*)::text AS n FROM failures WHERE stream_id = $1", [
        s.id,
      ]);
      streams.push({
        name: s.name,
        write_generation: write.number,
        events,
        failures: Number(failures.rows[0].n),
      });
    }
    res.json({ streams });
  });

  router.post("/api/streams", async (req: Request, res: Response) => {
    const body = req.body as { name?: unknown };
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "admin");
    needKeyAction(ctx, "manage");
    const name = typeof body.name === "string" ? body.name : "";
    if (!/^[a-z0-9-]{1,40}$/.test(name)) {
      throw errors.invalid({ name: "Use 1 to 40 characters: a-z, 0-9 or -." });
    }
    const existing = await db.query("SELECT 1 FROM streams WHERE space_id = $1 AND name = $2", [ctx.spaceId, name]);
    if (existing.rows.length > 0) throw errors.nameTaken();
    const id = nextId();
    await db.query("BEGIN");
    await db.query("INSERT INTO streams (id, space_id, name, created_at) VALUES ($1,$2,$3,now())", [
      id,
      ctx.spaceId,
      name,
    ]);
    const genId = nextId();
    await db.query(
      "INSERT INTO generations (id, stream_id, number, phase, created_at) VALUES ($1,$2,1,'hot',now())",
      [genId, id],
    );
    await db.query("COMMIT");
    const seq = nextSeq(ctx.spaceId);
    res.status(201).json({ name, write_generation: 1, seq });
  });

  router.get("/api/streams/:stream", async (req: Request, res: Response) => {
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "viewer");
    const stream = await requireStream(db, ctx.spaceId, req.params.stream);
    needKeyAction(ctx, "read", stream.name);
    keyStreamAllowed(ctx, stream.name);
    const gens = await listGenerations(db, stream.id);
    const mapping = [];
    for (const g of gens) {
      const m = await generationMapping(db, g.id);
      for (const [field, type] of m) {
        mapping.push({ field, type, generation: g.number, explicit: true });
      }
    }
    const explicitRows = await db.query<{ field: string; type: string; generation_id: string; explicit: boolean }>(
      "SELECT field, type, generation_id, explicit FROM mappings",
    );
    const genById = new Map(gens.map((g) => [g.id, g.number]));
    const seen = new Set<string>();
    const mappingOut: { field: string; type: string; generation: number; explicit: boolean }[] = [];
    for (const row of explicitRows.rows) {
      const g = genById.get(row.generation_id);
      if (g === undefined) continue;
      mappingOut.push({ field: row.field, type: row.type, generation: g, explicit: row.explicit });
    }
    const generations = await generationsInfo(db, ctx.spaceSlug, stream);
    res.json({ name: stream.name, mapping: mappingOut, generations });
  });

  router.post("/api/streams/:stream/mappings", async (req: Request, res: Response) => {
    const body = req.body as { field?: unknown; type?: unknown };
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "admin");
    const stream = await requireStream(db, ctx.spaceId, req.params.stream);
    needKeyAction(ctx, "manage", stream.name);
    keyStreamAllowed(ctx, stream.name);
    const field = typeof body.field === "string" ? body.field : "";
    const type = typeof body.type === "string" ? body.type : "";
    if (!field || !["number", "date", "boolean", "text", "keyword"].includes(type)) {
      throw errors.invalid({ field: "Check the highlighted fields.", type: "Check the highlighted fields." });
    }
    const write = await writeGenerationRow(db, stream.id);
    const m = await generationMapping(db, write.id);
    if (m.has(field)) {
      throw errors.mappingExists(field, write.number);
    }
    await db.query("INSERT INTO mappings (id, generation_id, field, type, explicit) VALUES ($1,$2,$3,$4,TRUE)", [
      nextId(),
      write.id,
      field,
      type,
    ]);
    const seq = nextSeq(ctx.spaceId);
    res.status(201).json({ field, type, generation: write.number, seq });
  });

  router.patch("/api/streams/:stream/events/:id", async (req: Request, res: Response) => {
    const body = req.body as { fields?: unknown };
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "editor");
    const stream = await requireStream(db, ctx.spaceId, req.params.stream);
    const found = await eventsById(db, stream.id, req.params.id);
    if (!found) throw errors.notFound();
    if (found.generation.phase !== "hot") {
      throw errors.generationReadOnly(found.generation.number, found.generation.phase);
    }
    if (!body.fields || typeof body.fields !== "object" || Array.isArray(body.fields)) {
      throw errors.invalid({ fields: "Check the highlighted fields." });
    }
    const fields = { ...found.event.fields, ...(body.fields as Record<string, unknown>) };
    await checkAndInfer(db, found.generation.id, fields);
    await db.query("DELETE FROM terms WHERE generation_id = $1 AND $2 = ANY(event_ids)", [
      found.generation.id,
      found.event.id,
    ]);
    await db.query("UPDATE events SET fields = $1, ts = $2 WHERE id = $3", [
      JSON.stringify(fields),
      new Date(String((body.fields as Record<string, unknown>)["@timestamp"] ?? found.event.ts.toISOString())),
      found.event.id,
    ]);
    await indexAgain(db, found.generation.id, found.event.id, fields);
    const seq = nextSeq(ctx.spaceId);
    broadcastToSpace(ctx.spaceId, "upload", { stored_total: await streamEventCount(db, stream.id) }, seq);
    const event = toEvent({ ...found, row: { ...found.event, fields } }, null);
    res.json(event);
  });

  router.get("/api/streams/:stream/events/:id/surrounding", async (req: Request, res: Response) => {
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "viewer");
    const stream = await requireStream(db, ctx.spaceId, req.params.stream);
    needKeyAction(ctx, "read", stream.name);
    keyStreamAllowed(ctx, stream.name);
    const found = await eventsById(db, stream.id, req.params.id);
    if (!found) throw errors.notFound();
    const gens = await listGenerations(db, stream.id);
    const all: { row: typeof found.event; generation: GenerationRow }[] = [];
    for (const g of gens) {
      if (g.phase === "archive") {
        try {
          const seg = await readSegment(g, ctx.spaceSlug, stream.name);
          for (const e of seg) all.push({ row: { ...e, id: e.event_id, generation_id: g.id }, generation: g });
        } catch {
          continue;
        }
      } else if (g.phase !== "delete") {
        const rows = await db.query(
          "SELECT id, generation_id, event_id, ts, fields, pipeline FROM events WHERE generation_id = $1",
          [g.id],
        );
        for (const r of rows.rows) all.push({ row: r as typeof found.event, generation: g });
      }
    }
    all.sort((a, b) => {
      const ta = a.row.ts.getTime();
      const tb = b.row.ts.getTime();
      if (ta !== tb) return ta - tb;
      return a.row.event_id < b.row.event_id ? -1 : 1;
    });
    const idx = all.findIndex((x) => x.row.event_id === req.params.id);
    const event = idx >= 0 ? toEvent(all[idx], null) : toEvent({ row: found.event, generation: found.generation }, null);
    const before = idx >= 0 ? all.slice(Math.max(0, idx - 5), idx).map((x) => toEvent(x, null)) : [];
    const after = idx >= 0 ? all.slice(idx + 1, idx + 6).map((x) => toEvent(x, null)) : [];
    res.json({ before, event, after });
  });

  router.get("/api/streams/:stream/generations", async (req: Request, res: Response) => {
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "viewer");
    const stream = await requireStream(db, ctx.spaceId, req.params.stream);
    needKeyAction(ctx, "read", stream.name);
    keyStreamAllowed(ctx, stream.name);
    const generations = await generationsInfo(db, ctx.spaceSlug, stream);
    res.json({ generations });
  });

  router.get("/api/streams/:stream/failures", async (req: Request, res: Response) => {
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "viewer");
    const stream = await requireStream(db, ctx.spaceId, req.params.stream);
    needKeyAction(ctx, "read", stream.name);
    keyStreamAllowed(ctx, stream.name);
    const rows = await db.query(
      "SELECT id, reason, raw, at FROM failures WHERE stream_id = $1 ORDER BY at DESC, id DESC",
      [stream.id],
    );
    res.json({ failures: rows.rows });
  });

  router.put("/api/streams/:stream/lifecycle", async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const { ctx, db } = await ctxFor(req, (req.query.space as string) ?? null);
    needRole(ctx, "admin");
    const stream = await requireStream(db, ctx.spaceId, req.params.stream);
    needKeyAction(ctx, "manage", stream.name);
    keyStreamAllowed(ctx, stream.name);
    const keys = [
      "rollover_max_age_ms",
      "rollover_max_events",
      "warm_after_ms",
      "archive_after_ms",
      "delete_after_ms",
    ];
    const fields: Record<string, string> = {};
    const policy: Record<string, number | null> = {};
    for (const k of keys) {
      const v = body[k];
      if (v === null || v === undefined) {
        policy[k] = null;
        continue;
      }
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
        fields[k] = "Check the highlighted fields.";
        continue;
      }
      policy[k] = v;
    }
    if (Object.keys(fields).length > 0) throw errors.invalid(fields);
    await db.query(
      `INSERT INTO lifecycle_policy (stream_id, rollover_max_age_ms, rollover_max_events, warm_after_ms, archive_after_ms, delete_after_ms)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (stream_id) DO UPDATE SET rollover_max_age_ms = $2, rollover_max_events = $3, warm_after_ms = $4, archive_after_ms = $5, delete_after_ms = $6`,
      [stream.id, policy.rollover_max_age_ms, policy.rollover_max_events, policy.warm_after_ms, policy.archive_after_ms, policy.delete_after_ms],
    );
    const seq = nextSeq(ctx.spaceId);
    res.json({
      policy,
      message: "Policy saved. It applies from the next step, and no generation moves backward.",
      seq,
    });
  });
}

async function indexAgain(db: PoolClient, generationId: string, eventId: string, fields: Record<string, unknown>): Promise<void> {
  await db.query("DELETE FROM terms WHERE generation_id = $1 AND $2 = ANY(event_ids)", [generationId, eventId]);
  await insertEventTerms(db, generationId, eventId, fields);
}

async function insertEventTerms(
  db: PoolClient,
  generationId: string,
  eventId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const byTerm = new Map<string, { positions: number[]; offsets: number[] }>();
  for (const [field, value] of Object.entries(fields)) {
    for (const v of valuesOf(value)) {
      if (typeof v !== "string") continue;
      for (const t of analyze("standard", v)) {
        const key = `${field}\u0000${t.token}`;
        const cur = byTerm.get(key) ?? { positions: [], offsets: [] };
        cur.positions.push(t.position);
        cur.offsets.push(t.start, t.end);
        byTerm.set(key, cur);
      }
    }
  }
  for (const [key, entry] of byTerm) {
    const sep = key.indexOf("\u0000");
    await db.query(
      "INSERT INTO terms (generation_id, field, token, positions, offsets, event_ids) VALUES ($1,$2,$3,$4,$5,$6)",
      [generationId, key.slice(0, sep), key.slice(sep + 1), entry.positions, entry.offsets, [eventId]],
    );
  }
}
