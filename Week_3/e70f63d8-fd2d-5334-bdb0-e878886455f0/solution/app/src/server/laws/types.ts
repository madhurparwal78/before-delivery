import type { BatterOut, Extra, WicketKind } from '../../shared/wire.js';
import type { ErrorCode } from '../../shared/copy.js';

export interface Player { id: string; name: string; shortName: string }
export interface Side { id: string; name: string; xi: Player[] }

export interface Wicket { kind: WicketKind; fielder: string | null; batterOut: BatterOut; newBatter: string | null }

export type LogEntry =
  | { kind: 'over'; bowler: string }
  | { kind: 'delivery'; extra: Extra; runs: number; wicket: Wicket | null }
  | { kind: 'retirement'; batter: string; newBatter: string };

type ViolationCode = Extract<
  ErrorCode,
  | 'NEEDS_BOWLER' | 'INNINGS_OVER' | 'OVER_IN_PROGRESS' | 'WICKET_NOT_ALLOWED' | 'BYES_NEED_RUNS' | 'NEW_BATTER_INVALID'
  | 'NO_BATTER_LEFT' | 'BOWLER_CONSECUTIVE' | 'BOWLER_LIMIT' | 'BOWLER_BARRED' | 'VALIDATION' | 'CHANGE_MOVES_OVERS'
  | 'CHANGE_BREAKS_WICKET'
>;

/** A log entry the laws refuse. `entry` is its index in the log, `seq` the delivery it concerns (null for other entries). */
export class LawViolation extends Error {
  constructor(
    readonly code: ViolationCode,
    message: string,
    readonly entry: number,
    readonly seq: number | null,
    readonly wicketKind: WicketKind | null = null,
    readonly onFreeHit = false,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

/** The innings that comes next in a match: who bats, the quota, the limits and the target. */
export interface InningsPlan {
  key: string;
  /** Which super over this is (1, 2, ...); 0 for the two innings of the match itself. */
  superNumber: number;
  half: 0 | 1 | 2;
  heading: string;
  battingTeam: Side;
  bowlingTeam: Side;
  quotaBalls: number;
  bowlerOverLimit: number;
  maxWickets: number;
  target: number | null;
  barredBowlers: string[];
}

/** A plan once the opening batters are chosen. */
export type InningsSpec = InningsPlan & { striker: string; nonStriker: string };

export type EndReason = 'overs' | 'all-out' | 'target';

export interface BatterRow {
  player: Player;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  dismissal: string | null;
  retired: boolean;
}

export interface BowlerRow {
  player: Player;
  legalBalls: number;
  maidens: number;
  runs: number;
  wickets: number;
  wides: number;
  noBalls: number;
}

export interface OverRecord { number: number; bowler: BowlerRow; legalBalls: number; teamRuns: number; charged: number; chips: string[] }

export interface FallOfWicket { wicketNumber: number; teamRuns: number; short: string; label: string }
