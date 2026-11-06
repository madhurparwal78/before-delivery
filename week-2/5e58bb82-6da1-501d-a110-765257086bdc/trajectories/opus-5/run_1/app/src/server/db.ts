import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { Pool as PoolType, PoolClient } from 'pg';
import { config } from './config.js';
import { derivePlan } from './domain/plan.js';
import type { Position, SurveyOrder } from '../shared/types.js';

export const pool: PoolType = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });

export type Db = PoolType | PoolClient;

export async function withTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

const SCRYPT_KEY_LENGTH = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1]!, 'hex');
  const expected = Buffer.from(parts[2]!, 'hex');
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * A hash no account uses, verified against for an unknown email so that the
 * response timing does not reveal whether the account exists.
 */
export const DECOY_PASSWORD_HASH = hashPassword(randomBytes(24).toString('hex'));

async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch {
      await new Promise((done) => setTimeout(done, 2000));
    }
  }
}

const SEED_ORGS = [
  { id: 'org-calderhaven', name: 'Port of Calderhaven Authority', time_zone: 'Europe/London' },
  { id: 'org-saltmere', name: 'Saltmere Dredging Ltd', time_zone: 'Europe/Amsterdam' },
];

const SEED_USERS = [
  { id: 'u-ira', name: 'Ira Penhallow', email: 'ira@fathomwright.test', role: 'principal_surveyor', org: null },
  { id: 'u-wren', name: 'Wren Calloway', email: 'wren@fathomwright.test', role: 'principal_surveyor', org: null },
  { id: 'u-tamsin', name: 'Tamsin Rook', email: 'tamsin@fathomwright.test', role: 'launch_technician', org: null },
  { id: 'u-odile', name: 'Odile Varga', email: 'odile@calderhaven-port.test', role: 'client_reviewer', org: 'org-calderhaven' },
  { id: 'u-bram', name: 'Bram Echols', email: 'bram@saltmere-dredging.test', role: 'client_reviewer', org: 'org-saltmere' },
];

const SEED_PASSWORD = 'chartroom-2026';

const SEED_VESSELS = [
  { id: 'v-kittiwake', name: 'Kittiwake', key: 'ik-kittiwake-4c19', total: 1840.2, since: 112.4, interval: 250 },
  { id: 'v-petrel', name: 'Petrel', key: 'ik-petrel-8a03', total: 960.0, since: 249.9, interval: 250 },
  { id: 'v-shearwater', name: 'Shearwater', key: 'ik-shearwater-2e77', total: 2210.5, since: 263.5, interval: 250 },
  { id: 'v-gannet', name: 'Gannet', key: 'ik-gannet-61b5', total: 310.0, since: 40.0, interval: 300 },
];

interface SeedMission {
  id: string;
  name: string;
  org: string;
  date: string;
  order: SurveyOrder;
  area: Position[];
  fence: Position[];
  depth: number;
  ratio: number;
  overlap: number;
  azimuth: number;
  speed: number;
}

function at(easting: number, northing: number): Position {
  return { easting, northing };
}

const SEED_MISSIONS: SeedMission[] = [
  {
    id: 'm-calderhaven-north',
    name: 'Calderhaven North Basin',
    org: 'org-calderhaven',
    date: '2026-11-02',
    order: 'special',
    area: [at(5000, 8000), at(5400, 8000), at(5400, 8300), at(5000, 8300)],
    fence: [at(4950, 7950), at(5450, 7950), at(5450, 8350), at(4950, 8350)],
    depth: 10,
    ratio: 4,
    overlap: 20,
    azimuth: 0,
    speed: 2.0,
  },
  {
    id: 'm-saltmere-approach',
    name: 'Saltmere Approach Channel',
    org: 'org-saltmere',
    date: '2026-11-03',
    order: '1a',
    area: [at(1000, 2000), at(1120, 2000), at(1120, 2600), at(1000, 2600)],
    fence: [at(950, 1950), at(1170, 1950), at(1170, 2650), at(950, 2650)],
    depth: 6,
    ratio: 4,
    overlap: 25,
    azimuth: 0,
    speed: 1.5,
  },
];

/** Applies the schema and then inserts any seed record that is missing, by id. */
export async function applySchemaAndSeed(): Promise<void> {
  await waitForDatabase();
  const here = dirname(fileURLToPath(import.meta.url));
  const schema = await readFile(resolve(here, 'schema.sql'), 'utf8');
  await pool.query(schema);

  for (const [index, org] of SEED_ORGS.entries()) {
    await pool.query(
      `INSERT INTO client_orgs (id, name, time_zone, seed_order) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO NOTHING`,
      [org.id, org.name, org.time_zone, index],
    );
  }

  for (const [index, user] of SEED_USERS.entries()) {
    await pool.query(
      `INSERT INTO users (id, name, email, role, client_org_id, units, password_hash, last_screen, seed_order)
       VALUES ($1,$2,$3,$4,$5,'metric',$6,NULL,$7) ON CONFLICT (id) DO NOTHING`,
      [user.id, user.name, user.email, user.role, user.org, hashPassword(SEED_PASSWORD), index],
    );
  }

  for (const [index, vessel] of SEED_VESSELS.entries()) {
    await pool.query(
      `INSERT INTO vessels (id, name, ingest_key, thruster_hours_total, hours_since_service,
         service_interval_h, afloat, version, seed_order)
       VALUES ($1,$2,$3,$4,$5,$6,false,1,$7) ON CONFLICT (id) DO NOTHING`,
      [vessel.id, vessel.name, vessel.key, vessel.total, vessel.since, vessel.interval, index],
    );
  }

  for (const mission of SEED_MISSIONS) {
    const plan = derivePlan({
      survey_area: mission.area,
      planned_depth_m: mission.depth,
      swath_ratio: mission.ratio,
      overlap_pct: mission.overlap,
      line_azimuth_deg: mission.azimuth,
      planned_speed_mps: mission.speed,
      survey_order: mission.order,
    });
    const inserted = await pool.query(
      `INSERT INTO missions (id, name, client_org_id, survey_date, status, survey_order,
         survey_area, geofence, planned_depth_m, swath_ratio, overlap_pct, line_azimuth_deg,
         planned_speed_mps, swath_width_m, line_spacing_m, line_count, crossline_count,
         estimated_duration_s, owner_id, version, hold, report_state, created_at)
       VALUES ($1,$2,$3,$4,'Planned',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'u-ira',1,NULL,'None',now())
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [
        mission.id,
        mission.name,
        mission.org,
        mission.date,
        mission.order,
        JSON.stringify(mission.area),
        JSON.stringify(mission.fence),
        mission.depth,
        mission.ratio,
        mission.overlap,
        mission.azimuth,
        mission.speed,
        plan.swath_width_m,
        plan.line_spacing_m,
        plan.line_count,
        plan.crossline_count,
        plan.estimated_duration_s,
      ],
    );
    if (inserted.rowCount === 0) continue;
    for (const line of plan.lines) {
      await pool.query(
        `INSERT INTO lines (id, mission_id, label, kind, status, start_e, start_n, end_e, end_n,
           length_m, label_num)
         VALUES ($1,$2,$3,$4,'Pending',$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
        [
          `${mission.id}-${line.label}`,
          mission.id,
          line.label,
          line.kind,
          line.start.easting,
          line.start.northing,
          line.end.easting,
          line.end.northing,
          line.length_m,
          line.label_num,
        ],
      );
    }
  }

  await pool.query(
    `INSERT INTO service_probes (name, state) VALUES ('storage','up'), ('mail','up')
     ON CONFLICT (name) DO NOTHING`,
  );
}
