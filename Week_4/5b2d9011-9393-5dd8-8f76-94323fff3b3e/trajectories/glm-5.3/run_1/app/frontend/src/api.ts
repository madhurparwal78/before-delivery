// Fetch helpers for the Holdfast Nights API. Every error keeps the one
// published shape.
export interface ApiError {
  code: string;
  message: string;
  fields?: Record<string, string>;
  extra?: Record<string, unknown>;
}

export interface ApiResult<T> {
  status: number;
  body: T | null;
  error: ApiError | null;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  const init: RequestInit = {
    method,
    headers: {},
    credentials: "same-origin",
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  try {
    const res = await fetch("/api" + path, init);
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = null; }
    }
    if (!res.ok) {
      const err = (data as { error?: ApiError } | null)?.error ?? { code: "bad_response", message: "" };
      if (res.status >= 500 && !err.code) {
        return { status: res.status, body: null, error: { code: "server_error", message: "Something went wrong on the server. Try again." } };
      }
      return { status: res.status, body: null, error: err };
    }
    return { status: res.status, body: data as T, error: null };
  } catch {
    return { status: 0, body: null, error: { code: "network", message: "Connection lost." } };
  }
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

// ---------- Shared API shapes ----------

export interface Player {
  id: string;
  callsign: string;
  role: "player" | "founder";
}

export interface Session {
  token: string;
  player: Player;
}

export interface Settings {
  bindings: Record<string, string>;
  master_volume: number;
  effects_volume: number;
  reduce_effects: boolean;
  screen_shake: boolean;
  camera_bob: boolean;
}

export interface StatusBody {
  build: string;
  tick_hz: number;
  services: { postgres: string; valkey: string; mail: string };
  mail_queued: number;
  server_time: string;
  studio_zone: string;
}

export interface PlayerState {
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

export interface ShopItemState {
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
  next_checkpoint: string;
  laps_done: number;
  lap_elapsed_ms: number;
  best_lap_ms: number | null;
  reset_remaining_ms: number | null;
}

export interface ReportResult {
  report_id: string;
  type: string;
  accepted: boolean;
  reason: string | null;
  tick: number;
  outcome: Record<string, unknown> | null;
}

export interface RoomEvent {
  seq: number;
  type: string;
  tick: number;
  [key: string]: unknown;
}

export interface RoomState {
  code: string;
  mode: "siege" | "convoy";
  phase: string;
  wave: number;
  phase_remaining_ms: number | null;
  tick: number;
  server_time: string;
  host: string;
  night_id: string | null;
  invite_expires_at: string;
  invite_remaining_ms: number | null;
  degraded: string | null;
  result: string | null;
  players: PlayerState[];
  enemies: EnemyState[];
  barrels: BarrelState[];
  grenades: GrenadeState[];
  shop: { open: boolean; items: ShopItemState[] };
  vehicles: VehicleState[];
  events: RoomEvent[];
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

export interface Signup {
  id: string;
  night_id: string;
  name: string;
  email: string;
  viewer_zone: string;
  created_at: string;
}

export interface HistoryMatch {
  id: string;
  code: string;
  mode: string;
  result: string;
  waves_cleared: number;
  night_id: string | null;
  started_at: string;
  ended_at: string;
  players: { callsign: string; score: number; kills: number; credits_earned: number; best_lap_ms: number | null }[];
}

export interface LapEntry {
  rank: number;
  callsign: string;
  lap_ms: number;
  set_at: string;
  match_id: string;
}

export interface PriceScheduleRow {
  id: string;
  item: string;
  price: number;
  effective_local: string;
  effective_at: string;
  status: "in_effect" | "pending" | "superseded";
}

export interface PricesBody {
  zone: string;
  items: {
    item: string;
    name: string;
    current_price: number;
    next_change: { id: string; price: number; effective_local: string; effective_at: string; in_ms: number } | null;
  }[];
  schedule: PriceScheduleRow[];
}
