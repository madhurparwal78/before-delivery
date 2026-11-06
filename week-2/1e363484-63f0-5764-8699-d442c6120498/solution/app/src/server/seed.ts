// Schema and seed data, applied on every start. The seed runs once per database (guarded by a marker
// row), so a restart never re-creates grants an admin has removed; both run under the schema lock, so
// two instances starting at once are safe.

import { hashPassword } from "./auth.js";
import { lockSchema, transaction, type Db } from "./db.js";
import { DAY, HALF_HOUR } from "./domain/time.js";
import { SCHEMA } from "./schema.js";

const SEED_PASSWORD = ["moss", "and", "tower", "26"].join("-");

const PEOPLE = [
  { id: "p-ines", name: "Ines Okafor", email: "ines@levelmoor.example", orgRole: "admin" },
  { id: "p-priya", name: "Priya Nand", email: "priya@levelmoor.example", orgRole: "steward" },
  { id: "p-tomas", name: "Tomas Reyes", email: "tomas@levelmoor.example", orgRole: "member" },
  { id: "p-hal", name: "Hal Brennan", email: "hal@levelmoor.example", orgRole: "member" },
  { id: "p-odile", name: "Odile Marsh", email: "odile@levelmoor.example", orgRole: "member" },
  { id: "p-wren", name: "Wren Adeyemi", email: "wren@levelmoor.example", orgRole: "member" },
];

const rectangle = (x1: number, y1: number, x2: number, y2: number) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];

const PROJECTS = [
  {
    slug: "blackmere-moss", name: "Blackmere Moss", kind: "peatland rewetting", code: "BM", floorTenths: 600, bufferTenths: 150,
    boundary: rectangle(0, 0, 1000, 600),
    sensors: [
      { id: "BM-T1", kind: "tower", polygon: rectangle(100, 100, 500, 500) },
      { id: "BM-T2", kind: "tower", polygon: rectangle(400, 200, 800, 500) },
      { id: "BM-S1", kind: "satellite", polygon: rectangle(0, 0, 500, 300) },
      { id: "BM-S2", kind: "satellite", polygon: rectangle(500, 0, 1000, 300) },
      { id: "BM-S3", kind: "satellite", polygon: rectangle(0, 300, 500, 600) },
      { id: "BM-S4", kind: "satellite", polygon: rectangle(500, 300, 1000, 600) },
    ],
  },
  {
    slug: "saltings-reach", name: "Saltings Reach", kind: "wetland restoration", code: "SR", floorTenths: 500, bufferTenths: 100,
    boundary: rectangle(0, 0, 800, 500),
    sensors: [
      { id: "SR-T1", kind: "tower", polygon: rectangle(200, 100, 600, 400) },
      { id: "SR-S1", kind: "satellite", polygon: rectangle(0, 0, 400, 500) },
      { id: "SR-S2", kind: "satellite", polygon: rectangle(400, 0, 800, 500) },
    ],
  },
  {
    slug: "hollin-wood", name: "Hollin Wood", kind: "managed forest", code: "HW", floorTenths: 700, bufferTenths: 200,
    boundary: rectangle(0, 0, 400, 400),
    sensors: [
      { id: "HW-T1", kind: "tower", polygon: rectangle(0, 0, 400, 300) },
      { id: "HW-S1", kind: "satellite", polygon: rectangle(0, 0, 400, 400) },
    ],
  },
];

const GRANTS: [string, string, string][] = [
  ["p-priya", "blackmere-moss", "viewer"], ["p-priya", "saltings-reach", "viewer"], ["p-priya", "hollin-wood", "viewer"],
  ["p-tomas", "blackmere-moss", "sealer"], ["p-tomas", "saltings-reach", "analyst"],
  ["p-hal", "blackmere-moss", "sealer"], ["p-hal", "saltings-reach", "sealer"], ["p-hal", "hollin-wood", "sealer"],
  ["p-odile", "blackmere-moss", "analyst"],
  ["p-wren", "blackmere-moss", "viewer"],
];

interface SeedReading { sensorId: string; project: string; t: number; fcE4: number; fch4E4: number; qc: number }

const JUNE_1 = Date.UTC(2026, 5, 1) / 1000;
const JUNE_3 = JUNE_1 + 2 * DAY;
const JUNE_8 = JUNE_1 + 7 * DAY;
const JUNE_15 = JUNE_1 + 14 * DAY;

/** Daytime is an interval starting 06:00 to 17:30 UTC. */
const daytime = (t: number) => (t % DAY) >= 6 * 3600 && (t % DAY) < 18 * 3600;

function seedReadings(): SeedReading[] {
  const rows: SeedReading[] = [];
  for (let t = JUNE_1; t < JUNE_15; t += HALF_HOUR) {
    const bm = "blackmere-moss", sr = "saltings-reach";
    rows.push({ sensorId: "BM-T1", project: bm, t, fcE4: daytime(t) ? -30_000 : 15_000, fch4E4: 150_000, qc: 0 });
    rows.push({ sensorId: "BM-T2", project: bm, t, fcE4: daytime(t) ? -20_000 : 10_000, fch4E4: 300_000, qc: 0 });
    if (t >= JUNE_3) {
      for (const cell of ["BM-S1", "BM-S2", "BM-S3", "BM-S4"]) {
        rows.push({ sensorId: cell, project: bm, t, fcE4: -10_000, fch4E4: 100_000, qc: cell === "BM-S4" && t >= JUNE_8 ? 3 : 0 });
      }
    }
    rows.push({ sensorId: "SR-T1", project: sr, t, fcE4: -15_000, fch4E4: 400_000, qc: 0 });
    for (const cell of ["SR-S1", "SR-S2"]) rows.push({ sensorId: cell, project: sr, t, fcE4: -5_000, fch4E4: 250_000, qc: 0 });
  }
  return rows;
}

async function seed(db: Db): Promise<void> {
  for (const p of PEOPLE) {
    await db.query("INSERT INTO people (id, name, email, org_role, password_hash) VALUES ($1, $2, $3, $4, $5)",
      [p.id, p.name, p.email, p.orgRole, await hashPassword(SEED_PASSWORD)]);
  }
  for (const p of PROJECTS) {
    await db.query(
      `INSERT INTO projects (slug, name, kind, code, floor_tenths, buffer_tenths, lead_person_id, boundary)
       VALUES ($1, $2, $3, $4, $5, $6, 'p-hal', $7)`,
      [p.slug, p.name, p.kind, p.code, p.floorTenths, p.bufferTenths, JSON.stringify(p.boundary)]);
    for (const s of p.sensors) {
      await db.query("INSERT INTO sensors (id, project, kind, polygon) VALUES ($1, $2, $3, $4)",
        [s.id, p.slug, s.kind, JSON.stringify(s.polygon)]);
    }
  }
  for (const [person, project, role] of GRANTS) {
    await db.query("INSERT INTO grants (person_id, project, role) VALUES ($1, $2, $3)", [person, project, role]);
  }
  const readings = seedReadings();
  await db.query(
    `INSERT INTO readings (sensor_id, interval_start, project, fc_e4, fch4_e4, qc)
     SELECT s, to_timestamp(t), p, f, m, q FROM unnest($1::text[], $2::int8[], $3::text[], $4::int[], $5::int[], $6::int[]) AS u(s, t, p, f, m, q)`,
    [readings.map((r) => r.sensorId), readings.map((r) => r.t), readings.map((r) => r.project),
      readings.map((r) => r.fcE4), readings.map((r) => r.fch4E4), readings.map((r) => r.qc)]);
}

export async function applySchemaAndSeed(): Promise<void> {
  await transaction(async (db) => {
    await lockSchema(db);
    await db.query(SCHEMA);
    for (const p of PROJECTS) await db.query(`CREATE SEQUENCE IF NOT EXISTS figure_seq_${p.code.toLowerCase()}`);
    const { rowCount } = await db.query("INSERT INTO seed_marker (name) VALUES ('levelmoor-v1') ON CONFLICT DO NOTHING");
    if (rowCount === 1) await seed(db);
  });
}
