import type { ChipCode, ChipState, GameweekStatus, Position, ReceiptState } from './domain';

export interface ClubView {
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

export interface SquadPlayerView {
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
  players: SquadPlayerView[];
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
  rules: { code: string; message: string }[];
}

export interface DraftView {
  gameweek: number;
  state: 'clean' | 'drafting' | 'confirmed' | 'refused';
  out: string[];
  in: string[];
  preview: TransferPreview | null;
  refusal: unknown | null;
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
  receipt: ReceiptState;
}

export interface HistoryView {
  manager_id: string;
  team_name: string;
  season_total: number;
  rows: HistoryRow[];
}

export interface LedgerEntryView {
  id: string;
  kind: 'opening_budget' | 'purchase' | 'sale' | 'reversal';
  amount_tenths: number;
  player_id: string | null;
  transfer_id: string | null;
  reverses: string | null;
  gameweek: number;
  created_at: string;
}

export interface TransferHistoryRow {
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

export interface CurrentGameweekFixture {
  id: string;
  home: string;
  away: string;
  kickoff: string;
}
