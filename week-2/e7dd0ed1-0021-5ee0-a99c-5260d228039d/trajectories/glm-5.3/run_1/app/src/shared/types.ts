// Shared API response shapes used by the client.
export interface Me {
  user: { id: string; name: string; email: string; operator: boolean };
  memberships: Array<{ workspace: { slug: string; name: string }; role: 'owner' | 'developer' | 'viewer' }>;
}
export interface Region { id: string; name: string; continent: string; lon: number; lat: number }
export interface PlanRow { id: string; name: string; price: string; included_storage_bytes: number; included_egress_bytes: number; storage_overage: string; egress_overage: string; request_units: string }
export interface Bucket { name: string; placement: string[]; created_at: string; object_count: number; stored_bytes: number }
export interface ListItem { key: string; version_id: string; size: number; etag: string; content_type: string; last_modified: string; tags: Record<string, string>; replicas_settled: number; replicas_total: number }
export interface Replica { region: string; role: 'origin' | 'replica'; state: 'pending' | 'settled' | 'failed' | 'superseded'; attempts: number; settled_at: string | null; settle_ms: number | null; error: string | null }
export interface ReplicaState { version_id: string; etag: string; acknowledged_at: string; ready: boolean; replicas: Replica[] }
export interface VersionInfo { version_id: string; etag: string; size: number; created_at: string; current: boolean; noncurrent_since: string | null; retain_until: string | null; legal_hold: boolean }
export interface AccessKey { key_id: string; description: string; permission: string; buckets: string[] | null; prefix: string | null; expires_at: string | null; expired: boolean; state: string; created_at: string; last_used_at: string | null; previous_secret_expires_at: string | null; previous_secret_last_used_at: string | null }
export interface WebhookEndpoint { id: string; url: string; events: string[]; buckets: string[] | null; description: string; state: string; created_at: string }
export interface Delivery { id: string; event_id: string; event_type: string; sequence: number; state: string; attempts: number; last_status: number | null; last_error: string | null; next_attempt_at: string | null; delivered_at: string | null }
export interface ShareLink { id: string; bucket: string; key: string; version_id: string; created_by: string; created_at: string; expires_at: string; state: string }
export interface Member { user_id: string; name: string; email: string; role: string }
export interface Invite { id: string; email: string; role: string; expires_at: string; state: string }
export interface UsageRow { window_start: string; window_end: string; bucket: string; unit: string; amount: string; tracking_id: string; billing_state: string }
export interface UsageView {
  period: string; plan: { id: string; name: string; included_storage_bytes: number; included_egress_bytes: number };
  stored_bytes: number; reserved_bytes: number; quota_bytes: number | null; egress_bytes: number; request_units: number;
  storage_gb_hours: string; percent: { storage: number; egress: number };
  billing: { state: string; unposted_rows: number; confirmed_through: string | null };
}
export interface AuditEntry { seq: number; at: string; actor: string; action: string; target: string; detail: string; hash: string }
export interface EncryptionView { generation: number; rotated_at: string | null; wrapped: Record<string, number> }
export interface SessionRow { id: string; device: string; created_at: string; last_seen_at: string; current: boolean }
export interface OpsRegion { id: string; name: string; state: string; pending: number; failed: number; oldest_pending_ms: number | null }
export interface OpsWorkspace { slug: string; name: string; plan: string; members: number; buckets: number; status: string; suspended_reason: string | null }
