import type { Role } from "./roles";

export type RoundStatus = "drafted" | "open" | "closed" | "marked" | "published";
export type RoundKind = "standard" | "picture";

export interface Sheet {
  status: "stored" | "not_stored";
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

export type DisputeStatus = "raised" | "upheld" | "dismissed";

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
  note: "queued" | "sent" | null;
}

export interface TableTeam {
  position: number;
  team_id: number;
  name: string;
  total: number;
  last_round: { round: number; score: number } | null;
}

export interface Table {
  night: number;
  version: number;
  last_published_round: number | null;
  teams: TableTeam[];
}

export interface SessionInfo {
  role: Role;
  team_id: number | null;
  team_name: string | null;
}

export interface RoundsResponse {
  night: number;
  server_time: string;
  rounds: Round[];
}

export type FieldError = "required" | "too_long" | "invalid" | "too_deep";

export interface ErrorBody {
  error: string;
  fields?: Record<string, FieldError>;
  retry_after?: number;
  count?: number;
}
