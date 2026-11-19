/** Client-side view of the API types, mirroring the server's serializers. */

export type Staff = { id: string; name: string; role: string; email: string; tenant_id: string; tenant_name: string };

export type Corridor = {
  id: string;
  name: string;
  voltage_kv: number;
  clearance_threshold_m: number;
  length_m: number;
  tower_count: number;
  inspection_due: string;
  overdue: boolean;
  utility: { id: string; name: string; time_zone: string; forester_name: string; forester_email: string };
  current_set: { id: string; revision: number; state: string } | null;
};

export type Tower = {
  number: number; label: string; chainage_m: number;
  lon_deg: number; lat_deg: number; base_height_m: number; attachment_height_m: number;
};

export type SpanInfo = { from_tower: number; to_tower: number; label: string };

export type Finding = {
  id: string; set_id: string; label: string;
  chainage_m: number; offset_m: number; lon_deg: number; lat_deg: number;
  ecef_m: [number, number, number];
  ground_height_m: number; terrain_level: number | null;
  canopy_height_m: number; canopy_top_height_m: number; canopy_radius_m: number;
  span: SpanInfo; clearance_m: number; status: 'violation' | 'clear';
  comment: string; updated_at: string;
};

export type ReviewLink = {
  url: string; expires_at: string;
  status: 'live' | 'revoked' | 'expired';
  email_state: 'queued' | 'sent';
};

export type SetRecord = {
  id: string; corridor_id: string; revision: number;
  state: 'draft' | 'submitted' | 'under_review' | 'accepted' | 'disputed' | 'closed';
  previous_set_id: string | null;
  submitted_at: string | null; submitted_by: string | null;
  frozen: { finding_count: number; violation_count: number } | null;
  review_link: ReviewLink | null;
  decisions: Record<string, { decision: 'accept' | 'dispute'; note: string }>;
};

export type AssetFile = { path: string; size_bytes: number; sha256: string; state: 'pending' | 'stored' | 'rejected' };
export type Asset = {
  id: string; corridor_id: string; kind: 'tileset' | 'terrain' | 'czml';
  state: 'pending' | 'stored' | 'rejected';
  rejected_reason: string | null;
  files: AssetFile[]; created_at: string; stored_at: string | null;
};

export type FlightAnswer = {
  chainage_m: number | null; time: string | null; covered: boolean;
  label?: string;
  position?: { lon_deg: number; lat_deg: number; height_m: number };
};

export type ApiErrorBody = { error: { code: string; message: string; fields?: Record<string, string>; from?: string; action?: string } };

export class ApiRequestError extends Error {
  status: number;
  code: string;
  fields: Record<string, string>;
  from?: string;
  action?: string;
  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.error?.message ?? 'Something went wrong.');
    this.status = status;
    this.code = body?.error?.code ?? 'unknown';
    this.fields = body?.error?.fields ?? {};
    this.from = body?.error?.from;
    this.action = body?.error?.action;
  }
}

export async function api<T>(path: string, init?: RequestInit & { idempotencyKey?: string }): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.idempotencyKey) headers.set('Idempotency-Key', init.idempotencyKey);
  if (init?.body !== undefined && init?.body !== null && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!res.ok) {
    throw new ApiRequestError(res.status, body as ApiErrorBody | null);
  }
  return body as T;
}

export async function apiRaw(path: string, init?: RequestInit): Promise<{ status: number; headers: Headers; bytes: ArrayBuffer | null; text: string | null }> {
  const res = await fetch(path, { ...init, credentials: 'same-origin' });
  if (res.status === 204) return { status: res.status, headers: res.headers, bytes: null, text: null };
  const buf = await res.arrayBuffer();
  return { status: res.status, headers: res.headers, bytes: buf, text: new TextDecoder().decode(buf) };
}
