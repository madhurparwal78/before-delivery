import type { Bracket, Fill, Format, MatchState, TournamentState, Winner } from '../../shared/api.js';

export type Side = 'upper' | 'lower';
export type Slot = { kind: 'tbd' } | { kind: 'bye' } | { kind: 'entrant'; entrantId: string };
export interface Feed { matchId: string; slot: Side }

export interface Report {
  entrantId: string;
  by: string;
  upper: number;
  lower: number;
  reportedAt: number;
  autoConfirmAt: number;
}

export interface Dispute {
  entrantId: string;
  by: string;
  upper: number;
  lower: number;
  disputedAt: number;
}

export interface Match {
  id: string;
  tournamentId: string;
  bracket: Bracket;
  round: number;
  number: number;
  label: string;
  upper: Slot;
  lower: Slot;
  state: MatchState;
  winner: Winner | null;
  upperGames: number | null;
  lowerGames: number | null;
  report: Report | null;
  dispute: Dispute | null;
  calledAt: number | null;
  overdue: boolean;
  version: number;
  updatedBy: string;
  resolvedBy: string | null;
  pairedAt: number | null;
  winnerTo: Feed | null;
  loserTo: Feed | null;
}

export interface Entrant {
  id: string;
  tournamentId: string;
  name: string;
  seed: number;
  userId: string | null;
  username: string | null;
  checkedIn: boolean;
}

export interface Tournament {
  id: string;
  name: string;
  format: Format;
  timeZone: string;
  fill: Fill;
  state: TournamentState;
  organizerId: string;
  organizerUsername: string;
  shareCode: string;
  checkinClosesAt: number | null;
  fieldSize: number | null;
  swissRounds: number | null;
  seedingVersion: number;
  liveSeq: number;
  seedingUpdatedBy: string | null;
  logoKey: string | null;
  logoSha: string | null;
  rosterKey: string | null;
  rosterName: string | null;
  createdAt: number;
  finishedAt: number | null;
}

export interface MatchRef { bracket: Bracket; round: number }

// What a change did to the field, in the order it happened; announcements are written from these.
export type DrawEvent =
  | { kind: 'advance'; name: string; to: MatchRef }
  | { kind: 'drop'; name: string; to: MatchRef }
  | { kind: 'reset_needed' }
  | { kind: 'champion'; name: string };

export interface Draw {
  tournament: Tournament;
  entrants: Entrant[];
  matches: Match[];
  byId: Map<string, Match>;
  entrantById: Map<string, Entrant>;
  now: number;
  actor: string;
  changed: Map<string, number>;
  created: Set<string>;
  events: DrawEvent[];
  finished: boolean;
}

export const isElimination = (format: Format): boolean => format === 'single_elimination' || format === 'double_elimination';
export { isDecided } from '../../shared/rules.js';
