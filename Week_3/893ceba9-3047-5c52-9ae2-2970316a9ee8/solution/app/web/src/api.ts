export type Role = "owner" | "reviewer";
export interface User { id: string; name: string; email: string; role: Role }
export interface BranchRef { name: string; state: string }
export interface Project {
  id: string; slug: string; name: string; client: string; source_language: string; target_languages: string[];
  repository: string; mqm_threshold: number; ai_routes: Record<string, string>; created_at: string; branches?: BranchRef[];
}
export interface Branch { name: string; state: BranchState; is_main: boolean; created_at: string }
export type BranchState = "open" | "in_review" | "merged" | "abandoned";
export interface Publish {
  id: string; branch: string; state: "queued" | "awaiting_host_confirmation" | "published" | "failed";
  failure_reason: string | null; languages: string[]; pull_request: { number: number; url: string } | null;
  bundles: Record<string, { object_key: string; sha256: string }>; created_at: string; confirmed_at: string | null;
}
export interface ProjectDetail extends Project { branches: Branch[]; tm_entries: number; last_publish: Publish | null }
export interface SegmentSummary { segment_id: string; value: string | null; status: string; score: number | null }
export interface KeyItem { id: string; name: string; source: string; translations: Record<string, SegmentSummary> }
export interface Issue { category: string; severity: string; note: string }
export interface Segment {
  id: string; project: string; branch: string; key_id: string; key: string; source: string | null; language: string;
  value: string | null; status: string; score: number | null; origin: string | null; issues: Issue[];
  comments: { id: string; author: string; body: string; at: string }[];
  history: { at: string; actor: string; from: string | null; to: string; value: string | null; note?: string }[]; removed: boolean;
}
export interface Conflict {
  id: string; key_id: string; key: string; field: string; base: string | null; main: string | null; branch: string | null;
  resolution: null | { choice: string; value: string | null; by: string; at: string }; held_until: string | null;
}
export interface Preview {
  branch: string; state: BranchState; keys: number; needs_review: number; new_keys: number; edited_keys: number;
  deleted_keys: number; conflicts: Conflict[]; below_threshold: number;
}
export interface Operation { id: string; kind: "import" | "merge"; label: string; at: string; restored_at: string | null; restorable: boolean }
export interface ImportReport {
  import_id: string; operation_id: string | null; filename: string; format: string; size: number; sha256: string; at: string; restored_at: string | null;
  added: number; duplicates: number; applied: number; rows: { line: number; reason: string }[];
}
export interface QueueItem {
  segment_id: string; project: string; branch: string; language: string; key: string; source: string | null; value: string | null;
  status: string; score: number | null; issues: Issue[]; assignment_id: string | null; expires_at: string | null; removed: boolean;
}
export interface Integrations { git_host: "up" | "down"; ai_engine: "up" | "down"; webhooks: "up" | "down" }
export interface WorkspaceStats {
  projects: number; exact_matches_reused: number; conflicts_open: number; below_threshold: number; publishes_confirmed: number;
}

export class ApiError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;
  fields: Record<string, string>;
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details ?? {};
    this.fields = fields ?? {};
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const e = body?.error ?? {};
    throw new ApiError(res.status, e.code ?? "error", e.message ?? res.statusText, e.details, e.fields);
  }
  return body as T;
}

async function send<T>(method: string, path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method, credentials: "same-origin", ...init });
  } catch {
    throw new ApiError(0, "network", "The desk couldn't reach the server. Check your connection and try again.");
  }
  return parse<T>(res);
}

export function api<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  return send<T>(method, path, {
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function upload<T>(path: string, form: FormData): Promise<T> {
  return send<T>("POST", path, { body: form });
}

export const enc = encodeURIComponent;
export const projectPath = (slug: string) => `/api/projects/${enc(slug)}`;
export const branchPath = (slug: string, branch: string) => `${projectPath(slug)}/branches/${enc(branch)}`;
