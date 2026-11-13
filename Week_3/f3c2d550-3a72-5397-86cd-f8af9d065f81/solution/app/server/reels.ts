import type { Reel, ReelSummary } from "../shared/api.js";
import { pool, query, transaction, type Queryable } from "./db.js";
import { ApiError, validationError } from "./errors.js";
import { findReferences, newId, toReference, type ReferenceRow } from "./references.js";

const MAX_STOPS = 60;
const NAME_COPY = "Give the reel a name of 1 to 60 characters.";
const IDS_COPY = "Use each reference once, and only references in your library.";
const REFERENCE_COPY = "Use a reference that is in your library.";
const VERSION_COPY = "Send the reel's current version number.";

interface ReelRow {
  id: string;
  name: string;
  demo: boolean;
  version: number;
}

export async function findReel(id: string, client: Queryable = pool, lock = false): Promise<ReelRow> {
  const [row] = await query<ReelRow>(`SELECT id, name, demo, version FROM reel WHERE id = $1 ${lock ? "FOR UPDATE" : ""}`, [id], client);
  if (!row) throw new ApiError("not_found");
  return row;
}

export async function listReels(): Promise<ReelSummary[]> {
  return query<ReelSummary>(
    `SELECT r.id, r.name, r.demo, r.version,
            count(rs.reference_id)::int AS stop_count,
            count(d.id) FILTER (WHERE d.state = 'stored')::int AS playable_count
     FROM reel r
     LEFT JOIN reel_stop rs ON rs.reel_id = r.id
     LEFT JOIN deck_reference d ON d.id = rs.reference_id
     GROUP BY r.id ORDER BY r.seq`,
  );
}

export async function readReel(id: string, client: Queryable = pool): Promise<Reel> {
  const reel = await findReel(id, client);
  const rows = await query<ReferenceRow>(
    `SELECT d.* FROM reel_stop rs JOIN deck_reference d ON d.id = rs.reference_id
     WHERE rs.reel_id = $1 ORDER BY rs.position`,
    [id],
    client,
  );
  return { ...reel, stops: rows.map((row, index) => ({ position: index + 1, reference: toReference(row) })) };
}

export async function createReel(rawName: unknown): Promise<Reel> {
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (Array.from(name).length < 1 || Array.from(name).length > 60) throw validationError({ name: NAME_COPY });
  const id = newId("reel");
  await query("INSERT INTO reel (id, name, demo, version) VALUES ($1, $2, false, 1)", [id, name]);
  return readReel(id);
}

/** Appends a stored reference; the reel's row lock decides every race across app copies. */
export async function appendStop(reelId: string, rawReferenceId: unknown): Promise<Reel> {
  await transaction(async (client) => {
    const reel = await findReel(reelId, client, true);
    const referenceId = typeof rawReferenceId === "string" ? rawReferenceId : "";
    const [reference] = await findReferences([referenceId], client);
    if (!reference) throw validationError({ reference_id: REFERENCE_COPY });
    if (reference.state === "trashed") throw new ApiError("reference_trashed");
    const [counts] = await query<{ stops: number; present: boolean; last: number }>(
      `SELECT count(*)::int AS stops, coalesce(bool_or(reference_id = $2), false) AS present, coalesce(max(position), 0) AS last
       FROM reel_stop WHERE reel_id = $1`,
      [reelId, referenceId],
      client,
    );
    if (counts?.present) throw new ApiError("already_in_reel", { message: `${reference.title} is already in ${reel.name}.` });
    if ((counts?.stops ?? 0) >= MAX_STOPS) throw new ApiError("reel_full");
    await client.query("INSERT INTO reel_stop (reel_id, reference_id, position) VALUES ($1, $2, $3)", [reelId, referenceId, (counts?.last ?? 0) + 1]);
    await client.query("UPDATE reel SET version = version + 1 WHERE id = $1", [reelId]);
  });
  return readReel(reelId);
}

/** Replaces the whole order; leaving an id out removes that stop. Of two reorders on one version exactly one wins. */
export async function reorderStops(reelId: string, rawVersion: unknown, rawIds: unknown): Promise<Reel> {
  await transaction(async (client) => {
    const reel = await findReel(reelId, client, true);
    const version = typeof rawVersion === "number" && Number.isInteger(rawVersion) && rawVersion >= 1 ? rawVersion : null;
    if (version !== null && version !== reel.version) throw new ApiError("reel_version_conflict");
    const errors: Record<string, string> = {};
    if (version === null) errors.version = VERSION_COPY;
    const ids = Array.isArray(rawIds) && rawIds.every((id) => typeof id === "string") ? (rawIds as string[]) : null;
    if (ids === null || ids.length > MAX_STOPS || new Set(ids).size !== ids.length || (await findReferences(ids, client)).length !== ids.length) {
      errors.reference_ids = IDS_COPY;
    }
    if (Object.keys(errors).length > 0 || ids === null) throw validationError(errors);
    await client.query("DELETE FROM reel_stop WHERE reel_id = $1", [reelId]);
    for (const [index, referenceId] of ids.entries()) {
      await client.query("INSERT INTO reel_stop (reel_id, reference_id, position) VALUES ($1, $2, $3)", [reelId, referenceId, index + 1]);
    }
    await client.query("UPDATE reel SET version = version + 1 WHERE id = $1", [reelId]);
  });
  return readReel(reelId);
}

