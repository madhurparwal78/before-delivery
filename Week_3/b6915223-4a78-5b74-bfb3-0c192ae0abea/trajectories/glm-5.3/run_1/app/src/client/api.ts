import type { ChipCode, ChipState, Position } from '../shared/domain';
import { CHIP_NAMES } from '../shared/domain';

export interface PlayerRow {
  id: string;
  name: string;
  club: string;
  position: Position;
  price_tenths: number;
  total_points: number;
  gameweek_points: number;
}

export interface SquadPlayer {
  id: string;
  name: string;
  club: string;
  position: Position;
  purchase_price_tenths: number;
  price_tenths: number;
  selling_price_tenths: number;
  slot: 'starting' | 'bench';
  bench_order: number | null;
  captain: boolean;
  vice_captain: boolean;
  raw_points: number;
  team_points: number;
}

export interface SquadView {
  gameweek: number;
  gameweek_status: 'upcoming' | 'open' | 'locked' | 'live' | 'closed';
  editable: boolean;
  players: SquadPlayer[];
  bank_tenths: number;
  squad_value_tenths: number;
  free_transfers: number;
  transfers_made: number;
  hit_points: number;
  chip: ChipCode | null;
  chips: Record<ChipCode, ChipState>;
  gameweek_total: number;
}

export interface DraftView {
  gameweek: number;
  state: 'clean' | 'drafting' | 'confirmed' | 'refused';
  out: string[];
  in: string[];
  preview: {
    count: number;
    free_transfers_used: number;
    hit_points: number;
    bank_after_tenths: number;
    rules: { code: string; message: string }[];
  } | null;
  refusal: { error: string; message?: string; rules?: { code: string; message: string }[] } | null;
}

export interface HistoryRow {
  gameweek: number;
  status: string;
  points: number;
  hit_points: number;
  net_points: number;
  running_total: number | null;
  chip: ChipCode | null;
  captain: string | null;
  vice_captain: string | null;
  transfers_made: number;
  receipt: 'stored' | 'pending';
}

export interface HistoryView {
  manager_id: string;
  team_name: string;
  season_total: number;
  rows: HistoryRow[];
}

export interface LedgerEntry {
  id: string;
  kind: 'opening_budget' | 'purchase' | 'sale' | 'reversal';
  amount_tenths: number;
  player_id: string | null;
  transfer_id: string | null;
  reverses: string | null;
  gameweek: number;
  created_at: string;
}

export interface TransferRow {
  id: string;
  gameweek: number;
  made_at: string;
  out: { player_id: string; name: string; sell_price_tenths: number };
  in: { player_id: string; name: string; price_tenths: number };
  free_hit: boolean;
}

export interface NoticeRow {
  id: string;
  kind: 'deadline_locked' | 'transfer_refused' | 'auto_sub' | 'price_change';
  gameweek: number;
  message: string;
  read: boolean;
  created: string;
}

export interface StandingRow {
  rank: number;
  last_rank: number | null;
  manager_id: string;
  team_name: string;
  gameweek_points: number;
  season_total: number;
}

export interface LeagueSummary {
  id: string;
  name: string;
  is_admin: boolean;
  rank: number;
  members: number;
}

export interface ClubRow {
  code: string;
  name: string;
}

export interface GameweekRow {
  number: number;
  status: 'upcoming' | 'open' | 'locked' | 'live' | 'closed';
  deadline: string | null;
}

export interface CurrentGameweek {
  number: number;
  status: 'upcoming' | 'open' | 'locked' | 'live' | 'closed';
  deadline: string | null;
  deadline_local: string | null;
  first_kickoff: string | null;
  fixtures: { id: string; home: string; away: string; kickoff: string }[];
  server_time: string;
}

export interface MeView {
  id: string;
  email: string;
  team_name: string;
  role: 'manager' | 'operator';
}

export interface OperatorEvent {
  event_id: string;
  gameweek: number;
  fixture_id: string;
  player_id: string;
  type: string;
  value: number | null;
  points_delta: number;
  voided: boolean;
  recorded_at: string;
}

export interface ApiErrorBody {
  error: string;
  message?: string;
  fields?: Record<string, string>;
  rules?: { code: string; message: string }[];
  hit_points?: number;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message ?? `Request failed with ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed = text === '' ? undefined : (JSON.parse(text) as unknown);
  if (!response.ok) {
    throw new ApiError(response.status, (parsed ?? { error: 'unknown' }) as ApiErrorBody);
  }
  return parsed as T;
}

export const api = {
  signUp: (body: { email: string; password: string; team_name: string }) =>
    request<{ id: string; email: string; team_name: string; role: string }>('/api/auth/signup', { method: 'POST', body: JSON.stringify(body) }),
  signIn: (body: { email: string; password: string }) =>
    request<{ id: string; email: string; team_name: string; role: string }>('/api/auth/signin', { method: 'POST', body: JSON.stringify(body) }),
  signOut: () => request<void>('/api/auth/signout', { method: 'POST' }),
  me: () => request<MeView>('/api/me'),
  clubs: () => request<{ clubs: ClubRow[] }>('/api/clubs'),
  players: (query: string) => request<{ players: PlayerRow[] }>(`/api/players${query}`),
  gameweeks: () => request<{ gameweeks: GameweekRow[] }>('/api/gameweeks'),
  currentGameweek: () => request<CurrentGameweek>('/api/gameweeks/current'),
  squad: () => request<SquadView>('/api/squad'),
  createSquad: (players: string[]) => request<SquadView>('/api/squad', { method: 'POST', body: JSON.stringify({ players }) }),
  savePicks: (body: { gameweek: number; starting: string[]; bench: string[]; captain: string | null; vice_captain: string | null }) =>
    request<SquadView>('/api/picks', { method: 'PUT', body: JSON.stringify(body) }),
  playChip: (gameweek: number, chip: ChipCode) =>
    request<SquadView>('/api/chips', { method: 'POST', body: JSON.stringify({ gameweek, chip }) }),
  cancelChip: (gameweek: number) => request<SquadView>(`/api/chips/${gameweek}`, { method: 'DELETE' }),
  previewTransfers: (body: { gameweek: number; out: string[]; in: string[] }) =>
    request<DraftView['preview']>('/api/transfers/preview', { method: 'POST', body: JSON.stringify(body) }),
  confirmTransfers: (body: { gameweek: number; out: string[]; in: string[]; hit_points: number }, key: string) =>
    request<{
      transfers: { id: string; out: string; in: string; sell_price_tenths: number; price_tenths: number }[];
      hit_points: number;
      gameweek_hit_points: number;
      bank_tenths: number;
      free_transfers: number;
    }>('/api/transfers', { method: 'POST', body: JSON.stringify(body), headers: { 'Idempotency-Key': key } }),
  draft: () => request<DraftView>('/api/transfers/draft'),
  saveDraft: (body: { gameweek: number; out: string[]; in: string[] }) =>
    request<DraftView>('/api/transfers/draft', { method: 'PUT', body: JSON.stringify(body) }),
  clearDraft: () => request<DraftView>('/api/transfers/draft', { method: 'DELETE' }),
  history: () => request<HistoryView>('/api/history'),
  transfersHistory: () => request<{ transfers: TransferRow[] }>('/api/history/transfers'),
  ledger: () => request<{ bank_tenths: number; squad_selling_value_tenths: number; entries: LedgerEntry[] }>('/api/history/ledger'),
  memberHistory: (leagueId: string, managerId: string) =>
    request<HistoryView>(`/api/leagues/${leagueId}/members/${managerId}/history`),
  leagues: () => request<{ leagues: LeagueSummary[] }>('/api/leagues'),
  createLeague: (name: string) =>
    request<{ id: string; name: string; code: string; admin_manager_id: string; is_admin: boolean }>('/api/leagues', { method: 'POST', body: JSON.stringify({ name }) }),
  joinLeague: (code: string) =>
    request<{ id: string; name: string; admin_manager_id: string; is_admin: boolean }>('/api/leagues/join', { method: 'POST', body: JSON.stringify({ code }) }),
  league: (id: string) =>
    request<{ id: string; name: string; code: string | null; gameweek: number; standings: StandingRow[] }>(`/api/leagues/${id}`),
  newCode: (id: string) => request<{ code: string }>(`/api/leagues/${id}/code`, { method: 'POST' }),
  notices: () => request<{ unread: number; notices: NoticeRow[] }>('/api/notices'),
  markAllRead: () => request<void>('/api/notices/read-all', { method: 'POST' }),
  publishFixtures: (gameweek: number, fixtures: { home: string; away: string; kickoff: string }[]) =>
    request<CurrentGameweek>(`/api/operator/gameweeks/${gameweek}/fixtures`, { method: 'PUT', body: JSON.stringify({ fixtures }) }),
  startGameweek: (gameweek: number) => request<{ number: number; status: string }>(`/api/operator/gameweeks/${gameweek}/start`, { method: 'POST' }),
  closeGameweek: (gameweek: number) => request<{ number: number; status: string; next_gameweek: number | null }>(`/api/operator/gameweeks/${gameweek}/close`, { method: 'POST' }),
  recordEvent: (body: { event_id: string; fixture_id: string; player_id: string; type: string; value?: number }) =>
    request<OperatorEvent>('/api/operator/events', { method: 'POST', body: JSON.stringify(body) }),
  voidEvent: (eventId: string) => request<OperatorEvent>(`/api/operator/events/${eventId}/void`, { method: 'POST' }),
  events: (gameweek: number) => request<{ events: OperatorEvent[] }>(`/api/operator/gameweeks/${gameweek}/events`),
  priceRun: (body: { run_date: string; moves: { player_id: string; delta_tenths: number }[] }) =>
    request<{ run_date: string; applied: { player_id: string; delta_tenths: number; price_tenths: number }[]; skipped: { player_id: string; reason: string }[] }>('/api/operator/price-runs', { method: 'POST', body: JSON.stringify(body) }),
};

export function chipLabel(chip: ChipCode): string {
  return CHIP_NAMES[chip];
}
