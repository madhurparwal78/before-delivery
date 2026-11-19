/** API client and shared types for the browser. */

export interface User { id: string; email: string; name: string }
export interface ProjectSummary { id: string; name: string; role: "owner" | "editor" | "reader" }
export interface CollectionSummary { id: string; name: string; count: number }
export interface CollectionInfo { id: string; name: string; count: number; sequence: number; validator: unknown }
export interface Plan {
  kind: "index" | "full_scan";
  index: string | null;
  docs_examined: number;
  returned: number;
}
export interface QueryAnswer {
  matched: number;
  page: number;
  page_size: number;
  documents: unknown[];
  ids: string[];
  plan: Plan;
}
export interface IndexInfo { name: string; keys: Record<string, number>; unique: boolean }
export interface SavedQuery {
  id: string; name: string; filter: unknown; projection: unknown; sort: unknown; limit: number;
  last_run_at: string | null; last_count: number | null;
}
export interface SchemaField { path: string; present: number; types: { type: string; share: number }[] }
export interface StagePreview {
  index: number;
  count: number;
  disabled: boolean;
  documents: unknown[];
}
export interface PreviewAnswer {
  input: number;
  stages: StagePreview[];
  pin: { _id: string; stopped_at: number | null } | null;
}
export interface ImportInfo {
  id: string; file_name: string; format: string; state: string;
  bytes: number; inserted: number; errors: { line: number; message: string }[]; created_at: string;
}
export interface Member { user_id: string; email: string; name: string; role: "owner" | "editor" | "reader" }
export interface Invitation { id: string; email: string; role: string; state: string }

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly extras: Record<string, unknown>,
  ) {
    super(code);
  }
}

async function request<T>(method: string, path: string, body?: unknown, raw?: Blob | File): Promise<T> {
  const init: RequestInit = { method, headers: {} };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  } else if (raw !== undefined) {
    init.body = raw;
  }
  const res = await fetch(path, init);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text.length > 0 && (text[0] === "{" || text[0] === "[") ? JSON.parse(text) : text;
  if (!res.ok) {
    const err = data as { error?: string } & Record<string, unknown>;
    throw new ApiError(res.status, err.error ?? "error", err);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>("GET", path),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown): Promise<T> => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown): Promise<T> => request<T>("PATCH", path, body),
  del: <T>(path: string): Promise<T> => request<T>("DELETE", path),
  upload: <T>(path: string, file: Blob | File): Promise<T> => request<T>("POST", path, undefined, file),
};

/** Download bytes from an API route as a Blob. */
export async function download(path: string): Promise<Blob> {
  const res = await fetch(path);
  if (!res.ok) {
    const text = await res.text();
    let code = "error";
    try {
      code = (JSON.parse(text) as { error: string }).error;
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, code, {});
  }
  return res.blob();
}
