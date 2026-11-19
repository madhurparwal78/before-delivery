export interface User {
  id: string;
  handle: string;
  email: string;
  verified: boolean;
}

export interface Version {
  pen_id: string;
  number: number;
  created_at: string;
  sha256: string;
  files: { html: string; css: string; js: string };
  libraries: string[];
  restored_from: number | null;
}

export interface VersionEntry {
  number: number;
  created_at: string;
  sha256: string;
  restored_from: number | null;
  added: number;
  removed: number;
  changed_chars: number;
}

export type ForkedFrom =
  | null
  | { pen_id: string; version: number; title: string; owner: string }
  | { removed: true }
  | { hidden: true };

export interface PenSummary {
  id: string;
  title: string;
  owner: string;
  visibility: "private" | "unlisted" | "public";
  tags: string[];
  head: number;
  updated_at: string;
  likes: number;
  forks: number;
}

export interface Pen extends PenSummary {
  liked: boolean;
  forked_from: ForkedFrom;
  version: Version | null;
}

export interface ShelfLibrary {
  id: string;
  name: string;
  version: string;
  global: string;
  path: string;
  license: string;
  bytes: number;
  sha256: string;
}

export interface CollectionInfo {
  id: string;
  title: string;
  count: number;
}

export interface Collection {
  id: string;
  title: string;
  pens: PenSummary[];
}

export interface ClientConfig {
  preview_delay_ms: number;
  draft_interval_ms: number;
  search_debounce_ms: number;
  loop_limit: number;
  pane_limit_bytes: number;
  max_tags: number;
  live_poll_ms: number;
}

export interface ApiError {
  status: number;
  error: string;
  message: string;
  fields?: Record<string, string>;
  head?: number;
}

let config: ClientConfig | null = null;

export async function getConfig(): Promise<ClientConfig> {
  if (config) return config;
  const res = await fetch("/api/config");
  config = (await res.json()) as ClientConfig;
  return config;
}

export class Api {
  static async request<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json; charset=utf-8";
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
    const res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return undefined as T;
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (!res.ok) {
      const err = json as { error?: string; message?: string; fields?: Record<string, string>; head?: number } | null;
      const e: ApiError = {
        status: res.status,
        error: err?.error ?? "unknown",
        message: err?.message ?? "Something went wrong.",
        fields: err?.fields,
        head: err?.head,
      };
      throw e;
    }
    return json as T;
  }

  static get<T>(path: string): Promise<T> {
    return Api.request<T>("GET", path);
  }
  static post<T>(path: string, body?: unknown, key?: string): Promise<T> {
    return Api.request<T>("POST", path, body, key);
  }
  static put<T>(path: string): Promise<T> {
    return Api.request<T>("PUT", path);
  }
  static del<T>(path: string): Promise<T> {
    return Api.request<T>("DELETE", path);
  }
  static patch<T>(path: string, body: unknown): Promise<T> {
    return Api.request<T>("PATCH", path, body);
  }
}

// The viewer's local time: <D> <Mon> <YYYY> <HH>:<MM>.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

export function formatTimeOnly(iso: string): string {
  const d = new Date(iso);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

export function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function widthBand(): "wide" | "medium" | "narrow" {
  const w = window.innerWidth;
  if (w >= 1024) return "wide";
  if (w >= 768) return "medium";
  return "narrow";
}
