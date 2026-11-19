export interface Player {
  id: string;
  callsign: string;
  role: "player" | "founder";
}

export interface Settings {
  bindings: Record<string, string>;
  master_volume: number;
  effects_volume: number;
  reduce_effects: boolean;
  screen_shake: boolean;
  camera_bob: boolean;
}

export interface SeatState {
  id: string;
  callsign: string;
  seat: number;
  ready: boolean;
  connection: "connected" | "disconnected" | "left";
  grace_remaining_ms: number | null;
  status: "up" | "downed" | "out";
  hp: number;
  x: number;
  z: number;
  aim: number;
  last_input_seq: number;
  mag: number;
  reserve: number;
  grenades: number;
  reload_remaining_ms: number | null;
  revive_remaining_ms: number | null;
  credits: number;
  score: number;
  kills: number;
}

export interface EnemyState {
  id: string;
  kind: "grunt" | "brute" | "boss";
  state: "patrol" | "detect" | "pursue" | "attack" | "dead";
  hp: number;
  x: number;
  z: number;
}

export interface BarrelState {
  id: string;
  hp: number;
  x: number;
  z: number;
  destroyed: boolean;
}

export interface GrenadeState {
  id: string;
  owner: string;
  x: number;
  z: number;
  fuse_remaining_ms: number;
}

export interface ShopItem {
  item: string;
  name: string;
  price: number;
  next_price: number | null;
  next_change_in_ms: number | null;
}

export interface VehicleState {
  player: string;
  state: "running" | "wrecked" | "finished";
  x: number;
  z: number;
  heading: number;
  last_seq: number;
  next_checkpoint: number;
  laps_done: number;
  lap_elapsed_ms: number;
  best_lap_ms: number | null;
  reset_remaining_ms: number | null;
}

export interface RoomEvent {
  seq: number;
  type: string;
  tick: number;
  [field: string]: unknown;
}

export interface RoomState {
  code: string;
  mode: "siege" | "convoy";
  phase: "lobby" | "countdown" | "wave" | "intermission" | "boss_wave" | "race" | "over";
  wave: number;
  phase_remaining_ms: number | null;
  tick: number;
  server_time: string;
  host: string | null;
  night_id: string | null;
  invite_expires_at: string;
  invite_remaining_ms: number | null;
  degraded: string | null;
  result: string | null;
  players: SeatState[];
  enemies: EnemyState[];
  barrels: BarrelState[];
  grenades: GrenadeState[];
  shop: { open: boolean; items: ShopItem[] };
  vehicles: VehicleState[];
  events: RoomEvent[];
}

export interface ReportBody {
  report_id: string;
  type: "shot" | "reload" | "grenade" | "revive";
  aim?: number;
  target?: { x: number; z: number };
  target_player?: string;
}

export interface ReportResult {
  report_id: string;
  type: string;
  accepted: boolean;
  reason: string | null;
  tick: number;
  outcome: unknown;
  error?: { code: string; message: string };
}

export interface Night {
  id: string;
  series_id: string;
  title: string;
  mode: "siege" | "convoy";
  date: string;
  scheduled_local_time: string;
  local_start: string;
  utc_offset: string;
  zone_abbr: string;
  starts_at: string;
  signups_open_at: string;
  signups_close_at: string;
  ends_at: string;
  status: "scheduled" | "signups_open" | "closed" | "live" | "done";
  status_changes_in_ms: number | null;
  capacity: number;
  signed_up: number;
  seats_left: number;
  dst_note: string | null;
}

export interface PriceChange {
  id: string;
  item: string;
  price: number;
  effective_local: string;
  effective_at: string;
  status: "in_effect" | "pending" | "superseded";
}

export interface PriceItem {
  item: string;
  name: string;
  current_price: number;
}

export interface ServiceStatus {
  build: string;
  tick_hz: number;
  services: { postgres: "up" | "down"; valkey: "up" | "down"; mail: "up" | "down" };
  mail_queued: number;
  server_time: string;
  studio_zone: string;
}

export interface HistoryMatch {
  id: string;
  code: string;
  mode: "siege" | "convoy";
  result: string;
  waves_cleared: number;
  night_id: string | null;
  started_at: string;
  ended_at: string;
  players: { callsign: string; score: number; kills: number; credits_earned: number; best_lap_ms: number | null }[];
}

export interface LapRow {
  rank: number;
  callsign: string;
  lap_ms: number;
  set_at: string;
  match_id: string;
}

export interface GameMap {
  id: string;
  width: number;
  depth: number;
  blocks: { x: number; z: number; w: number; d: number }[];
  spawns: { seat: number; x: number; z: number; aim?: number; heading?: number }[];
  barrels: { id: string; x: number; z: number }[];
  waves: { wave: number; enemies: { id: string; kind: string; x: number; z: number }[] }[];
  checkpoints: { id: string; x: number; z: number }[];
}
