// Same-origin calls to the desk's own API.

export type ApiError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  fields?: Record<string, string>;
  unreachable?: boolean;
};

export class DeskError extends Error {
  readonly info: ApiError;

  constructor(info: ApiError) {
    super(info.message);
    this.info = info;
  }
}

async function request<T>(method: string, path: string, body?: unknown, extra?: HeadersInit): Promise<T> {
  const headers = new Headers(extra);
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
    payload = JSON.stringify(body);
  }
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new DeskError({
      code: 'unreachable',
      message: "The desk couldn't reach the server. Check your connection and try again.",
      unreachable: true,
    });
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const info = (parsed as { error?: ApiError }).error ?? {
      code: 'internal',
      message: 'The desk could not answer that.',
    };
    throw new DeskError(info);
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown, extra?: HeadersInit) => request<T>('POST', path, body ?? {}, extra),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, form),
};

export type User = { id: string; name: string; email: string; role: 'owner' | 'reviewer' };

export type Project = {
  id: string;
  slug: string;
  name: string;
  client: string;
  source_language: string;
  target_languages: string[];
  repository: string;
  mqm_threshold: number;
  ai_routes: Record<string, string>;
  created_at: string;
  branches?: Branch[];
  tm_entries?: number;
  last_publish?: Publish | null;
};

export type Branch = { name: string; state: string; is_main: boolean; created_at: string };

export type SegmentSummary = {
  segment_id: string;
  value: string | null;
  status: string;
  score: number | null;
};

export type KeyRow = {
  id: string;
  name: string;
  source: string;
  translations: Record<string, SegmentSummary>;
};

export type Issue = { category: string; severity: string; note: string };

export type Segment = {
  id: string;
  project: string;
  branch: string;
  key_id: string;
  key: string;
  source: string | null;
  language: string;
  value: string | null;
  status: string;
  score: number | null;
  origin: string | null;
  issues: Issue[];
  comments: { id: string; author: string; body: string; at: string }[];
  history: { at: string; actor: string; from: string; to: string; value: string | null }[];
  removed: boolean;
};

export type Conflict = {
  id: string;
  key_id: string;
  key: string;
  field: string;
  base: string | null;
  main: string | null;
  branch: string | null;
  resolution: { choice: string; value: string | null; by: string; at: string } | null;
  held_until: string | null;
};

export type Preview = {
  branch: string;
  state: string;
  keys: number;
  needs_review: number;
  new_keys: number;
  edited_keys: number;
  deleted_keys: number;
  conflicts: Conflict[];
  below_threshold: number;
};

export type Publish = {
  id: string;
  branch: string;
  state: string;
  failure_reason: string | null;
  languages: string[];
  pull_request: { number: number; url: string } | null;
  bundles: Record<string, { object_key: string; sha256: string }>;
  created_at: string;
  confirmed_at: string | null;
};

export type Operation = {
  id: string;
  kind: 'import' | 'merge';
  label: string;
  at: string;
  restored_at: string | null;
  restorable: boolean;
};

export type QueueRow = {
  segment_id: string;
  project: string;
  branch: string;
  language: string;
  key: string;
  source: string | null;
  value: string | null;
  status: string;
  score: number | null;
  issues: Issue[];
  assignment_id: string | null;
  expires_at: string | null;
  removed: boolean;
};

export type Integrations = { git_host: string; ai_engine: string; webhooks: string };

export type WorkspaceStats = {
  projects: number;
  exact_matches_reused: number;
  conflicts_open: number;
  below_threshold: number;
  publishes_confirmed: number;
};

export type AuditEntry = {
  id: string;
  at: string;
  actor: string;
  action: string;
  project: string;
  detail: string;
};

export type TMEntry = {
  id: string;
  source: string;
  target: string;
  target_language: string;
  import_id: string | null;
};

export type TMImport = {
  import_id: string;
  filename: string;
  format: string;
  size: number;
  sha256: string;
  at: string;
  restored_at: string | null;
  added: number;
  duplicates: number;
  applied: number;
  rows: { line: number; reason: string }[];
};

export type ImportReport = {
  import_id: string;
  filename: string;
  added: number;
  duplicates: number;
  applied: number;
  rows: { line: number; reason: string }[];
};

export type Reviewer = { id: string; name: string; email: string };

export type Assignment = {
  id: string;
  reviewer_id: string;
  branch: string;
  language: string;
  segment_ids: string[];
  state: string;
  expires_at: string;
};

export type SourceFile = {
  file_id: string;
  branch: string;
  filename: string;
  content_type: string;
  size: number;
  sha256: string;
  at: string;
};
