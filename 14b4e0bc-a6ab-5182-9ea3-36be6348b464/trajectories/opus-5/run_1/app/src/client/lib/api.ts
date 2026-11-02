import type {
  AssetKind,
  CertificationState,
  EdgeKind,
  LineageDirection,
  Role,
  Tag,
  Transform,
} from '../../shared/domain.ts';

export interface ApiErrorBody {
  code: string;
  message: string;
  fields?: Record<string, string>;
}

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: ApiErrorBody };

export interface UserRef {
  id: string;
  name: string;
}

export interface TermRef {
  id: string;
  name: string;
}

export interface AssetSummary {
  id: string;
  kind: AssetKind;
  description: string;
  owner: UserRef;
  state: CertificationState;
  terms: TermRef[];
  tagged_column_count: number;
  pii_column_count: number;
  confidential_column_count: number;
  deprecated_upstream: string | null;
}

export interface ColumnBody {
  id: string;
  name: string;
  data_type: string;
  direct_tags: Tag[];
  effective_tags: Tag[];
  suppressed_tags: Tag[];
  tag_sources: Partial<Record<Tag, string[]>>;
  samples: string[];
  masked: boolean;
  asset?: { id: string; state: CertificationState };
}

export interface AssetDetail extends AssetSummary {
  verified_at: string | null;
  evidence: {
    filename: string;
    content_type: string;
    size_bytes: number;
    sha256: string;
    uploaded_at: string;
    uploaded_by: UserRef;
  } | null;
  deprecation: { reason: string; at: string; by: UserRef } | null;
  columns: ColumnBody[];
}

export interface FacetEntry {
  value: string;
  label: string;
  count: number;
}

export interface SearchBody {
  results: AssetSummary[];
  total: number;
  facets: { tag: FacetEntry[]; owner: FacetEntry[]; state: FacetEntry[]; term: FacetEntry[] };
  as_of_seq?: number;
  as_of_at?: string | null;
}

export interface ReachedColumn {
  column: string;
  asset: string;
  hop: number;
  carried_tags: Tag[];
  sealed_tags: Tag[];
  tag_sources: Partial<Record<Tag, string[]>>;
}

export interface LineageBody {
  focus: string;
  direction: LineageDirection;
  focus_tags: Tag[];
  focus_tag_sources: Partial<Record<Tag, string[]>>;
  reached: ReachedColumn[];
  edges: { from: string; to: string; transform: Transform; kind: EdgeKind }[];
  cycles: { from: string; to: string }[];
  assets: Record<string, { state: CertificationState; deprecated_upstream: string | null }>;
  totals: { columns: number; hops: number; cycles: number };
  truncated: boolean;
  limits: { max_hops: number; max_columns: number };
  summary: string;
}

export interface TermBody {
  id: string;
  name: string;
  definition: string;
  revision: number;
  assets: { id: string }[];
}

export interface AuditRow {
  id: string;
  seq: number;
  at: string;
  actor: UserRef;
  actor_role: Role;
  action: string;
  target: { type: string; id: string };
  before: unknown;
  after: unknown;
  prev_hash: string;
  hash: string;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface ServiceStatusBody {
  evidence: 'up' | 'down';
  mail: 'up' | 'down';
  queued_notices: number;
}

interface RequestOptions {
  body?: unknown;
  formData?: FormData;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export async function api<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  let body: BodyInit | undefined;
  if (options.formData !== undefined) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body, signal: options.signal });
  } catch {
    return { ok: false, status: 0, error: { code: 'network', message: 'Network error.' } };
  }
  if (response.status === 204) return { ok: true, status: 204, data: undefined as T };
  const text = await response.text();
  const parsed = text === '' ? null : (JSON.parse(text) as unknown);
  if (response.ok) return { ok: true, status: response.status, data: parsed as T };
  const errorBody = (parsed as { error?: ApiErrorBody } | null)?.error;
  return {
    ok: false,
    status: response.status,
    error: errorBody ?? { code: 'unknown', message: 'Something went wrong. Try again.' },
  };
}

export function columnPath(columnId: string): string {
  return encodeURIComponent(columnId);
}
