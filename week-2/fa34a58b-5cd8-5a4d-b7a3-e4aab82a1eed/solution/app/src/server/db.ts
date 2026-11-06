// PostgreSQL: the pool, boot retry, the idempotent schema and the one-time seed.

import pg from "pg";
import { config } from "./config.ts";

pg.types.setTypeParser(1082, (value: string) => value); // date stays YYYY-MM-DD
export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });
pool.on("error", () => undefined); // an idle client dropping is retried by the next query

export type Queryable = pg.Pool | pg.PoolClient;

export async function rows<T>(db: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}

export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS household (
  id text PRIMARY KEY, name text NOT NULL, zone text NOT NULL, notice_address text NOT NULL);
CREATE TABLE IF NOT EXISTS rooms (
  id text PRIMARY KEY, name text NOT NULL, position int NOT NULL);
CREATE TABLE IF NOT EXISTS scenes (
  id text PRIMARY KEY, name text NOT NULL, tint text NOT NULL, brightness int NOT NULL,
  setpoint_f int, position bigserial);
CREATE UNIQUE INDEX IF NOT EXISTS scenes_name_unique ON scenes (lower(name));
CREATE TABLE IF NOT EXISTS devices (
  id text PRIMARY KEY, name text NOT NULL, room_id text NOT NULL REFERENCES rooms, kind text NOT NULL,
  position int NOT NULL, online boolean NOT NULL, state jsonb NOT NULL, revision int NOT NULL,
  updated_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS schedules (
  id text PRIMARY KEY, name text NOT NULL, weekdays int[] NOT NULL,
  position int NOT NULL, revision int NOT NULL);
CREATE TABLE IF NOT EXISTS schedule_versions (
  schedule_id text NOT NULL REFERENCES schedules, from_date date NOT NULL, seeded boolean NOT NULL,
  PRIMARY KEY (schedule_id, from_date));
CREATE TABLE IF NOT EXISTS slots (
  id text PRIMARY KEY, schedule_id text NOT NULL, from_date date NOT NULL, time text NOT NULL,
  scene_id text NOT NULL REFERENCES scenes, room_ids text[] NOT NULL, position int NOT NULL,
  FOREIGN KEY (schedule_id, from_date) REFERENCES schedule_versions ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS guest_scenes (
  id text PRIMARY KEY, room_id text NOT NULL REFERENCES rooms, scene_id text NOT NULL REFERENCES scenes,
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, state text NOT NULL,
  ended_at timestamptz, cancelled_at timestamptz, position bigserial);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key text PRIMARY KEY, fingerprint text NOT NULL, status int NOT NULL, body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS runs (
  id text PRIMARY KEY, schedule_id text NOT NULL, version_from date NOT NULL, slot_id text NOT NULL,
  slot_time text NOT NULL, occurrence_day date NOT NULL, ran_day date NOT NULL, ran_at timestamptz NOT NULL,
  scene_id text NOT NULL, room_ids text[] NOT NULL,
  UNIQUE (schedule_id, version_from, slot_id, occurrence_day));
CREATE INDEX IF NOT EXISTS runs_by_day ON runs (ran_day, ran_at);
CREATE TABLE IF NOT EXISTS clips (
  id text PRIMARY KEY, camera_id text NOT NULL REFERENCES devices, recorded_at timestamptz NOT NULL,
  day date NOT NULL, declared_size int NOT NULL, stored_size int, state text NOT NULL, object_key text NOT NULL);
CREATE INDEX IF NOT EXISTS clips_by_day ON clips (day, recorded_at);
CREATE TABLE IF NOT EXISTS notices (
  id text PRIMARY KEY, kind text NOT NULL, subject text NOT NULL, body text NOT NULL, to_address text NOT NULL,
  state text NOT NULL, attempts int NOT NULL DEFAULT 0, created_at timestamptz NOT NULL, sent_at timestamptz,
  dedupe_key text NOT NULL UNIQUE, position bigserial);
`;

const ROOMS: [string, string][] = [
  ["hall", "Hall"], ["kitchen", "Kitchen"], ["living", "Living"], ["study", "Study"],
  ["main-bedroom", "Main bedroom"], ["nursery", "Nursery"], ["spare-room", "Spare room"],
  ["bath", "Bath"], ["porch", "Porch"],
];

const SCENES: [string, string, string, number, number][] = [
  ["wake", "Wake", "amber", 70, 70],
  ["day", "Day", "honey", 40, 68],
  ["evening", "Evening", "ember", 60, 69],
  ["bedtime", "Bedtime", "rose", 20, 67],
  ["night-low", "Night low", "dusk", 5, 65],
  ["guest-welcome", "Guest welcome", "candle", 50, 71],
];

const light = (level: number) => ({ on: false, brightness: level });
const DEVICES: [string, string, string, string, object][] = [
  ["hall-light", "Hall light", "hall", "light", light(70)],
  ["hall-camera", "Hall camera", "hall", "camera", {}],
  ["kitchen-lights", "Kitchen lights", "kitchen", "light", light(70)],
  ["kettle-plug", "Kettle plug", "kitchen", "plug", { on: false }],
  ["living-lamp", "Living lamp", "living", "light", light(60)],
  ["living-thermostat", "Living thermostat", "living", "thermostat", { setpoint_f: 68, current_f: 69 }],
  ["study-lamp", "Study lamp", "study", "light", light(40)],
  ["desk-plug", "Desk plug", "study", "plug", { on: true }],
  ["main-bedroom-light", "Main bedroom light", "main-bedroom", "light", light(20)],
  ["main-bedroom-thermostat", "Main bedroom thermostat", "main-bedroom", "thermostat", { setpoint_f: 67, current_f: 68 }],
  ["nursery-light", "Nursery light", "nursery", "light", light(20)],
  ["nursery-thermostat", "Nursery thermostat", "nursery", "thermostat", { setpoint_f: 68, current_f: 68 }],
  ["spare-room-light", "Spare room light", "spare-room", "light", light(50)],
  ["bath-light", "Bath light", "bath", "light", light(70)],
  ["porch-light", "Porch light", "porch", "light", light(60)],
  ["porch-camera", "Porch camera", "porch", "camera", {}],
];

const ALL_ROOMS = ROOMS.map(([id]) => id);
const WAKE_ROOMS = ["hall", "kitchen", "main-bedroom", "nursery", "bath"];
const DAY_ROOMS = ["kitchen", "living", "study"];
const EVENING_ROOMS = ["hall", "kitchen", "living", "porch"];
const NIGHT_ROOMS = ["hall", "kitchen", "living", "study", "bath", "porch"];

const SCHEDULES: { id: string; name: string; weekdays: number[]; slots: [string, string, string[]][] }[] = [
  {
    id: "weekday", name: "Weekday", weekdays: [1, 2, 3, 4, 5],
    slots: [
      ["01:30", "night-low", ALL_ROOMS], ["06:40", "wake", WAKE_ROOMS], ["08:30", "day", DAY_ROOMS],
      ["17:30", "evening", EVENING_ROOMS], ["19:30", "bedtime", ["nursery"]],
      ["21:30", "bedtime", ["main-bedroom"]], ["22:15", "night-low", NIGHT_ROOMS],
    ],
  },
  {
    id: "weekend", name: "Weekend", weekdays: [6, 0],
    slots: [
      ["01:30", "night-low", ALL_ROOMS], ["08:00", "wake", WAKE_ROOMS], ["10:00", "day", DAY_ROOMS],
      ["18:00", "evening", EVENING_ROOMS], ["19:45", "bedtime", ["nursery"]],
      ["22:30", "bedtime", ["main-bedroom"]], ["23:30", "night-low", NIGHT_ROOMS],
    ],
  },
];
const SEED_FROM = "2026-01-01";

async function seed(client: pg.PoolClient): Promise<void> {
  await client.query(
    "INSERT INTO household (id, name, zone, notice_address) VALUES ('household', 'Alder Lane house', 'America/Chicago', 'household@alder-lane.test')",
  );
  for (const [index, [id, name]] of ROOMS.entries()) {
    await client.query("INSERT INTO rooms (id, name, position) VALUES ($1, $2, $3)", [id, name, index + 1]);
  }
  for (const [id, name, tint, brightness, setpoint] of SCENES) {
    await client.query("INSERT INTO scenes (id, name, tint, brightness, setpoint_f) VALUES ($1, $2, $3, $4, $5)", [
      id, name, tint, brightness, setpoint,
    ]);
  }
  for (const [index, [id, name, room, kind, state]] of DEVICES.entries()) {
    await client.query(
      "INSERT INTO devices (id, name, room_id, kind, position, online, state, revision, updated_at) VALUES ($1, $2, $3, $4, $5, true, $6, 1, now())",
      [id, name, room, kind, index + 1, JSON.stringify(state)],
    );
  }
  for (const [index, schedule] of SCHEDULES.entries()) {
    await client.query("INSERT INTO schedules (id, name, weekdays, position, revision) VALUES ($1, $2, $3, $4, 1)", [
      schedule.id, schedule.name, schedule.weekdays, index + 1,
    ]);
    await client.query("INSERT INTO schedule_versions (schedule_id, from_date, seeded) VALUES ($1, $2, true)", [
      schedule.id, SEED_FROM,
    ]);
    for (const [position, [time, scene, rooms]] of schedule.slots.entries()) {
      await client.query(
        "INSERT INTO slots (id, schedule_id, from_date, time, scene_id, room_ids, position) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [`${schedule.id}-${time.replace(":", "")}`, schedule.id, SEED_FROM, time, scene, rooms, position + 1],
      );
    }
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for PostgreSQL (retrying every 2 seconds), applies the schema and seeds a missing household. */
export async function prepareDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query("SELECT 1");
      break;
    } catch {
      await sleep(2000);
    }
  }
  await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(417301)");
    await client.query(SCHEMA);
    const existing = await client.query("SELECT 1 FROM household");
    if (existing.rowCount === 0) await seed(client);
  });
}
