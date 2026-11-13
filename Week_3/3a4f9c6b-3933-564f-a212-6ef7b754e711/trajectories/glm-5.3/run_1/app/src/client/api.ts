// Client API access and shared view models.

export interface Session {
  user: { email: string; name: string };
  memberships: { project: string; role: Role }[];
}

export type Role = 'platform_engineer' | 'service_developer' | 'release_manager' | 'oncall_sre';

export interface Decision {
  evaluated_at: string;
  local_time: string;
  open: boolean;
  reason: 'open' | 'outside_window' | 'freeze';
  window: { id: string; label: string } | null;
  freeze: { name: string } | null;
  policy_version: number;
}

export interface Promotion {
  id: string;
  project: string;
  stage: string;
  cluster: string;
  time_zone: string;
  kind: 'promotion' | 'rollback';
  state: string;
  phase: string;
  progress: number;
  bundle: { version: string; digest: string; short_digest: string; source_commit: string };
  overrides: { parameters: Record<string, string>; replicas: Record<string, number> };
  requested_by: { email: string; name: string };
  requested_at: string;
  policy_version: number;
  approval: {
    state: 'pending' | 'approved' | 'rejected' | 'expired';
    request_expires_at: string;
    decided_by: string | null;
    decided_at: string | null;
    expires_at: string | null;
    comment: string | null;
  } | null;
  window_decision: Decision | null;
  freeze_break: { by: string; at: string; reason: string } | null;
  restores: string | null;
  counter: { in_sync: number; total: number } | null;
  evidence: { stored_snapshots: number; queued_snapshots: number };
  diff: { resource: string; path: string; change: string; before: string | null; after: string | null }[];
  history: { from: string | null; to: string; at: string; by: string }[];
}

export interface GraphNode {
  stage: string;
  cluster: string;
  time_zone: string;
  upstream: string | null;
  requires_approval: boolean;
  status: 'healthy' | 'progressing' | 'degraded' | 'out_of_sync' | 'not_deployed';
  current: { promotion_id: string; version: string; short_digest: string } | null;
  counter: { in_sync: number; total: number } | null;
  active_promotion: Promotion | null;
}

export interface GraphEdge {
  from: string;
  to: string;
  phase: string;
  progress: number;
  promotion_id: string | null;
}

export interface Graph {
  project: { slug: string; name: string };
  role: Role;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Bundle {
  id: string;
  version: string;
  digest: string;
  short_digest: string;
  source_commit: string;
  resources: { ref: string; kind: string; namespace: string; name: string }[];
  ingested_at: string;
  ingested_by: string;
  verified_in: string[];
}

export interface StatusInfo {
  storage: 'up' | 'down';
  mail: 'up' | 'down';
  queued_uploads: number;
  queued_notices: number;
}

export interface ClusterInfo {
  name: string;
  time_zone: string;
  stages: string[];
  windows: { id: string; label: string; days: string[]; start: string; end: string }[];
}

export interface HealthInfo {
  revision: string | null;
  in_sync: number;
  total: number;
  resources: { ref: string; kind: string; namespace: string; name: string; sync: string; health: string; updated_at: string }[];
}

export interface Opening {
  window_id: string;
  label: string;
  opens_at: string;
  closes_at: string;
  local_opens: string;
  local_closes: string;
}

export interface FreezeVersion {
  version: number;
  effective_from: string;
  created_by: string;
  created_at: string;
  freezes: { name: string; stages: string[]; starts_at: string; ends_at: string }[];
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields: Record<string, string> = {},
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export class NetworkError extends Error {}

async function parse(res: Response, path: string): Promise<unknown> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; message?: string; fields?: Record<string, string> } & Record<string, unknown>;
    if (res.status === 401 && b.error === 'unauthenticated' && !path.startsWith('/api/session')) {
      window.dispatchEvent(new CustomEvent('keelson:session-ended'));
    }
    throw new ApiError(res.status, b.error ?? 'unknown', b.message ?? 'Keelson could not complete the request.', b.fields ?? {}, b);
  }
  return body;
}

async function request(method: string, path: string, body?: unknown, requestKey?: string): Promise<unknown> {
  let res: Response;
  const headers: Record<string, string> = {};
  if (body !== undefined || method !== 'GET') headers['Content-Type'] = 'application/json';
  if (requestKey) headers['Request-Key'] = requestKey;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? (method === 'GET' ? undefined : JSON.stringify({})) : JSON.stringify(body),
    });
  } catch {
    throw new NetworkError('Keelson could not reach the server. Your last action was not confirmed.');
  }
  return parse(res, path);
}

export const api = {
  signIn: (email: string, password: string) => request('POST', '/api/session', { email, password }),
  session: () => request('GET', '/api/session'),
  signOut: () => request('DELETE', '/api/session', {}),
  projects: () => request('GET', '/api/projects'),
  graph: (slug: string) => request('GET', `/api/projects/${slug}/graph`),
  status: () => request('GET', '/api/status'),
  bundles: (slug: string) => request('GET', `/api/projects/${slug}/bundles`),
  promotions: (slug: string, stage?: string, limit?: number) => {
    const q = new URLSearchParams();
    if (stage) q.set('stage', stage);
    if (limit) q.set('limit', String(limit));
    const s = q.toString();
    return request('GET', `/api/projects/${slug}/promotions${s ? `?${s}` : ''}`);
  },
  health: (slug: string, stage: string) => request('GET', `/api/projects/${slug}/stages/${stage}/health`),
  promotion: (id: string) => request('GET', `/api/promotions/${id}`),
  clusters: (slug: string) => request('GET', `/api/projects/${slug}/clusters`),
  openings: (slug: string, cluster: string, count?: number, from?: string) => {
    const q = new URLSearchParams();
    if (count) q.set('count', String(count));
    if (from) q.set('from', from);
    return request('GET', `/api/projects/${slug}/clusters/${cluster}/window-openings?${q.toString()}`);
  },
  windowDecision: (slug: string, stage: string, at?: string) => {
    const q = at ? `?at=${encodeURIComponent(at)}` : '';
    return request('GET', `/api/projects/${slug}/stages/${stage}/window-decision${q}`);
  },
  freezePolicy: (slug: string) => request('GET', `/api/projects/${slug}/freeze-policy`),
  addWindow: (slug: string, cluster: string, body: { label: string; days: string[]; start: string; end: string }) =>
    request('POST', `/api/projects/${slug}/clusters/${cluster}/windows`, body),
  deleteWindow: (slug: string, cluster: string, id: string) =>
    request('DELETE', `/api/projects/${slug}/clusters/${cluster}/windows/${id}`),
  scheduleFreeze: (slug: string, body: unknown) =>
    request('POST', `/api/projects/${slug}/freeze-policy/versions`, body),
  requestPromotion: (slug: string, stage: string, body: { bundle_version: string; overrides?: unknown }, key: string) =>
    request('POST', `/api/projects/${slug}/stages/${stage}/promotions`, body, key),
  rollback: (slug: string, stage: string, reason: string, key: string) =>
    request('POST', `/api/projects/${slug}/stages/${stage}/rollback`, { reason }, key),
  approve: (id: string, comment: string, key: string) =>
    request('POST', `/api/promotions/${id}/approve`, comment ? { comment } : {}, key),
  reject: (id: string, reason: string, key: string) =>
    request('POST', `/api/promotions/${id}/reject`, { reason }, key),
  start: (id: string, key: string) => request('POST', `/api/promotions/${id}/start`, {}, key),
  retryWindow: (id: string, key: string) => request('POST', `/api/promotions/${id}/retry-window`, {}, key),
  breakFreeze: (id: string, reason: string, key: string) =>
    request('POST', `/api/promotions/${id}/break-freeze`, { reason }, key),
  approvalLink: (token: string) => request('GET', `/api/approval-links/${token}`),
};

// Cluster time format: YYYY-MM-DD HH:mm Europe/London
export function clusterTime(zone: string, iso: string | null): string {
  if (!iso) return '';
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} ${zone}`;
}

export function utcTime(iso: string | null): string {
  if (!iso) return '';
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export function newRequestKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
