import { pg } from './db.js';
import { dayOf } from '../domain/time.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS household (
  id text PRIMARY KEY,
  name text NOT NULL,
  zone text NOT NULL,
  notice_address text NOT NULL
);
CREATE TABLE IF NOT EXISTS rooms (
  id text PRIMARY KEY,
  name text NOT NULL,
  sort_order int NOT NULL
);
CREATE TABLE IF NOT EXISTS scenes (
  id text PRIMARY KEY,
  name text NOT NULL,
  tint text NOT NULL,
  brightness int NOT NULL,
  setpoint_f int,
  sort_order int NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
  id text PRIMARY KEY,
  name text NOT NULL,
  room_id text NOT NULL REFERENCES rooms(id),
  kind text NOT NULL,
  online boolean NOT NULL,
  state jsonb NOT NULL,
  revision int NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS schedules (
  id text PRIMARY KEY,
  name text NOT NULL,
  days text NOT NULL,
  revision int NOT NULL
);
CREATE TABLE IF NOT EXISTS schedule_versions (
  schedule_id text NOT NULL REFERENCES schedules(id),
  from_day date NOT NULL,
  PRIMARY KEY (schedule_id, from_day)
);
CREATE TABLE IF NOT EXISTS slots (
  id text PRIMARY KEY,
  schedule_id text NOT NULL REFERENCES schedules(id),
  from_day date NOT NULL,
  time_str text NOT NULL,
  scene_id text NOT NULL REFERENCES scenes(id),
  room_ids jsonb NOT NULL,
  UNIQUE (schedule_id, from_day, time_str, scene_id)
);
CREATE TABLE IF NOT EXISTS guest_scenes (
  id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES rooms(id),
  scene_id text NOT NULL REFERENCES scenes(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  state text NOT NULL,
  ended_at timestamptz,
  cancelled_at timestamptz
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key text PRIMARY KEY,
  body jsonb NOT NULL,
  status int NOT NULL,
  answer jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id text PRIMARY KEY,
  schedule_id text NOT NULL,
  version_from date NOT NULL,
  slot_id text NOT NULL,
  slot_time text NOT NULL,
  ran_at timestamptz NOT NULL,
  ran_day date NOT NULL,
  scene_id text NOT NULL,
  room_ids jsonb NOT NULL,
  UNIQUE (schedule_id, version_from, slot_id, ran_day)
);
CREATE TABLE IF NOT EXISTS clips (
  id text PRIMARY KEY,
  camera_id text NOT NULL REFERENCES devices(id),
  recorded_at timestamptz NOT NULL,
  day date NOT NULL,
  declared_size bigint NOT NULL,
  stored_size bigint,
  state text NOT NULL,
  object_key text NOT NULL
);
CREATE TABLE IF NOT EXISTS notices (
  id text PRIMARY KEY,
  kind text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  to_address text NOT NULL,
  state text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  sent_at timestamptz
);
CREATE TABLE IF NOT EXISTS notice_keys (
  key text PRIMARY KEY,
  notice_id text NOT NULL REFERENCES notices(id),
  created_at timestamptz NOT NULL
);
`;

const FIX_RUNS = `ALTER TABLE runs ADD COLUMN IF NOT EXISTS ran_day date;`;
const ALTER_RUNS_UNIQUE = `CREATE UNIQUE INDEX IF NOT EXISTS runs_occurrence ON runs (schedule_id, version_from, slot_id, ran_day);`;

export async function applySchema(): Promise<void> {
  // ran_day is part of the table definition for fresh databases; the ALTER
  // keeps an older applied schema from blocking the UNIQUE constraint.
  for (const stmt of SCHEMA.split(';')) {
    const t = stmt.trim();
    if (t) await pg.query(t);
  }
  await pg.query(FIX_RUNS);
  await pg.query(ALTER_RUNS_UNIQUE);
}

const roomSeed = [
  ['hall', 'Hall'],
  ['kitchen', 'Kitchen'],
  ['living', 'Living'],
  ['study', 'Study'],
  ['main-bedroom', 'Main bedroom'],
  ['nursery', 'Nursery'],
  ['spare-room', 'Spare room'],
  ['bath', 'Bath'],
  ['porch', 'Porch'],
];

const sceneSeed = [
  ['wake', 'Wake', 'amber', 70, 70],
  ['day', 'Day', 'honey', 40, 68],
  ['evening', 'Evening', 'ember', 60, 69],
  ['bedtime', 'Bedtime', 'rose', 20, 67],
  ['night-low', 'Night low', 'dusk', 5, 65],
  ['guest-welcome', 'Guest welcome', 'candle', 50, 71],
];

const deviceSeed: [string, string, string, string, object][] = [
  ['hall-light', 'Hall light', 'hall', 'light', { on: false, brightness: 70 }],
  ['hall-camera', 'Hall camera', 'hall', 'camera', {}],
  ['kitchen-lights', 'Kitchen lights', 'kitchen', 'light', { on: false, brightness: 70 }],
  ['kettle-plug', 'Kettle plug', 'kitchen', 'plug', { on: false }],
  ['living-lamp', 'Living lamp', 'living', 'light', { on: false, brightness: 60 }],
  ['living-thermostat', 'Living thermostat', 'living', 'thermostat', { setpoint_f: 68, current_f: 69 }],
  ['study-lamp', 'Study lamp', 'study', 'light', { on: false, brightness: 40 }],
  ['desk-plug', 'Desk plug', 'study', 'plug', { on: true }],
  ['main-bedroom-light', 'Main bedroom light', 'main-bedroom', 'light', { on: false, brightness: 20 }],
  ['main-bedroom-thermostat', 'Main bedroom thermostat', 'main-bedroom', 'thermostat', { setpoint_f: 67, current_f: 68 }],
  ['nursery-light', 'Nursery light', 'nursery', 'light', { on: false, brightness: 20 }],
  ['nursery-thermostat', 'Nursery thermostat', 'nursery', 'thermostat', { setpoint_f: 68, current_f: 68 }],
  ['spare-room-light', 'Spare room light', 'spare-room', 'light', { on: false, brightness: 50 }],
  ['bath-light', 'Bath light', 'bath', 'light', { on: false, brightness: 70 }],
  ['porch-light', 'Porch light', 'porch', 'light', { on: false, brightness: 60 }],
  ['porch-camera', 'Porch camera', 'porch', 'camera', {}],
];

const scheduleSeed = [
  {
    id: 'weekday', name: 'Weekday', days: 'mon-fri', from: '2026-01-01',
    slots: [
      ['01:30', 'night-low', ['hall', 'kitchen', 'living', 'study', 'main-bedroom', 'nursery', 'spare-room', 'bath', 'porch']],
      ['06:40', 'wake', ['hall', 'kitchen', 'main-bedroom', 'nursery', 'bath']],
      ['08:30', 'day', ['kitchen', 'living', 'study']],
      ['17:30', 'evening', ['hall', 'kitchen', 'living', 'porch']],
      ['19:30', 'bedtime', ['nursery']],
      ['21:30', 'bedtime', ['main-bedroom']],
      ['22:15', 'night-low', ['hall', 'kitchen', 'living', 'study', 'bath', 'porch']],
    ],
  },
  {
    id: 'weekend', name: 'Weekend', days: 'sat-sun', from: '2026-01-01',
    slots: [
      ['01:30', 'night-low', ['hall', 'kitchen', 'living', 'study', 'main-bedroom', 'nursery', 'spare-room', 'bath', 'porch']],
      ['08:00', 'wake', ['hall', 'kitchen', 'main-bedroom', 'nursery', 'bath']],
      ['10:00', 'day', ['kitchen', 'living', 'study']],
      ['18:00', 'evening', ['hall', 'kitchen', 'living', 'porch']],
      ['19:45', 'bedtime', ['nursery']],
      ['22:30', 'bedtime', ['main-bedroom']],
      ['23:30', 'night-low', ['hall', 'kitchen', 'living', 'study', 'bath', 'porch']],
    ],
  },
];

/** Insert seed data only when the household record is missing; never overwrite. */
export async function seed(): Promise<void> {
  const household = await pg.query('SELECT id FROM household');
  if (household.rowCount && household.rowCount > 0) return;

  await pg.query('BEGIN');
  try {
    await pg.query(`INSERT INTO household (id, name, zone, notice_address) VALUES ('alder-lane', 'Alder Lane house', 'America/Chicago', 'household@alder-lane.test')`);

    for (let i = 0; i < roomSeed.length; i++) {
      const [id, name] = roomSeed[i]!;
      await pg.query('INSERT INTO rooms (id, name, sort_order) VALUES ($1, $2, $3)', [id, name, i]);
    }

    for (let i = 0; i < sceneSeed.length; i++) {
      const [id, name, tint, brightness, setpoint] = sceneSeed[i]!;
      await pg.query('INSERT INTO scenes (id, name, tint, brightness, setpoint_f, sort_order) VALUES ($1, $2, $3, $4, $5, $6)', [id, name, tint, brightness, setpoint, i]);
    }

    const now = Date.now();
    for (const [id, name, room, kind, state] of deviceSeed) {
      await pg.query('INSERT INTO devices (id, name, room_id, kind, online, state, revision, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [id, name, room, kind, true, JSON.stringify(state), 1, new Date(now)]);
    }

    for (const sched of scheduleSeed) {
      await pg.query('INSERT INTO schedules (id, name, days, revision) VALUES ($1, $2, $3, $4)', [sched.id, sched.name, sched.days, 1]);
      await pg.query('INSERT INTO schedule_versions (schedule_id, from_day) VALUES ($1, $2)', [sched.id, sched.from]);
      for (const [timeStr, sceneId, roomIds] of sched.slots) {
        await pg.query('INSERT INTO slots (id, schedule_id, from_day, time_str, scene_id, room_ids) VALUES ($1, $2, $3, $4, $5, $6)', [
          `${sched.id}:${sched.from}:${timeStr}:${sceneId}`, sched.id, sched.from, timeStr, sceneId, JSON.stringify(roomIds),
        ]);
      }
    }
    await pg.query('COMMIT');
  } catch (e) {
    await pg.query('ROLLBACK');
    throw e;
  }
}

export function clipKey(clipId: string, cameraId: string, recordedAt: Date): string {
  return `clips/${cameraId}/${dayOf(recordedAt.getTime())}/${clipId}.mp4`;
}
