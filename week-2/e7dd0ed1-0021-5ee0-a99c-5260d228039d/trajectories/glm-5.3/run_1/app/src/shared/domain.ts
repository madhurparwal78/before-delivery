// Domain constants shared across server and client.
export const DAY = 86_400;
export const PLAN = {
  sandbox: {
    id: 'sandbox', name: 'Sandbox', price: '$0.00',
    included_storage_bytes: 1_000_000, included_egress_bytes: 2_000_000,
    storage_overage: 'none', egress_overage: 'none', request_units: 'none',
    kb_plan_id: 'farshore-sandbox-monthly',
  },
  indie: {
    id: 'indie', name: 'Indie', price: '$19.00',
    included_storage_bytes: 50_000_000_000, included_egress_bytes: 100_000_000_000,
    storage_overage: '$0.006 per GB-month, billed by the GB-hour',
    egress_overage: '$0.010 per GB',
    request_units: '$0.40 per million',
    kb_plan_id: 'farshore-indie-monthly',
  },
} as const;

export type PlanId = 'sandbox' | 'indie';
export type Role = 'owner' | 'developer' | 'viewer';
export type ReplicaState = 'pending' | 'settled' | 'failed' | 'superseded';
export type ReplicaRole = 'origin' | 'replica';
export type ReplicaError = 'etag_mismatch' | 'region_offline' | 'copy_failed' | null;
export type VersionState = 'current' | 'noncurrent' | 'removed';
export type AccessKeyState = 'active' | 'disabled';
export type LinkState = 'active' | 'revoked' | 'expired';
export type InviteState = 'pending' | 'accepted' | 'expired' | 'replaced';
export type DeliveryState = 'pending' | 'delivered' | 'dead';
export type WorkspaceStatus = 'active' | 'suspended';

export interface ReplicaRecord {
  region: string; role: ReplicaRole; state: ReplicaState;
  attempts: number; settled_at: string | null; settle_ms: number | null; error: ReplicaError;
}
