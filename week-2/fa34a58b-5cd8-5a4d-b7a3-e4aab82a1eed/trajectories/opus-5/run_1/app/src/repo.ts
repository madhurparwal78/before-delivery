import type { PoolClient } from 'pg';
import { pool, query } from './db';
import { formatInstant, householdDayOf, type HouseholdDay } from './domain/time';
import type {
  Clip,
  ClipState,
  Device,
  DeviceKind,
  DeviceState,
  GuestScene,
  GuestSceneState,
  Notice,
  NoticeKind,
  OwnerSource,
  Room,
  Run,
  Scene,
  Schedule,
  Tint,
} from './shared/types';

export interface RoomRow {
  id: string;
  name: string;
  plan_order: number;
}
export interface SceneRow {
  id: string;
  name: string;
  tint: Tint;
  brightness: number;
  setpoint_f: number | null;
  catalogue_order: number;
}
export interface DeviceRow {
  id: string;
  name: string;
  room_id: string;
  kind: DeviceKind;
  online: boolean;
  state: DeviceState;
  revision: number;
  updated_at: Date;
}
export interface SlotRow {
  id: string;
  slot_time: string;
  scene_id: string;
  room_ids: string[];
}
export interface VersionRow {
  id: string;
  from_date: HouseholdDay;
  seeded: boolean;
  slots: SlotRow[];
}
export interface ScheduleRow {
  id: string;
  name: string;
  days: string[];
  revision: number;
  versions: VersionRow[];
}
export interface GuestSceneRow {
  id: string;
  room_id: string;
  scene_id: string;
  starts_at: Date;
  ends_at: Date;
  state: GuestSceneState;
  ended_at: Date | null;
  cancelled_at: Date | null;
}
export interface RunRow {
  id: string;
  schedule_id: string;
  version_from: HouseholdDay;
  slot_id: string;
  slot_time: string;
  ran_at: Date;
  scene_id: string;
  room_ids: string[];
}
export interface ClipRow {
  id: string;
  camera_id: string;
  camera_name: string;
  recorded_at: Date;
  day: HouseholdDay;
  declared_size: string | number;
  stored_size: string | number | null;
  state: ClipState;
  object_key: string;
}
export interface NoticeRow {
  id: string;
  kind: NoticeKind;
  subject: string;
  body: string;
  to_address: string;
  state: 'queued' | 'sent';
  attempts: number;
  created_at: Date;
  sent_at: Date | null;
}
export interface RoomOwnerRow {
  room_id: string;
  scene_id: string | null;
  source: OwnerSource;
  since: Date | null;
  guest_scene_id: string | null;
}

function dayText(value: Date | string): HouseholdDay {
  if (typeof value === 'string') return value.slice(0, 10);
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function loadRooms(): Promise<RoomRow[]> {
  return query<RoomRow>('select id, name, plan_order from rooms order by plan_order');
}

export async function loadScenes(): Promise<SceneRow[]> {
  return query<SceneRow>(
    'select id, name, tint, brightness, setpoint_f, catalogue_order from scenes order by catalogue_order',
  );
}

export async function loadDevices(roomId?: string): Promise<DeviceRow[]> {
  if (roomId === undefined) {
    return query<DeviceRow>(
      `select d.id, d.name, d.room_id, d.kind, d.online, d.state, d.revision, d.updated_at
       from devices d join rooms r on r.id = d.room_id
       order by r.plan_order, d.device_order`,
    );
  }
  return query<DeviceRow>(
    `select id, name, room_id, kind, online, state, revision, updated_at
     from devices where room_id = $1 order by device_order`,
    [roomId],
  );
}

export async function loadDevice(id: string): Promise<DeviceRow | null> {
  const rows = await query<DeviceRow>(
    'select id, name, room_id, kind, online, state, revision, updated_at from devices where id = $1',
    [id],
  );
  return rows[0] ?? null;
}

export async function loadSchedules(): Promise<ScheduleRow[]> {
  const schedules = await query<{ id: string; name: string; days: string[]; revision: number }>(
    'select id, name, days, revision from schedules order by id',
  );
  const versions = await query<{
    id: string;
    schedule_id: string;
    from_date: Date | string;
    seeded: boolean;
  }>('select id, schedule_id, from_date, seeded from schedule_versions order by from_date');
  const slots = await query<{
    id: string;
    version_id: string;
    slot_time: string;
    scene_id: string;
    room_ids: string[];
  }>(
    'select id, version_id, slot_time, scene_id, room_ids from schedule_slots order by slot_time, ordinal',
  );
  return schedules.map((schedule) => ({
    ...schedule,
    versions: versions
      .filter((version) => version.schedule_id === schedule.id)
      .map((version) => ({
        id: version.id,
        from_date: dayText(version.from_date),
        seeded: version.seeded,
        slots: slots
          .filter((slot) => slot.version_id === version.id)
          .map((slot) => ({
            id: slot.id,
            slot_time: slot.slot_time,
            scene_id: slot.scene_id,
            room_ids: slot.room_ids,
          })),
      })),
  }));
}

export async function loadGuestScenes(): Promise<GuestSceneRow[]> {
  return query<GuestSceneRow>(
    `select id, room_id, scene_id, starts_at, ends_at, state, ended_at, cancelled_at
     from guest_scenes order by created_at desc, id desc`,
  );
}

export async function loadGuestScene(id: string): Promise<GuestSceneRow | null> {
  const rows = await query<GuestSceneRow>(
    `select id, room_id, scene_id, starts_at, ends_at, state, ended_at, cancelled_at
     from guest_scenes where id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function loadRuns(day: HouseholdDay): Promise<RunRow[]> {
  const rows = await query<Omit<RunRow, 'version_from'> & { version_from: Date | string }>(
    `select id, schedule_id, version_from, slot_id, slot_time, ran_at, scene_id, room_ids
     from runs where day = $1 order by ran_at`,
    [day],
  );
  return rows.map((row) => ({ ...row, version_from: dayText(row.version_from) }));
}

export async function loadClips(day: HouseholdDay): Promise<ClipRow[]> {
  const rows = await query<Omit<ClipRow, 'day'> & { day: Date | string }>(
    `select c.id, c.camera_id, d.name as camera_name, c.recorded_at, c.day,
            c.declared_size, c.stored_size, c.state, c.object_key
     from clips c join devices d on d.id = c.camera_id
     where c.day = $1 order by c.recorded_at`,
    [day],
  );
  return rows.map((row) => ({ ...row, day: dayText(row.day) }));
}

export async function loadClip(id: string): Promise<ClipRow | null> {
  const rows = await query<Omit<ClipRow, 'day'> & { day: Date | string }>(
    `select c.id, c.camera_id, d.name as camera_name, c.recorded_at, c.day,
            c.declared_size, c.stored_size, c.state, c.object_key
     from clips c join devices d on d.id = c.camera_id where c.id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? { ...row, day: dayText(row.day) } : null;
}

export async function loadNotices(): Promise<NoticeRow[]> {
  return query<NoticeRow>(
    `select id, kind, subject, body, to_address, state, attempts, created_at, sent_at
     from notices order by sequence desc`,
  );
}

export async function loadRoomOwners(): Promise<RoomOwnerRow[]> {
  return query<RoomOwnerRow>(
    'select room_id, scene_id, source, since, guest_scene_id from room_owners',
  );
}

export async function noticeAddress(): Promise<string> {
  const rows = await query<{ notice_address: string }>(
    'select notice_address from households limit 1',
  );
  const row = rows[0];
  if (!row) throw new Error('Household record missing');
  return row.notice_address;
}

export function toRoom(row: RoomRow, deviceIds: string[]): Room {
  return { id: row.id, name: row.name, order: row.plan_order, device_ids: deviceIds };
}

export function toScene(row: SceneRow): Scene {
  return {
    id: row.id,
    name: row.name,
    tint: row.tint,
    brightness: row.brightness,
    setpoint_f: row.setpoint_f,
  };
}

export function toDevice(row: DeviceRow): Device {
  return {
    id: row.id,
    name: row.name,
    room_id: row.room_id,
    kind: row.kind,
    online: row.online,
    state: row.state,
    revision: row.revision,
    updated_at: formatInstant(row.updated_at),
  };
}

export function toSchedule(row: ScheduleRow): Schedule {
  return {
    id: row.id,
    name: row.name,
    days: row.days,
    revision: row.revision,
    versions: row.versions.map((version) => ({
      from: version.from_date,
      slots: version.slots.map((slot) => ({
        id: slot.id,
        time: slot.slot_time,
        scene_id: slot.scene_id,
        room_ids: slot.room_ids,
      })),
    })),
  };
}

export function toGuestScene(row: GuestSceneRow): GuestScene {
  return {
    id: row.id,
    room_id: row.room_id,
    scene_id: row.scene_id,
    starts_at: formatInstant(row.starts_at),
    ends_at: formatInstant(row.ends_at),
    state: row.state,
    ended_at: row.ended_at ? formatInstant(row.ended_at) : null,
    cancelled_at: row.cancelled_at ? formatInstant(row.cancelled_at) : null,
  };
}

export function toRun(row: RunRow): Run {
  return {
    id: row.id,
    schedule_id: row.schedule_id,
    version_from: row.version_from,
    slot_id: row.slot_id,
    slot_time: row.slot_time,
    ran_at: formatInstant(row.ran_at),
    scene_id: row.scene_id,
    room_ids: row.room_ids,
  };
}

export function toClip(row: ClipRow): Clip {
  return {
    id: row.id,
    camera_id: row.camera_id,
    camera_name: row.camera_name,
    recorded_at: formatInstant(row.recorded_at),
    day: row.day,
    declared_size: Number(row.declared_size),
    stored_size: row.stored_size === null ? null : Number(row.stored_size),
    state: row.state,
    playable: row.state === 'stored',
    object_key: row.object_key,
  };
}

export function toNotice(row: NoticeRow): Notice {
  return {
    id: row.id,
    kind: row.kind,
    subject: row.subject,
    to: row.to_address,
    state: row.state,
    attempts: row.attempts,
    created_at: formatInstant(row.created_at),
    sent_at: row.sent_at ? formatInstant(row.sent_at) : null,
  };
}

export async function writeDeviceState(
  id: string,
  patch: { online?: boolean; state?: DeviceState },
  at: Date,
): Promise<DeviceRow> {
  const rows = await query<DeviceRow>(
    `update devices set
        online = coalesce($2, online),
        state = coalesce($3::jsonb, state),
        revision = revision + 1,
        updated_at = $4
     where id = $1
     returning id, name, room_id, kind, online, state, revision, updated_at`,
    [
      id,
      patch.online ?? null,
      patch.state === undefined ? null : JSON.stringify(patch.state),
      at,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error(`Device ${id} missing`);
  return row;
}

export async function recordRun(
  run: Omit<RunRow, 'id'> & { id: string },
): Promise<RunRow | null> {
  const rows = await query<Omit<RunRow, 'version_from'> & { version_from: Date | string }>(
    `insert into runs (id, schedule_id, version_from, slot_id, slot_time, ran_at, day, scene_id, room_ids)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (schedule_id, version_from, slot_id, day) do nothing
     returning id, schedule_id, version_from, slot_id, slot_time, ran_at, scene_id, room_ids`,
    [
      run.id,
      run.schedule_id,
      run.version_from,
      run.slot_id,
      run.slot_time,
      run.ran_at,
      householdDayOf(run.ran_at),
      run.scene_id,
      run.room_ids,
    ],
  );
  const row = rows[0];
  return row ? { ...row, version_from: dayText(row.version_from) } : null;
}

export async function saveRoomOwner(
  client: PoolClient | null,
  owner: RoomOwnerRow,
): Promise<void> {
  const runner = client ?? pool;
  await runner.query(
    `insert into room_owners (room_id, scene_id, source, since, guest_scene_id)
     values ($1, $2, $3, $4, $5)
     on conflict (room_id) do update set
       scene_id = excluded.scene_id,
       source = excluded.source,
       since = excluded.since,
       guest_scene_id = excluded.guest_scene_id`,
    [owner.room_id, owner.scene_id, owner.source, owner.since, owner.guest_scene_id],
  );
}
