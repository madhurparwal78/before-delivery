// Streams, generations and mappings: reading them, and the generation view the API and the page share.
import { pool, type Queryable } from "./db";
import { formatIso } from "../shared/time";
import { timelineText, type NextStep, type Phase } from "../shared/timeline";
import type { Lifecycle } from "./access";
import type { FieldType } from "./search/fields";

export interface GenerationRow {
  number: number;
  phase: Phase;
  createdMs: number;
  rolledOverMs: number | null;
  minTs: number | null;
  maxTs: number | null;
  segmentKey: string | null;
  segmentBytes: number | null;
  archivedEvents: number;
  archiveFailed: boolean;
  deleteFailed: boolean;
}

export async function loadGenerations(db: Queryable, streamId: number): Promise<GenerationRow[]> {
  const { rows } = await db.query<{
    number: number; phase: Phase; created_ms: number; rolled_over_ms: number | null; min_ts: number | null; max_ts: number | null;
    segment_key: string | null; segment_bytes: number | null; archived_events: number; archive_failed: boolean; delete_failed: boolean;
  }>("SELECT * FROM generations WHERE stream_id = $1 ORDER BY number", [streamId]);
  return rows.map((row) => ({
    number: row.number, phase: row.phase, createdMs: row.created_ms, rolledOverMs: row.rolled_over_ms, minTs: row.min_ts, maxTs: row.max_ts,
    segmentKey: row.segment_key, segmentBytes: row.segment_bytes, archivedEvents: row.archived_events,
    archiveFailed: row.archive_failed, deleteFailed: row.delete_failed,
  }));
}

export async function loadTypes(db: Queryable, streamId: number): Promise<Map<number, Map<string, FieldType>>> {
  const { rows } = await db.query<{ generation: number; field: string; type: FieldType }>(
    "SELECT generation, field, type FROM mappings WHERE stream_id = $1", [streamId],
  );
  const types = new Map<number, Map<string, FieldType>>();
  for (const row of rows) {
    const fields = types.get(row.generation) ?? new Map<string, FieldType>();
    fields.set(row.field, row.type);
    types.set(row.generation, fields);
  }
  return types;
}

async function eventCounts(db: Queryable, streamId: number): Promise<Map<number, number>> {
  const { rows } = await db.query<{ generation: number; n: number }>(
    "SELECT generation, count(*) AS n FROM events WHERE stream_id = $1 GROUP BY generation", [streamId],
  );
  return new Map(rows.map((row) => [row.generation, row.n]));
}

const PHASE_ORDER: Phase[] = ["hot", "warm", "archive", "delete"];
const THRESHOLDS: Array<{ phase: Exclude<Phase, "hot">; key: keyof Lifecycle }> = [
  { phase: "warm", key: "warm_after_ms" },
  { phase: "archive", key: "archive_after_ms" },
  { phase: "delete", key: "delete_after_ms" },
];

/** The furthest phase a rolled-over generation's age allows under the policy, never behind its current phase. */
export function phaseForAge(generation: GenerationRow, policy: Lifecycle, nowMs: number): Phase {
  if (generation.rolledOverMs === null) return generation.phase;
  const age = nowMs - generation.rolledOverMs;
  let phase = generation.phase;
  for (const { phase: candidate, key } of THRESHOLDS) {
    const after = policy[key];
    if (typeof after === "number" && age >= after && PHASE_ORDER.indexOf(candidate) > PHASE_ORDER.indexOf(phase)) phase = candidate;
  }
  return phase;
}

/** The next step a generation is waiting for, and when it becomes due. */
function nextStepOf(generation: GenerationRow, policy: Lifecycle, writeGeneration: number): NextStep | null {
  if (generation.phase === "delete") return null;
  if (generation.number === writeGeneration) {
    if (typeof policy.rollover_max_age_ms === "number") return { step: "rollover", at: generation.createdMs + policy.rollover_max_age_ms };
    if (typeof policy.rollover_max_events === "number") return { step: "rollover", at: null, events: policy.rollover_max_events };
    return null;
  }
  if (generation.rolledOverMs === null) return null;
  const due: NextStep[] = [];
  for (const { phase, key } of THRESHOLDS) {
    const after = policy[key];
    if (typeof after === "number" && PHASE_ORDER.indexOf(phase) > PHASE_ORDER.indexOf(generation.phase)) {
      due.push({ step: phase, at: generation.rolledOverMs + after });
    }
  }
  return due.sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || PHASE_ORDER.indexOf(b.step as Phase) - PHASE_ORDER.indexOf(a.step as Phase))[0] ?? null;
}

function generationView(generation: GenerationRow, policy: Lifecycle, writeGeneration: number, count: Map<number, number>) {
  const events = generation.phase === "archive" ? generation.archivedEvents : generation.phase === "delete" ? 0 : (count.get(generation.number) ?? 0);
  const next = nextStepOf(generation, policy, writeGeneration);
  return {
    number: generation.number,
    phase: generation.phase,
    created_at: formatIso(generation.createdMs),
    rolled_over_at: generation.rolledOverMs === null ? null : formatIso(generation.rolledOverMs),
    events,
    next: next && { step: next.step, at: next.at === null ? null : formatIso(next.at), ...(next.events === undefined ? {} : { events: next.events }) },
    segment: generation.segmentKey ? { key: generation.segmentKey, bytes: generation.segmentBytes } : null,
    archive_failed: generation.archiveFailed,
    delete_failed: generation.deleteFailed,
    timeline: timelineText(generation.number, generation.phase, next, "UTC"),
  };
}

type GenerationView = ReturnType<typeof generationView>;

export async function generationViews(streamId: number, policy: Lifecycle, writeGeneration: number): Promise<GenerationView[]> {
  const [generations, counts] = await Promise.all([loadGenerations(pool, streamId), eventCounts(pool, streamId)]);
  return generations.map((generation) => generationView(generation, policy, writeGeneration, counts));
}
