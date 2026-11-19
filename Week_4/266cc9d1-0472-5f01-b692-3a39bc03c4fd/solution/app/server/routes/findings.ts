// Findings: create, edit, delete and terrain re-resolution, all only in a draft set.
import { firstRow, type Db } from "../db.js";
import { loadCorridor, type CorridorRecord } from "../domain/corridor.js";
import {
  deriveFinding,
  FINDING_COLUMNS,
  MESSAGES,
  nextLabelNumber,
  readGroundHeight,
  terrainLevelOf,
  validateFindingEdit,
  validateNewFinding,
  type FindingRow,
} from "../domain/finding.js";
import { loadSet, requireDraft, type SetState } from "../domain/findingsSet.js";
import { isFinerTerrain } from "../../shared/terrainLevel.js";
import { fail } from "../http/errors.js";
import { json, noInput, staffRoute, type Route, type StaffContext } from "../http/pipeline.js";
import { newId } from "../db.js";

interface LoadedFinding {
  finding: FindingRow;
  state: SetState;
  corridor: CorridorRecord;
}

/** Locks the finding, and shares the set lock so a concurrent submit waits for this change. */
async function loadFinding(ctx: StaffContext): Promise<LoadedFinding> {
  const found = await ctx.db.query<FindingRow & { state: SetState; corridor_id: string }>(
    `SELECT ${FINDING_COLUMNS.split(",").map((c) => `f.${c.trim()}`).join(", ")}, s.state, s.corridor_id
       FROM findings f JOIN findings_sets s ON s.id = f.set_id JOIN corridors c ON c.id = s.corridor_id
      WHERE f.id = $1 AND c.tenant_id = $2 FOR UPDATE OF f FOR SHARE OF s`,
    [ctx.params.id ?? "", ctx.staff.tenantId],
  );
  const row = found.rows[0];
  if (row === undefined) throw fail.notFound();
  const { state, corridor_id: corridorId, ...finding } = row;
  return { finding, state, corridor: await loadCorridor(ctx.db, ctx.staff.tenantId, corridorId) };
}

async function readFinding(db: Db, id: string): Promise<FindingRow> {
  return firstRow(await db.query<FindingRow>(`SELECT ${FINDING_COLUMNS} FROM findings WHERE id = $1`, [id]));
}

export const findingRoutes: Route[] = [
  staffRoute({
    method: "POST",
    path: "/api/findings-sets/:id/findings",
    role: "vegetation_analyst",
    load: async (ctx) => {
      const set = await loadSet(ctx.db, ctx.staff.tenantId, ctx.params.id ?? "", true);
      return { set, corridor: await loadCorridor(ctx.db, ctx.staff.tenantId, set.corridor_id) };
    },
    conflict: (_ctx, { set }) => requireDraft(set.state),
    validate: (ctx, { corridor }) => {
      const result = validateNewFinding(ctx.json, corridor);
      if ("fields" in result) throw fail.validation(result.fields);
      return result.input;
    },
    perform: async (ctx, { set, corridor }, input) => {
      const { location } = input;
      const id = newId("fnd");
      await ctx.db.query(
        `INSERT INTO findings (id, set_id, label_number, chainage_m, offset_m, lon_deg, lat_deg, ground_height_m,
                               terrain_level, canopy_height_m, canopy_radius_m, comment)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          id,
          set.id,
          await nextLabelNumber(ctx.db, set.id),
          location.chainageM,
          location.offsetM,
          location.lonDeg,
          location.latDeg,
          location.groundHeightM,
          location.terrainLevel,
          input.canopyHeightM,
          input.canopyRadiusM,
          input.comment,
        ],
      );
      return json(201, { finding: deriveFinding(await readFinding(ctx.db, id), corridor) });
    },
  }),

  staffRoute({
    method: "PATCH",
    path: "/api/findings/:id",
    role: "vegetation_analyst",
    load: loadFinding,
    conflict: (_ctx, { state }) => requireDraft(state),
    validate: (ctx, { corridor }) => {
      const result = validateFindingEdit(ctx.json, corridor);
      if ("fields" in result) throw fail.validation(result.fields);
      return result.input;
    },
    perform: async (ctx, { finding, corridor }, input) => {
      const location = input.location;
      await ctx.db.query(
        `UPDATE findings SET
           canopy_height_m = COALESCE($2, canopy_height_m),
           canopy_radius_m = COALESCE($3, canopy_radius_m),
           comment = COALESCE($4, comment),
           chainage_m = CASE WHEN $5 THEN $6 ELSE chainage_m END,
           offset_m = CASE WHEN $5 THEN $7 ELSE offset_m END,
           lon_deg = CASE WHEN $5 THEN $8 ELSE lon_deg END,
           lat_deg = CASE WHEN $5 THEN $9 ELSE lat_deg END,
           ground_height_m = CASE WHEN $5 THEN $10 ELSE ground_height_m END,
           terrain_level = CASE WHEN $5 THEN $11 ELSE terrain_level END,
           updated_at = clock_timestamp()
         WHERE id = $1`,
        [
          finding.id,
          input.canopyHeightM,
          input.canopyRadiusM,
          input.comment,
          location !== null,
          location?.chainageM ?? null,
          location?.offsetM ?? null,
          location?.lonDeg ?? null,
          location?.latDeg ?? null,
          location?.groundHeightM ?? null,
          location?.terrainLevel ?? null,
        ],
      );
      return json(200, { finding: deriveFinding(await readFinding(ctx.db, finding.id), corridor) });
    },
  }),

  staffRoute({
    method: "DELETE",
    path: "/api/findings/:id",
    role: "vegetation_analyst",
    load: loadFinding,
    conflict: (_ctx, { state }) => requireDraft(state),
    validate: noInput,
    perform: async (ctx, { finding }) => {
      await ctx.db.query("DELETE FROM findings WHERE id = $1", [finding.id]);
      return { status: 204 };
    },
  }),

  staffRoute({
    method: "POST",
    path: "/api/findings/:id/terrain",
    role: "vegetation_analyst",
    load: loadFinding,
    conflict: (ctx, { state, finding }) => {
      requireDraft(state);
      const level = terrainLevelOf(ctx.json.terrain_level);
      if (level.ok && !isFinerTerrain(level.level, finding.terrain_level)) {
        throw fail.conflict("coarser_terrain", "That terrain level is not finer than the one already recorded.");
      }
    },
    validate: (ctx) => {
      const ground = readGroundHeight(ctx.json.ground_height_m);
      const level = terrainLevelOf(ctx.json.terrain_level);
      if (ground === null || !level.ok) {
        throw fail.validation({
          ...(ground === null ? { ground_height_m: MESSAGES.ground } : {}),
          ...(level.ok ? {} : { terrain_level: MESSAGES.level }),
        });
      }
      return { groundHeightM: ground, terrainLevel: level.level };
    },
    perform: async (ctx, { finding, corridor }, input) => {
      const previous = deriveFinding(finding, corridor);
      await ctx.db.query(
        "UPDATE findings SET ground_height_m = $2, terrain_level = $3, updated_at = clock_timestamp() WHERE id = $1",
        [finding.id, input.groundHeightM, input.terrainLevel],
      );
      return json(200, {
        finding: deriveFinding(await readFinding(ctx.db, finding.id), corridor),
        previous: {
          ground_height_m: previous.ground_height_m,
          terrain_level: previous.terrain_level,
          clearance_m: previous.clearance_m,
        },
      });
    },
  }),
];
