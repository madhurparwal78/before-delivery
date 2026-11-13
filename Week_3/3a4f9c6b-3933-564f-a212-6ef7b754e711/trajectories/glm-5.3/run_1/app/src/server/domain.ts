// Domain types shared across the server. Named after the brief's domain terms.

export type Role = 'platform_engineer' | 'service_developer' | 'release_manager' | 'oncall_sre';

export type PromotionKind = 'promotion' | 'rollback';

export type PromotionState =
  | 'requested'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'queued'
  | 'window_blocked'
  | 'applying'
  | 'health_wait'
  | 'healthy'
  | 'degraded'
  | 'rolled_back';

export type ActivePromotionState = Extract<
  PromotionState,
  'requested' | 'awaiting_approval' | 'approved' | 'queued' | 'window_blocked' | 'applying' | 'health_wait'
>;

export const ACTIVE_PROMOTION_STATES: readonly PromotionState[] = [
  'requested', 'awaiting_approval', 'approved', 'queued', 'window_blocked', 'applying', 'health_wait',
];

export type ApprovalState = 'pending' | 'approved' | 'rejected' | 'expired';

export type StageStatus = 'healthy' | 'progressing' | 'degraded' | 'out_of_sync' | 'not_deployed';

export type RailPhase =
  | 'idle'
  | 'queued'
  | 'window_check'
  | 'applying'
  | 'health_wait'
  | 'healthy'
  | 'degraded'
  | 'stopped';

export type SyncValue = 'Synced' | 'OutOfSync';
export type HealthValue = 'Healthy' | 'Progressing' | 'Degraded' | 'Missing';

export interface Decision {
  evaluated_at: string;
  local_time: string;
  open: boolean;
  reason: 'open' | 'outside_window' | 'freeze';
  window: { id: string; label: string } | null;
  freeze: { name: string } | null;
  policy_version: number;
}

export interface BundleRef {
  ref: string;
  kind: string;
  namespace: string;
  name: string;
}

export interface Overrides {
  parameters: Record<string, string>;
  replicas: Record<string, number>;
}

export interface DiffEntry {
  resource: string;
  path: string;
  change: 'added' | 'removed' | 'modified';
  before: string | null;
  after: string | null;
}

export interface HistoryEntry {
  from: PromotionState | null;
  to: PromotionState;
  at: string;
  by: string;
}

export interface HealthTimelineEntry {
  at: string;
  phase: 'applying' | 'health_wait';
  in_sync: number;
  total: number;
}

export interface PromotionApproval {
  state: ApprovalState;
  request_expires_at: string;
  decided_by: string | null;
  decided_at: string | null;
  expires_at: string | null;
  comment: string | null;
}

export interface PromotionView {
  id: string;
  project: string;
  stage: string;
  cluster: string;
  time_zone: string;
  kind: PromotionKind;
  state: PromotionState;
  phase: RailPhase;
  progress: number;
  bundle: { version: string; digest: string; short_digest: string; source_commit: string };
  overrides: Overrides;
  requested_by: { email: string; name: string };
  requested_at: string;
  policy_version: number;
  approval: PromotionApproval | null;
  window_decision: Decision | null;
  freeze_break: { by: string; at: string; reason: string } | null;
  restores: string | null;
  counter: { in_sync: number; total: number } | null;
  evidence: { stored_snapshots: number; queued_snapshots: number };
  diff: DiffEntry[];
  history: HistoryEntry[];
}

// A health row as persisted per promotion revision.
export interface HealthRow {
  ref: string;
  sync: SyncValue;
  health: HealthValue;
  updated_at: string;
}

export interface GraphNode {
  stage: string;
  cluster: string;
  time_zone: string;
  upstream: string | null;
  requires_approval: boolean;
  status: StageStatus;
  current: { promotion_id: string; version: string; short_digest: string } | null;
  counter: { in_sync: number; total: number } | null;
  active_promotion: PromotionView | null;
}

export interface GraphEdge {
  from: 'bundles' | string;
  to: string;
  phase: RailPhase;
  progress: number;
  promotion_id: string | null;
}

export interface SyncWindow {
  id: string;
  label: string;
  days: string[];
  start: string;
  end: string;
}

export interface Freeze {
  name: string;
  stages: string[];
  starts_at: string;
  ends_at: string;
}

export interface FreezePolicyVersion {
  version: number;
  effective_from: string;
  created_by: string;
  created_at: string;
  freezes: Freeze[];
}

export interface PersonRef {
  email: string;
  name: string;
}

export interface Membership {
  project: string;
  role: Role;
}
