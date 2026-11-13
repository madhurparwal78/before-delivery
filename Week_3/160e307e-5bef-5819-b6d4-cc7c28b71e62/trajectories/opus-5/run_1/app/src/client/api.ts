export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === 'string' ? body.error : 'SERVER_ERROR');
    this.status = status;
    this.code = typeof body.error === 'string' ? body.error : 'SERVER_ERROR';
    this.body = body;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin' };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed: unknown = text === '' ? {} : JSON.parse(text);
  const payload = (parsed === null || typeof parsed !== 'object' ? {} : parsed) as Record<string, unknown>;
  if (!response.ok) throw new ApiFailure(response.status, payload);
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};

export interface Me {
  id: string;
  name: string;
  avatar: number;
  chosen: boolean;
  email: string | null;
  linked: boolean;
  rating: number;
  rd: number;
  tier: string;
  rankedGames: number;
  chalk: number;
  equipped: { striker: string; board: string; coins: string };
}

export interface Config {
  verdictBannerMs: number;
  shotTimerSeconds: number;
  reconnectSeconds: number;
  rematchSeconds: number;
  roomExpirySeconds: number;
  bandWidenSeconds: number;
  modelVersion: string;
}

export interface SeatJson {
  seat: 0 | 1;
  playerId: string | null;
  name: string;
  avatar: number;
  color: 'white' | 'black';
  score: number;
  coinsLeft: number;
  dues: number;
  timeouts: number;
  connected: boolean;
  ready: boolean;
  strikerSkin: string;
  reconnectRemainingMs: number | null;
}

export interface PieceJson {
  id: string;
  x: number | null;
  y: number | null;
  state: 'board' | 'pocketed';
  pocketedBy: 0 | 1 | null;
}

export interface MatchJson {
  id: string;
  mode: 'local' | 'private' | 'casual' | 'ranked';
  format: 'quick' | 'classic';
  status: 'waiting' | 'active' | 'completed' | 'forfeit' | 'abandoned';
  board: number;
  turn: 0 | 1;
  phase: 'waiting' | 'aim' | 'match-over';
  shotSeq: number;
  breakAttempt: number | null;
  seats: [SeatJson, SeatJson];
  queen: { state: 'board' | 'pending' | 'covered'; seat: 0 | 1 | null };
  pieces: PieceJson[];
  turnDeadline: string | null;
  turnRemainingMs: number | null;
  winnerSeat: 0 | 1 | null;
  endReason: 'played' | 'left' | 'timeouts' | 'resigned' | null;
  roomCode: string | null;
  boardPointsLine: string | null;
  ratingChange: ({ delta: number; rating: number } | null)[];
  chalkEarned: number[];
}

export interface ShotResultJson {
  shotSeq: number;
  seat: 0 | 1;
  events: {
    firstContact: string | null;
    pocketed: { id: string; pocket: 'nw' | 'ne' | 'sw' | 'se' }[];
    strikerPocketed: boolean;
  };
  verdict: { word: string; line: string };
  frames: { t: number; pieces: { id: string; x: number; y: number }[] }[];
  final: { id: string; x: number | null; y: number | null; state: 'board' | 'pocketed' }[];
  boardOutcome: { winnerSeat: 0 | 1; points: number; pointsLine: string } | null;
  match: MatchJson;
}

export interface RoomJson {
  code: string;
  format: 'quick' | 'classic';
  status: 'open' | 'full' | 'closed';
  host: { id: string; name: string } | null;
  guest: { id: string; name: string } | null;
  expiresInMs: number | null;
  matchId: string | null;
}

export interface HistoryRow {
  matchId: string;
  mode: 'local' | 'private' | 'casual' | 'ranked';
  format: 'quick' | 'classic';
  opponent: string;
  result: 'won' | 'lost';
  yourScore: number;
  theirScore: number;
  ratingDelta: number | null;
  endReason: string;
  endedAt: string;
}
