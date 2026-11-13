/** Creating a mission and applying a JSON Merge Patch to it. */

import { isoInstant } from "../../shared/doy.js";
import type { DistanceUnit, SpeedUnit } from "../../shared/units.js";
import { pool, withTransaction } from "../db/pool.js";
import { recordMissionChange } from "./changes.js";
import { newId } from "./ids.js";
import { findMissionRow, type MissionRow } from "./missionRead.js";
import { recomputeResiduals } from "./residuals.js";

export async function createMission(name: string, epochMs: number): Promise<MissionRow> {
  const id = newId();
  const createdMs = Date.now();
  await withTransaction(async (tx) => {
    await tx.query(
      `insert into missions (id, name, epoch_ms, distance_unit, speed_unit, created_ms)
       values ($1, $2, $3, 'km', 'm_s', $4)`,
      [id, name, epochMs, createdMs],
    );
    await recordMissionChange(tx, {
      missionId: id,
      kind: "mission.created",
      data: { name, epoch_utc: isoInstant(epochMs) },
      bumpVersion: false,
      atMs: createdMs,
    });
  });
  const row = await findMissionRow(pool, id);
  if (!row) {
    throw new Error("mission vanished after creation");
  }
  return row;
}

export type MissionPatch = {
  name?: string;
  distance_unit?: DistanceUnit;
  speed_unit?: SpeedUnit;
  clearReference?: boolean;
};

/** Applies the patch; an unchanged member writes nothing. */
export async function patchMission(
  mission: MissionRow,
  patch: MissionPatch,
): Promise<MissionRow> {
  const changed: Record<string, string | null> = {};
  if (patch.name !== undefined && patch.name !== mission.name) {
    changed.name = patch.name;
  }
  if (patch.distance_unit !== undefined && patch.distance_unit !== mission.distance_unit) {
    changed.distance_unit = patch.distance_unit;
  }
  if (patch.speed_unit !== undefined && patch.speed_unit !== mission.speed_unit) {
    changed.speed_unit = patch.speed_unit;
  }
  const clearsReference = patch.clearReference === true && mission.reference_target !== null;
  if (clearsReference) {
    changed.reference_target = null;
  }
  if (Object.keys(changed).length === 0) {
    return mission;
  }
  await withTransaction(async (tx) => {
    await tx.query(
      `update missions set
         name = coalesce($2, name),
         distance_unit = coalesce($3, distance_unit),
         speed_unit = coalesce($4, speed_unit)
       where id = $1`,
      [
        mission.id,
        changed.name ?? null,
        changed.distance_unit ?? null,
        changed.speed_unit ?? null,
      ],
    );
    if (clearsReference) {
      await tx.query(
        `update missions set reference_target = null, reference_state = null,
           reference_fetched_ms = null, reference_etag = null, reference_etag_url = null
         where id = $1`,
        [mission.id],
      );
      await tx.query("delete from reference_vectors where mission_id = $1", [mission.id]);
      await recomputeResiduals(tx, mission.id, false);
    }
    await recordMissionChange(tx, {
      missionId: mission.id,
      kind: "mission.updated",
      data: changed,
      bumpVersion: changed.name !== undefined || clearsReference,
    });
  });
  const row = await findMissionRow(pool, mission.id);
  if (!row) {
    throw new Error("mission vanished during a patch");
  }
  return row;
}
