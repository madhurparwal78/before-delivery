import type {
  Appearance,
  GameKind,
  ItemKind,
  Material,
  PackId,
  PlanId,
} from './domain.js';

export type ServerStatus = 'pending_approval' | 'active' | 'past_due' | 'suspended';
export type StatusWord = 'PENDING' | 'PAID' | 'PAST DUE' | 'SUSPENDED';
export type BillingStatusWord = StatusWord | 'PAYMENT PENDING';

export interface ServerObject {
  id: string;
  slug: string;
  name: string;
  owner: string;
  role: 'owner' | 'member';
  status: ServerStatus;
  status_word: StatusWord;
  suspends_at: string | null;
  suspends_at_label: string | null;
  time_zone: string;
  plan: PlanId;
  season: number;
  worlds: { slug: string; name: string }[];
  member_count: number;
  character_count: number;
}

export interface BillingObject {
  server_id: string;
  status: ServerStatus;
  status_word: BillingStatusWord;
  plan: PlanId;
  pending_plan: PlanId | null;
  payment_pending: boolean;
  balance: string;
  currency: 'USD';
  past_due_since: string | null;
  suspends_at: string | null;
  suspends_at_label: string | null;
  killbill_account_id: string | null;
  provider_reachable: boolean;
  checked_at: string | null;
}

export interface CharacterObject {
  id: string;
  name: string;
  owner: string;
  world: string;
  x: number;
  y: number;
  appearance: Appearance;
  loadout: ItemKind[];
  balance: number;
  available: number;
}

export interface InventorySlot {
  slot: number;
  kind: ItemKind | null;
  count: number;
  held: number;
}

export interface InventoryObject {
  character_id: string;
  slots: InventorySlot[];
}

export interface WorldTableSummary {
  id: string;
  name: string;
  game: GameKind;
  x: number;
  y: number;
  state: TableState;
}

export interface WorldObject {
  slug: string;
  name: string;
  width: 40;
  height: 24;
  tiles: string[];
  tables: WorldTableSummary[];
  blocks: { x: number; y: number; material: Material }[];
  vehicles: {
    id: string;
    name: string;
    kind: 'car' | 'plane';
    owner_character_id: string;
    x: number;
    y: number;
  }[];
  characters: { id: string; name: string; x: number; y: number }[];
}

export interface MessageObject {
  id: string;
  character: { id: string; name: string };
  text: string;
  created_at: string;
}

export type TableState = 'open' | 'seated' | 'in_play' | 'finished' | 'settled';

export interface SeatObject {
  seat: number;
  label: string;
  character: { id: string; name: string } | null;
}

export type ChessPosition = { fen: string };
export type FourPosition = { rows: string[] };
export type TricksPosition = {
  trick: { seat: number; card: string }[];
  led_suit: string | null;
  tricks_won: number[];
};
export type Position = ChessPosition | FourPosition | TricksPosition;

export interface ResultObject {
  outcome: 'win' | 'draw' | 'forfeit' | 'abandoned';
  reason:
    | 'checkmate'
    | 'stalemate'
    | 'threefold_repetition'
    | 'fifty_move_rule'
    | 'four_in_a_row'
    | 'board_full'
    | 'hand_over'
    | 'timeout'
    | 'forfeit'
    | 'server_suspended';
  winners: number[];
  text: string;
  settlement: { character_id: string; amount: number }[];
}

export interface TableObject {
  id: string;
  name: string;
  game: GameKind;
  world: string;
  x: number;
  y: number;
  state: TableState;
  stake: number;
  turn_seconds: number;
  seats: SeatObject[];
  spectators: { character_id: string; name: string }[];
  game_id: string | null;
  turn: number;
  to_move_seat: number | null;
  turn_remaining_ms: number | null;
  position: Position | null;
  hand: string[] | null;
  hand_counts: number[];
  result: ResultObject | null;
  settled: boolean;
  pending_store: boolean;
  rematch_offers: string[];
}

export interface PartyObject {
  id: string;
  name: string;
  state: 'open' | 'closed';
  leader_id: string | null;
  members: { character_id: string; name: string; joined_at: string }[];
  run_id: string | null;
}

export interface RunObject {
  id: string;
  party_id: string;
  chapter_id: string;
  world: string;
  state: 'in_progress' | 'paused' | 'completed';
  checkpoints: {
    n: number;
    name: string;
    x: number;
    y: number;
    reached: boolean;
    stored: boolean;
  }[];
  started_at: string;
}

export interface TradeSide {
  character_id: string;
  name: string;
  coins: number;
  items: { kind: ItemKind; count: number }[];
  accepted: boolean;
  accepted_at: string | null;
}

export interface TradeObject {
  id: string;
  state: 'open' | 'completed' | 'cancelled';
  version: number;
  sides: TradeSide[];
  updated_at: string;
}

export interface InviteObject {
  id: string;
  email: string;
  state: 'pending' | 'used' | 'expired' | 'superseded';
  mail: 'sent' | 'held';
  expires_at: string;
}

export interface PurchaseObject {
  id: string;
  character_id: string;
  pack: PackId;
  coins: number;
  price: string;
  state: 'pending' | 'paid' | 'refunded';
  receipt: 'sent' | 'held';
  created_at: string;
}

export interface WeatherObject {
  weather: 'clear' | 'rain' | 'storm';
  since: string;
  changes_at: string;
  night_level: number;
}

export interface FriendObject {
  handle: string;
  display_name: string;
  online: boolean;
}

export interface UserObject {
  handle: string;
  display_name: string;
}

export interface MailRow {
  id: string;
  kind: string;
  to_handle: string;
  subject: string;
  state: 'held' | 'sent';
  created_at: string;
  sent_at: string | null;
}

export interface SaveRow {
  id: string;
  number: number;
  created_at: string;
  restored_from: number | null;
  objects: string[];
}

export interface LedgerEntryRow {
  id: string;
  kind: 'grant' | 'stake' | 'settlement' | 'top_up' | 'refund' | 'trade';
  game_id: string | null;
  trade_id: string | null;
  purchase_id: string | null;
  lines: { account: string; amount: number }[];
  created_at: string;
}

export interface LeaderboardEntry {
  rank: number;
  character_id: string;
  name: string;
  wins: number;
  reached_at: string;
}

export interface GameHistoryRow {
  id: string;
  table_name: string;
  game: GameKind;
  players: string[];
  result_text: string;
  finished_at: string;
}

export interface GameRecord {
  id: string;
  table_id: string;
  table_name: string;
  game: GameKind;
  seats: SeatObject[];
  moves: string[];
  position: Position;
  result: ResultObject | null;
  settled: boolean;
  started_at: string;
  finished_at: string | null;
  seed: number | null;
  hands: string[][] | null;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
  etag?: string;
}
