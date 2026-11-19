// The API client. Same-origin fetches; credentials ride the session cookie.
export interface Me {
  playerId: string;
  name: string;
  guest: boolean;
  email: string | null;
  units: 'kmh' | 'mph';
}

export interface CarStats {
  accelMps2: number;
  brakeMps2: number;
  topMps: number;
  gripPct: number;
  laneChangeSteps: number;
}

export interface CatalogCar {
  carId: string;
  name: string;
  class: string;
  pi: number;
  price: number | null;
  starter: boolean;
  stats: CarStats;
}

export interface GarageCar {
  carId: string;
  name: string;
  class: string;
  pi: number;
  overClassLimit: boolean;
  stages: Record<string, number>;
  paid: Record<string, number>;
  stats: CarStats;
}

export interface Reference {
  layoutId: string;
  oldLapMs: number;
  newLapMs: number;
  deltaMs: number;
  oldSectorsMs: [number, number, number];
  newSectorsMs: [number, number, number];
  sectorDeltasMs: [number, number, number];
  price: number;
}

export interface Garage {
  balance: number;
  selectedCarId: string;
  cars: GarageCar[];
  latestReference: Reference | null;
}

export interface RunSummary {
  runId: string;
  playerId: string;
  name: string;
  status: string;
  reason: string | null;
  layoutId: string;
  mode: string;
  carId: string;
  eventId: string | null;
  loaner: boolean;
  laps: number;
  stepLimit: number;
  car: { stats: CarStats; stages: Record<string, number> };
  lapResults: { lapMs: number; valid: boolean; offTrackSteps: number; sectorsMs: [number, number, number] }[];
  raceMs: number | null;
  bestLapMs: number | null;
  driftScore: number | null;
  coinsCollected: number | null;
  position: number | null;
  clean: boolean | null;
  payout: number | null;
  topSpeedMps: number | null;
  replaySha256: string | null;
}

export interface BoardRow {
  rank: number;
  playerId: string;
  name: string;
  runId: string;
  carId: string;
  value: number;
  unit: 'ms' | 'points';
  gapMs: number | null;
  topSpeedMps: number;
  replaySha256: string | null;
  mine: boolean;
}

export interface Board {
  layoutId: string;
  mode: string;
  class: string;
  rows: BoardRow[];
  mine: BoardRow | null;
}

export interface ChampionshipEvent {
  eventId: string;
  name: string;
  mode: string;
  layoutId: string;
  class: string;
  points: number;
  eligible: boolean;
  loanerCarId: string | null;
}

export interface ChampionshipLeague {
  leagueId: string;
  status: 'locked' | 'open' | 'complete';
  points: number;
  events: ChampionshipEvent[];
}

export interface Championship {
  leagues: ChampionshipLeague[];
  trophy: boolean;
}

export interface LobbyPlayerRow {
  playerId: string;
  name: string;
  ready: boolean;
  connection: 'connected' | 'reconnecting';
  rejoinSecondsLeft: number | null;
  position: number | null;
  lap: number;
  finishMs: number | null;
  dnf: boolean;
}

export interface LobbyBody {
  lobbyId: string;
  hostId: string;
  state: 'open' | 'countdown' | 'racing' | 'finished';
  countdown: number | null;
  graceSecondsLeft: number | null;
  players: LobbyPlayerRow[];
  ai: { name: string; position: number | null; lap: number; finishMs: number | null }[];
}

export interface CreateRunBody {
  runId: string;
  seed: string;
  layoutId: string;
  mode: string;
  carId: string;
  laps: number;
  stepLimit: number;
  loaner: boolean;
  car: { stats: CarStats; stages: Record<string, number> };
  ai: { name: string; carId: string; paceFactor: number }[];
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly fields?: Record<string, string>) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit & { rawBody?: BodyInit }): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    credentials: 'same-origin',
    body: init?.rawBody ?? init?.body
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; fields?: Record<string, string> } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'UNKNOWN', err?.message ?? 'Request failed.', err?.fields);
  }
  return data as T;
}

export const api = {
  me: (): Promise<Me> => call<Me>('/v1/me'),
  patchMe: (units: 'kmh' | 'mph'): Promise<Me> => call<Me>('/v1/me', { method: 'PATCH', body: JSON.stringify({ units }) }),
  cars: (): Promise<{ cars: CatalogCar[] }> => call('/v1/cars'),
  guests: (starterCarId: string): Promise<{ playerId: string; name: string; balance: number }> =>
    call('/v1/guests', { method: 'POST', body: JSON.stringify({ ageConfirmed: true, starterCarId }) }),
  garage: (): Promise<Garage> => call('/v1/garage'),
  selectCar: (carId: string): Promise<Garage> => call('/v1/garage', { method: 'PATCH', body: JSON.stringify({ selectedCarId: carId }) }),
  buyCar: (carId: string, key: string): Promise<{ carId: string; balance: number }> =>
    call('/v1/garage/cars', { method: 'POST', body: JSON.stringify({ carId }), headers: { 'Idempotency-Key': key } }),
  upgrade: (carId: string, system: string, stage: number, layoutId: string, key: string, rawBody: string): Promise<{
    purchaseId: string; carId: string; system: string; stage: number; price: number;
    balance: number; pi: number; overClassLimit: boolean; reference: Reference;
  }> =>
    call(`/v1/garage/cars/${carId}/upgrades/${system}`, { method: 'POST', body: rawBody, headers: { 'Idempotency-Key': key } }),
  refit: (carId: string, system: string, key: string): Promise<{ carId: string; system: string; refund: number; balance: number; pi: number }> =>
    call(`/v1/garage/cars/${carId}/refits/${system}`, { method: 'POST', body: '{}', headers: { 'Idempotency-Key': key } }),
  ledger: (): Promise<{ balance: number; total: number; movements: {
    movementId: string; kind: string; createdAt: string; runId: string | null;
    entries: { account: string; amount: number }[];
  }[] }> => call('/v1/ledger'),
  createRun: (body: Record<string, unknown>): Promise<CreateRunBody> =>
    call('/v1/runs', { method: 'POST', body: JSON.stringify(body) }),
  finishRun: (runId: string, rawBody: string): Promise<{ runId: string; status: string }> =>
    call(`/v1/runs/${runId}/finish`, { method: 'POST', rawBody }),
  run: (runId: string): Promise<RunSummary> => call(`/v1/runs/${runId}`),
  board: (layoutId: string, mode: string, cls: string): Promise<Board> =>
    call(`/v1/boards?layoutId=${layoutId}&mode=${mode}&class=${cls}`),
  championship: (): Promise<Championship> => call('/v1/championship'),
  createLobby: (aiCount: number): Promise<{ lobbyId: string; inviteUrl: string; state: string }> =>
    call('/v1/lobbies', { method: 'POST', body: JSON.stringify({ aiCount }) }),
  lobby: (lobbyId: string): Promise<LobbyBody> => call(`/v1/lobbies/${lobbyId}`),
  joinLobby: (lobbyId: string): Promise<LobbyBody> =>
    call(`/v1/lobbies/${lobbyId}/join`, { method: 'POST', body: '{}' }),
  setReady: (lobbyId: string, ready: boolean): Promise<LobbyBody> =>
    call(`/v1/lobbies/${lobbyId}/ready`, { method: 'POST', body: JSON.stringify({ ready }) }),
  sendLink: (email: string): Promise<{ status: string }> =>
    call('/v1/auth/links', { method: 'POST', body: JSON.stringify({ email }) }),
  redeem: (token: string, keep?: 'device' | 'account'): Promise<{
    playerId: string; email: string; outcome: string;
  }> =>
    call('/v1/auth/redeem', { method: 'POST', body: JSON.stringify({ token, keep }) }),
  status: (): Promise<{ replayStorage: 'ok' | 'unavailable' }> => call('/v1/status')
};
