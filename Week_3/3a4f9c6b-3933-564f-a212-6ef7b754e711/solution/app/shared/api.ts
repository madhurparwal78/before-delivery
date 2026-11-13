// The JSON shapes the API answers with (brief: API). Shared by the server and the browser.

export type Role = "platform_engineer" | "service_developer" | "release_manager" | "oncall_sre";

export type PromotionState =
  | "requested" | "awaiting_approval" | "approved" | "rejected" | "expired" | "queued"
  | "window_blocked" | "applying" | "health_wait" | "healthy" | "degraded" | "rolled_back";

export type Phase = "idle" | "queued" | "window_check" | "applying" | "health_wait" | "healthy" | "degraded" | "stopped";

export type StageStatus = "healthy" | "progressing" | "degraded" | "out_of_sync" | "not_deployed";

export type SyncValue = "Synced" | "OutOfSync";
export type HealthValue = "Healthy" | "Progressing" | "Degraded" | "Missing";

interface Person { email: string; name: string }
export interface Counter { in_sync: number; total: number }
export interface Overrides { parameters: Record<string, string>; replicas: Record<string, number> }

export interface DiffEntry {
  resource: string;
  path: string;
  change: "added" | "removed" | "modified";
  before: unknown;
  after: unknown;
}

export interface WindowDecision {
  evaluated_at: string;
  local_time: string;
  open: boolean;
  reason: "open" | "outside_window" | "freeze";
  window: { id: string; label: string } | null;
  freeze: { name: string } | null;
  policy_version: number;
}

export interface Approval {
  state: "pending" | "approved" | "rejected" | "expired";
  request_expires_at: string;
  decided_by: Person | null;
  decided_at: string | null;
  expires_at: string | null;
  comment: string | null;
}

export interface FreezeBreak { by: string; at: string; reason: string }
export interface HistoryEntry { from: PromotionState | null; to: PromotionState; at: string; by: string }

export interface Promotion {
  id: string;
  project: string;
  stage: string;
  cluster: string;
  time_zone: string;
  kind: "promotion" | "rollback";
  state: PromotionState;
  phase: Phase;
  progress: number;
  bundle: { version: string; digest: string; short_digest: string; source_commit: string };
  overrides: Overrides;
  requested_by: Person;
  requested_at: string;
  policy_version: number;
  approval: Approval | null;
  window_decision: WindowDecision | null;
  freeze_break: FreezeBreak | null;
  restores: string | null;
  counter: Counter | null;
  evidence: { stored_snapshots: number; queued_snapshots: number };
  diff: DiffEntry[];
  history: HistoryEntry[];
}

export interface GraphNode {
  stage: string;
  cluster: string;
  time_zone: string;
  upstream: string | null;
  requires_approval: boolean;
  status: StageStatus;
  current: { promotion_id: string; version: string; short_digest: string } | null;
  counter: Counter | null;
  active_promotion: Promotion | null;
  defaults: Overrides;
  last_healthy_at: string | null;
}

export interface GraphEdge { from: string; to: string; phase: Phase; progress: number; reached: number; promotion_id: string | null }

export interface Graph {
  project: { slug: string; name: string };
  role: Role;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Resource { ref: string; kind: string; namespace: string; name: string }

export interface Bundle {
  id: string;
  version: string;
  digest: string;
  short_digest: string;
  source_commit: string;
  resources: Resource[];
  ingested_at: string;
  ingested_by: string;
  verified_in: string[];
}

export interface HealthRow extends Resource { sync: SyncValue; health: HealthValue; updated_at: string }
export interface StageHealth { revision: string | null; in_sync: number; total: number; resources: HealthRow[] }

export type Day = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export const DAYS: readonly Day[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** The 7-character short digest: the first hex characters after `sha256:`. */
export const shortDigest = (digest: string) => digest.slice(7, 14);
export interface SyncWindow { id: string; label: string; days: Day[]; start: string; end: string }
export interface Cluster { name: string; time_zone: string; stages: string[]; windows: SyncWindow[] }

export interface Opening {
  window_id: string;
  label: string;
  opens_at: string;
  closes_at: string;
  local_opens: string;
  local_closes: string;
}

export interface Freeze { name: string; stages: string[]; starts_at: string; ends_at: string }
export interface FreezeVersion { version: number; effective_from: string; created_by: string; created_at: string; freezes: Freeze[] }
export interface FreezePolicy { in_force_version: number; versions: FreezeVersion[] }

export interface ServiceStatus { storage: "up" | "down"; mail: "up" | "down"; queued_uploads: number; queued_notices: number }

export interface SessionBody { user: Person; memberships: { project: string; role: Role }[] }

export interface ApprovalLink {
  project: string;
  stage: string;
  bundle: { version: string; short_digest: string };
  requested_by: Person;
  request_expires_at: string;
  time_zone: string;
  diff: DiffEntry[];
  promotion_id: string;
}

export interface ErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
  holder?: { promotion_id: string; bundle_version: string; bundle_digest: string; state: PromotionState };
  state?: PromotionState;
  current_version?: number;
}
