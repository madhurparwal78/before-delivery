/**
 * Seeding. Only missing rows are inserted, so a changed seeded row is never
 * reset. Seeded assets stay pending until their generated fixture files have
 * been written to object storage and confirmed.
 */

import { query, withAdvisoryLock, withTransaction } from "../db.js";
import {
  ASH_CREEK_TRACK,
  SEED_ASSETS,
  SEED_CORRIDORS,
  SEED_FINDINGS_SETS,
  SEED_STAFF,
  SEED_TENANTS,
  SEED_UTILITIES,
} from "../seed-data.js";
import { corridorGeometry, findCorridor } from "../domain/corridors.js";
import {
  declareAsset,
  findAsset,
  listAssetFiles,
  storeAssetFile,
  type ManifestFile,
} from "../domain/assets.js";
import { createFinding } from "../domain/findings.js";
import { sha256Hex } from "../services/storage.js";
import { geodesicDirect } from "../../shared/geodesy.js";
import { positionFromChainage, type CorridorGeometry } from "../../shared/corridor.js";
import { buildAshCreekCzml } from "./czml.js";
import { buildTerrainPyramid } from "./terrain.js";
import { buildTileset, type CanopySeed } from "./tileset.js";

const SEED_LOCK = 0x5041_4e32;
const FIXTURE_LOCK = 0x5041_4e33;

export async function applySeed(): Promise<void> {
  await withAdvisoryLock(SEED_LOCK, async () => {
    for (const tenant of SEED_TENANTS) {
      await query("INSERT INTO tenants (id, name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING", [
        tenant.id,
        tenant.name,
      ]);
    }
    for (const staff of SEED_STAFF) {
      await query(
        `INSERT INTO staff (id, tenant_id, name, role, email, access_code)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
        [staff.id, staff.tenantId, staff.name, staff.role, staff.email, staff.accessCode],
      );
    }
    for (const utility of SEED_UTILITIES) {
      await query(
        `INSERT INTO utilities (id, tenant_id, name, time_zone, forester_name, forester_email)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
        [
          utility.id,
          utility.tenantId,
          utility.name,
          utility.timeZone,
          utility.foresterName,
          utility.foresterEmail,
        ],
      );
    }
    for (const corridor of SEED_CORRIDORS) {
      const utility = SEED_UTILITIES.find((item) => item.id === corridor.utilityId)!;
      const lengthM = corridor.towers[corridor.towers.length - 1].chainageM;
      await query(
        `INSERT INTO corridors (
           id, tenant_id, utility_id, name, voltage_kv, clearance_threshold_m,
           origin_lon_deg, origin_lat_deg, azimuth_deg, length_m, inspection_due)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING`,
        [
          corridor.id,
          utility.tenantId,
          corridor.utilityId,
          corridor.name,
          corridor.voltageKv,
          corridor.clearanceThresholdM,
          corridor.originLonDeg,
          corridor.originLatDeg,
          corridor.azimuthDeg,
          lengthM,
          corridor.inspectionDue,
        ],
      );
      for (const tower of corridor.towers) {
        const point =
          tower.chainageM === 0
            ? { lonDeg: corridor.originLonDeg, latDeg: corridor.originLatDeg }
            : geodesicDirect(
                corridor.originLonDeg,
                corridor.originLatDeg,
                corridor.azimuthDeg,
                tower.chainageM,
              );
        await query(
          `INSERT INTO towers
             (corridor_id, number, chainage_m, base_height_m, attachment_height_m, lon_deg, lat_deg)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (corridor_id, number) DO NOTHING`,
          [
            corridor.id,
            tower.number,
            tower.chainageM,
            tower.baseHeightM,
            corridor.attachmentHeightM,
            point.lonDeg,
            point.latDeg,
          ],
        );
      }
    }

    for (const set of SEED_FINDINGS_SETS) {
      const corridorRow = await findCorridor(set.corridorId);
      if (!corridorRow) continue;
      const staff = SEED_STAFF.find((item) => item.accessCode === set.createdByCode)!;
      const inserted = await withTransaction(async (tx) =>
        tx.queryOne<{ id: string }>(
          `INSERT INTO findings_sets (id, tenant_id, corridor_id, revision, state)
           VALUES ($1,$2,$3,$4,'draft') ON CONFLICT (id) DO NOTHING RETURNING id`,
          [set.id, staff.tenantId, set.corridorId, set.revision],
        ),
      );
      if (!inserted) continue;
      const geometry = await corridorGeometry(corridorRow);
      for (const finding of set.findings) {
        const point = positionFromChainage(geometry, finding.chainageM, finding.offsetM);
        await createFinding(
          set.id,
          geometry,
          {
            location: {
              chainageM: finding.chainageM,
              offsetM: finding.offsetM,
              lonDeg: point.lonDeg,
              latDeg: point.latDeg,
              groundHeightM: finding.groundHeightM,
              terrainLevel: finding.terrainLevel,
            },
            canopyHeightM: finding.canopyHeightM,
            canopyRadiusM: finding.canopyRadiusM,
            comment: finding.comment,
          },
          `fnd-${set.id}-${finding.labelN}`,
        );
      }
    }

    for (const asset of SEED_ASSETS) {
      const corridorRow = await findCorridor(asset.corridorId);
      if (!corridorRow) continue;
      await query(
        `INSERT INTO assets (id, tenant_id, corridor_id, kind, state)
         VALUES ($1,$2,$3,$4,'pending') ON CONFLICT (id) DO NOTHING`,
        [asset.id, corridorRow.tenant_id, asset.corridorId, asset.kind],
      );
    }
  });
}

interface GeneratedFile {
  path: string;
  bytes: Uint8Array;
}

async function generate(
  kind: "tileset" | "terrain" | "czml",
  corridorId: string,
  geometry: CorridorGeometry,
): Promise<GeneratedFile[]> {
  if (kind === "terrain") return buildTerrainPyramid(geometry);
  if (kind === "czml") {
    return [{ path: ASH_CREEK_TRACK.path, bytes: buildAshCreekCzml(geometry) }];
  }
  return buildTileset(corridorId, geometry, await canopySeeds(corridorId));
}

/** Every seeded finding gets a tree in the reality mesh. */
async function canopySeeds(corridorId: string): Promise<CanopySeed[]> {
  const rows = await query<{
    chainage_m: number;
    offset_m: number;
    canopy_radius_m: number;
    canopy_height_m: number;
  }>(
    `SELECT f.chainage_m, f.offset_m, f.canopy_radius_m, f.canopy_height_m
     FROM findings f JOIN findings_sets s ON s.id = f.set_id
     WHERE s.corridor_id = $1
     ORDER BY f.chainage_m`,
    [corridorId],
  );
  return rows.map((row) => ({
    chainageM: row.chainage_m,
    offsetM: row.offset_m,
    radiusM: row.canopy_radius_m,
    heightM: row.canopy_height_m,
  }));
}

/**
 * Writes the generated fixture files for every seeded asset that is not stored
 * yet. Runs again whenever object storage starts answering.
 */
export async function ensureFixtureObjects(): Promise<void> {
  await withAdvisoryLock(FIXTURE_LOCK, async () => {
    for (const seed of SEED_ASSETS) {
      const asset = await findAsset(seed.id);
      if (!asset || asset.state === "stored" || asset.state === "rejected") continue;
      const corridorRow = await findCorridor(seed.corridorId);
      if (!corridorRow) continue;
      const geometry = await corridorGeometry(corridorRow);

      const files = await generate(seed.kind, seed.corridorId, geometry);
      const manifest: ManifestFile[] = files.map((file) => ({
        path: file.path,
        sizeBytes: file.bytes.byteLength,
        sha256: sha256Hex(file.bytes),
      }));
      const declared = await declareAsset(
        corridorRow.tenant_id,
        seed.corridorId,
        seed.kind,
        manifest,
        seed.id,
      );
      const stored = new Set(
        (await listAssetFiles(seed.id))
          .filter((file) => file.state === "stored")
          .map((file) => file.path),
      );
      for (const file of files) {
        if (stored.has(file.path)) continue;
        await storeAssetFile(declared, file.path, file.bytes, geometry);
      }
    }
  });
}
