export type Format = 'single_elimination' | 'double_elimination' | 'round_robin' | 'swiss';
export type TournamentState = 'draft' | 'checkin_open' | 'checkin_closed' | 'running' | 'finished';
export type Fill = 'lilac' | 'lemon' | 'mint';
export type BracketKind = 'winners' | 'losers' | 'final' | 'main';
export type MatchState =
  | 'pending'
  | 'called'
  | 'reported'
  | 'confirmed'
  | 'disputed'
  | 'resolved'
  | 'bye'
  | 'not_needed'
  | 'waiting';
export type Winner = 'upper' | 'lower' | 'draw' | null;
export type Role = 'organizer' | 'co_organizer' | 'player' | 'viewer';

export type Slot = { entrant_id: string; name: string } | { bye: true } | null;

export interface MatchReport {
  by: string;
  upper_games: number;
  lower_games: number;
  reported_at: string;
  auto_confirm_at: string;
}

export interface MatchDispute {
  by: string;
  upper_games: number;
  lower_games: number;
  disputed_at: string;
}

export interface ApiMatch {
  id: string;
  tournament_id: string;
  label: string;
  bracket: BracketKind;
  round: number;
  number: number;
  upper: Slot;
  lower: Slot;
  state: MatchState;
  upper_games: number | null;
  lower_games: number | null;
  winner: Winner;
  report: MatchReport | null;
  dispute: MatchDispute | null;
  called_at: string | null;
  version: number;
  overdue?: boolean;
  updated_by?: string | null;
}

export interface CurrentRound {
  bracket: BracketKind;
  round: number;
}

export interface ApiTournament {
  id: string;
  name: string;
  format: Format;
  state: TournamentState;
  time_zone: string;
  fill: Fill;
  checkin_closes_at: string | null;
  server_time: string;
  field_size: number | null;
  entrant_count: number;
  checked_in_count: number;
  current_round: CurrentRound | null;
  swiss_rounds: number | null;
  logo_url: string | null;
  seeding_version: number;
  my_role: Role;
  has_roster: boolean;
  finished_on: string | null;
  share_url?: string;
  co_organizers?: string[];
}

export interface ApiEntrant {
  id: string;
  name: string;
  seed: number;
  username?: string | null;
  checked_in: boolean;
}

export interface PublicEntrant {
  name: string;
  seed: number;
}

export interface PreviewMatch {
  number: number;
  upper: Slot;
  lower: Slot;
}

export interface StandingsRowRoundRobin {
  place: number;
  entrant_id: string;
  name: string;
  played: number;
  match_points: number;
  head_to_head: number;
  game_difference: string;
  games_won: number;
  seed: number;
  decided_by: string;
}

export interface StandingsRowSwiss {
  place: number;
  entrant_id: string;
  name: string;
  played: number;
  match_points: number;
  buchholz_cut_1: string;
  buchholz: string;
  sonneborn_berger: string;
  seed: number;
  decided_by: string;
}

export type StandingsRow = StandingsRowRoundRobin | StandingsRowSwiss;

export interface Standings {
  columns: string[];
  rows: StandingsRow[];
}

export interface HistoryRow {
  tournament_id: string;
  tournament_name: string;
  place: number;
  field_size: number;
  finished_on: string;
  text: string;
}

export interface ConfigResponse {
  server_time: string;
  confirm_window_ms: number;
  match_limit_ms: number;
  swiss_round_ms: number;
  toast_ms: number;
  roster_max_bytes: number;
  logo_max_bytes: number;
}

export interface DependentPreview {
  match_id: string;
  label: string;
  state: MatchState;
}

export interface EditPreviewResponse {
  dependents: DependentPreview[];
  count: number;
  confirmed_count: number;
  preview_token: string;
}

export interface ErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
  match?: ApiMatch;
  entrants?: ApiEntrant[];
  errors?: string[];
}

export type LiveMessageType =
  | 'match.updated'
  | 'matches.reset'
  | 'standings.updated'
  | 'checkin.updated'
  | 'entrants.updated'
  | 'tournament.updated'
  | 'announcement';

export interface LiveMessage {
  seq: number;
  type: LiveMessageType;
  at: string;
  data: {
    match?: ApiMatch;
    matches?: ApiMatch[];
    rows?: StandingsRow[];
    checked_in_count?: number;
    entrant?: { name: string; checked_in: boolean };
    entrants?: ApiEntrant[] | PublicEntrant[];
    tournament?: ApiTournament;
    text?: string;
  };
}

export interface SharePayload {
  tournament: ApiTournament;
  entrants: PublicEntrant[];
  matches: ApiMatch[];
  standings: Standings | null;
}

export const FORMAT_NAMES: Record<Format, string> = {
  single_elimination: 'Single elimination',
  double_elimination: 'Double elimination',
  round_robin: 'Round robin',
  swiss: 'Swiss',
};

export const FORMATS: Format[] = ['single_elimination', 'double_elimination', 'round_robin', 'swiss'];

export const STATUS_WORDS: Record<MatchState, string> = {
  pending: 'Pending',
  called: 'Called',
  reported: 'Awaiting confirmation',
  confirmed: 'Confirmed',
  disputed: 'Disputed',
  resolved: 'Resolved',
  bye: 'Bye',
  not_needed: 'Not needed',
  waiting: 'Waiting',
};

export const ROUND_ROBIN_COLUMNS = [
  'Place',
  'Entrant',
  'Played',
  'Match points',
  'Head-to-head',
  'Game difference',
  'Games won',
  'Seed',
  'Decided by',
];

export const SWISS_COLUMNS = [
  'Place',
  'Entrant',
  'Played',
  'Match points',
  'Buchholz cut 1',
  'Buchholz',
  'Sonneborn-Berger',
  'Seed',
  'Decided by',
];
