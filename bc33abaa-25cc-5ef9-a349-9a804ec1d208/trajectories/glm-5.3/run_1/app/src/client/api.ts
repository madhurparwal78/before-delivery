import type { Graph, Node as NodeT, Layer as LayerT, State as StateT, Transition as TransitionT, CameraView as CameraViewT } from "../shared/graph-types";

export type { Graph, NodeT, LayerT, StateT, TransitionT, CameraViewT };

export interface ApiError {
  status: number;
  body: Record<string, unknown>;
}

export interface Me {
  member?: { id: string; name: string; email: string; role: string; joinedAt: string };
  agent?: { id: string; name: string; scope: string };
  workspace: { id: string; name: string; timeZone: string };
  subscription?: Subscription | null;
}

export interface Subscription {
  state: "trial" | "active" | "past_due" | "suspended" | "cancelled";
  plan: string;
  period: string;
  seatsPurchased: number;
  extraSeats: number;
  trialEndsAt: string | null;
  graceEndsAt: string | null;
  pendingChange: { plan: string; period: string; extraSeats: number; effectiveAt: string } | null;
}


export interface AuthorT {
  kind: "member" | "agent" | "system";
  id: string;
  name: string;
}

export interface OpT {
  seq: number;
  batchId: string;
  type: string;
  payload: Record<string, unknown>;
  inverse: { type: string; payload: Record<string, unknown> };
  author: AuthorT;
  createdAt: string;
  undoOf: string | null;
  redoOf: string | null;
  restoreTo: number | null;
}

export interface VersionT {
  id: string;
  sceneId: string;
  number: number;
  label: string;
  state: "draft" | "in_review" | "scheduled" | "published" | "withdrawn";
  seq: number;
  createdBy: AuthorT;
  approvals: { member: AuthorT; at: string }[];
  publishAt: string | null;
  publishedAt: string | null;
  embedId: string | null;
}

export interface CommentT {
  id: string;
  nodeId: string;
  body: string;
  author: AuthorT;
  mentions: { id: string; name: string }[];
  resolved: boolean;
  createdAt: string;
}

export function apiErrorFrom(status: number, body: Record<string, unknown>): ApiError {
  return { status, body };
}

export async function api(path: string, opts: { method?: string; body?: unknown; raw?: boolean; headers?: Record<string, string> } = {}): Promise<unknown> {
  const res = await fetch(path, {
    method: opts.method ?? "GET",
    headers: {
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(opts.headers ?? {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = {};
  }
  if (!res.ok) {
    throw apiErrorFrom(res.status, body);
  }
  return body;
}

export function fieldErrors(err: unknown): Record<string, string> {
  if (typeof err === "object" && err !== null && "status" in err) {
    const e = err as ApiError;
    if (e.status === 422 && typeof e.body.errors === "object" && e.body.errors !== null) {
      return e.body.errors as Record<string, string>;
    }
  }
  return {};
}

export function errorText(err: unknown): string {
  if (typeof err === "object" && err !== null && "status" in err) {
    const e = err as ApiError;
    if (e.status === 503 && (e.body.service === "billing" || e.body.service === "file_storage")) {
      return e.body.service === "billing"
        ? "Billing is unavailable right now. Nothing was charged. Editing and publishing keep working."
        : "File storage is unavailable. Your edits are saved; uploads, versions and publishing will resume when it is back.";
    }
    if (e.status === 422 && typeof e.body.errors === "object") {
      const errors = e.body.errors as Record<string, string>;
      return Object.values(errors)[0] ?? "Invalid input.";
    }
    if (typeof e.body.error === "string") {
      return String(e.body.error);
    }
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

export function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const dateTimeFmt = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export function localTime(d: Date, timeZone: string): string {
  const parts = dateTimeFmt.formatToParts(d).reduce<Record<string, string>>((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} (${timeZone})`;
}

export function localDate(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function localTimeOnly(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(d);
}

export function utcSeconds(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Shortest decimal form with at most 4 decimals, ASCII hyphen for minus. */
export function num(value: number): string {
  const r = Math.round(value * 10000) / 10000;
  const s = String(r);
  return s.replace(/^-/, "-");
}

export function vecText(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((c) => num(Number(c))).join(", ")}]`;
  return String(v);
}
