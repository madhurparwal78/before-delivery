export type Direction = "across" | "down";
export type LinkState = "active" | "off";
export type PuzzleSource = "library" | "upload";
export type SquareState = "empty" | "filled" | "pencil" | "wrong" | "right" | "revealed";
export type CheckScope = "square" | "word" | "puzzle";
export type GameStatus = "open" | "live" | "paused" | "solved";
export type TimerState = "running" | "paused" | "solved";
export type GameMode = "shared" | "race";
export type RaceState = "lobby" | "racing" | "finished";

export const COLOURS = ["teal", "coral", "violet", "moss", "cobalt", "rose", "rust", "slate"] as const;
export type Colour = (typeof COLOURS)[number];

export interface PuzzleClue {
  number: number;
  row: number;
  col: number;
  length: number;
  text: string;
  links: { number: number; direction: Direction }[];
}

export interface PuzzleJSON {
  id: string;
  title: string;
  author: string;
  cols: number;
  rows: number;
  source: PuzzleSource;
  fixture: string | null;
  sha256: string | null;
  created_at: string;
  blocks: string[];
  numbers: { row: number; col: number; number: number }[];
  clues: { across: PuzzleClue[]; down: PuzzleClue[] };
}

export type Solution = string[][];

export interface SquareJSON {
  row: number;
  col: number;
  value: string;
  pencil: boolean;
  state: SquareState;
  owner: Colour | null;
}

export interface TimerSegment {
  started_at: string;
  ended_at: string | null;
}

export interface PlayerJSON {
  id: string;
  display_name: string;
  colour: Colour;
  host: boolean;
  present: boolean;
  team: 1 | 2 | null;
  score: number;
}

export interface GameJSON {
  id: string;
  puzzle_id: string;
  puzzle_title: string;
  host_player_id: string;
  code: string | null;
  link_state: LinkState;
  status: GameStatus;
  timer_state: TimerState;
  elapsed_ms: number;
  timer_segments: TimerSegment[];
  seq: number;
  revealed_count: number;
  checked_count: number;
  solved_at: string | null;
  mode: GameMode;
  race_state: RaceState | null;
  scores: { "1": number; "2": number } | null;
  players: PlayerJSON[];
  squares: SquareJSON[];
}

export interface OpJSON {
  seq: number;
  type: "cell" | "check" | "reveal" | "clear" | "claim";
  by: string;
  at: string;
  client_op_id: string | null;
  row?: number;
  col?: number;
  value?: string;
  pencil?: boolean;
  state?: SquareState;
  autocheck?: boolean;
  scope?: CheckScope;
  direction?: Direction | null;
  wrong?: number;
  revealed?: number;
  cleared?: number;
  squares?: { row: number; col: number; state?: SquareState; value?: string }[];
  team?: 1 | 2;
}

export interface StatsJSON {
  player_id: string;
  display_name: string;
  colour: Colour;
  letters: number;
  revealed: number;
}

export interface HistoryEntryJSON {
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
  squares: { row: number; col: number; owner: Colour }[];
  stats: StatsJSON[];
}

export interface SolveRecordJSON {
  format: "overlap-solve-record-1";
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
  initial: SquareJSON[];
  final: SquareJSON[];
  ops: OpJSON[];
  timer_segments: { started_at: string; ended_at: string }[];
  stats: { player_id: string; letters: number; revealed: number }[];
}

export interface ConfigJSON {
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

export interface BoardPuzzleJSON {
  id: string;
  title: string;
  author: string;
  cols: number;
  rows: number;
  source: PuzzleSource;
  fixture: string | null;
  in_progress: number;
}

export interface PuzzleSummary {
  id: string;
  title: string;
  author: string;
  cols: number;
  rows: number;
  source: PuzzleSource;
  fixture: string | null;
  in_progress: number;
}

export type ClientWrite =
  | { type: "cell"; row: number; col: number; value: string; pencil: boolean; client_op_id?: string | null }
  | { type: "check"; scope: CheckScope; row?: number | null; col?: number | null; direction?: Direction | null; client_op_id?: string | null }
  | { type: "reveal"; scope: CheckScope; row?: number | null; col?: number | null; direction?: Direction | null; client_op_id?: string | null }
  | { type: "clear"; scope: "word" | "puzzle"; row?: number | null; col?: number | null; direction?: Direction | null; client_op_id?: string | null }
  | { type: "cursor"; row: number; col: number; direction: Direction };

export type LiveMessage =
  | { type: "hello"; you: string; game: GameJSON }
  | { type: "cell"; seq: number; row: number; col: number; value: string; pencil: boolean; state: SquareState; owner: Colour | null; by: string; client_op_id: string | null; autocheck: boolean; team?: 1 | 2 }
  | { type: "check"; seq: number; scope: CheckScope; by: string; wrong: number; squares: { row: number; col: number; state: SquareState }[]; team?: 1 | 2 }
  | { type: "reveal"; seq: number; scope: CheckScope; by: string; revealed: number; squares: { row: number; col: number; value: string; state: "revealed"; owner: Colour }[]; team?: 1 | 2 }
  | { type: "cursor"; player_id: string; colour: Colour; row: number; col: number; direction: Direction; team?: 1 | 2 }
  | { type: "presence"; player_id: string; display_name: string; colour: Colour; present: boolean }
  | { type: "timer"; state: TimerState; elapsed_ms: number }
  | { type: "solved"; seq: number; elapsed_ms: number; revealed_count: number; stats: StatsJSON[] }
  | { type: "clear"; seq: number; scope: "word" | "puzzle"; by: string; cleared: number; squares: { row: number; col: number }[]; team?: 1 | 2 }
  | { type: "claim"; seq: number; row: number; col: number; value: string; owner: Colour; team: 1 | 2; by: string; scores: { "1": number; "2": number } }
  | { type: "team"; player_id: string; team: 1 | 2 | null }
  | { type: "race"; state: RaceState; scores: { "1": number; "2": number } }
  | { type: "error"; code: string; message: string; client_op_id: string | null }
  | { type: "link_off"; reason: "off" | "replaced"; message: string };
