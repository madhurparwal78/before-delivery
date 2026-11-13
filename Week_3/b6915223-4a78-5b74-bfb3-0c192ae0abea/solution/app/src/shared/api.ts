// Shapes of the JSON the API publishes (brief: Backend / API). Money is whole tenths of a million.

export type Position = "GK" | "DEF" | "MID" | "FWD";
export type GameweekStatus = "upcoming" | "open" | "locked" | "live" | "closed";
export type ChipCode = "wildcard" | "free_hit" | "bench_boost" | "triple_captain";
export type ChipState = "available" | "active" | "used";
export type EventType =
  | "minutes"
  | "goal"
  | "assist"
  | "clean_sheet"
  | "yellow_card"
  | "red_card"
  | "own_goal"
  | "bonus";
export type NoticeKind = "deadline_locked" | "transfer_refused" | "auto_sub" | "price_change";
export type Role = "manager" | "operator";
export type SortOrder = "price_desc" | "price_asc" | "points_desc" | "name_asc";

export const POSITIONS: readonly Position[] = ["GK", "DEF", "MID", "FWD"];
export const CHIPS: readonly ChipCode[] = ["wildcard", "free_hit", "bench_boost", "triple_captain"];
export const EVENT_TYPES: readonly EventType[] = [
  "minutes",
  "goal",
  "assist",
  "clean_sheet",
  "yellow_card",
  "red_card",
  "own_goal",
  "bonus",
];
const SORT_ORDERS: readonly SortOrder[] = ["price_desc", "price_asc", "points_desc", "name_asc"];

export const isChip = (value: unknown): value is ChipCode => CHIPS.some((chip) => chip === value);
export const isEventType = (value: unknown): value is EventType => EVENT_TYPES.some((type) => type === value);
export const isSortOrder = (value: unknown): value is SortOrder => SORT_ORDERS.some((sort) => sort === value);
export const isPosition = (value: unknown): value is Position => POSITIONS.some((position) => position === value);

export interface Rule {
  code: string;
  message: string;
}

export interface ErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
  rules?: Rule[];
  hit_points?: number;
}

export interface Account {
  id: string;
  email: string;
  team_name: string;
  role: Role;
}

export interface Club {
  code: string;
  name: string;
}

export interface CataloguePlayer {
  id: string;
  name: string;
  club: string;
  position: Position;
  price_tenths: number;
  total_points: number;
  gameweek_points: number;
}

export interface GameweekSummary {
  number: number;
  status: GameweekStatus;
  deadline: string | null;
}

export interface Fixture {
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
  fixtures: Fixture[];
  server_time: string;
}

export interface SquadPlayer {
  id: string;
  name: string;
  club: string;
  position: Position;
  purchase_price_tenths: number;
  price_tenths: number;
  selling_price_tenths: number;
  slot: "starting" | "bench";
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

export interface TransferPreview {
  count: number;
  free_transfers_used: number;
  hit_points: number;
  bank_after_tenths: number;
  rules: Rule[];
}

export type DraftState = "clean" | "drafting" | "confirmed" | "refused";

export interface DraftView {
  gameweek: number;
  state: DraftState;
  out: string[];
  in: string[];
  preview: TransferPreview;
  refusal: ErrorBody | null;
}

export interface ConfirmedTransfer {
  id: number;
  out: string;
  in: string;
  sell_price_tenths: number;
  price_tenths: number;
}

export interface TransferConfirmation {
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
  captain: string;
  vice_captain: string;
  transfers_made: number;
  receipt: "stored" | "pending";
}

export interface HistoryView {
  manager_id: string;
  team_name: string;
  season_total: number;
  rows: HistoryRow[];
}

export interface TransferRecord {
  id: number;
  gameweek: number;
  made_at: string;
  out: { player_id: string; name: string; sell_price_tenths: number };
  in: { player_id: string; name: string; price_tenths: number };
  free_hit: boolean;
}

export type LedgerKind = "opening_budget" | "purchase" | "sale" | "reversal";

export interface LedgerEntry {
  id: number;
  kind: LedgerKind;
  amount_tenths: number;
  player_id: string | null;
  transfer_id: number | null;
  reverses: number | null;
  gameweek: number;
  created_at: string;
}

export interface LedgerView {
  bank_tenths: number;
  squad_selling_value_tenths: number;
  entries: LedgerEntry[];
}

export interface LeagueCreated {
  id: number;
  name: string;
  code: string | null;
  admin_manager_id: string;
  is_admin: boolean;
}

export interface LeagueSummary {
  id: number;
  name: string;
  is_admin: boolean;
  rank: number;
  members: number;
}

export interface Standing {
  rank: number;
  last_rank: number | null;
  manager_id: string;
  team_name: string;
  gameweek_points: number;
  season_total: number;
}

export interface LeagueDetail {
  id: number;
  name: string;
  code: string | null;
  gameweek: number;
  standings: Standing[];
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

export interface PriceRunResult {
  run_date: string;
  applied: { player_id: string; delta_tenths: number; price_tenths: number }[];
  skipped: { player_id: string; reason: "gameweek_cap" }[];
}

// Messages pushed over the page's WebSocket. They say what changed; pages re-read the API.
export type LiveMessage =
  | { t: "gameweek" }
  | { t: "prices" }
  | { t: "event"; event_id: string; player_id: string; type: EventType; points_delta: number; voided: boolean }
  | { t: "squad"; manager: string }
  | { t: "notice"; manager: string }
  | { t: "receipt"; manager: string }
  | { t: "league" };
