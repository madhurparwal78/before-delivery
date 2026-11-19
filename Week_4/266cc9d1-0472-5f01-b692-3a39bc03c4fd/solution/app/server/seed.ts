// The seed: inserts only the rows that are missing, never overwrites a changed row, and stores the
// procedurally generated fixture files under the storage-confirmation rule once storage answers.
import { inTransaction, pool } from "./db.js";
import { filesOf, loadAsset, storeFile, type AssetKind } from "./domain/assets.js";
import { loadCorridor } from "./domain/corridor.js";
import { pointAt, type Centreline } from "../shared/geodesy.js";
import { ashCreekTrack } from "./fixtures/czml.js";
import type { FixtureCorridor } from "./fixtures/ground.js";
import { terrainPyramid } from "./fixtures/terrain.js";
import { realityMesh, type TreeSpec } from "./fixtures/tileset.js";
import { monitor } from "./monitor.js";
import { sha256Hex } from "./storage.js";

const SEED_LOCK = 7_314_002;
const FIXTURE_LOCK = 7_314_003;

const TENANTS = [
  { id: "kestrel", name: "Kestrel Ridge Aerial" },
  { id: "bluefen", name: "Blue Fen Survey" },
];

const STAFF = [
  { id: "stf-tomas-adeyemi", tenant: "kestrel", name: "Tomas Adeyemi", role: "survey_processor", code: "kestrel-processor-4417", email: "tomas.adeyemi@kestrelridge.example" },
  { id: "stf-rosa-lindqvist", tenant: "kestrel", name: "Rosa Lindqvist", role: "vegetation_analyst", code: "kestrel-analyst-2093", email: "rosa.lindqvist@kestrelridge.example" },
  { id: "stf-jun-park", tenant: "bluefen", name: "Jun Park", role: "survey_processor", code: "bluefen-processor-6620", email: "jun.park@bluefen.example" },
  { id: "stf-mika-osei", tenant: "bluefen", name: "Mika Osei", role: "vegetation_analyst", code: "bluefen-analyst-7731", email: "mika.osei@bluefen.example" },
];

const UTILITIES = [
  { id: "northmere", name: "Northmere Power Cooperative", tenant: "kestrel", zone: "America/Chicago", forester: "Dana Okafor", email: "dana.okafor@northmere.example" },
  { id: "sallow", name: "Sallow Valley Electric", tenant: "kestrel", zone: "America/Denver", forester: "Lee Marchetti", email: "lee.marchetti@sallowvalley.example" },
  { id: "harrow", name: "Harrow Coast Utilities", tenant: "bluefen", zone: "America/Los_Angeles", forester: "Sam Whitlock", email: "sam.whitlock@harrowcoast.example" },
];

interface SeedCorridor {
  id: string;
  tenant: string;
  name: string;
  utility: string;
  kv: number;
  threshold: number;
  due: string;
  lat: number;
  lon: number;
  azimuth: number;
  towers: Array<[number, number]>;
  attachment: number;
}

const CORRIDORS: SeedCorridor[] = [
  {
    id: "nm-ash-creek", tenant: "kestrel", name: "Ash Creek 345 kV", utility: "northmere", kv: 345, threshold: 3.0, due: "2026-03-31",
    lat: 44.5, lon: -93.2, azimuth: 90, attachment: 24.0,
    towers: [[0, 248.0], [312, 251.5], [640, 255.0], [955, 253.0], [1268, 249.5], [1590, 246.0], [1904, 247.5], [2231, 252.0], [2550, 256.5], [2870, 254.0]],
  },
  {
    id: "nm-birch-hollow", tenant: "kestrel", name: "Birch Hollow 138 kV", utility: "northmere", kv: 138, threshold: 1.6, due: "2030-06-30",
    lat: 44.62, lon: -93.05, azimuth: 45, attachment: 18.0,
    towers: [[0, 300.0], [210, 300.0], [430, 300.0], [655, 300.0], [870, 300.0], [1085, 300.0]],
  },
  {
    id: "sv-cutbank", tenant: "kestrel", name: "Cutbank 230 kV", utility: "sallow", kv: 230, threshold: 2.2, due: "2030-09-30",
    lat: 40.1, lon: -105.3, azimuth: 0, attachment: 30.0,
    towers: [[0, 1650.0], [380, 1650.0], [760, 1650.0], [1150, 1650.0]],
  },
  {
    id: "hc-dune-road", tenant: "bluefen", name: "Dune Road 115 kV", utility: "harrow", kv: 115, threshold: 1.4, due: "2030-05-31",
    lat: 36.8, lon: -121.7, azimuth: 120, attachment: 20.0,
    towers: [[0, 20.0], [250, 20.0], [500, 20.0]],
  },
];

interface SeedFinding {
  label: number;
  chainage: number;
  offset: number;
  ground: number;
  level: number | null;
  canopy: number;
  radius: number;
  comment: string;
}

const SETS: Array<{ id: string; corridor: string; createdBy: string; findings: SeedFinding[] }> = [
  {
    id: "set-ash-creek-r1",
    corridor: "nm-ash-creek",
    createdBy: "stf-rosa-lindqvist",
    findings: [
      { label: 1, chainage: 470.0, offset: 1.5, ground: 253.0, level: 15, canopy: 24.0, radius: 3.0, comment: "Silver maple leader under conductor, east of T2" },
      { label: 2, chainage: 1180.0, offset: -9.0, ground: 251.0, level: 9, canopy: 12.0, radius: 4.0, comment: "Aspen clump on north edge" },
      { label: 3, chainage: 1915.0, offset: 2.0, ground: 248.0, level: 15, canopy: 22.5, radius: 2.5, comment: "Cottonwood just past T7" },
      { label: 4, chainage: 2700.0, offset: -4.0, ground: 255.0, level: 15, canopy: 15.0, radius: 3.0, comment: "Boxelder regrowth" },
    ],
  },
  {
    id: "set-dune-road-r1",
    corridor: "hc-dune-road",
    createdBy: "stf-mika-osei",
    findings: [{ label: 1, chainage: 120.0, offset: 3.0, ground: 20.5, level: 12, canopy: 16.0, radius: 3.0, comment: "Monterey cypress" }],
  },
];

function lineOf(c: SeedCorridor): Centreline {
  return { origin: { lonDeg: c.lon, latDeg: c.lat }, azimuthDeg: c.azimuth };
}

function fixtureCorridor(c: SeedCorridor): FixtureCorridor {
  return { line: lineOf(c), towers: c.towers.map(([chainageM, baseHeightM], i) => ({ number: i + 1, chainageM, baseHeightM })) };
}

function corridorById(id: string): SeedCorridor {
  const found = CORRIDORS.find((c) => c.id === id);
  if (found === undefined) throw new Error(`no seed corridor ${id}`);
  return found;
}

interface SeedAsset {
  id: string;
  corridor: string;
  kind: AssetKind;
}

const ASSETS: SeedAsset[] = [
  { id: "ast-ash-terrain", corridor: "nm-ash-creek", kind: "terrain" },
  { id: "ast-ash-tileset", corridor: "nm-ash-creek", kind: "tileset" },
  { id: "ast-ash-czml", corridor: "nm-ash-creek", kind: "czml" },
  { id: "ast-birch-terrain", corridor: "nm-birch-hollow", kind: "terrain" },
];

/** The generated files of one seeded asset; generation is deterministic, so every process makes the same bytes. */
async function fixtureFiles(asset: SeedAsset): Promise<Map<string, Buffer>> {
  const corridor = corridorById(asset.corridor);
  if (asset.kind === "terrain") return terrainPyramid(fixtureCorridor(corridor), `${corridor.name} terrain`);
  if (asset.kind === "czml") return new Map([["ash-creek-2026-06-14.czml", ashCreekTrack(lineOf(corridor))]]);
  const trees: TreeSpec[] = (SETS.find((s) => s.corridor === asset.corridor)?.findings ?? []).map((f) => ({
    chainageM: f.chainage,
    offsetM: f.offset,
    canopyHeightM: f.canopy,
    canopyRadiusM: f.radius,
  }));
  return realityMesh(fixtureCorridor(corridor), trees);
}

const generated = new Map<string, Promise<Map<string, Buffer>>>();

function filesFor(asset: SeedAsset): Promise<Map<string, Buffer>> {
  let files = generated.get(asset.id);
  if (files === undefined) {
    files = fixtureFiles(asset);
    generated.set(asset.id, files);
  }
  return files;
}

/** Inserts every missing seed row; one advisory lock serialises processes starting together. */
export async function seed(): Promise<void> {
  const manifests = await Promise.all(ASSETS.map(async (a) => ({ asset: a, files: await filesFor(a) })));
  await inTransaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock($1)", [SEED_LOCK]);
    for (const t of TENANTS) {
      await db.query("INSERT INTO tenants (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING", [t.id, t.name]);
    }
    for (const s of STAFF) {
      await db.query(
        "INSERT INTO staff (id, tenant_id, name, role, access_code, email) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING",
        [s.id, s.tenant, s.name, s.role, s.code, s.email],
      );
    }
    for (const u of UTILITIES) {
      await db.query(
        `INSERT INTO utilities (id, tenant_id, name, time_zone, forester_name, forester_email)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [u.id, u.tenant, u.name, u.zone, u.forester, u.email],
      );
    }
    for (const c of CORRIDORS) {
      await db.query(
        `INSERT INTO corridors (id, tenant_id, utility_id, name, voltage_kv, clearance_threshold_m, inspection_due,
                                tower1_lat_deg, tower1_lon_deg, azimuth_deg, attachment_height_m)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT DO NOTHING`,
        [c.id, c.tenant, c.utility, c.name, c.kv, c.threshold, c.due, c.lat, c.lon, c.azimuth, c.attachment],
      );
      for (const [index, [chainage, base]] of c.towers.entries()) {
        const at = pointAt(lineOf(c), chainage, 0);
        await db.query(
          `INSERT INTO towers (corridor_id, number, chainage_m, lon_deg, lat_deg, base_height_m)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
          [c.id, index + 1, chainage, at.lonDeg, at.latDeg, base],
        );
      }
    }
    for (const set of SETS) {
      const inserted = await db.query(
        `INSERT INTO findings_sets (id, corridor_id, revision, state, created_by, last_label_number)
         VALUES ($1, $2, 1, 'draft', $3, $4) ON CONFLICT DO NOTHING RETURNING id`,
        [set.id, set.corridor, set.createdBy, set.findings.length],
      );
      if (inserted.rowCount !== 1) continue;
      const line = lineOf(corridorById(set.corridor));
      for (const f of set.findings) {
        const at = pointAt(line, f.chainage, f.offset);
        await db.query(
          `INSERT INTO findings (id, set_id, label_number, chainage_m, offset_m, lon_deg, lat_deg, ground_height_m,
                                 terrain_level, canopy_height_m, canopy_radius_m, comment)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [`${set.id.replace("set-", "fnd-")}-f${f.label}`, set.id, f.label, f.chainage, f.offset, at.lonDeg, at.latDeg, f.ground, f.level, f.canopy, f.radius, f.comment],
        );
      }
    }
    for (const { asset, files } of manifests) {
      const inserted = await db.query(
        "INSERT INTO assets (id, corridor_id, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id",
        [asset.id, asset.corridor, asset.kind],
      );
      if (inserted.rowCount !== 1) continue;
      let position = 0;
      for (const [path, bytes] of files) {
        await db.query(
          "INSERT INTO asset_files (asset_id, position, path, size_bytes, sha256) VALUES ($1, $2, $3, $4, $5)",
          [asset.id, position, path, bytes.length, sha256Hex(bytes)],
        );
        position += 1;
      }
    }
  });
}

let storing = false;

/**
 * Stores the fixture files of every seeded asset still pending. Several processes may try at once;
 * an advisory lock lets one work while the others skip, and each file is confirmed by storeFile.
 */
export async function storeSeedFixtures(): Promise<void> {
  if (storing || !monitor.storageOk()) return;
  const pending = await pool.query("SELECT 1 FROM assets WHERE id = ANY($1) AND state = 'pending' LIMIT 1", [ASSETS.map((a) => a.id)]);
  if (pending.rowCount === 0) return;
  storing = true;
  const client = await pool.connect();
  try {
    const locked = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [FIXTURE_LOCK]);
    if (locked.rows[0]?.ok !== true) return;
    try {
      for (const seeded of ASSETS) {
        const files = await filesFor(seeded);
        const tenant = corridorById(seeded.corridor).tenant;
        for (const [path, bytes] of files) {
          await inTransaction(async (db) => {
            const asset = await loadAsset(db, tenant, seeded.id, true);
            const file = (await filesOf(db, asset.id)).find((f) => f.path === path);
            if (asset.state !== "pending" || file === undefined || file.state !== "pending") return;
            await storeFile(db, await loadCorridor(db, tenant, asset.corridor_id), asset, file, bytes);
          });
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [FIXTURE_LOCK]);
    }
  } catch (error) {
    console.error("fixture storage paused:", error instanceof Error ? error.message : error);
  } finally {
    client.release();
    storing = false;
  }
}
