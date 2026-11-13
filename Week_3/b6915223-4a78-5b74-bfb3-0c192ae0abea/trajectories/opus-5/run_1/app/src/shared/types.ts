export type Position = 'GK' | 'DEF' | 'MID' | 'FWD';
export type ChipCode = 'wildcard' | 'free_hit' | 'bench_boost' | 'triple_captain';
export type GameweekStatus = 'upcoming' | 'open' | 'locked' | 'live' | 'closed';
export type ChipState = 'available' | 'active' | 'used';
export type EventType =
  | 'minutes'
  | 'goal'
  | 'assist'
  | 'clean_sheet'
  | 'yellow_card'
  | 'red_card'
  | 'own_goal'
  | 'bonus';
export type NoticeKind = 'deadline_locked' | 'transfer_refused' | 'auto_sub' | 'price_change';
export type LedgerKind = 'opening_budget' | 'purchase' | 'sale' | 'reversal';
export type SortOrder = 'price_desc' | 'price_asc' | 'points_desc' | 'name_asc';
export type DraftState = 'clean' | 'drafting' | 'confirmed' | 'refused';

export interface BrokenRule {
  code: string;
  message: string;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
  rules?: BrokenRule[];
  hit_points?: number;
}

export interface Club {
  code: string;
  name: string;
}

export interface PlayerRow {
  id: string;
  name: string;
  club: string;
  position: Position;
  price_tenths: number;
  total_points: number;
  gameweek_points: number;
}

export interface FixtureRow {
  id: string;
  home: string;
  away: string;
  kickoff: string;
}

export interface CurrentGameweek {
  number: number;
  status: GameweekStatus;
  deadline: string | null;
  deadline_local: string | null;
  first_kickoff: string | null;
  fixtures: FixtureRow[];
  server_time: string;
}

export interface GameweekListRow {
  number: number;
  status: GameweekStatus;
  deadline: string | null;
}

export interface SquadViewPlayer {
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
  gameweek_status: GameweekStatus;
  editable: boolean;
  players: SquadViewPlayer[];
  bank_tenths: number;
  squad_value_tenths: number;
  free_transfers: number;
  transfers_made: number;
  hit_points: number;
  chip: ChipCode | null;
  chips: Record<ChipCode, ChipState>;
  gameweek_total: number;
}

export interface TransferPreview {
  count: number;
  free_transfers_used: number;
  hit_points: number;
  bank_after_tenths: number;
  rules: BrokenRule[];
}

export interface DraftView {
  gameweek: number;
  state: DraftState;
  out: string[];
  in: string[];
  preview: TransferPreview;
  refusal: ApiErrorBody | null;
}

export interface ConfirmedTransfer {
  id: string;
  out: string;
  in: string;
  sell_price_tenths: number;
  price_tenths: number;
}

export interface TransfersResult {
  transfers: ConfirmedTransfer[];
  hit_points: number;
  gameweek_hit_points: number;
  bank_tenths: number;
  free_transfers: number;
}

export interface HistoryRow {
  gameweek: number;
  status: GameweekStatus;
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

export interface TransferHistoryRow {
  id: string;
  gameweek: number;
  made_at: string;
  out: { player_id: string; name: string; sell_price_tenths: number };
  in: { player_id: string; name: string; price_tenths: number };
  free_hit: boolean;
}

export interface LedgerEntry {
  id: string;
  kind: LedgerKind;
  amount_tenths: number;
  player_id: string | null;
  transfer_id: string | null;
  reverses: string | null;
  gameweek: number | null;
  created_at: string;
}

export interface LedgerView {
  bank_tenths: number;
  squad_selling_value_tenths: number;
  entries: LedgerEntry[];
}

export interface LeagueSummary {
  id: string;
  name: string;
  is_admin: boolean;
  rank: number | null;
  members: number;
}

export interface StandingRow {
  rank: number;
  last_rank: number | null;
  manager_id: string;
  team_name: string;
  gameweek_points: number;
  season_total: number;
}

export interface LeagueView {
  id: string;
  name: string;
  code: string | null;
  gameweek: number;
  standings: StandingRow[];
}

export interface LeagueCreated {
  id: string;
  name: string;
  code: string | null;
  admin_manager_id: string;
  is_admin: boolean;
}

export interface Notice {
  id: string;
  kind: NoticeKind;
  gameweek: number;
  message: string;
  read: boolean;
  created: string;
}

export interface NoticesView {
  unread: number;
  notices: Notice[];
}

export interface MatchEvent {
  event_id: string;
  gameweek: number;
  fixture_id: string;
  player_id: string;
  type: EventType;
  value: number | null;
  points_delta: number;
  voided: boolean;
  recorded_at: string;
}

export interface Me {
  id: string;
  email: string;
  team_name: string;
  role: 'manager' | 'operator';
}

export interface PriceRunResult {
  run_date: string;
  applied: { player_id: string; delta_tenths: number; price_tenths: number }[];
  skipped: { player_id: string; reason: 'gameweek_cap' }[];
}
