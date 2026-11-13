/** The shapes the API publishes, shared by the server and the browser. */

import type { Role } from './desk.js';

export const ROUND_STATUSES = ['drafted', 'open', 'closed', 'marked', 'published'] as const;
export type RoundStatus = (typeof ROUND_STATUSES)[number];

export type RoundKind = 'standard' | 'picture';

export interface Sheet {
  status: 'stored' | 'not_stored';
  key: string | null;
  size: number | null;
  sha256: string | null;
  width: number | null;
  height: number | null;
}

export interface Round {
  number: number;
  title: string;
  kind: RoundKind;
  status: RoundStatus;
  opened_at: string | null;
  closes_at: string | null;
  closed_at: string | null;
  seconds_left: number | null;
  sheet: Sheet | null;
}

export interface Answer {
  id: number;
  round: number;
  team_id: number;
  team_name: string;
  question: number;
  text: string;
  submitted_at: string;
  current: boolean;
  mark: 0 | 1 | null;
  ruled: 0 | 1 | null;
}

export type DisputeStatus = 'raised' | 'upheld' | 'dismissed';

export interface Dispute {
  id: number;
  answer_id: number;
  team_id: number;
  round: number;
  question: number;
  answer_text: string;
  reason: string;
  status: DisputeStatus;
  raised_at: string;
  ruled_at: string | null;
  note: 'queued' | 'sent' | null;
}

export interface TableTeam {
  position: number;
  team_id: number;
  name: string;
  total: number;
  last_round: { round: number; score: number } | null;
}

export interface LeagueTable {
  night: number;
  version: number;
  last_published_round: number | null;
  teams: TableTeam[];
}

export interface SessionBody {
  role: Role;
  team_id: number | null;
  team_name: string | null;
}

export interface RoundsBody {
  night: number;
  server_time: string;
  rounds: Round[];
}

export interface AnswersBody {
  round: number;
  answers: Answer[];
}

export interface AcceptedBody {
  round: number;
  accepted: Answer[];
}

export interface ArchiveBody {
  answers: Answer[];
  limit: number;
  next_cursor: string | null;
  has_more: boolean;
}

export interface SearchBody {
  answers: Answer[];
  count: number;
  truncated: boolean;
}

export interface ApiError {
  error: string;
  fields?: Record<string, 'required' | 'too_long' | 'invalid' | 'too_deep'>;
  retry_after?: number;
  count?: number;
}

export const QUESTIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export const ROUND_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export function roundStatusLabel(status: RoundStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}
