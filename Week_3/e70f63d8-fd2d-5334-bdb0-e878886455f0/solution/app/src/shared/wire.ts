// Wire shapes shared by the server and the browser client (API, State, Scorecard, Live connection).

export type Extra = 'none' | 'wide' | 'no-ball' | 'bye' | 'leg-bye';
export type WicketKind = 'bowled' | 'caught' | 'lbw' | 'stumped' | 'hit-wicket' | 'run-out';
export type BatterOut = 'striker' | 'non-striker';
export type MatchStatus =
  | 'ready' | 'innings_1' | 'innings_break' | 'innings_2' | 'super_over_break' | 'super_over' | 'result' | 'tied';
export type BarReason = 'consecutive' | 'limit' | 'super-over';

export interface WicketBody {
  kind: WicketKind;
  fielder: string | null;
  batter_out: BatterOut;
  new_batter: string | null;
}

export interface TeamRef { id: string; name: string; logo_url: string | null }

export interface MatchInfo {
  id: string;
  title: string;
  status: MatchStatus;
  overs: number;
  players_per_side: number;
  super_over: boolean;
  home: TeamRef;
  away: TeamRef;
  played_on: string | null;
}

interface BatterLine { player: string; short_name: string; runs: number; balls: number; on_strike: boolean; text: string }
interface BowlerLineState { player: string; short_name: string; figures: string; text: string }
export interface BarredBowler { player: string; reason: BarReason }
export interface ChaseState { target: number; need: number; balls_left: number; required_rate: string; text: string }

export interface DeliveryItem {
  kind: 'delivery';
  seq: number;
  over: number;
  ball: number;
  label: string;
  runs: number;
  bat_runs: number;
  extra: Extra;
  extra_runs: number;
  wicket: WicketKind | 'none';
  free_hit: boolean;
  striker: string;
  bowler: string;
  line: string;
}
interface OverEndItem { kind: 'over-end'; over: number; line: string }
interface RetirementItem { kind: 'retirement'; player: string; line: string }
export type CommentaryItem = DeliveryItem | OverEndItem | RetirementItem;

export interface YetToBat { player: string; short_name: string; retired_hurt: boolean }
interface InningsBreak { heading: string; text: string }

export interface MatchState {
  match: MatchInfo;
  innings: string | null;
  batting_team: TeamRef;
  bowling_team: TeamRef;
  runs: number;
  wickets: number;
  legal_balls: number;
  overs_text: string;
  scoreboard: string;
  batters: BatterLine[];
  bowler: BowlerLineState | null;
  next_bowler_needed: boolean;
  barred_bowlers: BarredBowler[];
  free_hit: boolean;
  run_rate: string;
  chase: ChaseState | null;
  this_over: string[];
  commentary: CommentaryItem[];
  yet_to_bat: YetToBat[];
  innings_break: InningsBreak | null;
  result: string | null;
  last_seq: number;
}

export interface ScorerMatchState extends MatchState { viewer_link: boolean; viewer_code: string | null }

export interface BattingRow {
  player: string; name: string; dismissal: string; runs: number; balls: number; fours: number; sixes: number; strike_rate: string;
}
export interface BowlingRow {
  player: string; name: string; overs: string; maidens: number; runs: number; wickets: number; wides: number; no_balls: number;
  economy: string;
}
interface ExtrasLine { b: number; lb: number; w: number; nb: number; total: number; text: string }
export interface InningsCard {
  innings: string;
  heading: string;
  batting: BattingRow[];
  extras: ExtrasLine;
  total_text: string;
  did_not_bat: string[];
  fall_of_wickets: string;
  bowling: BowlingRow[];
}
export interface Scorecard { match: MatchInfo; innings: InningsCard[]; result: string | null }

export interface PlayerRef { id: string; name: string; short_name: string }
export interface MatchSide { id: string; name: string; logo_url: string | null; xi: PlayerRef[] }
export interface MatchDetail {
  id: string;
  title: string;
  status: MatchStatus;
  home: MatchSide;
  away: MatchSide;
  overs: number;
  players_per_side: number;
  super_over: boolean;
  tournament: { id: string; name: string } | null;
  viewer_link: boolean;
  viewer_code: string | null;
  scorers: { display_name: string }[];
  /** The sides of the innings that can start now (null while one is in progress or after the result). */
  next_innings: { batting_team: string; bowling_team: string } | null;
}
export interface MatchListItem {
  id: string; title: string; status: MatchStatus; played_on: string | null; result: string | null; is_organiser: boolean;
}

export interface User { id: string; email: string; display_name: string }
export interface TeamListItem { id: string; name: string; logo_url: string | null }
export interface TeamDetail {
  id: string;
  name: string;
  logo_url: string | null;
  players: PlayerRef[];
  matches: { id: string; line: string; scorecard_url: string | null }[];
  is_organiser: boolean;
}
export interface PlayerListItem extends PlayerRef { team: { id: string; name: string } }

export interface TableRow {
  team: { id: string; name: string };
  p: number; w: number; l: number; t: number; pts: number; nrr: string;
}
export interface GroupTable {
  name: string;
  table: TableRow[];
  matches: { id: string; home: string; away: string; status: MatchStatus; result: string | null }[];
}
export interface TournamentDetail {
  id: string; name: string; overs: number; players_per_side: number; super_over: boolean; groups: GroupTable[];
}

export interface Career {
  player: { id: string; name: string; short_name: string; team: { id: string; name: string } };
  batting: {
    matches: number; innings: number; not_outs: number; runs: number; high_score: string; average: string;
    strike_rate: string; fours: number; sixes: number;
  };
  bowling: { overs: string; runs: number; wickets: number; best: string; economy: string };
}

export interface InvitationView { match: { id: string; title: string }; status: 'open' | 'used' | 'expired' }

export interface ApiConfig { live_delay_ms: number; tick_ms: number; tick_stagger_ms: number }

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string>; seq?: number; holder?: string | null };
}

export type EventKind = 'delivery' | 'change' | 'undo' | 'retirement' | 'innings' | 'over';

export type ClientMessage =
  | { type: 'watch'; code: string }
  | { type: 'watch'; match: string }
  | { type: 'watch'; tournament: string }
  | { type: 'score'; match: string }
  | { type: 'take-pen'; match: string };

export type ServerMessage =
  | { type: 'state'; event: { kind: EventKind; seq: number }; state: MatchState }
  | { type: 'pen'; pen: string | null; holder: string | null }
  | { type: 'table'; tournament: string; groups: GroupTable[] }
  | { type: 'link-off' }
  | { type: 'live'; status: 'paused' }
  | { type: 'error'; code: 'NOT_FOUND' };
