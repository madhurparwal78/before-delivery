// Idempotent schema apply and seed. Runs on every serve start.
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Pool } from "pg";
import type { AppConfig } from "./config.js";
import { Storage } from "./services/storage.js";
import { localToUtc } from "./time.js";
import { adjustedTime, indexedTime } from "./domain/times.js";

const SEED_PASSWORD = "conecount-2026";

interface SeedDriver {
  name: string;
  email: string;
}

interface SeedEventSpec {
  key: string;
  name: string;
  venue: string;
  date: string;
  cutoff: string;
  runsPerDriver: number;
  heats: Record<number, string[]>;
  stations: string[];
  status: string;
  registrations: {
    driver: string;
    classCode: string;
    carNumber: number;
    description: string;
    checkedIn: boolean;
    station?: { name: string; heat: number };
    runs?: { run: number; outcome: "time" | "dnf"; raw?: string; cones?: number }[];
    confirmationSent?: boolean;
  }[];
}

const RIDGELINE_DRIVERS: SeedDriver[] = [
  { name: "Avery Lindqvist", email: "avery@ridgeline.test" },
  { name: "Bo Tanaka-Reyes", email: "bo@ridgeline.test" },
  { name: "Cass Ferreira", email: "cass@ridgeline.test" },
  { name: "Del Mbeki", email: "del@ridgeline.test" },
  { name: "Emery Novak", email: "emery@ridgeline.test" },
  { name: "Finn Castellanos", email: "finn@ridgeline.test" },
  { name: "Gale Ostrowski", email: "gale@ridgeline.test" },
  { name: "Harper Quill", email: "harper@ridgeline.test" },
];

const RIDGELINE_FACTORS: Record<string, string> = {
  SS: "0.8270", AS: "0.8180", BS: "0.8120", DS: "0.8000",
  GS: "0.7930", HS: "0.7840", STR: "0.8290", SM: "0.8550",
};

const TIDEWATER_FACTORS: Record<string, string> = {
  SS: "0.8250", AS: "0.8170", BS: "0.8110", DS: "0.7990",
  GS: "0.7920", HS: "0.7830", STR: "0.8280", SM: "0.8540",
};

const POINTS_7: SeedEventSpec = {
  key: "seed_points7",
  name: "Points 7 at Fairgrounds",
  venue: "County Fairgrounds Lot B",
  date: "2026-08-16",
  cutoff: "2026-08-14T20:00",
  runsPerDriver: 2,
  heats: { 1: ["SS", "STR"], 2: ["GS", "HS"] },
  stations: ["Start", "Finish", "Corner 1", "Corner 2"],
  status: "final",
  registrations: [
    {
      driver: "avery@ridgeline.test", classCode: "SS", carNumber: 12,
      description: "2019 Chevrolet Corvette", checkedIn: true,
      station: { name: "Corner 1", heat: 2 },
      runs: [
        { run: 1, outcome: "time", raw: "52.418", cones: 1 },
        { run: 2, outcome: "time", raw: "51.907", cones: 0 },
      ],
    },
    {
      driver: "bo@ridgeline.test", classCode: "STR", carNumber: 7,
      description: "2020 Mazda MX-5 RF", checkedIn: true,
      station: { name: "Corner 2", heat: 2 },
      runs: [
        { run: 1, outcome: "time", raw: "53.211", cones: 0 },
        { run: 2, outcome: "dnf" },
      ],
    },
    {
      driver: "cass@ridgeline.test", classCode: "GS", carNumber: 31,
      description: "2017 Volkswagen GTI", checkedIn: true,
      station: { name: "Corner 1", heat: 1 },
      runs: [
        { run: 1, outcome: "time", raw: "56.034", cones: 2 },
        { run: 2, outcome: "time", raw: "55.120", cones: 0 },
      ],
    },
    {
      driver: "del@ridgeline.test", classCode: "HS", carNumber: 4,
      description: "2016 Honda Fit", checkedIn: true,
      station: { name: "Corner 2", heat: 1 },
      runs: [
        { run: 1, outcome: "time", raw: "58.402", cones: 0 },
        { run: 2, outcome: "time", raw: "57.880", cones: 1 },
      ],
    },
  ],
};

const POINTS_9: SeedEventSpec = {
  key: "seed_points9",
  name: "Points 9 at Airpark",
  venue: "Mesa Airpark Overflow Lot",
  date: "2026-11-21",
  cutoff: "2026-11-20T18:00",
  runsPerDriver: 3,
  heats: { 1: ["SS", "AS", "BS", "STR"], 2: ["DS", "GS", "HS", "SM"] },
  stations: ["Start", "Finish", "Corner 1", "Corner 2", "Corner 3", "Corner 4"],
  status: "registration_open",
  registrations: [
    {
      driver: "avery@ridgeline.test", classCode: "SS", carNumber: 12,
      description: "2019 Chevrolet Corvette", checkedIn: false, confirmationSent: true,
    },
    {
      driver: "cass@ridgeline.test", classCode: "GS", carNumber: 31,
      description: "2017 Volkswagen GTI", checkedIn: false, confirmationSent: true,
    },
  ],
};

const TIDEWATER_6: SeedEventSpec = {
  key: "seed_tw6",
  name: "Tidewater Points 6",
  venue: "Harborline Lot A",
  date: "2026-11-14",
  cutoff: "2026-11-13T20:00",
  runsPerDriver: 3,
  heats: { 1: ["SS", "AS", "BS", "STR"], 2: ["DS", "GS", "HS", "SM"] },
  stations: ["Start", "Finish", "Corner 1", "Corner 2"],
  status: "registration_open",
  registrations: [
    {
      driver: "nico@tidewater.test", classCode: "SS", carNumber: 55,
      description: "2015 Porsche Cayman", checkedIn: false, confirmationSent: true,
    },
  ],
};

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(salt + password).digest("hex");
  return `s1$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [version, salt, hash] = stored.split("$");
  if (version !== "s1" || !salt || !hash) return false;
  return createHash("sha256").update(salt + password).digest("hex") === hash;
}

export async function migrate(pool: Pool): Promise<void> {
  const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "schema.sql");
  const sql = readFileSync(schemaPath, "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const statement of splitStatements(sql)) {
      await client.query(statement);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

function splitStatements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function seed(pool: Pool, config: AppConfig, _storage: Storage): Promise<void> {
  const q = async (text: string, params: unknown[] = []) => (await pool.query(text, params as never[])).rows;

  const already = await q(`SELECT id FROM clubs LIMIT 1`);
  if (already.length > 0) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const userIds = new Map<string, string>();
    async function upsertUser(email: string, name: string, clubId: string | null, isOperator: boolean, roles: string[]): Promise<string> {
      const id = `usr_${stableId(email)}`;
      await client.query(
        `INSERT INTO users (id, club_id, name, email, password_hash, is_operator, staff_roles)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (email) DO NOTHING`,
        [id, clubId, name, email, hashPassword(SEED_PASSWORD), isOperator, roles],
      );
      userIds.set(email, id);
      return id;
    }

    const operatorId = await upsertUser("ops@pylonworks.test", "Rowan Pell", null, true, []);

    const clubRows = [
      { slug: "ridgeline", name: "Ridgeline Region", tz: "America/Denver" },
      { slug: "tidewater", name: "Tidewater Region", tz: "America/New_York" },
    ];
    const clubIds = new Map<string, string>();
    for (const club of clubRows) {
      const id = `club_${stableId(club.slug)}`;
      await client.query(
        `INSERT INTO clubs (id, slug, name, time_zone) VALUES ($1,$2,$3,$4) ON CONFLICT (slug) DO NOTHING`,
        [id, club.slug, club.name, club.tz],
      );
      clubIds.set(club.slug, id);
    }
    const ridgelineId = clubIds.get("ridgeline") as string;
    const tidewaterId = clubIds.get("tidewater") as string;

    // Index tables
    async function insertTable(clubId: string, effective: string, factors: Record<string, string>, createdBy: string): Promise<string> {
      const id = `idxt_${stableId(clubId + effective)}`;
      await client.query(
        `INSERT INTO index_tables (id, club_id, effective_date, factors, created_by)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (club_id, effective_date) DO NOTHING`,
        [id, clubId, effective, JSON.stringify(factors), createdBy],
      );
      return id;
    }
    const tableRidgeline = await insertTable(ridgelineId, "2026-01-01", RIDGELINE_FACTORS, operatorId);
    const tableTidewater = await insertTable(tidewaterId, "2026-01-01", TIDEWATER_FACTORS, operatorId);

    // Users
    await upsertUser("chair@ridgeline.test", "Dana Whitcombe", ridgelineId, false, ["chair"]);
    await upsertUser("timing@ridgeline.test", "Ike Moreau", ridgelineId, false, ["timing"]);
    await upsertUser("workers@ridgeline.test", "Priya Halvorsen", ridgelineId, false, ["workers"]);
    for (const driver of RIDGELINE_DRIVERS) await upsertUser(driver.email, driver.name, ridgelineId, false, []);
    await upsertUser("chair@tidewater.test", "Morgan Ashby", tidewaterId, false, ["chair"]);
    await upsertUser("nico@tidewater.test", "Nico Brandt", tidewaterId, false, []);

    async function seedEvent(spec: SeedEventSpec, clubId: string, clubSlug: string, clubTz: string, tableId: string): Promise<void> {
      const eventId = `evt_${stableId(spec.key)}`;
      const cutoffUtc = localToUtc(spec.cutoff.slice(0, 10), spec.cutoff.slice(11, 16), clubTz);
      const heatClasses: Record<string, string[]> = {};
      for (const [heat, classes] of Object.entries(spec.heats)) heatClasses[heat] = classes;
      const status = spec.status;
      const provisionalAt = status === "final" || status === "published"
        ? localToUtc(spec.date, "18:00", clubTz)
        : null;
      await client.query(
        `INSERT INTO events (id, club_id, name, date, venue, registration_cutoff, runs_per_driver,
          heat_classes, stations, status, running_heat, provisional_at, protest_window_closes_at,
          version, index_table_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1,$14)
         ON CONFLICT (id) DO NOTHING`,
        [
          eventId, clubId, spec.name, spec.date, spec.venue, cutoffUtc.toISOString(),
          spec.runsPerDriver, JSON.stringify(heatClasses), JSON.stringify(spec.stations),
          status, status === "running" ? 1 : null, provisionalAt,
          provisionalAt ? new Date(provisionalAt.getTime() + config.protestWindowSeconds * 1000).toISOString() : null,
          tableId,
        ],
      );

      const stationIds = new Map<string, string>();
      for (const heat of Object.keys(spec.heats).map(Number).sort((a, b) => a - b)) {
        for (const name of spec.stations) {
          const id = `sta_${stableId(`${spec.key}:${heat}:${name}`)}`;
          await client.query(
            `INSERT INTO stations (id, event_id, name, heat) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
            [id, eventId, name, heat],
          );
          stationIds.set(`${heat}:${name}`, id);
        }
      }

      for (const reg of spec.registrations) {
        const driverId = userIds.get(reg.driver) as string;
        const regId = `reg_${stableId(`${spec.key}:${reg.driver}`)}`;
        const runHeat = Object.entries(spec.heats).find(([, classes]) => classes.includes(reg.classCode))?.[0];
        await client.query(
          `INSERT INTO registrations (id, event_id, driver_id, class_code, car_number, car_description,
            run_heat, checked_in_at, confirmation_email)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (event_id, driver_id) DO NOTHING`,
          [
            regId, eventId, driverId, reg.classCode, reg.carNumber, reg.description,
            Number(runHeat), reg.checkedIn ? cutoffUtc.toISOString() : null,
            reg.confirmationSent ? "accepted" : "pending",
          ],
        );
        if (reg.station) {
          const stationId = stationIds.get(`${reg.station.heat}:${reg.station.name}`);
          if (stationId) {
            await client.query(`UPDATE stations SET registration_id = $1 WHERE id = $2`, [regId, stationId]);
          }
        }
        for (let runNumber = 1; runNumber <= spec.runsPerDriver; runNumber++) {
          const runId = `run_${stableId(`${spec.key}:${reg.driver}:${runNumber}`)}`;
          const specRun = reg.runs?.find((r) => r.run === runNumber);
          let status2 = "pending";
          let outcome: string | null = null;
          let raw: string | null = null;
          let cones: number | null = null;
          let adjusted: string | null = null;
          let indexed: string | null = null;
          if (specRun) {
            status2 = "committed";
            outcome = specRun.outcome;
            if (specRun.outcome === "time") {
              raw = specRun.raw as string;
              cones = specRun.cones ?? 0;
              const factor = clubSlug === "ridgeline" ? RIDGELINE_FACTORS[reg.classCode] : TIDEWATER_FACTORS[reg.classCode];
              adjusted = adjustedTime(raw, cones);
              indexed = indexedTime(adjusted, factor);
            }
          }
          await client.query(
            `INSERT INTO runs (id, registration_id, run_number, status, outcome, raw_time, cones,
              adjusted_time, indexed_time, factor, committed_at, committed_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
             ON CONFLICT (registration_id, run_number) DO NOTHING`,
            [
              runId, regId, runNumber, status2, outcome, raw, cones, adjusted, indexed,
              specRun ? (clubSlug === "ridgeline" ? RIDGELINE_FACTORS[reg.classCode] : TIDEWATER_FACTORS[reg.classCode]) : null,
              specRun ? cutoffUtc.toISOString() : null,
              specRun ? userIds.get("timing@ridgeline.test") : null,
            ],
          );
        }
      }
    }

    await seedEvent(POINTS_7, ridgelineId, "ridgeline", "America/Denver", tableRidgeline);
    await seedEvent(POINTS_9, ridgelineId, "ridgeline", "America/Denver", tableRidgeline);
    await seedEvent(TIDEWATER_6, tidewaterId, "tidewater", "America/New_York", tableTidewater);

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

function stableId(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 20);
}
