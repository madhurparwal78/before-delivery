import type { Cell, Digit } from './board';
import type { DailyResultState, DayState } from './daily';
import type { LoggedMove, StartBoard } from './engine';
import type { LeaderboardRow } from './leaderboard';
import type { Level } from './puzzles';

export interface PlayerShape {
  player_id: string;
  email: string;
  display_name: string;
  verified: boolean;
}

export interface ResultShape {
  id: string;
  level: Level;
  seconds: number;
  mistakes: number;
  hints: number;
  score: number;
  finished_at: string;
  daily_state: DailyResultState | null;
}

export type GameStatus = 'playing' | 'lost' | 'won' | 'abandoned';

export interface GameShape {
  id: string;
  mode: 'solo' | 'daily';
  level: Level;
  puzzle_id: string;
  date: string | null;
  status: GameStatus;
  puzzle: string;
  solution: string;
  start: StartBoard;
  moves: LoggedMove[];
  elapsed_ms: number;
  result: ResultShape | null;
}

export interface SeatShape {
  display_name: string;
  ready: boolean;
  connected: boolean;
}

export type RoomState =
  | 'open'
  | 'seated'
  | 'countdown'
  | 'playing'
  | 'finished'
  | 'tie'
  | 'forfeited';

export interface RoomShape {
  code: string;
  level: Level;
  state: RoomState;
  seats: SeatShape[];
}

export interface DailyDayShape {
  date: string;
  state: DayState;
  id: string | null;
}

export interface DailyShape {
  today: string;
  month: string;
  days: DailyDayShape[];
  current_streak: number;
  best_streak: number;
}

export interface LeaderboardShape {
  date: string;
  live: boolean;
  rows: LeaderboardRow[];
}

export interface LevelStatsShape {
  started: number;
  won: number;
  win_rate: number | null;
  best_seconds: number | null;
  average_seconds: number | null;
  best_score: number | null;
}

export interface FinishedGameShape {
  id: string;
  date: string;
  level: Level;
  result: 'won' | 'lost';
  seconds: number;
  score: number | null;
}

export interface ProfileShape {
  levels: Record<Level, LevelStatsShape>;
  finished_games: FinishedGameShape[];
}

export interface HealthShape {
  status: 'ok' | 'degraded';
  down?: ('postgres' | 'valkey' | 'mailpit')[];
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    move?: number | null;
  };
}

export type ClientSocketMessage =
  | { type: 'room'; code: string }
  | { type: 'ready'; ready: boolean }
  | { type: 'move'; op: 'enter' | 'note' | 'erase' | 'undo' | 'redo'; cell?: Cell; digit?: Digit }
  | { type: 'leaderboard'; date: string };

export type DuelOutcome = 'win' | 'loss' | 'tie' | 'out' | 'opponent_out' | 'forfeit_win';

export type ServerSocketMessage =
  | { type: 'room'; room: RoomShape }
  | { type: 'countdown'; seconds_left: number }
  | { type: 'start'; puzzle: string; started_at: string }
  | {
      type: 'you';
      values: string;
      wrong: Cell[];
      hinted: Cell[];
      notes: Record<Cell, Digit[]>;
      correct: number;
      mistakes: number;
    }
  | { type: 'progress'; display_name: string; correct: number; mistakes: number }
  | { type: 'presence'; display_name: string; state: 'reconnecting' | 'back' }
  | {
      type: 'result';
      outcome: DuelOutcome;
      winner: string | null;
      seconds: number | null;
    }
  | {
      type: 'leaderboard';
      date: string;
      rows: LeaderboardRow[];
      latest: { display_name: string; rank: number };
    }
  | { type: 'error'; code: string; message: string };

/** Settings the browser needs, delivered by the server with the page shell. */
export interface ClientConfig {
  mistake_limit: number;
  hint_limit: number;
  move_limit: number;
  daily_start: string;
  leaderboard_size: number;
}
