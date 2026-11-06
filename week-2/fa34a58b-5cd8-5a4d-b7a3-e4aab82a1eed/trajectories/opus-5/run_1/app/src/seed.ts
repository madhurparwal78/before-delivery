import { transaction } from './db';
import type { DeviceKind, DeviceState, Tint } from './shared/types';

export const HOUSEHOLD_ID = 'alder-lane';
export const HOUSEHOLD_NAME = 'Alder Lane house';
export const NOTICE_ADDRESS = 'household@alder-lane.test';

const ROOMS: { id: string; name: string }[] = [
  { id: 'hall', name: 'Hall' },
  { id: 'kitchen', name: 'Kitchen' },
  { id: 'living', name: 'Living' },
  { id: 'study', name: 'Study' },
  { id: 'main-bedroom', name: 'Main bedroom' },
  { id: 'nursery', name: 'Nursery' },
  { id: 'spare-room', name: 'Spare room' },
  { id: 'bath', name: 'Bath' },
  { id: 'porch', name: 'Porch' },
];

const SCENES: { id: string; name: string; tint: Tint; brightness: number; setpoint: number }[] = [
  { id: 'wake', name: 'Wake', tint: 'amber', brightness: 70, setpoint: 70 },
  { id: 'day', name: 'Day', tint: 'honey', brightness: 40, setpoint: 68 },
  { id: 'evening', name: 'Evening', tint: 'ember', brightness: 60, setpoint: 69 },
  { id: 'bedtime', name: 'Bedtime', tint: 'rose', brightness: 20, setpoint: 67 },
  { id: 'night-low', name: 'Night low', tint: 'dusk', brightness: 5, setpoint: 65 },
  { id: 'guest-welcome', name: 'Guest welcome', tint: 'candle', brightness: 50, setpoint: 71 },
];

const DEVICES: {
  id: string;
  name: string;
  room: string;
  kind: DeviceKind;
  state: DeviceState;
}[] = [
  { id: 'hall-light', name: 'Hall light', room: 'hall', kind: 'light', state: { on: false, brightness: 70 } },
  { id: 'hall-camera', name: 'Hall camera', room: 'hall', kind: 'camera', state: {} },
  { id: 'kitchen-lights', name: 'Kitchen lights', room: 'kitchen', kind: 'light', state: { on: false, brightness: 70 } },
  { id: 'kettle-plug', name: 'Kettle plug', room: 'kitchen', kind: 'plug', state: { on: false } },
  { id: 'living-lamp', name: 'Living lamp', room: 'living', kind: 'light', state: { on: false, brightness: 60 } },
  { id: 'living-thermostat', name: 'Living thermostat', room: 'living', kind: 'thermostat', state: { setpoint_f: 68, current_f: 69 } },
  { id: 'study-lamp', name: 'Study lamp', room: 'study', kind: 'light', state: { on: false, brightness: 40 } },
  { id: 'desk-plug', name: 'Desk plug', room: 'study', kind: 'plug', state: { on: true } },
  { id: 'main-bedroom-light', name: 'Main bedroom light', room: 'main-bedroom', kind: 'light', state: { on: false, brightness: 20 } },
  { id: 'main-bedroom-thermostat', name: 'Main bedroom thermostat', room: 'main-bedroom', kind: 'thermostat', state: { setpoint_f: 67, current_f: 68 } },
  { id: 'nursery-light', name: 'Nursery light', room: 'nursery', kind: 'light', state: { on: false, brightness: 20 } },
  { id: 'nursery-thermostat', name: 'Nursery thermostat', room: 'nursery', kind: 'thermostat', state: { setpoint_f: 68, current_f: 68 } },
  { id: 'spare-room-light', name: 'Spare room light', room: 'spare-room', kind: 'light', state: { on: false, brightness: 50 } },
  { id: 'bath-light', name: 'Bath light', room: 'bath', kind: 'light', state: { on: false, brightness: 70 } },
  { id: 'porch-light', name: 'Porch light', room: 'porch', kind: 'light', state: { on: false, brightness: 60 } },
  { id: 'porch-camera', name: 'Porch camera', room: 'porch', kind: 'camera', state: {} },
];

const ALL_ROOMS = ROOMS.map((room) => room.id);

const SEED_FROM = '2026-01-01';

const SCHEDULES: {
  id: string;
  name: string;
  days: string[];
  slots: { time: string; scene: string; rooms: string[] }[];
}[] = [
  {
    id: 'weekday',
    name: 'Weekday',
    days: ['mon', 'tue', 'wed', 'thu', 'fri'],
    slots: [
      { time: '01:30', scene: 'night-low', rooms: ALL_ROOMS },
      { time: '06:40', scene: 'wake', rooms: ['hall', 'kitchen', 'main-bedroom', 'nursery', 'bath'] },
      { time: '08:30', scene: 'day', rooms: ['kitchen', 'living', 'study'] },
      { time: '17:30', scene: 'evening', rooms: ['hall', 'kitchen', 'living', 'porch'] },
      { time: '19:30', scene: 'bedtime', rooms: ['nursery'] },
      { time: '21:30', scene: 'bedtime', rooms: ['main-bedroom'] },
      { time: '22:15', scene: 'night-low', rooms: ['hall', 'kitchen', 'living', 'study', 'bath', 'porch'] },
    ],
  },
  {
    id: 'weekend',
    name: 'Weekend',
    days: ['sat', 'sun'],
    slots: [
      { time: '01:30', scene: 'night-low', rooms: ALL_ROOMS },
      { time: '08:00', scene: 'wake', rooms: ['hall', 'kitchen', 'main-bedroom', 'nursery', 'bath'] },
      { time: '10:00', scene: 'day', rooms: ['kitchen', 'living', 'study'] },
      { time: '18:00', scene: 'evening', rooms: ['hall', 'kitchen', 'living', 'porch'] },
      { time: '19:45', scene: 'bedtime', rooms: ['nursery'] },
      { time: '22:30', scene: 'bedtime', rooms: ['main-bedroom'] },
      { time: '23:30', scene: 'night-low', rooms: ['hall', 'kitchen', 'living', 'study', 'bath', 'porch'] },
    ],
  },
];

/** Inserts the seed data only when the household record is missing. */
export async function seedIfEmpty(): Promise<void> {
  await transaction(async (client) => {
    const existing = await client.query('select 1 from households where id = $1', [HOUSEHOLD_ID]);
    if (existing.rowCount && existing.rowCount > 0) return;

    await client.query(
      'insert into households (id, name, zone, notice_address) values ($1, $2, $3, $4)',
      [HOUSEHOLD_ID, HOUSEHOLD_NAME, 'America/Chicago', NOTICE_ADDRESS],
    );

    for (const [index, room] of ROOMS.entries()) {
      await client.query('insert into rooms (id, name, plan_order) values ($1, $2, $3)', [
        room.id,
        room.name,
        index + 1,
      ]);
    }

    for (const [index, scene] of SCENES.entries()) {
      await client.query(
        'insert into scenes (id, name, tint, brightness, setpoint_f, catalogue_order) values ($1, $2, $3, $4, $5, $6)',
        [scene.id, scene.name, scene.tint, scene.brightness, scene.setpoint, index + 1],
      );
    }

    const seedInstant = new Date();
    for (const [index, device] of DEVICES.entries()) {
      await client.query(
        `insert into devices (id, name, room_id, kind, online, state, revision, updated_at, device_order)
         values ($1, $2, $3, $4, true, $5, 1, $6, $7)`,
        [
          device.id,
          device.name,
          device.room,
          device.kind,
          JSON.stringify(device.state),
          seedInstant,
          index + 1,
        ],
      );
    }

    for (const schedule of SCHEDULES) {
      await client.query(
        'insert into schedules (id, name, days, revision) values ($1, $2, $3, 1)',
        [schedule.id, schedule.name, schedule.days],
      );
      const versionId = `${schedule.id}-${SEED_FROM}`;
      await client.query(
        'insert into schedule_versions (id, schedule_id, from_date, seeded) values ($1, $2, $3, true)',
        [versionId, schedule.id, SEED_FROM],
      );
      for (const [index, slot] of schedule.slots.entries()) {
        await client.query(
          'insert into schedule_slots (id, version_id, slot_time, scene_id, room_ids, ordinal) values ($1, $2, $3, $4, $5, $6)',
          [`${versionId}-${index + 1}`, versionId, slot.time, slot.scene, slot.rooms, index + 1],
        );
      }
    }

    for (const room of ROOMS) {
      await client.query(
        "insert into room_owners (room_id, scene_id, source, since, guest_scene_id) values ($1, null, 'none', null, null)",
        [room.id],
      );
    }
  });
}
