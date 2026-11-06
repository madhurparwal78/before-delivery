export type Tint = 'amber' | 'honey' | 'ember' | 'rose' | 'dusk' | 'candle';
export const TINTS: readonly Tint[] = ['amber', 'honey', 'ember', 'rose', 'dusk', 'candle'];

export type DeviceKind = 'light' | 'plug' | 'thermostat' | 'camera';

export interface LightState {
  on: boolean;
  brightness: number;
}
export interface PlugState {
  on: boolean;
}
export interface ThermostatState {
  setpoint_f: number;
  current_f: number;
}
export type CameraState = Record<string, never>;
export type DeviceState = LightState | PlugState | ThermostatState | CameraState;

export interface Room {
  id: string;
  name: string;
  order: number;
  device_ids: string[];
}

export interface Scene {
  id: string;
  name: string;
  tint: Tint;
  brightness: number;
  setpoint_f: number | null;
}

export interface Device {
  id: string;
  name: string;
  room_id: string;
  kind: DeviceKind;
  online: boolean;
  state: DeviceState;
  revision: number;
  updated_at: string;
}

export interface Slot {
  id: string;
  time: string;
  scene_id: string;
  room_ids: string[];
}

export interface ScheduleVersion {
  from: string;
  slots: Slot[];
}

export interface Schedule {
  id: string;
  name: string;
  days: string[];
  revision: number;
  versions: ScheduleVersion[];
}

export type GuestSceneState = 'scheduled' | 'active' | 'ended' | 'cancelled';

export interface GuestScene {
  id: string;
  room_id: string;
  scene_id: string;
  starts_at: string;
  ends_at: string;
  state: GuestSceneState;
  ended_at: string | null;
  cancelled_at: string | null;
}

export interface Run {
  id: string;
  schedule_id: string;
  version_from: string;
  slot_id: string;
  slot_time: string;
  ran_at: string;
  scene_id: string;
  room_ids: string[];
}

export type ClipState = 'announced' | 'storing' | 'stored' | 'size_mismatch';

export interface Clip {
  id: string;
  camera_id: string;
  camera_name: string;
  recorded_at: string;
  day: string;
  declared_size: number;
  stored_size: number | null;
  state: ClipState;
  playable: boolean;
  object_key: string;
}

export type NoticeKind = 'guest_scene_ended' | 'schedule_change' | 'motion';

export interface Notice {
  id: string;
  kind: NoticeKind;
  subject: string;
  to: string;
  state: 'queued' | 'sent';
  attempts: number;
  created_at: string;
  sent_at: string | null;
}

export type OwnerSource = 'schedule' | 'guest' | 'none';

export interface StatusRoom {
  room_id: string;
  name: string;
  scene_id: string | null;
  scene_name: string | null;
  since: string | null;
  source: OwnerSource;
  guest_scene_id: string | null;
}

export interface StatusBody {
  now: string;
  day: string;
  zone: string;
  offset: string;
  rooms: StatusRoom[];
  services: { storage: 'up' | 'down'; mail: 'up' | 'down' };
}

export interface HourMark {
  at: string;
  label: string;
  abbr: string;
}

export interface PlanStartOwner {
  room_id: string;
  scene_id: string | null;
  since: string | null;
  source: OwnerSource;
  guest_scene_id: string | null;
}

export type PlanChangeSource = 'schedule' | 'guest' | 'guest_end';

export interface PlanChange {
  at: string;
  local: string;
  offset: string;
  source: PlanChangeSource;
  schedule_id: string | null;
  version_from: string | null;
  slot_id: string | null;
  slot_time: string | null;
  guest_scene_id: string | null;
  scene_id: string | null;
  room_ids: string[];
}

export interface PlanBody {
  day: string;
  schedule_id: string;
  hours: number;
  start: string;
  end: string;
  hour_marks: HourMark[];
  rooms: { room_id: string; name: string; order: number }[];
  start_owners: PlanStartOwner[];
  changes: PlanChange[];
}

export type SocketMessage =
  | ({ type: 'status' } & StatusBody)
  | { type: 'device'; device: Device }
  | { type: 'guest_scene'; guest_scene: GuestScene }
  | { type: 'schedule'; schedule_id: string; revision: number }
  | { type: 'scene'; scene: Scene }
  | { type: 'clip'; clip: Clip }
  | { type: 'notice'; notice: Notice };

export interface ApiErrorBody {
  error: { code: string; message: string };
  fields?: Record<string, string>;
}
