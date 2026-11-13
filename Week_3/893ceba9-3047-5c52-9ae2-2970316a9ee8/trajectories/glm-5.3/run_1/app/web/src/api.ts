export interface ApiError {
  code: string;
  message: string;
  fields?: Record<string, string>;
  details?: Record<string, unknown>;
}

export class RequestError extends Error {
  status: number;
  code: string;
  fields: Record<string, string>;
  details: Record<string, unknown>;
  constructor(status: number, e: ApiError) {
    super(e.message);
    this.status = status;
    this.code = e.code;
    this.fields = e.fields || {};
    this.details = e.details || {};
  }
}

export async function api<T = any>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const headers: Record<string, string> = Object.assign({}, (init?.headers as Record<string, string>) || {});
  let body: string | undefined;
  const method = (init?.method || "GET").toUpperCase();
  if (init?.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const res = await fetch(path, { ...init, method, headers, body: init?.body as BodyInit | undefined || body, credentials: "same-origin" });
  if (res.status === 204) return undefined as T;
  if (res.ok) {
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) return res.json();
    return (await res.text()) as unknown as T;
  }
  let payload: { error?: ApiError } = {};
  try { payload = await res.json(); } catch { /* non-JSON error */ }
  if (payload.error) throw new RequestError(res.status, payload.error);
  throw new RequestError(res.status, { code: "network", message: "The desk couldn't reach the server. Check your connection and try again." });
}

export async function downloadFile(path: string, filename: string): Promise<void> {
  const res = await fetch(path, { credentials: "same-origin" });
  if (!res.ok) throw new Error("download failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function hhmm(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

export function qs(name: string): string | null {
  return new URLSearchParams(location.search).get(name);
}

export function navigate(path: string, replace = false): void {
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export interface User { id: string; name: string; email: string; role: "owner" | "reviewer"; }

export interface Project {
  id: string; slug: string; name: string; client: string;
  source_language: string; target_languages: string[]; repository: string;
  mqm_threshold: number; ai_routes: Record<string, string>; created_at: string;
}
export interface Branch { name: string; state: "open" | "in_review" | "merged" | "abandoned"; is_main: boolean; created_at: string; }
export interface ProjectDetail extends Project {
  branches: Branch[]; tm_entries: number; last_publish: Publish | null;
}
export interface SegmentSummary { segment_id: string; value: string | null; status: SegStatus; score: number | null; }
export type SegStatus = "untranslated" | "drafted" | "scored" | "needs_review" | "approved";
export interface Issue { category: string; severity: string; note?: string; }
export interface Comment { id: string; author: string; body: string; at: string; }
export interface SegHistoryItem { at: string; actor: string; from: string; to: string; value: string | null; }
export interface Segment {
  id: string; project: string; branch: string; key_id: string; key: string;
  source: string | null; language: string; value: string | null; status: SegStatus;
  score: number | null; origin: string | null; issues: Issue[]; comments: Comment[];
  history: SegHistoryItem[]; removed: boolean;
}
export interface Conflict {
  id: string; key_id: string; key: string; field: string;
  base: string | null; main: string | null; branch: string | null;
  resolution: { choice: string; value: string | null; by: string; at: string } | null;
  held_until: string | null;
}
export interface MergePreview {
  branch: string; state: string; keys: number; needs_review: number;
  new_keys: number; edited_keys: number; deleted_keys: number;
  conflicts: Conflict[]; below_threshold: number;
}
export interface Publish {
  id: string; branch: string; state: "queued" | "awaiting_host_confirmation" | "published" | "failed";
  failure_reason: string | null; languages: string[];
  pull_request: { number: number; url: string } | null;
  bundles: Record<string, { object_key: string; sha256: string }>;
  created_at: string; confirmed_at: string | null;
}
export interface Operation { id: string; kind: "import" | "merge"; label: string; at: string; restored_at: string | null; restorable: boolean; }
export interface Assignment { id: string; reviewer_id: string; branch: string; language: string; segment_ids: string[]; state: string; expires_at: string; }
export interface AuditEntry { id: string; at: string; actor: string; action: string; project: string; detail: string; }
export interface TmEntry { id: string; source: string; target: string; target_language: string; import_id: string | null; }
export interface TmImport { import_id: string; filename: string; format: string; size: number; sha256: string; at: string; restored_at: string | null; }
export interface ImportReport {
  import_id: string; filename: string; format: string; size: number; sha256: string; object_key: string;
  added: number; duplicates: number; applied: number; rows: { line: number; reason: string }[];
}
export interface SourceFile { file_id: string; branch: string; filename: string; content_type: string; size: number; sha256: string; at: string; }
export interface Reviewer { id: string; name: string; email: string; }
export interface QueueSegment {
  segment_id: string; project: string; branch: string; language: string; key: string;
  source: string | null; value: string | null; status: SegStatus; score: number | null;
  issues: Issue[]; assignment_id: string | null; expires_at: string | null; removed: boolean;
}
export interface WorkspaceStats { projects: number; exact_matches_reused: number; conflicts_open: number; below_threshold: number; publishes_confirmed: number; }
export interface KeyRow { id: string; name: string; source: string; translations: Record<string, SegmentSummary>; }

export const STATUS_WORDS: Record<string, string> = {
  untranslated: "Untranslated", drafted: "Drafted", scored: "Scored",
  needs_review: "Needs review", approved: "Approved",
  open: "Open", in_review: "In review", merged: "Merged", abandoned: "Abandoned",
  queued: "Queued", awaiting_host_confirmation: "Awaiting host confirmation",
  published: "Published", failed: "Failed",
};

export function statusWord(s: string): string {
  return STATUS_WORDS[s] || s;
}

export function fieldLabel(f: string): string {
  if (f === "name") return "name";
  if (f === "source") return "source";
  if (f === "presence") return "presence";
  if (f.startsWith("translation:")) return f.slice("translation:".length);
  return f;
}
