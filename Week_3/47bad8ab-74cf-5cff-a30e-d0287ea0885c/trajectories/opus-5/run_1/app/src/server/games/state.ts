import type { PoolClient } from 'pg';
import { layoutGrid, type GridLayout } from '../../shared/grid';
import type {
  ClueJson,
  Colour,
  GameJson,
  GamePlayerJson,
  PlayerStat,
  PuzzleJson,
  SquareJson,
  SquareState,
} from '../../shared/types';
import { query } from '../db';

export interface PuzzleRecord {
  id: string;
  title: string;
  author: string;
  cols: number;
  rows: number;
  source: 'library' | 'upload';
  fixture: string | null;
  sha256: string | null;
  owner_id: string | null;
  blocks: string[];
  numbers: { row: number; col: number; number: number }[];
  clues: { across: ClueJson[]; down: ClueJson[] };
  solution: string[][];
  created_at: Date;
}

export interface GameRecord {
  id: string;
  puzzle_id: string;
  host_player_id: string;
  code: string | null;
  link_state: 'active' | 'off';
  status: 'open' | 'live' | 'paused' | 'solved';
  mode: 'shared' | 'race';
  race_state: 'lobby' | 'racing' | 'finished' | null;
  seq: number;
  checked_count: number;
  solved_at: Date | null;
  solved_seq: number | null;
  record_ready: boolean;
  initial_squares: SquareJson[];
  created_at: Date;
}

export interface SeatRecord {
  game_id: string;
  player_id: string;
  display_name: string;
  colour: Colour;
  host: boolean;
  seat: number;
  present: boolean;
  team: 1 | 2 | null;
  score: number;
}

export interface SquareRecord {
  team: number;
  row: number;
  col: number;
  value: string;
  pencil: boolean;
  state: SquareState;
  owner: Colour | null;
}

export interface SegmentRecord {
  idx: number;
  started_at: Date;
  ended_at: Date | null;
}

export interface ClaimRecord {
  row: number;
  col: number;
  team: 1 | 2;
  player_id: string;
  owner: Colour;
}

export interface GameState {
  game: GameRecord;
  puzzle: PuzzleRecord;
  layout: GridLayout;
  seats: SeatRecord[];
  squares: Map<string, SquareRecord>;
  segments: SegmentRecord[];
  claims: ClaimRecord[];
}

export const squareKey = (team: number, row: number, col: number): string =>
  `${team}:${row}:${col}`;

export function whiteSquares(puzzle: PuzzleRecord): { row: number; col: number }[] {
  const squares: { row: number; col: number }[] = [];
  for (let r = 0; r < puzzle.rows; r += 1) {
    for (let c = 0; c < puzzle.cols; c += 1) {
      if (puzzle.blocks[r][c] !== '#') squares.push({ row: r, col: c });
    }
  }
  return squares;
}

export function isBlack(puzzle: PuzzleRecord, row: number, col: number): boolean {
  if (row < 0 || row >= puzzle.rows || col < 0 || col >= puzzle.cols) return true;
  return puzzle.blocks[row][col] === '#';
}

export function answerAt(puzzle: PuzzleRecord, row: number, col: number): string {
  return puzzle.solution[row][col];
}

export function puzzleLayout(puzzle: PuzzleRecord): GridLayout {
  return layoutGrid(puzzle.blocks.map((row) => row.split('').map((cell) => cell === '#')));
}

export function puzzleJson(puzzle: PuzzleRecord): PuzzleJson {
  return {
    id: puzzle.id,
    title: puzzle.title,
    author: puzzle.author,
    cols: puzzle.cols,
    rows: puzzle.rows,
    source: puzzle.source,
    fixture: puzzle.fixture,
    sha256: puzzle.sha256,
    created_at: puzzle.created_at.toISOString(),
    blocks: puzzle.blocks,
    numbers: puzzle.numbers,
    clues: puzzle.clues,
  };
}

export async function loadPuzzle(puzzleId: string): Promise<PuzzleRecord | null> {
  const result = await query<PuzzleRecord>('select * from puzzles where id = $1', [puzzleId]);
  return result.rows[0] ?? null;
}

type Querier = Pick<PoolClient, 'query'>;

async function run<T extends object>(
  client: Querier | null,
  text: string,
  values: unknown[],
): Promise<T[]> {
  const result = client ? await client.query(text, values) : await query(text, values);
  return result.rows as T[];
}

export async function loadGameState(
  gameId: string,
  client: Querier | null = null,
): Promise<GameState | null> {
  const games = await run<GameRecord>(client, 'select * from games where id = $1', [gameId]);
  const game = games[0];
  if (!game) return null;
  const puzzles = await run<PuzzleRecord>(client, 'select * from puzzles where id = $1', [
    game.puzzle_id,
  ]);
  const puzzle = puzzles[0];
  const seats = await run<SeatRecord>(
    client,
    `select gp.game_id, gp.player_id, p.display_name, gp.colour, gp.host, gp.seat,
            gp.present, gp.team, gp.score
       from game_players gp join players p on p.id = gp.player_id
      where gp.game_id = $1 order by gp.seat`,
    [gameId],
  );
  const squareRows = await run<SquareRecord>(
    client,
    'select team, row, col, value, pencil, state, owner from squares where game_id = $1',
    [gameId],
  );
  const segments = await run<SegmentRecord>(
    client,
    'select idx, started_at, ended_at from timer_segments where game_id = $1 order by idx',
    [gameId],
  );
  const claims = await run<ClaimRecord>(
    client,
    'select row, col, team, player_id, owner from race_claims where game_id = $1',
    [gameId],
  );
  const squares = new Map<string, SquareRecord>();
  for (const square of squareRows) squares.set(squareKey(square.team, square.row, square.col), square);
  return { game, puzzle, layout: puzzleLayout(puzzle), seats, squares, segments, claims };
}

export function elapsedMs(state: GameState, now = Date.now()): number {
  let total = 0;
  for (const segment of state.segments) {
    const end = segment.ended_at ? segment.ended_at.getTime() : now;
    total += Math.max(0, end - segment.started_at.getTime());
  }
  return total;
}

export function timerState(state: GameState): 'running' | 'paused' | 'solved' {
  if (state.game.status === 'solved') return 'solved';
  return state.game.status === 'live' ? 'running' : 'paused';
}

export function teamOf(state: GameState, playerId: string): 1 | 2 | null {
  return state.seats.find((seat) => seat.player_id === playerId)?.team ?? null;
}

export function gridTeam(state: GameState, playerId: string): number {
  if (state.game.mode === 'shared') return 0;
  return teamOf(state, playerId) ?? 0;
}

export function scores(state: GameState): { '1': number; '2': number } {
  let one = 0;
  let two = 0;
  for (const claim of state.claims) {
    if (claim.team === 1) one += 1;
    else two += 1;
  }
  return { '1': one, '2': two };
}

function emptySquare(row: number, col: number): SquareJson {
  return { row, col, value: '', pencil: false, state: 'empty', owner: null };
}

export function squareJson(square: SquareRecord): SquareJson {
  return {
    row: square.row,
    col: square.col,
    value: square.value,
    pencil: square.pencil,
    state: square.state,
    owner: square.owner,
  };
}

export function viewSquares(state: GameState, viewerId: string): SquareJson[] {
  const team = state.game.mode === 'shared' ? 0 : teamOf(state, viewerId);
  return whiteSquares(state.puzzle).map(({ row, col }) => {
    if (team === null) {
      const claim = state.claims.find((c) => c.row === row && c.col === col);
      if (!claim) return emptySquare(row, col);
      return {
        row,
        col,
        value: answerAt(state.puzzle, row, col),
        pencil: false,
        state: 'right',
        owner: claim.owner,
      };
    }
    const square = state.squares.get(squareKey(team, row, col));
    return square ? squareJson(square) : emptySquare(row, col);
  });
}

export function revealedCount(state: GameState): number {
  let count = 0;
  for (const square of state.squares.values()) {
    if (square.team === 0 && square.state === 'revealed') count += 1;
  }
  return count;
}

export function playerStats(state: GameState): PlayerStat[] {
  return state.seats.map((seat) => {
    let letters = 0;
    let revealed = 0;
    for (const square of state.squares.values()) {
      if (square.team !== 0 || square.owner !== seat.colour) continue;
      if (square.state === 'revealed') revealed += 1;
      else if (square.value !== '') letters += 1;
    }
    return {
      display_name: seat.display_name,
      colour: seat.colour,
      letters,
      revealed,
    };
  });
}

function playerJson(seat: SeatRecord): GamePlayerJson {
  return {
    id: seat.player_id,
    display_name: seat.display_name,
    colour: seat.colour,
    host: seat.host,
    present: seat.present,
    team: seat.team,
    score: seat.score,
  };
}

export function gameJson(state: GameState, viewerId: string): GameJson {
  const race = state.game.mode === 'race';
  return {
    id: state.game.id,
    puzzle_id: state.game.puzzle_id,
    puzzle_title: state.puzzle.title,
    host_player_id: state.game.host_player_id,
    code: state.game.link_state === 'active' ? state.game.code : null,
    link_state: state.game.link_state,
    status: state.game.status,
    timer_state: timerState(state),
    elapsed_ms: elapsedMs(state),
    timer_segments: state.segments.map((segment) => ({
      started_at: segment.started_at.toISOString(),
      ended_at: segment.ended_at ? segment.ended_at.toISOString() : null,
    })),
    seq: state.game.seq,
    revealed_count: revealedCount(state),
    checked_count: state.game.checked_count,
    solved_at: state.game.solved_at ? state.game.solved_at.toISOString() : null,
    mode: state.game.mode,
    race_state: race ? state.game.race_state : null,
    scores: race ? scores(state) : null,
    players: state.seats.map(playerJson),
    squares: viewSquares(state, viewerId),
  };
}
