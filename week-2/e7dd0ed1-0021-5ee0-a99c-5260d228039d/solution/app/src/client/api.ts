// The JSON API as the browser sees it (brief: Backend, API). One fetch path, one error type.

export type Role = "owner" | "developer" | "viewer";

export interface Region {
  id: string;
  name: string;
  continent: string;
  lon: number;
  lat: number;
}

export interface Membership {
  workspace: { slug: string; name: string };
  role: Role;
}

export interface Me {
  user: { id: string; name: string; email: string; operator: boolean };
  memberships: Membership[];
}

export interface Bucket {
  name: string;
  placement: string[];
  created_at: string;
  object_count: number;
  stored_bytes: number;
}

interface ObjectItem {
  key: string;
  version_id: string;
  size: number;
  etag: string;
  content_type: string;
  last_modified: string;
  tags: Record<string, string>;
  replicas_settled: number;
  replicas_total: number;
}

export interface ObjectPage {
  items: ObjectItem[];
  common_prefixes: string[];
  next_cursor: string | null;
  truncated: boolean;
}

export interface SearchItem {
  bucket: string;
  key: string;
  size: number;
  last_modified: string;
}

export interface ObjectMeta {
  key: string;
  version_id: string;
  etag: string;
  size: number;
  content_type: string;
  last_modified: string;
  metadata: Record<string, string>;
  tags: Record<string, string>;
}

export type ReplicaState = "pending" | "settled" | "failed" | "superseded";

export interface Replica {
  region: string;
  role: "origin" | "replica";
  state: ReplicaState;
  attempts: number;
  settled_at: string | null;
  settle_ms: number | null;
  error: "etag_mismatch" | "region_offline" | "copy_failed" | null;
}

export interface ReplicaRecord {
  version_id: string;
  replicas: Replica[];
}

export interface StoredObject extends ReplicaRecord {
  bucket: string;
  key: string;
  etag: string;
  size: number;
}

export interface Version {
  version_id: string;
  etag: string;
  size: number;
  created_at: string;
  current: boolean;
  noncurrent_since: string | null;
  retain_until: string | null;
  legal_hold: boolean;
}

export interface LockState {
  version_id: string;
  retain_until: string | null;
  legal_hold: boolean;
  locked: boolean;
}

export interface LifecycleRules {
  noncurrent_days: number | null;
  keep_newest_noncurrent: number;
  abort_multipart_days: number | null;
}

export interface DeleteBatch {
  batch_id: string | null;
  undo_until: string | null;
  results: { key: string; outcome: "deleted" | "not_found"; version_id: string | null }[];
}

export interface UndoResult {
  batch_id: string;
  state: "undone";
  results: { key: string; outcome: "restored" | "newer_version" | "gone"; version_id: string | null }[];
}

export interface ShareLink {
  id: string;
  url?: string;
  bucket: string;
  key: string;
  version_id: string;
  created_by?: string;
  expires_at: string;
  state: "active" | "expired" | "revoked";
}

export interface Member {
  user_id: string;
  name: string;
  email: string;
  role: Role;
}

export interface Invite {
  id: string;
  email: string;
  role: "developer" | "viewer";
  expires_at: string;
  state: "pending" | "accepted" | "expired" | "replaced";
}

export interface InviteInfo {
  workspace: { slug: string; name: string };
  email: string;
  role: "developer" | "viewer";
  expires_at: string;
  existing_account: boolean;
}

export interface AccessKey {
  key_id: string;
  description: string;
  permission: "read" | "read-write";
  buckets: string[] | null;
  prefix: string | null;
  expires_at: string | null;
  expired: boolean;
  state: "active" | "disabled";
  created_at: string;
  last_used_at: string | null;
  previous_secret_expires_at: string | null;
  secret?: string;
}

export interface TwoStepState {
  enabled: boolean;
  enabled_at: string | null;
  recovery_codes_left: number;
}

export interface SessionRow {
  id: string;
  device: string;
  created_at: string;
  last_seen_at: string;
  current: boolean;
}

export interface Encryption {
  generation: number;
  rotated_at: string | null;
  wrapped: Record<string, number>;
}

export interface AuditEntry {
  seq: number;
  at: string;
  actor: string;
  action: string;
  target: string;
  detail: string;
  hash: string;
}

export const WEBHOOK_EVENTS = ["object.created", "object.deleted", "object.restored", "version.removed"] as const;

export interface Endpoint {
  id: string;
  url: string;
  events: string[];
  buckets: string[] | null;
  description: string;
  state: "active" | "disabled";
  created_at: string;
  secret?: string;
}

export interface Delivery {
  id: string;
  event_type: string;
  sequence: number;
  state: "pending" | "delivered" | "dead";
  attempts: number;
  last_status: number | null;
  last_error: "http_status" | "timeout" | "connection_failed" | null;
  next_attempt_at: string | null;
  delivered_at: string | null;
}

export interface Usage {
  plan: { id: string; name: string; included_storage_bytes: number; included_egress_bytes: number };
  stored_bytes: number;
  reserved_bytes: number;
  egress_bytes: number;
  request_units: number;
  percent: { storage: number; egress: number };
  billing: { state: "in_sync" | "pending" | "delayed"; unposted_rows: number; confirmed_through: string | null };
}

export interface UsageRow {
  window_start: string;
  window_end: string;
  bucket: string;
  unit: string;
  amount: string;
  tracking_id: string;
  billing_state: "open" | "queued" | "posted";
}

export interface OpsRegion {
  id: string;
  name: string;
  state: "online" | "offline";
  pending: number;
  failed: number;
  oldest_pending_ms: number | null;
}

export interface OpsWorkspace {
  slug: string;
  name: string;
  plan: string;
  members: number;
  buckets: number;
  status: "active" | "suspended";
  suspended_reason: string | null;
}

export interface OpsBilling {
  state: "in_sync" | "pending" | "delayed";
  queued_rows: number;
  posted_rows: number;
  last_attempt_at: string | null;
  last_error: string | null;
}

export interface ErrorBody {
  error: string;
  message: string;
  errors?: Record<string, string>;
  retry_after_seconds?: number;
  from?: string;
  to?: string;
  quota_bytes?: number;
  current_etag?: string;
  retain_until?: string | null;
  legal_hold?: boolean;
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: ErrorBody) {
    super(body.message);
  }

  get code(): string {
    return this.body.error;
  }
}

export const MUTATION_HEADERS = { "X-Requested-With": "farshore" } as const;

export function signInUrl(): string {
  return "/signin?next=" + encodeURIComponent(location.pathname + location.search);
}

type Body = Record<string, unknown> | undefined;

// The step-up confirmation dialog registers itself here; it answers whether the user confirmed.
let confirmStepUp: (() => Promise<boolean>) | null = null;
export function onStepUp(handler: (() => Promise<boolean>) | null): void {
  confirmStepUp = handler;
}

const STEP_UP_CANCELLED = "Nothing changed. Confirmation was cancelled.";

// Every JSON call. A lost or half-signed-in session sends the browser to sign-in, which comes back here.
// A step_up_required answer asks the user to confirm, then sends the same request once more.
export async function api<T>(method: string, path: string, body?: Body, headers: Record<string, string> = {}): Promise<T> {
  const sent: Record<string, string> = { ...headers };
  if (method !== "GET") Object.assign(sent, MUTATION_HEADERS);
  if (body !== undefined) sent["Content-Type"] = "application/json";
  const response = await fetch(path, { method, headers: sent, body: body === undefined ? undefined : JSON.stringify(body) });
  if (response.status === 204) return undefined as T;
  const parsed: unknown = await response.json();
  if (response.ok) return parsed as T;
  const error = new ApiError(response.status, parsed as ErrorBody);
  if (error.code === "unauthenticated" || error.code === "two_step_required") location.assign(signInUrl());
  if (error.code === "step_up_required" && confirmStepUp) {
    if (await confirmStepUp()) return api<T>(method, path, body, headers);
    throw new ApiError(403, { error: "step_up_cancelled", message: STEP_UP_CANCELLED });
  }
  throw error;
}

export function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) if (value !== undefined) search.set(name, value);
  const text = search.toString();
  return text ? `?${text}` : "";
}

export function retryAfter(error: ApiError): number {
  return error.body.retry_after_seconds ?? 1;
}

let regionsLoad: Promise<Region[]> | null = null;

export function loadRegions(): Promise<Region[]> {
  regionsLoad ??= api<{ regions: Region[] }>("GET", "/api/regions").then((r) => r.regions);
  return regionsLoad;
}
