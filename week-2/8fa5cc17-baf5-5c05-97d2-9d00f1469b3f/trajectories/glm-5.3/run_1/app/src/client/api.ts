// The API client: fetch with the CSRF token and 401 handling.

export interface ApiErrorBody {
  error: string;
  errors?: Record<string, string>;
  current?: unknown;
  status?: string;
  quoted_in?: number;
}

export class ApiFailure extends Error {
  constructor(
    public status: number,
    public body: ApiErrorBody
  ) {
    super(`api ${status}`);
  }
}

export class NetworkFailure extends Error {
  constructor() {
    super("network");
  }
}

let csrfToken = "";

export function setCsrfToken(token: string): void {
  csrfToken = token;
}

export function getCsrfToken(): string {
  return csrfToken;
}

export type UnauthenticatedHandler = (path: string) => void;
let onUnauthenticated: UnauthenticatedHandler | null = null;

export function setUnauthenticatedHandler(fn: UnauthenticatedHandler): void {
  onUnauthenticated = fn;
}

export async function api<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(method !== "GET" ? { "X-CSRF-Token": csrfToken } : {}),
        ...(headers ?? {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    throw new NetworkFailure();
  }
  if (res.status === 401) {
    if (onUnauthenticated !== null) onUnauthenticated(path);
    throw new ApiFailure(401, { error: "unauthenticated" });
  }
  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!res.ok) {
    throw new ApiFailure(res.status, (parsed ?? { error: "unknown" }) as ApiErrorBody);
  }
  return parsed as T;
}

export interface ObjectJson {
  id: string;
  type_id: string;
  type_name: string;
  title: string;
  daily_date: string | null;
  properties: Record<string, unknown>;
  share_visibility: "follow" | "never";
  collection_ids: string[];
  backlinks: number;
  created_at: string;
  updated_at: string;
  blocks?: BlockJson[];
}

export interface BlockJson {
  id: string;
  object_id: string;
  kind: "text" | "quote" | "attachment";
  position: number;
  body: string | null;
  version: number;
  origin: { block_id: string; object_id: string; object_title: string; backlinks: number } | null;
  attachment: { id: string; filename: string; content_type: string; size_bytes: number } | null;
}

export interface TypeFieldJson {
  name: string;
  kind: "text" | "number" | "date" | "url" | "select" | "relation";
  required: boolean;
  options: string[] | null;
  target_type_id: string | null;
}

export interface TypeJson {
  id: string;
  name: string;
  builtin: boolean;
  fields: TypeFieldJson[];
}

export interface BacklinkJson {
  edge_id: string;
  from_object_id: string;
  from_title: string;
  kind: "quote" | "relation";
  field_name: string | null;
  block_id: string | null;
}

export interface ShareLinkJson {
  id: string;
  collection_id: string;
  url: string;
  status: "active" | "expired" | "revoked";
  expires_at: string;
  expires_at_display: string;
  expires_at_utc: string;
  time_zone: string;
  created_at: string;
  revoked_at: string | null;
}

export interface SessionJson {
  id: string;
  label: string;
  created_at: string;
  last_seen_at: string;
  current: boolean;
}

export interface QueryJson {
  id: string;
  name: string;
  type_id: string;
  text: string;
  group_by: string | null;
  sort: Array<{ key: string; dir: string }>;
}

export interface CollectionJson {
  id: string;
  name: string;
  object_count: number;
}

export interface BoardJson {
  collection_id: string;
  cards: Array<{ object_id: string; title: string; x: number; y: number; stored: boolean }>;
  edges: Array<{ id: number; from: string; to: string }>;
}

export interface GraphJson {
  nodes: Array<{ id: string; title: string; type_id: string; type_name: string; collection_ids: string[]; backlinks: number; in_scope?: boolean }>;
  edges: Array<{ id: number; from: string; to: string; kind: string }>;
}

export interface SearchResultJson {
  object_id: string;
  title: string;
  type_name: string;
  score: number;
  snippet: Array<{ text: string; match: boolean }>;
}

export interface TimelineJson {
  today: string;
  days: Array<{ date: string; object_id: string | null; block_count: number; blocks: Array<{ id: string; kind: string; excerpt: string; movable: boolean }> }>;
}

/** The first message from a 422 errors object, or a fallback. */
export function apiFail(e: unknown, key: string): string {
  if (e instanceof ApiFailure) {
    const errors = e.body.errors;
    if (errors !== undefined && errors[key] !== undefined) return errors[key];
    return e.body.error;
  }
  return "Not saved. Check your connection and try again.";
}
