import type { Level } from "./levels";
import type { Move, StartBoard } from "./moves";

export interface Player {
  player_id: string;
  email: string;
  display_name: string;
  verified: boolean;
}

export type DailyState = "solved" | "late";

export interface Result {
  id: string;
  level: Level;
  seconds: number;
  mistakes: number;
  hints: number;
  score: number;
  finished_at: string;
  daily_state: DailyState | null;
}

type GameStatus = "playing" | "lost" | "won" | "abandoned";

export interface Game {
  id: string;
  mode: "solo" | "daily";
  level: Level;
  puzzle_id: string;
  date: string | null;
  status: GameStatus;
  puzzle: string;
  solution: string;
  start: StartBoard;
  moves: Move[];
  elapsed_ms: number;
  /** A lost game is closed once its second chance is used or a newer game at its level was started. */
  closed: boolean;
  result: Result | null;
}

export type CalendarState = "solved" | "late" | "missed" | "today" | "future" | "closed";

export interface DailyMonth {
  today: string;
  month: string;
  days: { date: string; state: CalendarState; id: string | null }[];
  current_streak: number;
  best_streak: number;
}

export interface LeaderboardRow {
  rank: number;
  display_name: string;
  seconds: number;
  score: number;
  mistakes: number;
  hints: number;
}

export interface Leaderboard {
  date: string;
  live: boolean;
  rows: LeaderboardRow[];
}

export interface LevelStatistics {
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
  result: "won" | "lost";
  seconds: number;
  score: number | null;
}

export interface Profile {
  levels: Record<Level, LevelStatistics>;
  finished_games: FinishedGame[];
}

export type RoomState = "open" | "seated" | "countdown" | "playing" | "finished" | "tie" | "forfeited";

export interface Seat {
  display_name: string;
  ready: boolean;
  connected: boolean;
}

export interface Room {
  code: string;
  level: Level;
  state: RoomState;
  seats: Seat[];
}

type DuelOutcome = "win" | "loss" | "tie" | "out" | "opponent_out" | "forfeit_win";

export type ClientMessage =
  | { type: "room"; code: string }
  | { type: "ready"; ready: boolean }
  | { type: "move"; op: "enter" | "note" | "erase" | "undo" | "redo"; cell?: string; digit?: number }
  | { type: "leaderboard"; date: string };

export type ServerMessage =
  | { type: "room"; room: Room }
  | { type: "countdown"; seconds_left: number }
  | { type: "start"; puzzle: string; started_at: number }
  | {
      type: "you";
      values: string;
      wrong: string[];
      hinted: string[];
      notes: Record<string, number[]>;
      correct: number;
      mistakes: number;
    }
  | { type: "progress"; display_name: string; correct: number; mistakes: number }
  | { type: "presence"; display_name: string; state: "reconnecting" | "back" }
  | { type: "result"; outcome: DuelOutcome; winner: string | null; seconds: number | null }
  | { type: "leaderboard"; date: string; rows: LeaderboardRow[]; latest: { display_name: string; rank: number } }
  | { type: "error"; code: string; message: string };

/** Written into index.html by the server so the client knows the instance's limits. */
export interface ClientConfig {
  mistakeLimit: number;
  hintLimit: number;
  dailyStart: string;
}
