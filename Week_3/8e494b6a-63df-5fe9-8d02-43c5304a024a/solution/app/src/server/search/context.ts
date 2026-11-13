// A stream as a search sees it: its generations and their types, and the events of a time range from live rows and segments.
import { pool } from "../db";
import { getObject, StorageUnavailable } from "../storage";
import type { Lifecycle, StreamRef } from "../access";
import { loadGenerations, loadTypes, type GenerationRow } from "../streams";
import type { FieldType, Doc } from "./fields";
import { MemoryTermIndex, PostgresTermIndex, CompositeIndex, type TermIndex } from "./index";
import { parseSegment, storedEvent, type EventPhase, type StoredEvent } from "./events";
import type { QuerySchema } from "./parser";

export interface StreamContext {
  id: number;
  name: string;
  spaceId: number;
  policy: Lifecycle;
  writeGeneration: number;
  generations: GenerationRow[];
  types: Map<number, Map<string, FieldType>>;
}

export async function loadStreamContext(stream: StreamRef, spaceId: number): Promise<StreamContext> {
  const [generations, types] = await Promise.all([loadGenerations(pool, stream.id), loadTypes(pool, stream.id)]);
  return { id: stream.id, name: stream.name, spaceId, policy: stream.lifecycle, writeGeneration: stream.writeGeneration, generations, types };
}

const PSEUDO: Record<string, FieldType> = { "@timestamp": "date", _id: "keyword" };

/** A field's types across the stream's generations, lowest generation first. */
export function typesOfField(ctx: StreamContext, field: string): FieldType[] {
  const pseudo = PSEUDO[field];
  if (pseudo) return [pseudo];
  const found: FieldType[] = [];
  for (const generation of [...ctx.types.keys()].sort((a, b) => a - b)) {
    const type = ctx.types.get(generation)?.get(field);
    if (type && !found.includes(type)) found.push(type);
  }
  return found;
}

export function schemaOf(ctx: StreamContext): QuerySchema {
  return {
    typesOf: (field) => typesOfField(ctx, field),
    hasPrefix: (path) => [...ctx.types.values()].some((fields) => [...fields.keys()].some((field) => field.startsWith(`${path}.`))),
  };
}

/** Generations that hold events inside the range. */
export function coveredGenerations(ctx: StreamContext, from: number, to: number): GenerationRow[] {
  return ctx.generations.filter((g) => g.phase !== "delete" && g.minTs !== null && g.maxTs !== null && g.minTs < to && g.maxTs >= from);
}

/** `Field <f> is <a> in generation <g> and <b> in generation <h>. It can't be sorted or counted.` when the range covers a type conflict. */
export function conflictSentence(ctx: StreamContext, field: string, from: number, to: number): string | null {
  if (PSEUDO[field]) return null;
  const typed = coveredGenerations(ctx, from, to)
    .map((g) => ({ generation: g.number, type: ctx.types.get(g.number)?.get(field) }))
    .filter((entry): entry is { generation: number; type: FieldType } => entry.type !== undefined)
    .sort((a, b) => a.generation - b.generation);
  const first = typed[0];
  const other = typed.find((entry) => entry.type !== first?.type);
  if (!first || !other) return null;
  return `Field ${field} is ${first.type} in generation ${first.generation} and ${other.type} in generation ${other.generation}. It can't be sorted or counted.`;
}

export interface Universe {
  events: StoredEvent[];
  archived: StoredEvent[];
  partial: boolean;
  skipped: number;
  index: TermIndex;
}

const phaseOf = (ctx: StreamContext, generation: number): EventPhase => {
  const phase = ctx.generations.find((g) => g.number === generation)?.phase;
  return phase === "warm" || phase === "archive" ? phase : "hot";
};

/** The events of a time range: live rows from Postgres plus archived generations read back from their segments. */
export async function loadUniverse(ctx: StreamContext, from: number, to: number): Promise<Universe> {
  const { rows } = await pool.query<{ ext_id: string; generation: number; ts: number; doc: Doc; pipeline: string | null; ordinal: number }>(
    "SELECT ext_id, generation, ts, doc, pipeline, ordinal FROM events WHERE stream_id = $1 AND ts >= $2 AND ts < $3",
    [ctx.id, from, to],
  );
  const events = rows.map((row) =>
    storedEvent({ id: row.ext_id, generation: row.generation, phase: phaseOf(ctx, row.generation), ts: row.ts, doc: row.doc, pipeline: row.pipeline, ordinal: row.ordinal }),
  );
  const archived: StoredEvent[] = [];
  let skipped = 0;
  for (const generation of coveredGenerations(ctx, from, to).filter((g) => g.phase === "archive" && g.segmentKey)) {
    try {
      const text = (await getObject(generation.segmentKey as string)).toString("utf8");
      archived.push(...parseSegment(text, generation.number).filter((event) => event.ts >= from && event.ts < to));
    } catch (error) {
      if (!(error instanceof StorageUnavailable)) throw error;
      skipped++;
    }
  }
  const parts: TermIndex[] = [new PostgresTermIndex(ctx.id, from, to)];
  if (archived.length > 0) parts.push(new MemoryTermIndex(archived, (generation) => ctx.types.get(generation) ?? new Map()));
  return { events: [...events, ...archived], archived, partial: skipped > 0, skipped, index: new CompositeIndex(parts) };
}
