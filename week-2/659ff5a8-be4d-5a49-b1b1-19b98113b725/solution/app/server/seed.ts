import type pg from "pg";
import { statusAfterCommit } from "../shared/lifecycle.js";
import { adjustedMs, indexedMs, parseFactor, parseRawTime } from "../shared/rules.js";
import { hashPassword } from "./auth.js";
import { insertEvent, writeEventStatus } from "./domain/events.js";
import { one, returning } from "./db.js";

const PASSWORD = "conecount-2026";
const RIDGELINE = { slug: "ridgeline", name: "Ridgeline Region", timeZone: "America/Denver" };
const TIDEWATER = { slug: "tidewater", name: "Tidewater Region", timeZone: "America/New_York" };

const RIDGELINE_FACTORS = { SS: "0.8270", AS: "0.8180", BS: "0.8120", DS: "0.8000", GS: "0.7930", HS: "0.7840", STR: "0.8290", SM: "0.8550" };
const TIDEWATER_FACTORS = { SS: "0.8250", AS: "0.8170", BS: "0.8110", DS: "0.7990", GS: "0.7920", HS: "0.7830", STR: "0.8280", SM: "0.8540" };

type Club = { id: number; timeZone: string };

async function addUser(db: pg.PoolClient, clubId: number | null, name: string, email: string, roles: string[]): Promise<number> {
  const user = await returning<{ id: number }>(
    db,
    "insert into users (club_id, name, email, password_hash, roles) values ($1, $2, $3, $4, $5) returning id",
    [clubId, name, email, await hashPassword(PASSWORD), roles],
  );
  return user.id;
}

async function addClub(db: pg.PoolClient, club: typeof RIDGELINE, factors: Record<string, string>): Promise<Club> {
  const created = await returning<{ id: number }>(
    db,
    "insert into clubs (slug, name, time_zone) values ($1, $2, $3) returning id",
    [club.slug, club.name, club.timeZone],
  );
  await db.query("insert into index_tables (club_id, effective_date, factors) values ($1, '2026-01-01', $2)", [created.id, factors]);
  return { id: created.id, timeZone: club.timeZone };
}

async function register(
  db: pg.PoolClient,
  eventId: number,
  runs: number,
  driverId: number,
  heat: number,
  car: { classCode: string; number: number; description: string },
): Promise<number> {
  const created = await returning<{ id: number }>(
    db,
    `insert into registrations (event_id, user_id, class_code, car_number, car_description, run_heat)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [eventId, driverId, car.classCode, car.number, car.description, heat],
  );
  await db.query("insert into runs (registration_id, run_number) select $1, n from generate_series(1, $2::int) n", [created.id, runs]);
  return created.id;
}

async function confirmed(db: pg.PoolClient, registrationId: number, email: string, eventName: string, car: string, heat: number): Promise<void> {
  await db.query(
    `insert into email_deliveries (kind, registration_id, recipient, subject, body, status, sent_at)
     values ('registration', $1, $2, $3, $4, 'sent', now())`,
    [registrationId, email, `Registered for ${eventName}: car ${car}`, `Car ${car}\nRun heat ${heat}`],
  );
}

type SeedRun = readonly [string, number] | "DNF";

async function timeRuns(db: pg.PoolClient, registrationId: number, factorText: string, timingId: number, runs: SeedRun[]): Promise<void> {
  const factor = parseFactor(factorText);
  if (factor === null) throw new Error(`bad seed factor ${factorText}`);
  for (const [index, run] of runs.entries()) {
    const raw = run === "DNF" ? null : parseRawTime(run[0]);
    const cones = run === "DNF" ? null : run[1];
    const adjusted = run === "DNF" || raw === null ? null : adjustedMs(raw, run[1]);
    const indexed = adjusted === null ? null : indexedMs(adjusted, factor);
    await db.query(
      `update runs set status = $10, outcome = $3, raw_ms = $4, cones = $5, adjusted_ms = $6, indexed_ms = $7,
              factor_bp = $8, committed_at = '2026-08-16T18:00:00Z', committed_by = $9
        where registration_id = $1 and run_number = $2`,
      [registrationId, index + 1, run === "DNF" ? "dnf" : "time", raw, cones, adjusted, indexed, factor, timingId,
       statusAfterCommit(run === "DNF" ? "dnf" : "time")],
    );
  }
}

const STATIONS = ["Start", "Finish", "Corner 1", "Corner 2"];
const AIRPARK_STATIONS = ["Start", "Finish", "Corner 1", "Corner 2", "Corner 3", "Corner 4"];

/** Seed the demo clubs once; running it again changes nothing. */
export async function seed(db: pg.PoolClient): Promise<void> {
  if (await one(db, "select 1 from clubs where slug = 'ridgeline'")) return;
  await addUser(db, null, "Rowan Pell", "ops@pylonworks.test", ["operator"]);

  const ridgeline = await addClub(db, RIDGELINE, RIDGELINE_FACTORS);
  await addUser(db, ridgeline.id, "Dana Whitcombe", "chair@ridgeline.test", ["chair"]);
  const timing = await addUser(db, ridgeline.id, "Ike Moreau", "timing@ridgeline.test", ["timing"]);
  await addUser(db, ridgeline.id, "Priya Halvorsen", "workers@ridgeline.test", ["workers"]);
  const avery = await addUser(db, ridgeline.id, "Avery Lindqvist", "avery@ridgeline.test", []);
  const bo = await addUser(db, ridgeline.id, "Bo Tanaka-Reyes", "bo@ridgeline.test", []);
  const cass = await addUser(db, ridgeline.id, "Cass Ferreira", "cass@ridgeline.test", []);
  const del = await addUser(db, ridgeline.id, "Del Mbeki", "del@ridgeline.test", []);
  await addUser(db, ridgeline.id, "Emery Novak", "emery@ridgeline.test", []);
  await addUser(db, ridgeline.id, "Finn Castellanos", "finn@ridgeline.test", []);
  await addUser(db, ridgeline.id, "Gale Ostrowski", "gale@ridgeline.test", []);
  await addUser(db, ridgeline.id, "Harper Quill", "harper@ridgeline.test", []);

  const fairgroundsHeats = [
    { number: 1, classes: ["SS", "STR"] },
    { number: 2, classes: ["GS", "HS"] },
  ];
  const fairgrounds = await insertEvent(db, ridgeline, {
    name: "Points 7 at Fairgrounds",
    date: "2026-08-16",
    venue: "County Fairgrounds Lot B",
    registrationCutoff: "2026-08-14T20:00",
    runsPerDriver: 2,
    heats: fairgroundsHeats,
    stations: STATIONS,
  });
  await writeEventStatus(db, fairgrounds, "final");
  await db.query(
    "update events set provisional_at = '2026-08-16T19:00:00Z', protest_window_closes_at = '2026-08-16T19:30:00Z' where id = $1",
    [fairgrounds],
  );
  const entries = [
    { who: avery, heat: 1, car: { classCode: "SS", number: 12, description: "2019 Chevrolet Corvette" }, runs: [["52.418", 1], ["51.907", 0]] as SeedRun[] },
    { who: bo, heat: 1, car: { classCode: "STR", number: 7, description: "2020 Mazda MX-5 RF" }, runs: [["53.211", 0], "DNF"] as SeedRun[] },
    { who: cass, heat: 2, car: { classCode: "GS", number: 31, description: "2017 Volkswagen GTI" }, runs: [["56.034", 2], ["55.120", 0]] as SeedRun[] },
    { who: del, heat: 2, car: { classCode: "HS", number: 4, description: "2016 Honda Fit" }, runs: [["58.402", 0], ["57.880", 1]] as SeedRun[] },
  ];
  const registered: Record<number, number> = {};
  for (const entry of entries) {
    const id = await register(db, fairgrounds, 2, entry.who, entry.heat, entry.car);
    registered[entry.who] = id;
    await db.query("update registrations set checked_in_at = '2026-08-16T15:00:00Z' where id = $1", [id]);
    await timeRuns(db, id, RIDGELINE_FACTORS[entry.car.classCode as keyof typeof RIDGELINE_FACTORS], timing, entry.runs);
  }
  for (const [who, heat, station] of [
    [avery, 2, "Corner 1"],
    [bo, 2, "Corner 2"],
    [cass, 1, "Corner 1"],
    [del, 1, "Corner 2"],
  ] as const) {
    await db.query("update stations set worker_registration_id = $4 where event_id = $1 and heat = $2 and name = $3", [
      fairgrounds,
      heat,
      station,
      registered[who],
    ]);
  }

  const airparkName = "Points 9 at Airpark";
  const airpark = await insertEvent(db, ridgeline, {
    name: airparkName,
    date: "2026-11-21",
    venue: "Mesa Airpark Overflow Lot",
    registrationCutoff: "2026-11-20T18:00",
    runsPerDriver: 3,
    heats: [
      { number: 1, classes: ["SS", "AS", "BS", "STR"] },
      { number: 2, classes: ["DS", "GS", "HS", "SM"] },
    ],
    stations: AIRPARK_STATIONS,
  });
  await writeEventStatus(db, airpark, "registration_open");
  const averyReg = await register(db, airpark, 3, avery, 1, { classCode: "SS", number: 12, description: "2019 Chevrolet Corvette" });
  const cassReg = await register(db, airpark, 3, cass, 2, { classCode: "GS", number: 31, description: "2017 Volkswagen GTI" });
  await confirmed(db, averyReg, "avery@ridgeline.test", airparkName, "12 SS", 1);
  await confirmed(db, cassReg, "cass@ridgeline.test", airparkName, "31 GS", 2);

  const tidewater = await addClub(db, TIDEWATER, TIDEWATER_FACTORS);
  await addUser(db, tidewater.id, "Morgan Ashby", "chair@tidewater.test", ["chair"]);
  const nico = await addUser(db, tidewater.id, "Nico Brandt", "nico@tidewater.test", []);
  const tidewaterName = "Tidewater Points 6";
  const points6 = await insertEvent(db, tidewater, {
    name: tidewaterName,
    date: "2026-11-14",
    venue: "Tidewater Naval Lot",
    registrationCutoff: "2026-11-13T20:00",
    runsPerDriver: 3,
    heats: [
      { number: 1, classes: ["SS", "AS", "BS", "STR"] },
      { number: 2, classes: ["DS", "GS", "HS", "SM"] },
    ],
    stations: STATIONS,
  });
  await writeEventStatus(db, points6, "registration_open");
  const nicoReg = await register(db, points6, 3, nico, 1, { classCode: "SS", number: 55, description: "2015 Porsche Cayman" });
  await confirmed(db, nicoReg, "nico@tidewater.test", tidewaterName, "55 SS", 1);
}
