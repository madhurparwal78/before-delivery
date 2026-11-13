// Programs, their rule editions and progress (DP-28, DP-29, DP-64).
import type { Pool, PoolClient } from "pg";
import type { ProgramSummary, ProgramDetail } from "#shared/api.js";
import type { RuleEdition } from "#shared/completeness.js";
import { editionForDate } from "#shared/completeness.js";

export interface ProgramRecord {
  readonly id: string;
  readonly name: string;
  readonly requiredCount: number;
  readonly coordinator_name: string;
  readonly coordinator_email: string;
  readonly editions: readonly RuleEdition[];
  readonly objectIds: readonly string[];
}

export async function loadProgramById(client: PoolClient | Pool, programId: string): Promise<ProgramRecord | null> {
  const result = await client.query(`
    SELECT p.id, p.name, p.required_count, p.coordinator_name, p.coordinator_email,
           (SELECT jsonb_agg(jsonb_build_object('edition', e.edition, 'effective_from', e.effective_from,
              'min_description', e.min_description, 'sketch_required', e.sketch_required,
              'concentration_required', e.concentration_required, 'pair_required', e.pair_required) ORDER BY e.edition)
              FROM program_editions e WHERE e.program_id = p.id) AS editions,
           (SELECT jsonb_agg(object_id ORDER BY position) FROM program_objects po WHERE po.program_id = p.id) AS object_ids
    FROM programs p WHERE p.id = $1`, [programId]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    requiredCount: row.required_count,
    coordinator_name: row.coordinator_name,
    coordinator_email: row.coordinator_email,
    editions: row.editions ?? [],
    objectIds: row.object_ids ?? [],
  };
}

export async function listPrograms(client: PoolClient | Pool): Promise<ProgramRecord[]> {
  const result = await client.query(`
    SELECT p.id, p.name, p.required_count, p.coordinator_name, p.coordinator_email,
           (SELECT jsonb_agg(jsonb_build_object('edition', e.edition, 'effective_from', e.effective_from,
              'min_description', e.min_description, 'sketch_required', e.sketch_required,
              'concentration_required', e.concentration_required, 'pair_required', e.pair_required) ORDER BY e.edition)
              FROM program_editions e WHERE e.program_id = p.id) AS editions,
           (SELECT jsonb_agg(object_id ORDER BY position) FROM program_objects po WHERE po.program_id = p.id) AS object_ids
    FROM programs p ORDER BY p.name`);
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    requiredCount: row.required_count,
    coordinator_name: row.coordinator_name,
    coordinator_email: row.coordinator_email,
    editions: row.editions ?? [],
    objectIds: row.object_ids ?? [],
  }));
}

export interface ObservationForProgress {
  readonly observation_id: string;
  readonly object_id: string;
  readonly evening_date: string;
  readonly observed_at_text: string | null;
  readonly created_at: Date;
  readonly seeing: number | null;
  readonly transparency_nelm: string | null;
  readonly description: string;
  readonly strokes_sha256: string | null;
  readonly concentration_class: string | null;
  readonly kind: string;
  readonly has_pair: boolean;
}

export async function loadAccountObservations(client: PoolClient | Pool, accountId: string): Promise<ObservationForProgress[]> {
  const result = await client.query(`
    SELECT o.id, o.object_id, o.evening_date, o.observed_at_text, o.created_at, o.seeing, o.transparency_nelm,
           o.description, o.strokes_sha256, o.concentration_class, ob.kind,
           (o.pair_primary IS NOT NULL AND o.pair_secondary IS NOT NULL) AS has_pair
    FROM observations o JOIN objects ob ON ob.id = o.object_id
    WHERE o.account_id = $1 AND o.deleted = false`, [accountId]);
  return result.rows.map((row) => ({
    observation_id: row.id,
    object_id: row.object_id,
    evening_date: row.evening_date,
    observed_at_text: row.observed_at_text,
    created_at: row.created_at,
    seeing: row.seeing,
    transparency_nelm: row.transparency_nelm,
    description: row.description,
    strokes_sha256: row.strokes_sha256,
    concentration_class: row.concentration_class,
    kind: row.kind,
    has_pair: row.has_pair,
  }));
}

// The completeness rule together with the choice of rule edition lives in
// shared/completeness; this is its caller for program progress.
export function qualifyingObservationFor(
  observations: readonly ObservationForProgress[],
  editions: readonly RuleEdition[],
): ObservationForProgress | null {
  let best: ObservationForProgress | null = null;
  for (const observation of observations) {
    const edition = editionForDate(editions, observation.evening_date);
    const kind = observation.kind;
    if (!observation.observed_at_text) continue;
    if (observation.seeing === null) continue;
    if (observation.transparency_nelm === null) continue;
    if (observation.description.trim().length < edition.min_description) continue;
    if (edition.sketch_required && observation.strokes_sha256 === null) continue;
    if (edition.concentration_required && observation.concentration_class === null) continue;
    if (edition.pair_required && kind === "double_star" && !observation.has_pair) continue;
    if (!best) {
      best = observation;
      continue;
    }
    if (newerObservation(observation, best)) best = observation;
  }
  return best;
}

// Newest means the latest observed_at; ties go to the one created later, and
// observations without a time count last.
export function newerObservation(a: ObservationForProgress, b: ObservationForProgress): boolean {
  const aMs = a.observed_at_text ? Date.parse(a.observed_at_text) : Number.NEGATIVE_INFINITY;
  const bMs = b.observed_at_text ? Date.parse(b.observed_at_text) : Number.NEGATIVE_INFINITY;
  if (aMs !== bMs) return aMs > bMs;
  return a.created_at.getTime() > b.created_at.getTime();
}

export function representativeQualifyingObservation(
  observations: readonly ObservationForProgress[],
  editions: readonly RuleEdition[],
  objectIds: readonly string[],
): Map<string, string> {
  const byObject = new Map<string, ObservationForProgress[]>();
  for (const observation of observations) {
    if (!objectIds.includes(observation.object_id)) continue;
    const list = byObject.get(observation.object_id) ?? [];
    list.push(observation);
    byObject.set(observation.object_id, list);
  }
  const result = new Map<string, string>();
  for (const [objectId, list] of byObject) {
    const qualifying = qualifyingObservationFor(list, editions);
    if (qualifying) result.set(objectId, qualifying.observation_id);
  }
  return result;
}

export async function programSummariesFor(pool: Pool, accountId: string): Promise<ProgramSummary[]> {
  const programs = await listPrograms(pool);
  const follows = await pool.query<{ program_id: string }>("SELECT program_id FROM program_follows WHERE account_id = $1", [accountId]);
  const followed = new Set(follows.rows.map((row) => row.program_id));
  const observations = await loadAccountObservations(pool, accountId);
  return programs.map((program) => {
    const qualifying = representativeQualifyingObservation(observations, program.editions, program.objectIds);
    const newest = program.editions[program.editions.length - 1];
    return {
      id: program.id,
      name: program.name,
      required_count: program.requiredCount,
      sketch_required: newest?.sketch_required ?? false,
      min_description: newest?.min_description ?? 0,
      concentration_required: newest?.concentration_required ?? false,
      pair_required: newest?.pair_required ?? false,
      editions: program.editions,
      coordinator_name: program.coordinator_name,
      following: followed.has(program.id),
      progress: {
        qualifying: qualifying.size,
        total: program.objectIds.length,
        required: program.requiredCount,
      },
    };
  });
}

export async function programDetailFor(pool: Pool, accountId: string, programId: string): Promise<ProgramDetail | null> {
  const program = await loadProgramById(pool, programId);
  if (!program) return null;
  const follows = await pool.query<{ program_id: string }>("SELECT program_id FROM program_follows WHERE account_id = $1 AND program_id = $2", [accountId, programId]);
  const observations = await loadAccountObservations(pool, accountId);
  const byObject = new Map<string, ObservationForProgress[]>();
  for (const observation of observations) {
    if (!program.objectIds.includes(observation.object_id)) continue;
    const list = byObject.get(observation.object_id) ?? [];
    list.push(observation);
    byObject.set(observation.object_id, list);
  }
  const objects = await pool.query<{ id: string; designation: string; name: string }>(
    "SELECT id, designation, name FROM objects",
  );
  const objectById = new Map(objects.rows.map((row) => [row.id, row]));
  const rows = program.objectIds.map((objectId) => {
    const list = byObject.get(objectId) ?? [];
    const qualifying = qualifyingObservationFor(list, program.editions);
    return {
      object_id: objectId,
      designation: objectById.get(objectId)?.designation ?? objectId,
      name: objectById.get(objectId)?.name ?? "",
      qualifying_observation_id: qualifying?.observation_id ?? null,
    };
  });
  const newest = program.editions[program.editions.length - 1];
  const qualifyingCount = rows.filter((row) => row.qualifying_observation_id !== null).length;
  return {
    id: program.id,
    name: program.name,
    required_count: program.requiredCount,
    sketch_required: newest?.sketch_required ?? false,
    min_description: newest?.min_description ?? 0,
    concentration_required: newest?.concentration_required ?? false,
    pair_required: newest?.pair_required ?? false,
    editions: program.editions,
    coordinator_name: program.coordinator_name,
    following: follows.rows.length > 0,
    progress: {
      qualifying: qualifyingCount,
      total: program.objectIds.length,
      required: program.requiredCount,
    },
    objects: rows,
  };
}
