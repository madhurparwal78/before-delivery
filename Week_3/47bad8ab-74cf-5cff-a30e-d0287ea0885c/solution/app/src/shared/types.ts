import type { ClueRef } from './clues.ts'
import type { Direction } from './numbering.ts'

export const COLOURS = ['Teal', 'Coral', 'Violet', 'Moss', 'Cobalt', 'Rose', 'Rust', 'Slate'] as const
export type Colour = (typeof COLOURS)[number]

export type SquareState = 'empty' | 'filled' | 'pencil' | 'wrong' | 'right' | 'revealed'
export type Team = 1 | 2
export type GameMode = 'shared' | 'race'
type Scope = 'square' | 'word' | 'puzzle'
export type Scores = { 1: number; 2: number }

export interface Square {
  row: number
  col: number
  value: string
  pencil: boolean
  state: SquareState
  owner: Colour | null
}

export interface ClueJson {
  number: number
  row: number
  col: number
  length: number
  text: string
  links: ClueRef[]
}

export interface PuzzleJson {
  id: string
  title: string
  author: string
  cols: number
  rows: number
  source: 'library' | 'upload'
  fixture: string | null
  sha256: string | null
  created_at: string
  blocks: string[]
  numbers: { row: number; col: number; number: number }[]
  clues: { across: ClueJson[]; down: ClueJson[] }
}

export type Solution = string[][]

export interface PuzzleListEntry {
  id: string
  title: string
  author: string
  cols: number
  rows: number
  source: 'library' | 'upload'
  fixture: string | null
  in_progress: number
}

export interface Settings {
  skip_filled: boolean
  jump_next_clue: boolean
  autocheck: boolean
}

export interface PlayerJson {
  id: string
  display_name: string
  colour: Colour
  host: boolean
  present: boolean
  team: Team | null
  score: number
}

export interface TimerSegment {
  started_at: string
  ended_at: string | null
}

export type TimerState = 'running' | 'paused' | 'solved'
export type GameStatus = 'open' | 'live' | 'paused' | 'solved'
export type RaceState = 'lobby' | 'racing' | 'finished'

export interface GameJson {
  id: string
  puzzle_id: string
  puzzle_title: string
  host_player_id: string
  code: string | null
  link_state: 'active' | 'off'
  status: GameStatus
  timer_state: TimerState
  elapsed_ms: number
  timer_segments: TimerSegment[]
  seq: number
  revealed_count: number
  checked_count: number
  solved_at: string | null
  mode: GameMode
  race_state: RaceState | null
  scores: Scores | null
  players: PlayerJson[]
  squares: Square[]
}

export interface SquareMark {
  row: number
  col: number
  state: SquareState
}

export interface SquareReveal extends SquareMark {
  value: string
  owner: Colour | null
}

interface OpBase {
  seq: number
  by: string
  at: string
  client_op_id: string | null
  team?: Team
}

export interface CellOp extends OpBase {
  type: 'cell'
  row: number
  col: number
  value: string
  pencil: boolean
  state: SquareState
  autocheck: boolean
}

interface ScopedOpBase extends OpBase {
  scope: Scope
  row: number | null
  col: number | null
  direction: Direction | null
}

export interface CheckOp extends ScopedOpBase {
  type: 'check'
  squares: SquareMark[]
}

export interface RevealOp extends ScopedOpBase {
  type: 'reveal'
  squares: SquareReveal[]
}

export interface ClearOp extends ScopedOpBase {
  type: 'clear'
  squares: SquareMark[]
}

export interface ClaimOp extends OpBase {
  type: 'claim'
  row: number
  col: number
  team: Team
  squares: SquareReveal[]
}

export type Op = CellOp | CheckOp | RevealOp | ClearOp | ClaimOp

export interface PlayerStats {
  player_id: string
  letters: number
  revealed: number
}

export interface HistoryStats {
  display_name: string
  colour: Colour
  letters: number
  revealed: number
}

export interface HistoryEntry {
  game_id: string
  puzzle_id: string
  puzzle_title: string
  cols: number
  rows: number
  elapsed_ms: number
  solved_at: string
  revealed_count: number
  checked_count: number
  record_ready: boolean
  players: { display_name: string; colour: Colour }[]
  squares: { row: number; col: number; owner: Colour | null }[]
  stats: HistoryStats[]
}

export interface SolveRecord {
  format: 'overlap-solve-record-1'
  game_id: string
  puzzle_id: string
  puzzle_title: string
  cols: number
  rows: number
  solved_at: string
  elapsed_ms: number
  revealed_count: number
  checked_count: number
  players: { id: string; display_name: string; colour: Colour }[]
  initial: Square[]
  final: Square[]
  ops: Op[]
  timer_segments: TimerSegment[]
  stats: PlayerStats[]
}

export interface PublicConfig {
  heartbeat_ms: number
  presence_grace_ms: number
  upload_max_bytes: number
  max_grid: number
  max_players: number
  live_rate: number
  toast_ms: number
  replay_step_ms: number
}

export interface ApiErrorBody {
  error: string
  message: string
  fields?: Record<string, string>
  lines?: string[]
}

/** What the client sends over the live connection or `POST /api/games/<id>/ops`. */
export type ClientWrite =
  | { type: 'cell'; row: number; col: number; value: string; pencil: boolean; client_op_id?: string }
  | { type: 'check' | 'reveal' | 'clear'; scope: Scope; row?: number | null; col?: number | null; direction?: Direction | null; client_op_id?: string }

interface CursorMessage {
  type: 'cursor'
  row: number
  col: number
  direction: Direction
}

export type ClientMessage = ClientWrite | CursorMessage

type CellMessage = {
  type: 'cell'
  seq: number
  row: number
  col: number
  value: string
  pencil: boolean
  state: SquareState
  owner: Colour | null
  by: string
  client_op_id: string | null
  autocheck: boolean
}

type CheckMessage = { type: 'check'; seq: number; scope: Scope; by: string; wrong: number; squares: SquareMark[]; client_op_id: string | null }
type RevealMessage = { type: 'reveal'; seq: number; scope: Scope; by: string; revealed: number; squares: SquareReveal[]; client_op_id: string | null }
type ClearMessage = { type: 'clear'; seq: number; scope: Scope; by: string; cleared: number; squares: { row: number; col: number }[]; client_op_id: string | null }
type ClaimMessage = { type: 'claim'; seq: number; row: number; col: number; value: string; owner: Colour | null; team: Team; by: string; scores: Scores; client_op_id: string | null }

export type WriteMessage = CellMessage | CheckMessage | RevealMessage | ClearMessage | ClaimMessage

export type ServerMessage =
  | { type: 'hello'; you: string; game: GameJson }
  | WriteMessage
  | { type: 'cursor'; player_id: string; colour: Colour; row: number; col: number; direction: Direction }
  | { type: 'presence'; player_id: string; display_name: string; colour: Colour; present: boolean }
  | { type: 'timer'; state: TimerState; elapsed_ms: number }
  | { type: 'solved'; seq: number; elapsed_ms: number; revealed_count: number; stats: HistoryStats[] }
  | { type: 'team'; player_id: string; team: Team | null }
  | { type: 'race'; state: 'racing' | 'finished'; scores: Scores }
  | { type: 'error'; code: string; message: string; client_op_id: string | null }
  | { type: 'link_off'; reason: 'off' | 'replaced'; message: string }

export const LINK_OFF_CLOSE = 4410
export const LIVE_FRAME_LIMIT = 4096
export const JSON_BODY_LIMIT = 16384
