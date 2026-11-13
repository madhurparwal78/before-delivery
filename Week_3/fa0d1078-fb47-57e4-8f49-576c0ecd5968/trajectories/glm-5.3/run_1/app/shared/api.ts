import type { Level } from './puzzles.js';

// The shapes of the API bodies. Levels are easy, medium, hard and expert in
// every body.

export interface Player {
  player_id: string;
  email: string;
  display_name: string;
  verified: boolean;
}

export type DailyState = 'solved' | 'late' | null;

export interface Result {
  id: string;
  level: Level;
  seconds: number;
  mistakes: number;
  hints: number;
  score: number;
  finished_at: string;
  daily_state: DailyState;
}

export type GameStatus = 'playing' | 'lost' | 'won' | 'abandoned';

export interface StartBoardShape {
  entries: number[];
  notes: Record<string, number[]>;
  mistakes: number;
  hints: number;
  elapsed_ms: number;
  second_chance_used: boolean;
}

export interface GameShape {
  id: string;
  mode: 'solo' | 'daily';
  level: Level;
  puzzle_id: string;
  date: string | null;
  status: GameStatus;
  puzzle: string;
  solution: string;
  start: StartBoardShape;
  moves: number;
  elapsed_ms: number;
  result: Result | null;
}

export type RoomState = 'open' | 'seated' | 'countdown' | 'playing' | 'finished' | 'tie' | 'forfeited';

export interface SeatShape {
  display_name: string;
  ready: boolean;
  connected: boolean;
}

export interface RoomShape {
  code: string;
  level: Level;
  state: RoomState;
  seats: (SeatShape | null)[];
}

export interface LeaderboardRow {
  rank: number;
  display_name: string;
  seconds: number;
  score: number;
  mistakes: number;
  hints: number;
}

export interface ProfileLevelStats {
  started: number;
  won: number;
  win_rate: number | null;
  best_seconds: number | null;
  average_seconds: number | null;
  best_score: number | null;
}

export interface FinishedGame {
  id: string;
  date: string;
  level: Level;
  result: 'won' | 'lost';
  seconds: number;
  score: number | null;
}

export interface ProfileShape {
  levels: Record<Level, ProfileLevelStats>;
  finished_games: FinishedGame[];
}

export interface DailyDay {
  date: string;
  state: 'solved' | 'late' | 'missed' | 'today' | 'future' | 'closed';
  id: string | null;
}

export interface DailyShape {
  today: string;
  month: string;
  days: DailyDay[];
  current_streak: number;
  best_streak: number;
}

export interface ApiError {
  code: string;
  message: string;
  fields?: Record<string, string>;
  move?: number | null;
}
