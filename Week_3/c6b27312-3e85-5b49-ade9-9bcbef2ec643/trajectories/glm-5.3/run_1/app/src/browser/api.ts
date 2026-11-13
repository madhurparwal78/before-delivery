import type { Values, ManifestEntry, TapeOperation } from "../shared/records.js";

export interface PartResponse {
  slug: string;
  title: string;
  category: string;
  visibility: string;
  owner: { id: string; displayName: string };
  likes: number;
  liked: boolean;
  headRevisionId: string;
  revision: {
    id: string;
    label: string;
    values: Values;
    sourceRef: string;
    geometryDigest: string;
    message: string;
  };
  source: string;
  manifest: ManifestEntry[];
  preflightLeft: number | null;
}

export interface EvaluationResponse {
  id: string;
  partSlug: string;
  seq: number;
  status: "succeeded" | "failed" | "cancelled";
  geometryDigest: string | null;
  volume: number;
  bbox: number[];
  faces: number;
  solid: { ops: Array<Record<string, number | string>> } | null;
  diagnostics: { code: string; message: string; parameter: string | null }[];
}

export interface GalleryResponse {
  parts: {
    slug: string;
    title: string;
    category: string;
    author: { displayName: string };
    likes: number;
    liked: boolean;
    createdAt: string;
    head: { id: string; label: string; geometryDigest: string; volume: number; bbox: number[] };
  }[];
  nextCursor: string | null;
  categories: { slug: string; name: string; count: number }[];
  total: number;
}

export interface ReportResponse {
  id: string;
  partSlug: string;
  process: string;
  values: Values;
  geometryDigest: string;
  status: "complete" | "unsupported";
  message: string | null;
  findings: {
    id: string;
    severity: "Blocking" | "Advisory" | "Pass";
    code: string;
    message: string;
    cutLabel: string | null;
    measured: number;
    threshold: number;
    operation: number;
    parameters: string[];
    pose: { position: number[]; target: number[]; up: number[]; fov: number };
  }[];
  costBands: { quantity: number; low: number; high: number; text: string }[];
  confidence: "High" | "Medium" | "Low" | null;
  createdAt: string;
}

export interface RoomResponse {
  room: {
    id: string;
    partSlug: string;
    headRevisionId: string;
    title: string;
    state: "open" | "approved" | "closed";
    requiredApprovals: number;
    approvals: { reviewerId: string; revisionId: string; geometryDigest: string; at: string }[];
    reviewers: { email: string; userId: string | null; displayName?: string }[];
    createdBy: string;
  };
  comments: CommentResponse[];
}

export interface CommentResponse {
  id: string;
  roomId: string;
  author: { id: string; displayName: string };
  body: string;
  anchor: { kind: string; position?: number[] };
  pose: { position?: number[]; target?: number[]; up?: number[]; fov?: number };
  revisionId: string;
  createdAt: string;
}

export interface Me { id: string; email: string; displayName: string }

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly message: string,
    readonly errors: Record<string, string> | null
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    ...init,
  });
  const body = await res.text();
  const json = body ? JSON.parse(body) as Record<string, unknown> : {};
  if (!res.ok) {
    throw new ApiError(res.status, String(json.error ?? "error"), String(json.message ?? ""), (json.errors as Record<string, string>) ?? null);
  }
  return json as T;
}

export const api = {
  config: () => request<{ evalDebounceMs: number; slowEvalNoticeMs: number; commentMaxChars: number; requiredApprovals: number; preflightSignedOutLimit: number }>("/api/config"),
  me: () => request<Me>("/api/me"),
  part: (slug: string, revision?: string) => request<PartResponse>(`/api/parts/${slug}${revision ? `?revision=${encodeURIComponent(revision)}` : ""}`),
  gallery: (params: { category?: string; sort?: string; cursor?: string }) => {
    const q = new URLSearchParams();
    if (params.category) q.set("category", params.category);
    if (params.sort) q.set("sort", params.sort);
    if (params.cursor) q.set("cursor", params.cursor);
    return request<GalleryResponse>(`/api/parts?${q.toString()}`);
  },
  revisions: (slug: string) => request<{ revisions: PartResponse["revision"][] }>(`/api/parts/${slug}/revisions`),
  evaluate: (partSlug: string, values: Values, seq: number, viewer: string, signal?: AbortSignal) =>
    request<EvaluationResponse>("/api/evaluations", {
      method: "POST",
      body: JSON.stringify({ partSlug, values, seq, viewerId: viewer }),
      signal,
    }),
  cancel: (viewer: string) =>
    fetch("/api/evaluations/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ viewerId: viewer }), credentials: "same-origin" }),
  preflight: (partSlug: string, values: Values, process: string) =>
    request<ReportResponse>("/api/preflight", { method: "POST", body: JSON.stringify({ partSlug, values, process }) }),
  tape: (revisionId: string) => request<{ revisionId: string; partSlug: string; n: number; operations: TapeOperation[]; preflight: ReportResponse | null }>(`/api/revisions/${revisionId}/tape`),
  compare: (base: string, head: string) =>
    request<{
      base: string; head: string; identical: boolean; added: number; removed: number; unchanged: number;
      hunks: { index: number; kind: "added" | "removed"; volume: number; box: { min: number[]; max: number[] } }[];
      parameterChanges: { name: string; label: string; base: unknown; head: unknown; unit: string }[];
    }>(`/api/compare?base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}`),
  room: (id: string) => request<RoomResponse>(`/api/rooms/${id}`),
  postComment: (roomId: string, body: string, anchor: unknown, pose: unknown, key: string) =>
    request<CommentResponse>(`/api/rooms/${roomId}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ body, anchor, pose }),
    }),
  approve: (roomId: string, revisionId: string, key: string) =>
    request<RoomResponse["room"]>(`/api/rooms/${roomId}/approvals`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ revisionId }),
    }),
  closeRoom: (roomId: string) => request<RoomResponse["room"]>(`/api/rooms/${roomId}/close`, { method: "POST" }),
  dashboard: () => request<{
    parts: { slug: string; title: string; visibility: string; likes: number; head: { id: string; label: string }; revisionCount: number }[];
    rooms: { id: string; title: string; partSlug: string; state: string; approvals: number; requiredApprovals: number }[];
    liked: { slug: string; title: string; author: string }[];
  }>("/api/dashboard"),
  like: (slug: string) => request<{ liked: boolean; likes: number }>(`/api/parts/${slug}/like`, { method: "PUT" }),
  unlike: (slug: string) => request<{ liked: boolean; likes: number }>(`/api/parts/${slug}/like`, { method: "DELETE" }),
  signin: (email: string, password: string, next?: string) =>
    request<{ id: string; landing: string }>("/api/auth/signin", { method: "POST", body: JSON.stringify({ email, password, next }) }),
  signup: (email: string, password: string, displayName: string, next: string) =>
    request<{ status: string }>("/api/auth/signup", { method: "POST", body: JSON.stringify({ email, password, displayName, next }) }),
  signout: () => fetch("/api/auth/signout", { method: "POST", credentials: "same-origin" }),
};
