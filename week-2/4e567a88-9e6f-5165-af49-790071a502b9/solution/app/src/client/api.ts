// The browser's API client: same-origin JSON over the session cookie, and the shapes the API returns.

import type { InputSchema } from "../shared/schema";
import type { Unit } from "../shared/units";

export type Role = "member" | "admin" | "finance" | "compliance";
export type JobStatus = "queued" | "leased" | "running" | "succeeded" | "failed" | "cancelled";
export type Access = "allowed" | "blocked";
export type TeamAccess = Access | "inherit";

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  team_id: string | null;
}

export interface Team {
  id: string;
  name: string;
}

export interface Model {
  slug: string;
  name: string;
  modality: "image" | "video" | "audio";
  unit: Unit;
  unit_label: string;
  input_schema: InputSchema;
  current_rate: { id: string; micro_per_unit: number; effective_at: string };
  access: { api: Access; playground: Access } | null;
}

export interface Job {
  id: string;
  team_id: string;
  model: string;
  status: JobStatus;
  priority: "high" | "normal" | "low";
  submitted_by: { id: string; name: string };
  submitted_at: string;
  started_at: string | null;
  finished_at: string | null;
  attempts: number;
  failure_reason: string | null;
  waiting_reason: string | null;
  queue_position: number | null;
  rate: { id: string; micro_per_unit: number };
  unit: Unit;
  estimated_units: string;
  billed_units: string | null;
  reserved_micro: number;
  charged_micro: number | null;
  released_micro: number;
  outputs: string[];
  payload_visible: boolean;
  input?: Record<string, string | number>;
  input_assets?: string[];
}

export interface InFlight {
  job_id: string;
  status: JobStatus;
  reserved_micro: number;
  estimated_units: string;
  unit: Unit;
}

export type CapState = "under" | "soft_cap_passed" | "hard_cap_reached";

export interface MeterSnapshot {
  team_id: string;
  granted_micro: number;
  available_micro: number;
  reserved_micro: number;
  settled_micro: number;
  in_flight: InFlight[];
  recent_replays: { job_id: string; at: string }[];
  period: {
    label: string;
    starts_at: string;
    ends_at: string;
    spend_micro: number;
    soft_cap_micro: number;
    hard_cap_micro: number;
    soft_cap_offset_micro: number;
  };
  cap_state: CapState;
}

export interface Asset {
  id: string;
  team_id: string;
  kind: "upload" | "output";
  media_type: string;
  job_id: string | null;
  model: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  bytes: number;
  created_at: string;
  expires_at: string;
  url?: string;
  prompt?: string;
  derived_from?: string[];
}

export type LineageNode =
  | {
    id: string;
    state: "live";
    media_type: string;
    model: string | null;
    job_id: string | null;
    created_at: string;
    thumbnail_url?: string;
    prompt?: string;
  }
  | { id: string; state: "tombstone"; removed_at: string; reason: "deleted" | "expired" };

export interface Lineage {
  nodes: LineageNode[];
  edges: { from: string; to: string }[];
}

export interface Topup {
  id: string;
  team_id: string;
  credits: number;
  amount_usd: string;
  status: "pending" | "paid" | "failed";
  pending_reason: string | null;
  failure_reason: string | null;
  kb_account_id: string | null;
  kb_invoice_id: string | null;
  kb_payment_id: string | null;
  created_by: { id: string; name: string } | string;
  created_at: string;
  paid_at: string | null;
}

export interface Movement {
  id: string;
  kind: string;
  created_at: string;
  job_id: string | null;
  topup_id: string | null;
  kb_invoice_id: string | null;
  entries: { account: string; amount_micro: number }[];
}

export interface Rate {
  id: string;
  micro_per_unit: number;
  effective_at: string;
  effective_at_local: string;
  status: "past" | "current" | "scheduled";
  created_by: { id: string; name: string } | string | null;
}

export interface Endpoint {
  id: string;
  team_id: string;
  url: string;
  state: "active" | "failing" | "disabled";
  consecutive_failures: number;
  created_by: { id: string; name: string } | string;
  created_at: string;
  secret?: string;
}

export interface Delivery {
  event_id: string;
  event_type: string;
  job_id: string;
  attempt: number;
  attempted_at: string;
  status_code: number | null;
  outcome: "delivered" | "failed" | "skipped_disabled";
  next_attempt_at: string | null;
}

export interface TeamPolicy {
  id: string;
  name: string;
  concurrency: number;
  payload_visibility: "team" | "restricted";
  soft_cap_credits: number;
  hard_cap_credits: number;
  context_defaults: { api: TeamAccess; playground: TeamAccess };
  model_access: Record<string, { api: TeamAccess; playground: TeamAccess }>;
}

export interface Policy {
  version: number;
  timezone: string;
  retention_days: number;
  org_model_access: Record<string, { api: Access; playground: Access }>;
  teams: TeamPolicy[];
}

interface ErrorBody {
  code: string;
  message: string;
  fields?: Record<string, string>;
  /** On asset_gone. */
  removed_at?: string;
  reason?: "deleted" | "expired";
  [extra: string]: unknown;
}

/** A refusal from the API: its status and the one published error shape. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly body: ErrorBody) {
    super(body.message);
  }
}

interface Reply<T> {
  status: number;
  data: T;
  headers: Headers;
}

/** Milliseconds to add to the browser clock to read the server's clock (from the Date header). */
let skew = 0;
export const serverNow = (): number => Date.now() + skew;

function noteClock(headers: Headers): void {
  const stamp = headers.get("date");
  if (stamp) {
    const at = Date.parse(stamp);
    if (!Number.isNaN(at)) skew = at - Date.now();
  }
}

interface RequestOptions {
  body?: unknown;
  raw?: Blob;
  headers?: Record<string, string>;
}

/** Throws ApiError on a non-2xx answer and lets a network failure (TypeError) through. */
export async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<Reply<T>> {
  const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
  let body: BodyInit | undefined;
  if (options.raw) body = options.raw;
  else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const response = await fetch(path, { method, headers, body, credentials: "same-origin" });
  noteClock(response.headers);
  const text = response.status === 204 ? "" : await response.text();
  const parsed: unknown = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = (parsed as { error?: ErrorBody } | null)?.error ?? { code: "http_error", message: response.statusText };
    throw new ApiError(response.status, error);
  }
  return { status: response.status, data: parsed as T, headers: response.headers };
}

export async function get<T>(path: string): Promise<T> {
  return (await request<T>("GET", path)).data;
}

export const query = (params: Record<string, string | undefined>): string => {
  const pairs = Object.entries(params).filter((p): p is [string, string] => p[1] !== undefined && p[1] !== "");
  return pairs.length ? `?${new URLSearchParams(pairs).toString()}` : "";
};

/** Asks every live view (meter, queue, lists) to poll now instead of waiting for its next tick. */
export function refreshAll(): void {
  window.dispatchEvent(new Event("dispatch:refresh"));
}
