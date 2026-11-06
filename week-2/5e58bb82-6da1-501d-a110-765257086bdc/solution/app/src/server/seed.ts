// Seed data from the brief: inserted when missing (by id), never changed once present.
import { hashPassword } from "./passwords.js";
import { tx } from "./db.js";
import { derivePlan, type PlanSettings } from "./plan.js";
import { insertLines } from "./lines.js";
import type { Position } from "./geometry.js";

const PASSWORD = "chartroom-2026";

const ORGS = [
  ["org-calderhaven", "Port of Calderhaven Authority", "Europe/London"],
  ["org-saltmere", "Saltmere Dredging Ltd", "Europe/Amsterdam"],
];

const USERS: [string, string, string, string, string | null][] = [
  ["u-ira", "Ira Penhallow", "ira@fathomwright.test", "principal_surveyor", null],
  ["u-wren", "Wren Calloway", "wren@fathomwright.test", "principal_surveyor", null],
  ["u-tamsin", "Tamsin Rook", "tamsin@fathomwright.test", "launch_technician", null],
  ["u-odile", "Odile Varga", "odile@calderhaven-port.test", "client_reviewer", "org-calderhaven"],
  ["u-bram", "Bram Echols", "bram@saltmere-dredging.test", "client_reviewer", "org-saltmere"],
];

const VESSELS: [string, string, string, number, number, number][] = [
  ["v-kittiwake", "Kittiwake", "ik-kittiwake-4c19", 1840.2, 112.4, 250],
  ["v-petrel", "Petrel", "ik-petrel-8a03", 960.0, 249.9, 250],
  ["v-shearwater", "Shearwater", "ik-shearwater-2e77", 2210.5, 263.5, 250],
  ["v-gannet", "Gannet", "ik-gannet-61b5", 310.0, 40.0, 300],
];

const square = (pts: [number, number][]): Position[] => pts.map(([easting, northing]) => ({ easting, northing }));

const MISSIONS: { id: string; name: string; org: string; date: string; area: Position[]; fence: Position[]; settings: PlanSettings }[] = [
  {
    id: "m-calderhaven-north", name: "Calderhaven North Basin", org: "org-calderhaven", date: "2026-11-02",
    area: square([[5000, 8000], [5400, 8000], [5400, 8300], [5000, 8300]]),
    fence: square([[4950, 7950], [5450, 7950], [5450, 8350], [4950, 8350]]),
    settings: { planned_depth_m: 10, swath_ratio: 4, overlap_pct: 20, line_azimuth_deg: 0, planned_speed_mps: 2.0, survey_order: "special" },
  },
  {
    id: "m-saltmere-approach", name: "Saltmere Approach Channel", org: "org-saltmere", date: "2026-11-03",
    area: square([[1000, 2000], [1120, 2000], [1120, 2600], [1000, 2600]]),
    fence: square([[950, 1950], [1170, 1950], [1170, 2650], [950, 2650]]),
    settings: { planned_depth_m: 6, swath_ratio: 4, overlap_pct: 25, line_azimuth_deg: 0, planned_speed_mps: 1.5, survey_order: "1a" },
  },
];

export async function seed(): Promise<void> {
  const now = new Date();
  await tx(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(7462)");
    for (const [id, name, zone] of ORGS) {
      await db.query("INSERT INTO client_orgs (id, name, time_zone) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING", [id, name, zone]);
    }
    const present = new Set((await db.query<{ id: string }>("SELECT id FROM users")).rows.map((r) => r.id));
    for (const [id, name, email, role, org] of USERS) {
      if (present.has(id)) continue;
      await db.query(
        "INSERT INTO users (id, name, email, role, client_org_id, password_hash) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING",
        [id, name, email, role, org, await hashPassword(PASSWORD)]);
    }
    for (const [order, [id, name, key, total, since, interval]] of VESSELS.entries()) {
      await db.query(
        `INSERT INTO vessels (id, name, seed_order, ingest_key, thruster_hours_total, hours_since_service, service_interval_h)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`, [id, name, order, key, total, since, interval]);
    }
    for (const m of MISSIONS) {
      const plan = derivePlan(m.area, m.settings);
      const inserted = await db.query(
        `INSERT INTO missions (id, name, client_org_id, survey_date, status, survey_order, survey_area, geofence,
           planned_depth_m, swath_ratio, overlap_pct, line_azimuth_deg, planned_speed_mps, swath_width_m, line_spacing_m,
           line_count, crossline_count, estimated_duration_s, owner_id, created_at)
         VALUES ($1,$2,$3,$4,'Planned',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'u-ira',$18) ON CONFLICT (id) DO NOTHING`,
        [m.id, m.name, m.org, m.date, m.settings.survey_order, JSON.stringify(m.area), JSON.stringify(m.fence),
          m.settings.planned_depth_m, m.settings.swath_ratio, m.settings.overlap_pct, m.settings.line_azimuth_deg,
          m.settings.planned_speed_mps, plan.swath_width_m, plan.line_spacing_m, plan.line_count, plan.crossline_count,
          plan.estimated_duration_s, now]);
      if (inserted.rowCount) {
        await insertLines(db, m.id, plan.lines, m.id.replace(/^m-/, ""));
        await db.query("INSERT INTO mission_coverage (mission_id) VALUES ($1) ON CONFLICT DO NOTHING", [m.id]);
      }
    }
  });
}
