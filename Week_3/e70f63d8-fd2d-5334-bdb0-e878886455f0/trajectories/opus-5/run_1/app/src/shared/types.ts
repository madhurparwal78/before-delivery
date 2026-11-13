export type Extra = 'none' | 'wide' | 'no-ball' | 'bye' | 'leg-bye';

export type WicketKind =
  | 'bowled'
  | 'caught'
  | 'lbw'
  | 'stumped'
  | 'hit-wicket'
  | 'run-out';

export type MatchStatus =
  | 'ready'
  | 'innings_1'
  | 'innings_break'
  | 'innings_2'
  | 'super_over_break'
  | 'super_over'
  | 'result'
  | 'tied';

export type BarReason = 'consecutive' | 'limit' | 'super-over';

export interface TeamRef {
  id: string;
  name: string;
  logo_url: string | null;
}

export interface MatchHeader {
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

export interface BatterLine {
  player: string;
  short_name: string;
  runs: number;
  balls: number;
  on_strike: boolean;
  text: string;
}

export interface BowlerLine {
  player: string;
  short_name: string;
  figures: string;
  text: string;
}

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
  wicket: 'none' | WicketKind;
  free_hit: boolean;
  striker: string;
  bowler: string;
  line: string;
}

export interface OverEndItem {
  kind: 'over-end';
  over: number;
  line: string;
}

export interface RetirementItem {
  kind: 'retirement';
  player: string;
  line: string;
}

export type CommentaryItem = DeliveryItem | OverEndItem | RetirementItem;

export interface ChaseLine {
  target: number;
  need: number;
  balls_left: number;
  required_rate: string;
  text: string;
}

export interface YetToBat {
  player: string;
  short_name: string;
  retired_hurt: boolean;
}

export interface MatchState {
  match: MatchHeader;
  innings: string | null;
  batting_team: TeamRef | null;
  bowling_team: TeamRef | null;
  runs: number;
  wickets: number;
  legal_balls: number;
  overs_text: string;
  scoreboard: string;
  batters: BatterLine[];
  bowler: BowlerLine | null;
  next_bowler_needed: boolean;
  barred_bowlers: { player: string; reason: BarReason }[];
  free_hit: boolean;
  run_rate: string;
  chase: ChaseLine | null;
  this_over: string[];
  commentary: CommentaryItem[];
  yet_to_bat: YetToBat[];
  innings_break: { heading: string; text: string } | null;
  result: string | null;
  last_seq: number;
}

export interface ScorerState extends MatchState {
  viewer_link: boolean;
  viewer_code: string | null;
}

export interface BattingRow {
  player: string;
  name: string;
  dismissal: string;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  strike_rate: string;
}

export interface BowlingRow {
  player: string;
  name: string;
  overs: string;
  maidens: number;
  runs: number;
  wickets: number;
  wides: number;
  no_balls: number;
  economy: string;
}

export interface ScorecardInnings {
  innings: string;
  heading: string;
  batting: BattingRow[];
  extras: { b: number; lb: number; w: number; nb: number; total: number; text: string };
  total_text: string;
  did_not_bat: string[];
  fall_of_wickets: string;
  bowling: BowlingRow[];
}

export interface Scorecard {
  match: MatchHeader;
  innings: ScorecardInnings[];
  result: string | null;
}

export interface TableRow {
  team: { id: string; name: string };
  p: number;
  w: number;
  l: number;
  t: number;
  pts: number;
  nrr: string;
}

export interface GroupView {
  name: string;
  table: TableRow[];
  matches: {
    id: string;
    home: string;
    away: string;
    status: MatchStatus;
    result: string | null;
  }[];
}

export interface TournamentView {
  id: string;
  name: string;
  overs: number;
  players_per_side: number;
  super_over: boolean;
  groups: GroupView[];
}

export interface Career {
  player: { id: string; name: string; short_name: string; team: { id: string; name: string } };
  batting: {
    matches: number;
    innings: number;
    not_outs: number;
    runs: number;
    high_score: string;
    average: string;
    strike_rate: string;
    fours: number;
    sixes: number;
  };
  bowling: { overs: string; runs: number; wickets: number; best: string; economy: string };
}

export type LiveEventKind =
  | 'delivery'
  | 'change'
  | 'undo'
  | 'retirement'
  | 'innings'
  | 'over';

export type ServerMessage =
  | { type: 'state'; event: { kind: LiveEventKind; seq: number }; state: MatchState }
  | { type: 'pen'; pen: string | null; holder: string | null }
  | { type: 'table'; tournament: string; groups: GroupView[] }
  | { type: 'link-off' }
  | { type: 'live'; status: 'paused' }
  | { type: 'error'; code: 'NOT_FOUND' };

export type ClientMessage =
  | { type: 'watch'; code?: string; match?: string; tournament?: string }
  | { type: 'score'; match: string }
  | { type: 'take-pen'; match: string };
