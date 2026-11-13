// Every request, response and live message of the Cupfold API, shared by the server and the browser client.

export type Format = 'single_elimination' | 'double_elimination' | 'round_robin' | 'swiss';
export type TournamentState = 'draft' | 'checkin_open' | 'checkin_closed' | 'running' | 'finished';
export type Fill = 'lilac' | 'lemon' | 'mint';
export type Bracket = 'winners' | 'losers' | 'final' | 'main';
export type MatchState =
  | 'pending' | 'called' | 'reported' | 'confirmed' | 'disputed' | 'resolved' | 'bye' | 'not_needed' | 'waiting';
export type Winner = 'upper' | 'lower' | 'draw';
export type Role = 'organizer' | 'co_organizer' | 'player' | 'viewer';

export const FORMATS: readonly Format[] = ['single_elimination', 'double_elimination', 'round_robin', 'swiss'];
export const FILLS: readonly Fill[] = ['lilac', 'lemon', 'mint'];

export type ErrorCode =
  | 'too_large' | 'unauthenticated' | 'bad_credentials' | 'username_taken' | 'rate_limited' | 'not_found'
  | 'read_only' | 'forbidden' | 'stale_match' | 'already_resolved' | 'stale_preview' | 'stale_seeding'
  | 'checkin_closed' | 'wrong_state' | 'validation' | 'roster_invalid' | 'storage_unavailable';

export interface ApiErrorBody {
  error: ErrorCode;
  message: string;
  fields?: Record<string, string>;
  match?: MatchView;
  entrants?: EntrantView[];
  errors?: string[];
}

export type SlotView = { entrant_id: string; name: string } | { bye: true } | null;

export interface ReportView {
  by: string;
  upper_games: number;
  lower_games: number;
  reported_at: string;
  auto_confirm_at: string;
}

export interface DisputeView {
  by: string;
  upper_games: number;
  lower_games: number;
  disputed_at: string;
}

export interface MatchView {
  id: string;
  tournament_id: string;
  label: string;
  bracket: Bracket;
  round: number;
  number: number;
  upper: SlotView;
  lower: SlotView;
  state: MatchState;
  upper_games: number | null;
  lower_games: number | null;
  winner: Winner | null;
  report: ReportView | null;
  dispute: DisputeView | null;
  called_at: string | null;
  version: number;
  overdue?: boolean;
  updated_by?: string;
}

export interface CurrentRound {
  bracket: Bracket;
  round: number;
}

export interface TournamentView {
  id: string;
  name: string;
  format: Format;
  time_zone: string;
  fill: Fill;
  state: TournamentState;
  checkin_closes_at: string | null;
  server_time: string;
  field_size: number | null;
  entrant_count: number;
  checked_in_count: number;
  current_round: CurrentRound | null;
  swiss_rounds?: number | null;
  logo_url: string | null;
  roster_file_name: string | null;
  seeding_version: number;
  // The live message sequence this view reflects; a screen connects with after=live_seq so it misses nothing.
  live_seq: number;
  my_role: Role;
  share_url?: string;
  co_organizers?: string[];
}

export interface EntrantView {
  id: string;
  name: string;
  seed: number;
  username?: string | null;
  checked_in: boolean;
}

export interface PublicEntrantView {
  name: string;
  seed: number;
}

export interface StandingRow {
  place: number;
  entrant_id: string;
  name: string;
  played: number;
  match_points: number;
  seed: number;
  decided_by: string;
  head_to_head?: number;
  game_difference?: number;
  games_won?: number;
  buchholz_cut_1?: number;
  buchholz?: number;
  sonneborn_berger?: number;
}

export interface StandingsView {
  columns: string[];
  rows: StandingRow[];
}

export interface Credentials { username: string; password: string }
export interface UserBody { user: { username: string } }

export interface ConfigBody {
  server_time: string;
  confirm_window_ms: number;
  match_limit_ms: number;
  swiss_round_ms: number;
  toast_ms: number;
  roster_max_bytes: number;
  logo_max_bytes: number;
}

export interface CreateTournamentBody { name: string; format: string; time_zone: string; fill: string }
export interface AddEntrantBody { name: string; username?: string | null }
export interface SeedingResult { entrants: EntrantView[]; seeding_version: number }
export interface OpenCheckinBody { closes_at?: string }
export interface CheckinResult { entrant: EntrantView; checked_in_count: number }
export interface StartResult { tournament: TournamentView; removed: string[] }
export interface RoundResult { round: number; matches: MatchView[] }

export interface PreviewMatch { number: number; upper: SlotView; lower: SlotView }

export interface RosterResult { entrants: EntrantView[]; sha256: string; file_name: string }
export interface LogoResult { logo_url: string; sha256: string }

export interface ReportResult { match: MatchView; outcome: 'reported' | 'confirmed' | 'disputed' }
export interface MatchResult { match: MatchView }

export interface Dependent { match_id: string; label: string; state: MatchState }
export interface EditPreview {
  dependents: Dependent[];
  count: number;
  confirmed_count: number;
  preview_token: string;
}
export interface EditResult { match: MatchView; reset: string[] }

export interface MeBody { entrant: EntrantView; checked_in: boolean; next_match: MatchView | null }
export interface HistoryRow {
  tournament_id: string;
  tournament_name: string;
  place: number;
  field_size: number;
  finished_on: string;
  text: string;
}

export interface ShareBody {
  tournament: TournamentView;
  entrants: PublicEntrantView[];
  matches: MatchView[];
  standings: StandingsView | null;
}

export interface SeedStep {
  match?: string;
  action: 'called' | 'reported' | 'disputed' | 'confirmed' | 'resolved' | 'next_round';
  upper_games?: number;
  lower_games?: number;
  by?: string;
  resolver?: string;
  counter?: { upper_games: number; lower_games: number };
}

export interface SeedEntrant { name: string; seed: number; username?: string; checked_in?: boolean }

export interface SeedTournament {
  key: string;
  name: string;
  format: Format;
  organizer: string;
  co_organizers?: string[];
  time_zone: string;
  fill: Fill;
  state: TournamentState;
  checkin_closes_at?: string;
  entrants: SeedEntrant[];
  steps?: SeedStep[];
}

export interface SeedBody {
  users: Credentials[];
  tournaments: SeedTournament[];
}

export interface SeedResult {
  users: Record<string, { id: string }>;
  tournaments: Record<string, {
    id: string;
    share_code: string;
    entrants: Record<string, string>;
    matches: Record<string, string>;
  }>;
}

// Live channel: every message is {seq, type, at, data}.
interface LiveBase { seq: number; at: string }
export type LiveMessage =
  | (LiveBase & { type: 'match.updated'; data: { match: MatchView } })
  | (LiveBase & { type: 'matches.reset'; data: { matches: MatchView[] } })
  | (LiveBase & { type: 'standings.updated'; data: { rows: StandingRow[] } })
  | (LiveBase & { type: 'checkin.updated'; data: { checked_in_count: number; entrant: { name: string; checked_in: boolean } } })
  | (LiveBase & { type: 'entrants.updated'; data: { entrants: Array<EntrantView | PublicEntrantView> } })
  | (LiveBase & { type: 'tournament.updated'; data: { tournament: TournamentView } })
  | (LiveBase & { type: 'announcement'; data: { text: string } });

export type LiveType = LiveMessage['type'];
