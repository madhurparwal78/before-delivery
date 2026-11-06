export interface ApiFailureBody {
  code: string;
  message: string;
  fields?: Record<string, string>;
  required_micro?: number;
  available_micro?: number;
  period_ends_at?: string;
  current_version?: number;
  status?: string;
  removed_at?: string;
  reason?: string;
}

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;
  readonly detail: ApiFailureBody;

  constructor(status: number, body: ApiFailureBody) {
    super(body.message);
    this.status = status;
    this.code = body.code;
    this.fields = body.fields ?? {};
    this.detail = body;
  }
}

interface RequestOptions {
  body?: unknown;
  raw?: Blob;
  headers?: Record<string, string>;
}

async function send<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  let payload: BodyInit | undefined;
  if (options.raw) {
    payload = options.raw;
    headers['content-type'] = options.raw.type;
  } else if (options.body !== undefined) {
    payload = JSON.stringify(options.body);
    headers['content-type'] = 'application/json';
  }
  const response = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed: unknown = text.length > 0 ? JSON.parse(text) : {};
  if (!response.ok) {
    const envelope = parsed as { error?: ApiFailureBody };
    throw new ApiFailure(
      response.status,
      envelope.error ?? { code: 'unknown', message: 'That request could not be completed.' },
    );
  }
  const replayed = response.headers.get('idempotent-replayed') === 'true';
  if (replayed && parsed !== null && typeof parsed === 'object') {
    (parsed as { replayed?: boolean }).replayed = true;
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string) => send<T>('GET', path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    send<T>('POST', path, { body, headers }),
  postRaw: <T>(path: string, raw: Blob, headers?: Record<string, string>) =>
    send<T>('POST', path, { raw, headers }),
  put: <T>(path: string, body: unknown) => send<T>('PUT', path, { body }),
  del: <T>(path: string) => send<T>('DELETE', path),
};

export interface Member {
  id: string;
  name: string;
  email: string;
  role: 'member' | 'admin' | 'finance' | 'compliance';
  team_id: string | null;
}

export interface SchemaProperty {
  type: 'string' | 'integer';
  title: string;
  description?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  enum?: (string | number)[];
  default?: string | number;
  contentMediaType?: string;
}

export interface InputSchema {
  type: 'object';
  required: string[];
  properties: Record<string, SchemaProperty>;
}

export interface ModelView {
  slug: string;
  name: string;
  modality: 'image' | 'video' | 'audio';
  unit: string;
  unit_label: string;
  input_schema: InputSchema;
  current_rate: { id: string; micro_per_unit: number; effective_at: string } | null;
  access: { api: 'allowed' | 'blocked'; playground: 'allowed' | 'blocked' } | null;
}

export interface JobView {
  id: string;
  team_id: string;
  model: string;
  status: 'queued' | 'leased' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  priority: string;
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
  input?: Record<string, string | number>;
  input_assets?: string[];
}

export interface MeterView {
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
  cap_state: 'under' | 'soft_cap_passed' | 'hard_cap_reached';
}

export interface AssetView {
  id: string;
  team_id: string;
  kind: 'upload' | 'output';
  media_type: string;
  job_id: string | null;
  model: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  bytes: number;
  created_at: string;
  expires_at: string;
  url: string | null;
  prompt?: string | null;
  derived_from?: string[];
}

export type LineageNode =
  | {
      id: string;
      state: 'live';
      media_type: string;
      model: string | null;
      job_id: string | null;
      created_at: string;
      thumbnail_url: string | null;
      prompt?: string | null;
    }
  | { id: string; state: 'tombstone'; removed_at: string; reason: 'deleted' | 'expired' };

export interface LineageView {
  nodes: LineageNode[];
  edges: { from: string; to: string }[];
}

export interface TeamView {
  id: string;
  name: string;
}

export interface TopupView {
  id: string;
  team_id: string;
  credits: number;
  amount_usd: string;
  status: 'pending' | 'paid' | 'failed';
  pending_reason: string | null;
  failure_reason: string | null;
  kb_invoice_id: string | null;
  created_by: string;
  created_at: string;
  paid_at: string | null;
}

export interface MovementView {
  id: string;
  kind: string;
  created_at: string;
  job_id: string | null;
  topup_id: string | null;
  kb_invoice_id: string | null;
  entries: { account: string; amount_micro: number }[];
}

export interface LedgerView {
  balances: {
    granted_micro: number;
    available_micro: number;
    reserved_micro: number;
    settled_micro: number;
  };
  movements: MovementView[];
}

export interface RateView {
  id: string;
  micro_per_unit: number;
  effective_at: string;
  effective_at_local: string;
  status: 'past' | 'current' | 'scheduled';
  created_by: string;
}

export interface EndpointView {
  id: string;
  team_id: string;
  url: string;
  state: 'active' | 'failing' | 'disabled';
  consecutive_failures: number;
  created_by: string;
  created_at: string;
  secret?: string;
}

export interface DeliveryView {
  event_id: string;
  event_type: string;
  job_id: string;
  attempt: number;
  attempted_at: string;
  status_code: number | null;
  outcome: 'delivered' | 'failed' | 'skipped_disabled';
  next_attempt_at: string | null;
}

export interface PolicyTeam {
  id: string;
  name: string;
  concurrency: number;
  payload_visibility: 'team' | 'restricted';
  soft_cap_credits: number;
  hard_cap_credits: number;
  context_defaults: { api: string; playground: string };
  model_access: Record<string, { api: string; playground: string }>;
}

export interface PolicyView {
  version: number;
  timezone: string;
  retention_days: number;
  org_model_access: Record<string, { api: string; playground: string }>;
  teams: PolicyTeam[];
}

export interface SystemView {
  storage: 'up' | 'down';
  billing: 'up' | 'down';
  checked_at: string;
}

export interface QueueView {
  lanes: { model: string; queued: JobView[]; running: JobView[] }[];
}
