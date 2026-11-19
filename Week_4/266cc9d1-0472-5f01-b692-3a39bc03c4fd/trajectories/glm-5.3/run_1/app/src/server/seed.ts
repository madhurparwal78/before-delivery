import { createHash, randomBytes } from 'node:crypto';
import { db, applySchema } from './db.js';
import { CORRIDORS, UTILITIES, corridorModel, deriveFinding } from '../domain/corridors.js';
import { fixtureManifest } from '../domain/fixtures.js';

const TENANTS = [
  { id: 'kestrel', name: 'Kestrel Ridge Aerial' },
  { id: 'bluefen', name: 'Blue Fen Survey' },
];

const STAFF = [
  { id: 'st-tomas', tenant: 'kestrel', name: 'Tomas Adeyemi', role: 'survey_processor', code: 'kestrel-processor-4417', email: 'tomas.adeyemi@kestrelridge.example' },
  { id: 'st-rosa', tenant: 'kestrel', name: 'Rosa Lindqvist', role: 'vegetation_analyst', code: 'kestrel-analyst-2093', email: 'rosa.lindqvist@kestrelridge.example' },
  { id: 'st-jun', tenant: 'bluefen', name: 'Jun Park', role: 'survey_processor', code: 'bluefen-processor-6620', email: 'jun.park@bluefen.example' },
  { id: 'st-mika', tenant: 'bluefen', name: 'Mika Osei', role: 'vegetation_analyst', code: 'bluefen-analyst-7731', email: 'mika.osei@bluefen.example' },
];

const SEED_ASSETS = [
  { id: 'ast-ash-terrain', corridor: 'nm-ash-creek', kind: 'terrain' },
  { id: 'ast-ash-tileset', corridor: 'nm-ash-creek', kind: 'tileset' },
  { id: 'ast-ash-czml', corridor: 'nm-ash-creek', kind: 'czml' },
  { id: 'ast-birch-terrain', corridor: 'nm-birch-hollow', kind: 'terrain' },
] as const;

const SEED_SETS = [
  { id: 'fs-ash-1', corridor: 'nm-ash-creek', createdBy: 'st-rosa', findings: [
    { label: 'F-1', n: 1, c: 470.0, o: 1.50, g: 253.00, lvl: 15, h: 24.00, r: 3.0, comment: 'Silver maple leader under conductor, east of T2' },
    { label: 'F-2', n: 2, c: 1180.0, o: -9.00, g: 251.00, lvl: 9, h: 12.00, r: 4.0, comment: 'Aspen clump on north edge' },
    { label: 'F-3', n: 3, c: 1915.0, o: 2.00, g: 248.00, lvl: 15, h: 22.50, r: 2.5, comment: 'Cottonwood just past T7' },
    { label: 'F-4', n: 4, c: 2700.0, o: -4.00, g: 255.00, lvl: 15, h: 15.00, r: 3.0, comment: 'Boxelder regrowth' },
  ] },
  { id: 'fs-dune-1', corridor: 'hc-dune-road', createdBy: 'st-mika', findings: [
    { label: 'F-1', n: 1, c: 120.0, o: 3.00, g: 20.50, lvl: 12, h: 16.00, r: 3.0, comment: 'Monterey cypress' },
  ] },
] as const;

/** Insert missing seed rows only. Never resets a changed seeded row. */
export async function seed(): Promise<void> {
  const pool = db();
  await applySchema(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const t of TENANTS) {
      await client.query('INSERT INTO tenants (id, name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING', [t.id, t.name]);
    }
    for (const u of UTILITIES) {
      await client.query(
        'INSERT INTO utilities (id, tenant_id, name, time_zone, forester_name, forester_email) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING',
        [u.id, u.tenantId, u.name, u.timeZone, u.foresterName, u.foresterEmail]
      );
    }
    for (const s of STAFF) {
      await client.query(
        'INSERT INTO staff (id, tenant_id, name, role, access_code, email) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING',
        [s.id, s.tenant, s.name, s.role, s.code, s.email]
      );
    }
    for (const c of CORRIDORS) {
      const length = c.towers[c.towers.length - 1].chainageM;
      await client.query(
        'INSERT INTO corridors (id, utility_id, name, voltage_kv, clearance_threshold_m, inspection_due, start_lon, start_lat, azimuth, attachment_height_m) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING',
        [c.id, c.utilityId, c.name, c.voltageKv, c.clearanceThresholdM, c.inspectionDue, c.tower1.lonDeg, c.tower1.latDeg, c.azimuthDeg, c.attachmentHeightM]
      );
      for (const t of c.towers) {
        await client.query(
          'INSERT INTO towers (corridor_id, number, chainage_m, base_height_m) VALUES ($1,$2,$3,$4) ON CONFLICT (corridor_id, number) DO NOTHING',
          [c.id, c.towers.indexOf(t) + 1, t.chainageM, t.baseHeightM]
        );
      }
      void length;
    }
    for (const a of SEED_ASSETS) {
      await client.query(
        'INSERT INTO assets (id, corridor_id, kind, state, seeded) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING',
        [a.id, a.corridor, a.kind, 'pending', true]
      );
      const files = fixtureManifest(a.corridor, a.kind);
      for (const f of files) {
        await client.query(
          'INSERT INTO asset_files (asset_id, path, size_bytes, sha256, state) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (asset_id, path) DO NOTHING',
          [a.id, f.path, 0, '0'.repeat(64), 'pending']
        );
      }
    }
    for (const set of SEED_SETS) {
      const model = corridorModel(set.corridor);
      if (!model) continue;
      await client.query(
        'INSERT INTO findings_sets (id, corridor_id, revision, state, created_by) VALUES ($1,$2,1,$3,$4) ON CONFLICT (id) DO NOTHING',
        [set.id, set.corridor, 'draft', set.createdBy]
      );
      await client.query('INSERT INTO label_counter (set_id, next_number) VALUES ($1,1) ON CONFLICT (set_id) DO NOTHING', [set.id]);
      for (const f of set.findings) {
        const d = deriveFinding(model, { chainageM: f.c, offsetM: f.o, groundHeightM: f.g, canopyHeightM: f.h, canopyRadiusM: f.r });
        await client.query(
          `INSERT INTO findings (id, set_id, label, number, chainage_m, offset_m, lon_deg, lat_deg, ecef_x, ecef_y, ecef_z,
           ground_height_m, terrain_level, canopy_height_m, canopy_top_height_m, canopy_radius_m, clearance_m, status, comment)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) ON CONFLICT (set_id, number) DO NOTHING`,
          [`${set.id}-${f.label}`, set.id, f.label, f.n, f.c, f.o, d.lonDeg, d.latDeg, d.ecef.x, d.ecef.y, d.ecef.z,
           f.g, f.lvl, f.h, d.canopyTopHeightM, f.r, d.clearanceM, d.status, f.comment]
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** SHA-256 of a seeded fixture file's bytes, computed identically everywhere. */
export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function newId(prefix: string): string {
  return `${prefix}-${randomBytes(8).toString('hex')}`;
}

/** A review token: 43 URL-safe base64 chars from 32 random bytes. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}
