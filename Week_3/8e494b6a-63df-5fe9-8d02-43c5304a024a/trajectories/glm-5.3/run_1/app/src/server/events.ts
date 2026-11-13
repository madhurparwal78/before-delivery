/**
 * The event store: streams, generations, mappings, events and the app's own term index,
 * all in Postgres, plus the archive segment read path.
 */
import type { PoolClient } from "pg";
import { nextId } from "./db";
import { analyze } from "../shared/analyze";
import type { FieldType, FlattenedEvent, LifecyclePolicy, Phase } from "../shared/types";
import { flatten, inferType, isIsoDate, valueFitsType, valuesOf } from "../shared/util";
import { getObject, segmentKey, storageForcedDown } from "./storage";

export const STREAM_MAX_EVENTS = 100000;

export interface GenerationRow {
  id: string;
  stream_id: string;
  number: number;
  phase: Phase;
  created_at: Date;
  rolled_over_at: Date | null;
}

export interface StreamRow {
  id: string;
  space_id: string;
  name: string;
}

export async function getStream(db: PoolClient, spaceId: string, name: string): Promise<StreamRow | null> {
  const res = await db.query("SELECT id, space_id, name FROM streams WHERE space_id = $1 AND name = $2", [
    spaceId,
    name,
  ]);
  return (res.rows[0] as StreamRow) ?? null;
}

export async function requireStream(db: PoolClient, spaceId: string, name: string): Promise<StreamRow> {
  const s = await getStream(db, spaceId, name);
  if (!s) throw notFound();
  return s;
}

function notFound(): import("./errors").ApiError {
  const { errors } = require("./errors") as typeof import("./errors");
  return errors.notFound();
}

export async function listGenerations(db: PoolClient, streamId: string): Promise<GenerationRow[]> {
  const res = await db.query(
    "SELECT id, stream_id, number, phase, created_at, rolled_over_at FROM generations WHERE stream_id = $1 ORDER BY number",
    [streamId],
  );
  return res.rows as GenerationRow[];
}

export async function writeGenerationRow(db: PoolClient, streamId: string): Promise<GenerationRow> {
  const gens = await listGenerations(db, streamId);
  return gens.reduce((a, b) => (b.number > a.number ? b : a));
}

export async function generationMapping(db: PoolClient, generationId: string): Promise<Map<string, FieldType>> {
  const res = await db.query<{ field: string; type: FieldType }>(
    "SELECT field, type FROM mappings WHERE generation_id = $1",
    [generationId],
  );
  const out = new Map<string, FieldType>();
  for (const row of res.rows) out.set(row.field, row.type);
  return out;
}

/** Union mapping across generations, first type wins (conflicts are reported separately). */
export async function unionMapping(db: PoolClient, generations: GenerationRow[]): Promise<Map<string, FieldType>> {
  const out = new Map<string, FieldType>();
  for (const g of generations) {
    const m = await generationMapping(db, g.id);
    for (const [f, t] of m) {
      if (!out.has(f)) out.set(f, t);
    }
  }
  return out;
}

/** Field conflicts across the given generations, as the published sentence (rule A). */
export async function fieldConflicts(db: PoolClient, generations: GenerationRow[]): Promise<Map<string, string>> {
  const conflicts = new Map<string, string>();
  const seen = new Map<string, { gen: number; type: FieldType }>();
  const ordered = [...generations].sort((a, b) => a.number - b.number);
  for (const g of ordered) {
    const m = await generationMapping(db, g.id);
    for (const [f, t] of m) {
      const first = seen.get(f);
      if (!first) {
        seen.set(f, { gen: g.number, type: t });
      } else if (first.type !== t && !conflicts.has(f)) {
        conflicts.set(
          f,
          `Field ${f} is ${first.type} in generation ${first.gen} and ${t} in generation ${g.number}. It can't be sorted or counted.`,
        );
      }
    }
  }
  return conflicts;
}

export interface EventRow {
  id: string;
  generation_id: string;
  event_id: string;
  ts: Date;
  fields: Record<string, unknown>;
  pipeline: string | null;
}

interface RawEventRow {
  id: string;
  generation_id: string;
  event_id: string;
  ts: Date;
  fields: Record<string, unknown>;
  pipeline: string | null;
}

const EVENT_SELECT = "SELECT id, generation_id, event_id, ts, fields, pipeline FROM events";

function toRow(r: RawEventRow): EventRow {
  return { ...r, fields: r.fields ?? {} };
}

export async function eventsById(
  db: PoolClient,
  streamId: string,
  eventId: string,
): Promise<{ event: EventRow; generation: GenerationRow } | null> {
  const gens = await listGenerations(db, streamId);
  for (const g of gens) {
    if (g.phase === "archive" || g.phase === "delete") continue;
    const res = await db.query<RawEventRow>(`${EVENT_SELECT} WHERE generation_id = $1 AND event_id = $2`, [
      g.id,
      eventId,
    ]);
    if (res.rows[0]) return { event: toRow(res.rows[0]), generation: g };
  }
  for (const g of gens) {
    if (g.phase !== "archive") continue;
    const seg = await readSegment(g);
    const hit = seg.find((e) => e.event_id === eventId);
    if (hit) {
      return { event: { ...hit, id: hit.event_id, generation_id: g.id }, generation: g };
    }
  }
  return null;
}

export interface SegmentEvent {
  event_id: string;
  ts: Date;
  fields: Record<string, unknown>;
  pipeline: string | null;
}

const segmentCache = new Map<string, SegmentEvent[]>();

/** Forget cached segments when storage is switched up or down by the grading route. */
export function clearSegmentCache(): void {
  segmentCache.clear();
}

/**
 * Read a generation's archived segment from storage. Throws storageUnavailable when
 * storage is unreachable (including the grading switch), so searches report the
 * generation as skipped.
 */
export async function readSegment(g: GenerationRow, spaceSlug?: string, streamName?: string): Promise<SegmentEvent[]> {
  if (!g.rolled_over_at) return [];
  if (storageForcedDown()) throw storageUnavailable();
  const key = g.segment_key ?? segmentKeyFor(g, spaceSlug, streamName);
  const cached = segmentCache.get(key);
  if (cached) return cached;
  const bytes = await getObject(key);
  if (!bytes) throw storageUnavailable();
  const text = bytes.toString("utf8");
  const out: SegmentEvent[] = [];
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const parsed = JSON.parse(line) as {
      _id: string;
      "@timestamp": string;
      fields: Record<string, unknown>;
      _pipeline?: string | null;
    };
    out.push({
      event_id: parsed._id,
      ts: new Date(parsed["@timestamp"]),
      fields: parsed.fields,
      pipeline: parsed._pipeline ?? null,
    });
  }
  segmentCache.set(key, out);
  return out;
}

export function forgetSegment(spaceSlug: string, streamName: string, number: number): void {
  segmentCache.delete(segmentKey(spaceSlug, streamName, number));
}

declare module "./events" {
  interface GenerationRow {
    segment_key?: string;
  }
}

function segmentKeyFor(g: GenerationRow, spaceSlug?: string, streamName?: string): string {
  if (g.segment_key) return g.segment_key;
  return segmentKey(spaceSlug ?? "?", streamName ?? "?", g.number);
}

function storageUnavailable(): import("./errors").ApiError {
  const { errors } = require("./errors") as typeof import("./errors");
  return errors.storageUnavailable();
}

/** Insert one event and its term index rows. */
export async function insertEvent(
  db: PoolClient,
  generationId: string,
  event: { id: string; ts: Date; fields: Record<string, unknown>; pipeline: string | null; seq: number },
): Promise<void> {
  await db.query(
    "INSERT INTO events (id, generation_id, event_id, ts, fields, pipeline, seq, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now())",
    [nextId(), generationId, event.id, event.ts, JSON.stringify(event.fields), event.pipeline, event.seq],
  );
  await indexEvent(db, generationId, event.id, event.fields);
}

/** The term index for one event: one row per (field, token). */
export async function indexEvent(
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
    const field = key.slice(0, sep);
    const token = key.slice(sep + 1);
    await db.query(
      "INSERT INTO terms (generation_id, field, token, positions, offsets, event_ids) VALUES ($1,$2,$3,$4,$5,$6)",
      [generationId, field, token, entry.positions, entry.offsets, [eventId]],
    );
  }
}

export async function generationEventCount(db: PoolClient, generationId: string): Promise<number> {
  const res = await db.query<{ n: string }>("SELECT count(*)::text AS n FROM events WHERE generation_id = $1", [
    generationId,
  ]);
  return Number(res.rows[0].n);
}

export async function streamEventCount(db: PoolClient, streamId: string): Promise<number> {
  const gens = await listGenerations(db, streamId);
  let total = 0;
  for (const g of gens) {
    if (g.phase === "delete") continue;
    if (g.phase === "archive") {
      const seg = await readSegment(g);
      total += seg.length;
      continue;
    }
    total += await generationEventCount(db, g.id);
  }
  return total;
}

/** The API event body. */
export function toFlattened(
  row: { event_id: string; ts: Date; fields: Record<string, unknown>; pipeline: string | null },
  generation: number,
  phase: "hot" | "warm" | "archive",
  score: number | null,
  highlights: Record<string, [number, number][]> = {},
): FlattenedEvent {
  return {
    _id: row.event_id,
    "@timestamp": row.ts.toISOString(),
    _generation: generation,
    _phase: phase,
    _pipeline: row.pipeline,
    _score: score,
    fields: flatten(row.fields),
    highlights,
  };
}

export function valueTypeName(value: unknown): string {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") return isIsoDate(value) ? "date" : "text";
  return "text";
}

/** Type check and infer mappings for one event under rule A. Throws field_conflict on mismatch. */
export async function checkAndInfer(
  db: PoolClient,
  generationId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const mapping = await generationMapping(db, generationId);
  const flat = flatten(fields);
  for (const [field, value] of Object.entries(flat)) {
    const existing = mapping.get(field);
    if (existing) {
      if (!valueFitsType(value, existing)) {
        const { errors } = require("./errors") as typeof import("./errors");
        throw errors.fieldConflict(`field ${field} expects ${existing}, got ${valueTypeName(value)}.`);
      }
      continue;
    }
    const vals = valuesOf(value);
    if (vals.length === 0) continue;
    const inferred = inferType(vals[0]);
    if (!inferred) continue;
    for (const v of vals) {
      if (!valueFitsType(v, inferred)) {
        const { errors } = require("./errors") as typeof import("./errors");
        throw errors.fieldConflict(`field ${field} mixes types in one array.`);
      }
    }
    await db.query(
      "INSERT INTO mappings (id, generation_id, field, type, explicit) VALUES ($1,$2,$3,$4,FALSE) ON CONFLICT DO NOTHING",
      [nextId(), generationId, field, inferred],
    );
    mapping.set(field, inferred);
  }
}

export interface PolicyRow {
  stream_id: string;
  rollover_max_age_ms: number | null;
  rollover_max_events: number | null;
  warm_after_ms: number | null;
  archive_after_ms: number | null;
  delete_after_ms: number | null;
}

export async function getPolicy(db: PoolClient, streamId: string): Promise<PolicyRow | null> {
  const res = await db.query<PolicyRow>(
    "SELECT stream_id, rollover_max_age_ms, rollover_max_events, warm_after_ms, archive_after_ms, delete_after_ms FROM lifecycle_policy WHERE stream_id = $1",
    [streamId],
  );
  return res.rows[0] ?? null;
}
