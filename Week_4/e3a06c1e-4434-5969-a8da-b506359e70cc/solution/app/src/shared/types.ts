import type { Plan } from "./billing";

export type Role = "admin" | "developer" | "reviewer" | "approver" | "billing";
export const ROLES: readonly Role[] = ["admin", "developer", "reviewer", "approver", "billing"];

export type SessionState = "connecting" | "live" | "closed" | "idle_closed" | "quota_halted" | "revoked";
export type CloseReason = "client" | "disconnect" | "end_of_audio" | "cap";
type BillingState = "open" | "not_billable" | "pending" | "confirmed";
export type CorrectionState = "draft" | "submitted" | "approved" | "returned";
/** A segment has at most one correction in one of these states. */
export const OPEN_CORRECTION_STATES: readonly CorrectionState[] = ["draft", "submitted", "returned"];
type PlanChangeState = "requested" | "confirmed" | "failed";
export type Voice = "lumen" | "basalt";

export const ENDED_STATES: readonly SessionState[] = ["closed", "idle_closed", "quota_halted", "revoked"];

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  org_id: string;
}

export interface Me {
  user: User;
  org: { id: string; name: string; slug: string; plan: Plan };
  project_ids: string[];
}

export interface Quota {
  limit_minutes: number;
  used_seconds: number;
  period_start: string;
  resets_at: string;
  exhausted: boolean;
  server_time: string;
}

export interface Project {
  id: string;
  name: string;
  quota: Quota;
  sessions: number;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  revoked_at: string | null;
}

export interface Session {
  id: string;
  project_id: string;
  kind: "live" | "replay";
  source: "live" | "tone" | "upload";
  label: string;
  state: SessionState;
  close_reason: CloseReason | null;
  channels: number;
  sample_rate: 16000;
  audio_ms: number;
  frame: number;
  plan: Plan;
  key_id: string;
  started_at: string;
  live_at: string | null;
  ended_at: string | null;
  billable_seconds: number | null;
  billing_state: BillingState;
  flagged_segments: number;
  wer: number | null;
  mean: number[];
  server_time: string;
}

export interface Word {
  text: string;
  confidence: number;
  start_ms: number;
  end_ms: number;
}

export interface Segment {
  id: string;
  index: number;
  start_ms: number;
  end_ms: number;
  flagged: boolean;
  machine: { text: string; words: Word[] };
  reviewed: { text: string; words: Word[]; source: "machine" | "correction"; correction_id: string | null };
  open_correction: { id: string; state: CorrectionState; author_id: string } | null;
}

export interface Correction {
  id: string;
  session_id: string;
  segment_id: string;
  author: { id: string; name: string };
  state: CorrectionState;
  text: string;
  note: string | null;
  created_at: string;
  submitted_at: string | null;
  decided_at: string | null;
  decided_by: string | null;
}

export interface Spectrum {
  frame: number;
  peak_bin: number;
  rows: number[][];
  mean: number[];
}

export interface FrameEvent {
  frame: number;
  audio_ms: number;
  peak_bin: number;
  bins: number[];
}

export interface SynthesisJob {
  id: string;
  project_id: string;
  voice: Voice;
  characters: number;
  duration_ms: number;
  audio_url: string;
  console_audio_url: string;
  created_at: string;
}

interface UsageProject {
  project_id: string;
  name: string;
  sessions: number;
  billable_seconds: number;
  cost_cents: number;
  billing_state: "confirmed" | "pending";
  pending_sessions: number;
  by_plan: { plan: Plan; billable_seconds: number; cost_cents: number }[];
}

export interface Usage {
  month: string;
  billing_reachable: boolean;
  org_total_cents: number;
  projects: UsageProject[];
}

interface PlanChange {
  id: string;
  target: Plan;
  state: PlanChangeState;
  requested_at: string;
  decided_at: string | null;
}

export interface OrgPlan {
  plan: Plan;
  billing_reachable: boolean;
  change: PlanChange | null;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  project_ids: string[];
  joined_at: string;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
}
