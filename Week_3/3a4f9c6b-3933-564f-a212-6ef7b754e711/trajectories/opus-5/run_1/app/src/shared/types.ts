export type ProjectRole =
  | 'platform_engineer'
  | 'service_developer'
  | 'release_manager'
  | 'oncall_sre';

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

export type PromotionKind = 'promotion' | 'rollback';

export type RailPhase =
  | 'idle'
  | 'queued'
  | 'window_check'
  | 'applying'
  | 'health_wait'
  | 'healthy'
  | 'degraded'
  | 'stopped';

export type StageStatus = 'healthy' | 'progressing' | 'degraded' | 'out_of_sync' | 'not_deployed';

export type ResourceSync = 'Synced' | 'OutOfSync';
export type ResourceHealth = 'Healthy' | 'Progressing' | 'Degraded' | 'Missing';

export type ApprovalState = 'pending' | 'approved' | 'rejected' | 'expired';

export type WeekDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export type ErrorCode =
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'cross_origin'
  | 'unauthenticated'
  | 'invalid_credentials'
  | 'not_found'
  | 'forbidden'
  | 'request_key_required'
  | 'request_key_reused'
  | 'validation'
  | 'invalid_transition'
  | 'stage_busy'
  | 'not_verified_upstream'
  | 'version_exists'
  | 'evidence_pending'
  | 'approval_expired'
  | 'no_healthy_revision'
  | 'phase_regression'
  | 'promotion_not_running'
  | 'link_expired'
  | 'stale_version'
  | 'storage_unavailable';

export interface Overrides {
  parameters: Record<string, string>;
  replicas: Record<string, number>;
}

export interface DiffEntry {
  resource: string;
  path: string;
  change: 'added' | 'removed' | 'modified';
  before: unknown;
  after: unknown;
}

export interface WindowRef {
  id: string;
  label: string;
}

export interface WindowDecision {
  evaluated_at: string;
  local_time: string;
  open: boolean;
  reason: 'open' | 'outside_window' | 'freeze';
  window: WindowRef | null;
  freeze: { name: string } | null;
  policy_version: number;
}

export interface FreezeBreak {
  by: string;
  at: string;
  reason: string;
}

export interface PromotionCounter {
  in_sync: number;
  total: number;
}

export interface HistoryEntry {
  from: PromotionState | null;
  to: PromotionState | 'requested';
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

export interface PromotionBundleRef {
  version: string;
  digest: string;
  short_digest: string;
  source_commit: string;
}

export interface Promotion {
  id: string;
  project: string;
  stage: string;
  cluster: string;
  time_zone: string;
  kind: PromotionKind;
  state: PromotionState;
  phase: RailPhase;
  progress: number;
  bundle: PromotionBundleRef;
  overrides: Overrides;
  requested_by: { email: string; name: string };
  requested_at: string;
  policy_version: number;
  approval: PromotionApproval | null;
  window_decision: WindowDecision | null;
  freeze_break: FreezeBreak | null;
  restores: string | null;
  counter: PromotionCounter | null;
  evidence: { stored_snapshots: number; queued_snapshots: number };
  diff: DiffEntry[];
  history: HistoryEntry[];
}

export interface BundleResource {
  ref: string;
  kind: string;
  namespace: string;
  name: string;
}

export interface Bundle {
  id: string;
  version: string;
  digest: string;
  short_digest: string;
  source_commit: string;
  resources: BundleResource[];
  ingested_at: string;
  ingested_by: string;
  verified_in: string[];
}

export interface GraphNode {
  stage: string;
  cluster: string;
  time_zone: string;
  upstream: string | null;
  requires_approval: boolean;
  defaults: Overrides;
  status: StageStatus;
  current: { promotion_id: string; version: string; short_digest: string } | null;
  counter: PromotionCounter | null;
  active_promotion: Promotion | null;
}

export interface GraphEdge {
  from: string;
  to: string;
  phase: RailPhase;
  progress: number;
  promotion_id: string | null;
}

export interface GraphResponse {
  project: { slug: string; name: string };
  role: ProjectRole;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface StatusResponse {
  storage: 'up' | 'down';
  mail: 'up' | 'down';
  queued_uploads: number;
  queued_notices: number;
}

export interface SessionResponse {
  user: { email: string; name: string };
  memberships: { project: string; role: ProjectRole }[];
}

export interface SyncWindow {
  id: string;
  label: string;
  days: WeekDay[];
  start: string;
  end: string;
}

export interface ClusterView {
  name: string;
  time_zone: string;
  stages: string[];
  windows: SyncWindow[];
}

export interface WindowOpening {
  window_id: string;
  label: string;
  opens_at: string;
  closes_at: string;
  local_opens: string;
  local_closes: string;
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

export interface FreezePolicyResponse {
  in_force_version: number;
  versions: FreezePolicyVersion[];
}

export interface HealthRow {
  ref: string;
  kind: string;
  namespace: string;
  name: string;
  sync: ResourceSync;
  health: ResourceHealth;
  updated_at: string;
}

export interface StageHealthResponse {
  revision: string | null;
  in_sync: number;
  total: number;
  resources: HealthRow[];
}

export interface ApprovalLinkResponse {
  project: string;
  stage: string;
  bundle: { version: string; short_digest: string };
  requested_by: string;
  request_expires_at: string;
  time_zone: string;
  diff: DiffEntry[];
  promotion_id: string;
}
