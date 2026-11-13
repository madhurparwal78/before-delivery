/** Landmarks: at most five per mission, caselessly unique, never indexed. */

import type { JsonValue } from "../../shared/canonical.js";
import { isValidLatitude, isValidLongitude } from "../../shared/coords.js";
import { readTextField } from "./validation.js";
import { isoInstant } from "../../shared/doy.js";
import { caselessKey } from "../../shared/text.js";
import type { Landmark } from "../../shared/model.js";
import { withTransaction } from "../db/pool.js";
import { conflict, landmarkNotFound, validation } from "../errors.js";
import { recordMissionChange } from "./changes.js";
import { newId } from "./ids.js";
import type { MissionRow } from "./missionRead.js";

const LANDMARK_LIMIT = 5;

export async function addLandmark(
  mission: MissionRow,
  fields: Record<string, JsonValue>,
): Promise<Landmark> {
  return withTransaction(async (tx) => {
    await tx.query("select pg_advisory_xact_lock(hashtext($1))", [`landmarks:${mission.id}`]);
    const held = await tx.query<{ count: number }>(
      "select count(*)::int as count from landmarks where mission_id = $1",
      [mission.id],
    );
    if (held.rows[0].count >= LANDMARK_LIMIT) {
      throw conflict("landmark_limit", { message: "A mission holds at most 5 landmarks." });
    }
    const key = typeof fields.name === "string" ? caselessKey(fields.name.trim().normalize("NFC")) : "";
    const taken = await tx.query(
      "select id from landmarks where mission_id = $1 and name_key = $2",
      [mission.id, key],
    );
    if (taken.rowCount && taken.rowCount > 0) {
      throw conflict("landmark_name_taken", {
        message: "A landmark with this name already exists.",
      });
    }
    const errors: Record<string, string> = {};
    const checkedName = readTextField(fields.name, {
      min: 1, max: 40, lengthMessage: "Enter a landmark name of 1 to 40 characters.",
    });
    if (!checkedName.ok) errors.name = checkedName.message;
    const latitude = fields.lat_deg;
    if (typeof latitude !== "number" || !isValidLatitude(latitude)) {
      errors.lat_deg = "Give latitude in degrees from -90 to 90, with at most 6 decimals.";
    }
    const longitude = fields.lon_deg;
    if (typeof longitude !== "number" || !isValidLongitude(longitude)) {
      errors.lon_deg = "Give longitude in degrees above -180 and up to 180, with at most 6 decimals.";
    }
    if (Object.keys(errors).length > 0 || !checkedName.ok) throw validation(errors);
    const name = checkedName.value;
    const latDeg = latitude as number;
    const lonDeg = longitude as number;
    const id = newId();
    const createdMs = Date.now();
    await tx.query(
      `insert into landmarks (id, mission_id, name, name_key, lat_deg, lon_deg, created_ms)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [id, mission.id, name, key, latDeg, lonDeg, createdMs],
    );
    await recordMissionChange(tx, {
      missionId: mission.id,
      kind: "landmark.added",
      data: { landmark_id: id, name, lat_deg: latDeg, lon_deg: lonDeg },
      bumpVersion: true,
      atMs: createdMs,
    });
    return {
      id,
      name,
      lat_deg: latDeg,
      lon_deg: lonDeg,
      created_at: isoInstant(createdMs),
    };
  });
}

export async function removeLandmark(mission: MissionRow, landmarkId: string): Promise<void> {
  await withTransaction(async (tx) => {
    if (!/^[0-9a-fA-F-]{36}$/.test(landmarkId)) {
      throw landmarkNotFound();
    }
    const removed = await tx.query(
      "delete from landmarks where id = $1 and mission_id = $2 returning id",
      [landmarkId, mission.id],
    );
    if (removed.rowCount !== 1) {
      throw landmarkNotFound();
    }
    await recordMissionChange(tx, {
      missionId: mission.id,
      kind: "landmark.removed",
      data: { landmark_id: landmarkId },
      bumpVersion: true,
    });
  });
}
