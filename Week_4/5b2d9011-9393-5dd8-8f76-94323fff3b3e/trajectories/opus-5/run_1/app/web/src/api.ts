// The typed API client. Every value the screens show comes from here; the
// browser never recomputes a server rule.

export interface Player {
  id: string;
  callsign: string;
  role: 'player' | 'founder';
}

export interface Settings {
  bindings: Record<string, string>;
  master_volume: number;
  effects_volume: number;
  reduce_effects: boolean;
  screen_shake: boolean;
  camera_bob: boolean;
}

export interface Status {
  build: string;
  tick_hz: number;
  services: { postgres: string; valkey: string; mail: string };
  mail_queued: number;
  server_time: string;
  studio_zone: string;
}

export interface RoomPlayer {
  id: string;
  callsign: string;
  seat: number;
  ready: boolean;
  connection: 'connected' | 'disconnected' | 'left';
  grace_remaining_ms: number | null;
  status: 'up' | 'downed' | 'out';
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

export interface Enemy {
  id: string;
  kind: string;
  state: string;
  hp: number;
  x: number;
  z: number;
}

export interface Barrel {
  id: string;
  hp: number;
  x: number;
  z: number;
  destroyed: boolean;
}

export interface GrenadeView {
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

export interface VehicleView {
  player: string;
  state: 'running' | 'wrecked' | 'finished';
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
  [key: string]: unknown;
}

export interface RoomState {
  code: string;
  mode: 'siege' | 'convoy';
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
  players: RoomPlayer[];
  enemies: Enemy[];
  barrels: Barrel[];
  grenades: GrenadeView[];
  shop: { open: boolean; items: ShopItem[] };
  vehicles: VehicleView[];
  events: RoomEvent[];
}

export interface ReportResult {
  report_id: string;
  type: string;
  accepted: boolean;
  reason: string | null;
  tick: number;
  outcome: unknown;
}

export interface PoseResult {
  seq: number;
  accepted: boolean;
  reason: string | null;
  vehicle: VehicleView;
}

export interface Night {
  id: string;
  series_id: string;
  title: string;
  mode: 'siege' | 'convoy';
  date: string;
  scheduled_local_time: string;
  local_start: string;
  utc_offset: string;
  zone_abbr: string;
  starts_at: string;
  signups_open_at: string;
  signups_close_at: string;
  ends_at: string;
  status: 'scheduled' | 'signups_open' | 'closed' | 'live' | 'done';
  status_changes_in_ms: number | null;
  capacity: number;
  signed_up: number;
  seats_left: number;
  dst_note: string | null;
}

export interface PriceChangeRow {
  id: string;
  item: string;
  price: number;
  effective_local: string;
  effective_at: string;
  status: 'in_effect' | 'pending' | 'superseded';
}

export interface PricesView {
  zone: string;
  items: {
    item: string;
    name: string;
    current_price: number;
    next_change: {
      id: string;
      price: number;
      effective_local: string;
      effective_at: string;
      in_ms: number;
    } | null;
  }[];
  schedule: PriceChangeRow[];
}

export interface MatchPlayer {
  callsign: string;
  score: number;
  kills: number;
  credits_earned: number;
  best_lap_ms: number | null;
}

export interface Match {
  id: string;
  code: string;
  mode: 'siege' | 'convoy';
  result: string;
  waves_cleared: number;
  night_id: string | null;
  started_at: string;
  ended_at: string;
  players: MatchPlayer[];
}

export interface LapRow {
  rank: number;
  callsign: string;
  lap_ms: number;
  set_at: string;
  match_id: string;
}

/** ApiError carries the server's published error code and field messages. */
export class ApiError extends Error {
  status: number;
  code: string;
  fields: Record<string, string>;
  extra: Record<string, unknown>;

  constructor(status: number, code: string, message: string, fields: Record<string, string>, extra: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.extra = extra;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin' };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError(0, 'network', 'Something went wrong on the server. Try again.', {}, {});
  }
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: any = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    const error = payload?.error ?? {};
    const { code, message, fields, ...extra } = error;
    throw new ApiError(
      response.status,
      code ?? 'unknown',
      message ?? 'Something went wrong on the server. Try again.',
      fields ?? {},
      extra ?? {},
    );
  }
  return payload as T;
}

export const api = {
  status: () => request<Status>('GET', '/api/status'),
  studio: () => request<{ name: string; zone: string }>('GET', '/api/studio'),
  me: () => request<{ player: Player }>('GET', '/api/me'),
  createSession: (callsign: string, studioKey?: string) =>
    request<{ token: string; player: Player }>('POST', '/api/sessions', {
      callsign,
      ...(studioKey ? { studio_key: studioKey } : {}),
    }),
  settings: () => request<Settings>('GET', '/api/me/settings'),
  saveSettings: (settings: Settings) => request<Settings>('PUT', '/api/me/settings', settings),

  createRoom: (mode: 'siege' | 'convoy') => request<RoomState>('POST', '/api/rooms', { mode }),
  room: (code: string) => request<RoomState>('GET', `/api/rooms/${encodeURIComponent(code)}`),
  join: (code: string) =>
    request<{ seat: number; state: RoomState }>('POST', `/api/rooms/${encodeURIComponent(code)}/join`),
  ready: (code: string, ready: boolean) =>
    request<RoomState>('POST', `/api/rooms/${encodeURIComponent(code)}/ready`, { ready }),
  start: (code: string) => request<RoomState>('POST', `/api/rooms/${encodeURIComponent(code)}/start`),
  leave: (code: string) => request<RoomState>('POST', `/api/rooms/${encodeURIComponent(code)}/leave`),
  heartbeat: (code: string) => request<void>('POST', `/api/rooms/${encodeURIComponent(code)}/heartbeat`),
  input: (code: string, seq: number, move: { x: number; z: number }, aim: number) =>
    request<{ seq: number; applied: boolean }>('POST', `/api/rooms/${encodeURIComponent(code)}/input`, {
      seq,
      move,
      aim,
    }),
  report: (code: string, body: Record<string, unknown>) =>
    request<ReportResult>('POST', `/api/rooms/${encodeURIComponent(code)}/reports`, body),
  reportBatch: (code: string, reports: Record<string, unknown>[]) =>
    request<{ results: (ReportResult | { error: { code: string; message: string } })[] }>(
      'POST',
      `/api/rooms/${encodeURIComponent(code)}/reports/batch`,
      { reports },
    ),
  pose: (code: string, seq: number, x: number, z: number, heading: number) =>
    request<PoseResult>('POST', `/api/rooms/${encodeURIComponent(code)}/pose`, { seq, x, z, heading }),
  purchase: (code: string, purchaseId: string, item: string) =>
    request<{ purchase_id: string; item: string; unit_price: number; balance: number }>(
      'POST',
      `/api/rooms/${encodeURIComponent(code)}/purchases`,
      { purchase_id: purchaseId, item },
    ),

  nights: (days = 28) => request<{ zone: string; nights: Night[] }>('GET', `/api/nights?days=${days}`),
  signup: (nightId: string, name: string, email: string, viewerZone: string) =>
    request<{ signup: { id: string }; email_status: string }>(
      'POST',
      `/api/nights/${encodeURIComponent(nightId)}/signups`,
      { name, email, viewer_zone: viewerZone },
    ),
  createSeries: (body: Record<string, unknown>) =>
    request<{ series: { id: string; title: string }; nights: Night[] }>('POST', '/api/nights/series', body),

  prices: () => request<PricesView>('GET', '/api/prices'),
  createPriceChange: (item: string, price: number, effectiveLocal: string) =>
    request<PriceChangeRow>('POST', '/api/prices', {
      item,
      price,
      effective_local: effectiveLocal,
    }),
  deletePriceChange: (id: string) => request<void>('DELETE', `/api/prices/${encodeURIComponent(id)}`),

  history: () => request<{ matches: Match[] }>('GET', '/api/history'),
  laps: () => request<{ laps: LapRow[] }>('GET', '/api/laps'),
  map: (id: string) => request<any>('GET', `/api/maps/${encodeURIComponent(id)}`),
};
