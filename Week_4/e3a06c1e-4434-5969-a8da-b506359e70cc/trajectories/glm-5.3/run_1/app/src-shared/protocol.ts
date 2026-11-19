// Shared API object shapes and message contracts used by both server and browser.

export type Role = 'admin' | 'developer' | 'reviewer' | 'approver' | 'billing';

export type SessionState = 'connecting' | 'live' | 'closed' | 'idle_closed' | 'quota_halted' | 'revoked';
export type CloseReason = 'client' | 'disconnect' | 'end_of_audio' | 'cap' | null;
export type BillingState = 'open' | 'not_billable' | 'pending' | 'confirmed';
export type Source = 'live' | 'tone' | 'upload';

export type Quota = {
  limit_minutes: number;
  used_seconds: number;
  period_start: string;
  resets_at: string;
  exhausted: boolean;
  server_time: string;
};

export type Session = {
  id: string;
  project_id: string;
  kind: 'live' | 'replay';
  source: Source;
  label: string;
  state: SessionState;
  close_reason: CloseReason;
  channels: number;
  sample_rate: 16000;
  audio_ms: number;
  frame: number;
  plan: 'pilot' | 'scale';
  key_id: string;
  started_at: string;
  live_at: string | null;
  ended_at: string | null;
  billable_seconds: number | null;
  billing_state: BillingState;
  flagged_segments: number;
  wer: number | null;
  server_time: string;
};

export type Word = { text: string; confidence: number; start_ms: number; end_ms: number };

export type Segment = {
  id: string;
  index: number;
  start_ms: number;
  end_ms: number;
  flagged: boolean;
  machine: { text: string; words: Word[] };
  reviewed: { text: string; words: Word[]; source: 'machine' | 'correction'; correction_id: string | null };
  open_correction: { id: string; state: string; author_id: string } | null;
};

export type Correction = {
  id: string;
  session_id: string;
  segment_id: string;
  author: { id: string; name: string };
  state: 'draft' | 'submitted' | 'approved' | 'returned';
  text: string;
  note: string | null;
  created_at: string;
  submitted_at: string | null;
  decided_at: string | null;
  decided_by: string | null;
};

export type SynthesisJob = {
  id: string;
  project_id: string;
  voice: 'lumen' | 'basalt';
  characters: number;
  duration_ms: number;
  audio_url: string;
  console_audio_url: string;
  created_at: string;
};

export type ProjectSummary = { id: string; name: string; sessions: number; quota: Quota };

export type Member = { id: string; name: string; email: string; role: Role; project_ids: string[]; joined_at: string | null };

export type Invitation = { id: string; name: string; email: string; role: Role; project_ids: string[]; used: boolean };

export type ApiKeySummary = { id: string; name: string; prefix: string; created_at: string; revoked_at: string | null };

export type User = { id: string; name: string; email: string; role: Role; org_id: string };

export type PlanChange = { id: string; target: 'pilot' | 'scale'; state: 'requested' | 'confirmed' | 'failed'; requested_at: string; decided_at: string | null };

export type ApiError = { error: string; message: string; fields?: Record<string, string> };

export type SessionEvent =
  | { type: 'state'; state: SessionState; close_reason: CloseReason; session?: Session; quota?: Quota }
  | { type: 'frame'; frame: number; audio_ms: number; peak_bin: number; bins: number[] }
  | { type: 'segment'; segment: Segment }
  | { type: 'correction'; segment: Segment; wer: number }
  | { type: 'quota'; quota: Quota };

export type SpectrumResponse = { frame: number; peak_bin: number; rows: number[][]; mean: number[] };

export type TranscriptResponse = { segments: Segment[]; wer: number | null };

export type UsageProject = {
  project_id: string;
  name: string;
  sessions: number;
  billable_seconds: number;
  cost_cents: number;
  billing_state: 'confirmed' | 'pending';
  pending_sessions: number;
  by_plan: { plan: 'pilot' | 'scale'; billable_seconds: number; cost_cents: number }[];
};

export type UsageResponse = {
  month: string;
  billing_reachable: boolean;
  org_total_cents: number;
  projects: UsageProject[];
};

export type PlanResponse = { plan: 'pilot' | 'scale'; billing_reachable: boolean; change: PlanChange | null };
