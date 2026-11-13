import type { Direction } from './grid';

export type Colour = 'Teal' | 'Coral' | 'Violet' | 'Moss' | 'Cobalt' | 'Rose' | 'Rust' | 'Slate';

export const COLOURS: Colour[] = [
  'Teal',
  'Coral',
  'Violet',
  'Moss',
  'Cobalt',
  'Rose',
  'Rust',
  'Slate',
];

export type SquareState = 'empty' | 'filled' | 'pencil' | 'wrong' | 'right' | 'revealed';

export interface ClueJson {
  number: number;
  row: number;
  col: number;
  length: number;
  text: string;
  links: { number: number; direction: Direction }[];
}

export interface PuzzleJson {
  id: string;
  title: string;
  author: string;
  cols: number;
  rows: number;
  source: 'library' | 'upload';
  fixture: string | null;
  sha256: string | null;
  created_at: string;
  blocks: string[];
  numbers: { row: number; col: number; number: number }[];
  clues: { across: ClueJson[]; down: ClueJson[] };
}

export interface PuzzleTile {
  id: string;
  title: string;
  author: string;
  cols: number;
  rows: number;
  source: 'library' | 'upload';
  fixture: string | null;
  in_progress: number;
}

export interface SquareJson {
  row: number;
  col: number;
  value: string;
  pencil: boolean;
  state: SquareState;
  owner: Colour | null;
}

export interface GamePlayerJson {
  id: string;
  display_name: string;
  colour: Colour;
  host: boolean;
  present: boolean;
  team: 1 | 2 | null;
  score: number;
}

export interface TimerSegmentJson {
  started_at: string;
  ended_at: string | null;
}

export interface GameJson {
  id: string;
  puzzle_id: string;
  puzzle_title: string;
  host_player_id: string;
  code: string | null;
  link_state: 'active' | 'off';
  status: 'open' | 'live' | 'paused' | 'solved';
  timer_state: 'running' | 'paused' | 'solved';
  elapsed_ms: number;
  timer_segments: TimerSegmentJson[];
  seq: number;
  revealed_count: number;
  checked_count: number;
  solved_at: string | null;
  mode: 'shared' | 'race';
  race_state: 'lobby' | 'racing' | 'finished' | null;
  scores: { '1': number; '2': number } | null;
  players: GamePlayerJson[];
  squares: SquareJson[];
}

export type OpScope = 'square' | 'word' | 'puzzle';

export interface OpSquare {
  row: number;
  col: number;
  state: SquareState;
  value?: string;
}

export interface BaseOp {
  seq: number;
  by: string;
  at: string;
  client_op_id: string | null;
  team?: 1 | 2;
}

export interface CellOp extends BaseOp {
  type: 'cell';
  row: number;
  col: number;
  value: string;
  pencil: boolean;
  state: SquareState;
  owner: Colour | null;
  autocheck: boolean;
}

export interface MarkOp extends BaseOp {
  type: 'check' | 'reveal' | 'clear';
  scope: OpScope | null;
  row: number | null;
  col: number | null;
  direction: Direction | null;
  squares: OpSquare[];
}

export interface ClaimOp extends BaseOp {
  type: 'claim';
  row: number;
  col: number;
  team: 1 | 2;
  owner: Colour;
  squares: OpSquare[];
}

export type Op = CellOp | MarkOp | ClaimOp;

export interface ConfigJson {
  heartbeat_ms: number;
  presence_grace_ms: number;
  upload_max_bytes: number;
  max_grid: number;
  max_players: number;
  live_rate: number;
  toast_ms: number;
  replay_step_ms: number;
}

export interface PlayerSettings {
  skip_filled: boolean;
  jump_next_clue: boolean;
  autocheck: boolean;
}

export interface PlayerStat {
  display_name: string;
  colour: Colour;
  letters: number;
  revealed: number;
}

export interface HistoryEntry {
  game_id: string;
  puzzle_id: string;
  puzzle_title: string;
  cols: number;
  rows: number;
  elapsed_ms: number;
  solved_at: string;
  revealed_count: number;
  checked_count: number;
  record_ready: boolean;
  players: { display_name: string; colour: Colour }[];
  squares: { row: number; col: number; owner: Colour | null }[];
  stats: PlayerStat[];
}

export interface SolveRecord {
  format: 'overlap-solve-record-1';
  game_id: string;
  puzzle_id: string;
  puzzle_title: string;
  cols: number;
  rows: number;
  solved_at: string;
  elapsed_ms: number;
  revealed_count: number;
  checked_count: number;
  players: { id: string; display_name: string; colour: Colour }[];
  initial: SquareJson[];
  final: SquareJson[];
  ops: Op[];
  timer_segments: { started_at: string; ended_at: string }[];
  stats: { player_id: string; letters: number; revealed: number }[];
}

export interface CellWrite {
  type: 'cell';
  row: number;
  col: number;
  value: string;
  pencil: boolean;
  client_op_id?: string | null;
}

export interface MarkWrite {
  type: 'check' | 'reveal' | 'clear';
  scope: OpScope;
  row?: number | null;
  col?: number | null;
  direction?: Direction | null;
  client_op_id?: string | null;
}

export interface CursorWrite {
  type: 'cursor';
  row: number;
  col: number;
  direction: Direction;
}

export type ClientWrite = CellWrite | MarkWrite | CursorWrite;

export interface LiveHello {
  type: 'hello';
  you: string;
  game: GameJson;
}

export interface LiveCell {
  type: 'cell';
  seq: number;
  row: number;
  col: number;
  value: string;
  pencil: boolean;
  state: SquareState;
  owner: Colour | null;
  by: string;
  client_op_id: string | null;
  autocheck: boolean;
}

export interface LiveCheck {
  type: 'check';
  seq: number;
  scope: OpScope;
  by: string;
  wrong: number;
  squares: { row: number; col: number; state: SquareState }[];
  client_op_id?: string | null;
}

export interface LiveReveal {
  type: 'reveal';
  seq: number;
  scope: OpScope;
  by: string;
  revealed: number;
  squares: { row: number; col: number; value: string; state: 'revealed'; owner: Colour }[];
  client_op_id?: string | null;
}

export interface LiveClear {
  type: 'clear';
  seq: number;
  scope: 'word' | 'puzzle';
  by: string;
  cleared: number;
  squares: { row: number; col: number }[];
  client_op_id?: string | null;
}

export interface LiveClaim {
  type: 'claim';
  seq: number;
  row: number;
  col: number;
  value: string;
  owner: Colour;
  team: 1 | 2;
  by: string;
  scores: { '1': number; '2': number };
  client_op_id?: string | null;
}

export interface LiveCursor {
  type: 'cursor';
  player_id: string;
  colour: Colour;
  row: number;
  col: number;
  direction: Direction;
}

export interface LivePresence {
  type: 'presence';
  player_id: string;
  display_name: string;
  colour: Colour;
  present: boolean;
}

export interface LiveTimer {
  type: 'timer';
  state: 'running' | 'paused' | 'solved';
  elapsed_ms: number;
}

export interface LiveSolved {
  type: 'solved';
  seq: number;
  elapsed_ms: number;
  revealed_count: number;
  stats: PlayerStat[];
}

export interface LiveTeam {
  type: 'team';
  player_id: string;
  team: 1 | 2 | null;
}

export interface LiveRace {
  type: 'race';
  state: 'racing' | 'finished';
  scores: { '1': number; '2': number };
}

export interface LiveError {
  type: 'error';
  code: string;
  message: string;
  client_op_id: string | null;
}

export interface LiveLinkOff {
  type: 'link_off';
  reason: 'off' | 'replaced';
  message: string;
}

export type LiveMessage =
  | LiveHello
  | LiveCell
  | LiveCheck
  | LiveReveal
  | LiveClear
  | LiveClaim
  | LiveCursor
  | LivePresence
  | LiveTimer
  | LiveSolved
  | LiveTeam
  | LiveRace
  | LiveError
  | LiveLinkOff;

export type WriteMessage = LiveCell | LiveCheck | LiveReveal | LiveClear | LiveClaim;
