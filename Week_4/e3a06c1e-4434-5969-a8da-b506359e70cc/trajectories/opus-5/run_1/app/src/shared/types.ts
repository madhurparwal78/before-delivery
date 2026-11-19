export type Role = 'admin' | 'developer' | 'reviewer' | 'approver' | 'billing';
export type Plan = 'pilot' | 'scale';
export type SessionKind = 'live' | 'replay';
export type SessionSource = 'live' | 'tone' | 'upload';
export type SessionState = 'connecting' | 'live' | 'closed' | 'idle_closed' | 'quota_halted' | 'revoked';
export type CloseReason = 'client' | 'disconnect' | 'end_of_audio' | 'cap';
export type BillingState = 'open' | 'not_billable' | 'pending' | 'confirmed';
export type CorrectionState = 'draft' | 'submitted' | 'approved' | 'returned';
export type PlanChangeState = 'requested' | 'confirmed' | 'failed';
export type ConfidenceBand = 'high' | 'medium' | 'low';
export type Voice = 'lumen' | 'basalt';
export type FieldState = 'idle' | 'connecting' | 'live' | 'closed' | 'quota_halted';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  org_id: string;
}

export interface Org {
  id: string;
  name: string;
  slug: string;
  plan: Plan;
}

export interface Quota {
  limit_minutes: number;
  used_seconds: number;
  period_start: string;
  resets_at: string;
  exhausted: boolean;
  server_time: string;
}

export interface ProjectView {
  id: string;
  name: string;
  sessions: number;
  quota: Quota;
}

export interface SessionView {
  id: string;
  project_id: string;
  kind: SessionKind;
  source: SessionSource;
  label: string;
  state: SessionState;
  close_reason: CloseReason | null;
  channels: number;
  sample_rate: 16000;
  audio_ms: number;
  frame: number;
  plan: Plan;
  key_id: string | null;
  started_at: string;
  live_at: string | null;
  ended_at: string | null;
  billable_seconds: number | null;
  billing_state: BillingState;
  flagged_segments: number;
  wer: number | null;
  server_time: string;
}

export interface Word {
  text: string;
  confidence: number;
  start_ms: number;
  end_ms: number;
}

export interface SegmentView {
  id: string;
  index: number;
  start_ms: number;
  end_ms: number;
  flagged: boolean;
  machine: { text: string; words: Word[] };
  reviewed: { text: string; words: Word[]; source: 'machine' | 'correction'; correction_id: string | null };
  open_correction: null | { id: string; state: CorrectionState; author_id: string };
}

export interface CorrectionView {
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

export interface SynthesisJobView {
  id: string;
  project_id: string;
  voice: Voice;
  characters: number;
  duration_ms: number;
  audio_url: string;
  console_audio_url: string;
  created_at: string;
}

export interface KeyView {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  revoked_at: string | null;
}

export interface MemberView {
  id: string;
  name: string;
  email: string;
  role: Role;
  project_ids: string[];
  joined_at: string;
}

export interface InvitationView {
  id: string;
  name: string;
  email: string;
  role: Role;
  project_ids: string[];
  used: false;
}

export interface UsageProject {
  project_id: string;
  name: string;
  sessions: number;
  billable_seconds: number;
  cost_cents: number;
  billing_state: 'confirmed' | 'pending';
  pending_sessions: number;
  by_plan: { plan: Plan; billable_seconds: number; cost_cents: number }[];
}

export interface UsageView {
  month: string;
  billing_reachable: boolean;
  org_total_cents: number;
  projects: UsageProject[];
}

export interface PlanChangeView {
  id: string;
  target: Plan;
  state: PlanChangeState;
  requested_at: string;
  decided_at: string | null;
}

export interface SpectrumView {
  frame: number;
  peak_bin: number;
  rows: number[][];
  mean: number[];
}

export interface ApiErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
}
