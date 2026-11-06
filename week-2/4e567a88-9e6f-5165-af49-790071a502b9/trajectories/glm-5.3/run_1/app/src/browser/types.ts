// Shared browser types matching the published API shapes.
export type Role = "member" | "admin" | "finance" | "compliance";
export type Modality = "image" | "video" | "audio";

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  team_id: string | null;
}

export interface TeamRef {
  id: string;
  name: string;
}

export interface SchemaField {
  name: string;
  type: "string" | "integer" | "enum" | "media";
  title: string;
  description: string;
  required: boolean;
  default: string | number | null;
  min_length?: number;
  max_length?: number;
  minimum?: number;
  maximum?: number;
  enum?: (string | number)[];
  media_type?: "image";
}

export interface Model {
  slug: string;
  name: string;
  modality: Modality;
  unit: string;
  unit_label: string;
  input_schema: SchemaField[];
  current_rate: { id: string; micro_per_unit: number; effective_at: string };
  access: { api: string; playground: string } | null;
}

export interface Job {
  id: string;
  team_id: string;
  model: string;
  status: "queued" | "leased" | "running" | "succeeded" | "failed" | "cancelled";
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
  unit: string;
  estimated_units: string;
  billed_units: string | null;
  reserved_micro: number;
  charged_micro: number | null;
  released_micro: number;
  outputs: string[];
  payload_visible: boolean;
  input?: Record<string, unknown>;
  input_assets?: string[];
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

export interface Meter {
  team_id: string;
  granted_micro: number;
  available_micro: number;
  reserved_micro: number;
  settled_micro: number;
  in_flight: { job_id: string; status: string; reserved_micro: number; estimated_units: string; unit: string }[];
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
  cap_state: "under" | "soft_cap_passed" | "hard_cap_reached";
}

export interface Rate {
  id: string;
  micro_per_unit: number;
  effective_at: string;
  effective_at_local: string;
  status: "past" | "current" | "scheduled";
  created_by: { id: string; name: string };
}

export interface TopUp {
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
  created_by: string;
  created_at: string;
  paid_at: string | null;
}

export interface Endpoint {
  id: string;
  team_id: string;
  url: string;
  state: "active" | "failing" | "disabled";
  consecutive_failures: number;
  created_by: { id: string; name: string };
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

export interface Ledger {
  balances: { granted_micro: number; available_micro: number; reserved_micro: number; settled_micro: number };
  movements: {
    id: string;
    kind: string;
    created_at: string;
    job_id: string | null;
    topup_id: string | null;
    kb_invoice_id: string | null;
    entries: { account: string; amount_micro: number }[];
  }[];
}

export interface Policy {
  version: number;
  timezone: string;
  retention_days: number;
  org_model_access: Record<string, { api: string; playground: string }>;
  teams: {
    id: string;
    name: string;
    concurrency: number;
    payload_visibility: "team" | "restricted";
    soft_cap_credits: number;
    hard_cap_credits: number;
    context_defaults: { api: string; playground: string };
    model_access: Record<string, { api: string; playground: string }>;
  }[];
}

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
  fields?: Record<string, string>;
  required_micro?: number;
  available_micro?: number;
  period_ends_at?: string;
  current_version?: number;
  status?: string;
}
