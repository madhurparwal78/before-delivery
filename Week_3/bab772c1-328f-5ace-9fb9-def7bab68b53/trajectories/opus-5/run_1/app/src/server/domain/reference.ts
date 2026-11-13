/** The reference ephemeris: one fetch per mission at a time, stored in SI units. */

import { pool, withTransaction } from "../db/pool.js";
import { REFERENCE_LOCK, withAdvisoryLock } from "../db/locks.js";
import { validation } from "../errors.js";
import { fetchVectors, firstPageUrl } from "../services/ephemeris.js";
import { recomputeResiduals } from "./residuals.js";
import { recordMissionChange } from "./changes.js";
import { findMissionRow, type MissionRow } from "./missionRead.js";
import type { Vector } from "../../shared/model.js";

export type ReferenceOutcome = "updated" | "unchanged" | "unavailable";

export const TARGET_PATTERN = /^[A-Z0-9-]{1,32}$/;

async function missionSpan(
  missionId: string,
): Promise<{ fromUnixS: number; toUnixS: number } | null> {
  const result = await pool.query<{ first_ms: number; last_ms: number }>(
    `select min(utc_ms)::bigint as first_ms, max(utc_ms)::bigint as last_ms
     from samples where mission_id = $1`,
    [missionId],
  );
  const row = result.rows[0];
  if (!row || row.first_ms === null) {
    return null;
  }
  return {
    fromUnixS: Math.floor(row.first_ms / 1000),
    toUnixS: Math.floor(row.last_ms / 1000),
  };
}

async function storeVectors(
  missionId: string,
  vectors: readonly Vector[],
): Promise<void> {
  await withTransaction(async (tx) => {
    await tx.query("delete from reference_vectors where mission_id = $1", [missionId]);
    for (const vector of vectors) {
      await tx.query(
        `insert into reference_vectors (mission_id, unix_ms, x_m, y_m, z_m, vx_m_s, vy_m_s, vz_m_s)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (mission_id, unix_ms) do nothing`,
        [
          missionId,
          vector.unix_ms,
          vector.x_m,
          vector.y_m,
          vector.z_m,
          vector.vx_m_s,
          vector.vy_m_s,
          vector.vz_m_s,
        ],
      );
    }
  });
}

async function vectorCount(missionId: string): Promise<number> {
  const result = await pool.query<{ count: number }>(
    "select count(*)::int as count from reference_vectors where mission_id = $1",
    [missionId],
  );
  return result.rows[0].count;
}

async function settleReference(
  mission: MissionRow,
  target: string,
  state: "ready" | "unavailable",
  kind: "reference.set" | "reference.refreshed",
  bumpVersion: boolean,
  fetchedMs: number | null,
  etag: string | null,
  etagUrl: string | null,
): Promise<void> {
  const count = state === "ready" ? await vectorCount(mission.id) : 0;
  await withTransaction(async (tx) => {
    await tx.query(
      `update missions set reference_target = $2, reference_state = $3,
         reference_fetched_ms = coalesce($4, reference_fetched_ms),
         reference_etag = $5, reference_etag_url = $6
       where id = $1`,
      [mission.id, target, state, fetchedMs, etag, etagUrl],
    );
    await recomputeResiduals(tx, mission.id, state === "ready");
    await recordMissionChange(tx, {
      missionId: mission.id,
      kind,
      data: { target, state, vector_count: count },
      bumpVersion,
    });
  });
}

export async function setReference(
  mission: MissionRow,
  target: string,
): Promise<{ outcome: Exclude<ReferenceOutcome, "unchanged">; mission: MissionRow }> {
  return withAdvisoryLock(REFERENCE_LOCK, mission.id, async () => {
    const span = await missionSpan(mission.id);
    if (!span) {
      throw new Error("a mission with no samples cannot take a reference");
    }
    await pool.query(
      "update missions set reference_target = $2, reference_state = 'fetching' where id = $1",
      [mission.id, target],
    );
    const result = await fetchVectors(target, span.fromUnixS, span.toUnixS, null);
    if (result.outcome === "unknown_target") {
      await pool.query(
        `update missions set reference_target = $2, reference_state = $3 where id = $1`,
        [mission.id, mission.reference_target, mission.reference_state],
      );
      throw validation({ target: "The ephemeris service does not know this target." });
    }
    if (result.outcome === "unavailable" || result.outcome === "unchanged") {
      await settleReference(mission, target, "unavailable", "reference.set", true, null, null, null);
      return { outcome: "unavailable" as const, mission: await reload(mission.id) };
    }
    await storeVectors(mission.id, result.vectors);
    await settleReference(
      mission,
      target,
      "ready",
      "reference.set",
      true,
      Date.now(),
      result.etag,
      result.firstPageUrl,
    );
    return { outcome: "updated" as const, mission: await reload(mission.id) };
  });
}

export async function refreshReference(
  mission: MissionRow,
): Promise<{ outcome: ReferenceOutcome; mission: MissionRow }> {
  return withAdvisoryLock(REFERENCE_LOCK, mission.id, async () => {
    const target = mission.reference_target;
    if (!target) {
      throw new Error("a refresh needs a target");
    }
    const span = await missionSpan(mission.id);
    if (!span) {
      throw new Error("a mission with no samples cannot refresh a reference");
    }
    const url = firstPageUrl(target, span.fromUnixS, span.toUnixS);
    const conditional =
      mission.reference_etag && mission.reference_etag_url === url
        ? mission.reference_etag
        : null;
    const result = await fetchVectors(target, span.fromUnixS, span.toUnixS, conditional);
    if (result.outcome === "unchanged") {
      const stateChanges = mission.reference_state !== "ready";
      await settleReference(
        mission,
        target,
        "ready",
        "reference.refreshed",
        stateChanges,
        Date.now(),
        mission.reference_etag,
        mission.reference_etag_url,
      );
      return { outcome: "unchanged" as const, mission: await reload(mission.id) };
    }
    if (result.outcome === "unknown_target" || result.outcome === "unavailable") {
      const stateChanges = mission.reference_state !== "unavailable";
      await settleReference(
        mission,
        target,
        "unavailable",
        "reference.refreshed",
        stateChanges,
        null,
        mission.reference_etag,
        mission.reference_etag_url,
      );
      return { outcome: "unavailable" as const, mission: await reload(mission.id) };
    }
    await storeVectors(mission.id, result.vectors);
    await settleReference(
      mission,
      target,
      "ready",
      "reference.refreshed",
      true,
      Date.now(),
      result.etag,
      result.firstPageUrl,
    );
    return { outcome: "updated" as const, mission: await reload(mission.id) };
  });
}

async function reload(missionId: string): Promise<MissionRow> {
  const row = await findMissionRow(pool, missionId);
  if (!row) {
    throw new Error("mission vanished during a reference fetch");
  }
  return row;
}
