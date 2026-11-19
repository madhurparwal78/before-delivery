// The client runtime: api helper, live stream, shared stores. The browser
// never polls; it refetches only after a push or a reconnect.

export interface MemberWorkspace { id: string; name: string; slug: string; role: string }
export interface Me { id: string; name: string; email: string; workspaces: MemberWorkspace[] }

export interface RunListItem {
  id: string; number: number; automation_id: string; automation_name: string;
  status: string; test: boolean; version: number | null; replay_of: string | null;
  started_at: string | null; finished_at: string | null; message: string | null;
}

export interface StepRec {
  id: string; kind: string; name: string; col: number; row: number; status: string; ord: number;
  reused: boolean; input: unknown; output: unknown; log: string[]; attempts: number;
  started_at: string | null; finished_at: string | null; due_at: string | null; retry_at: string | null;
}

export interface TriggerRec { id: "trigger"; kind: string; name: string; col: number; row: number; fields: Record<string, unknown>; sample: unknown }
export interface StepDraft { id: string; kind: string; name: string; col: number; row: number; fields: Record<string, unknown> }
export interface EdgeRec { id: string; from: string; port: string; to: string; order: number }

export interface AutomationShape {
  id: string; name: string; trigger_kind: string; revision: number; live_version: number | null;
  drain_count: number; next_run_at: string | null;
  trigger: TriggerRec; steps: StepDraft[]; edges: EdgeRec[];
}

export interface RunDetail extends RunListItem {
  trigger: unknown; steps: StepRec[]; edges: EdgeRec[];
}

export interface TableShape { id: string; name: string; columns: { name: string; type: string }[]; row_count: number }

export const TRIGGER_KINDS = ["form", "schedule", "webhook", "row_added", "manual"];
export const STEP_KINDS = ["set", "filter", "branch", "loop", "wait", "send_email", "add_row", "update_row", "call_webhook"];
export const OPERATORS = ["equals", "not equals", "contains", "greater than", "less than", "is empty", "is not empty"];
export const CANVAS_COLS = 24;
export const CANVAS_ROWS = 12;

export interface Shell {
  breakpoint: number;
  timeZone: string;
  publicUrl: string;
}

export const SHELL: Shell = (window as unknown as { __SHELL__: Shell }).__SHELL__ ?? { breakpoint: 720, timeZone: "America/New_York", publicUrl: "" };

import { h as preactH } from "preact";
// The runtime re-exports h with a permissive signature: page components pass
// heterogeneous props and children, and the exact VNode generics add no value
// at the call sites.
export const h: (type: any, props: any, ...children: any[]) => any =
  ((type: any, props: any, ...children: any[]) => preactH(type, props, ...(children ?? []))) as any;

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(message: string, status: number, body: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.body = body ?? {};
  }
}

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers as Record<string, string> ?? {}) },
    credentials: "same-origin",
  });
  const text = await r.text();
  let body: unknown = null;
  if (text) { try { body = JSON.parse(text); } catch { body = null; } }
  if (!r.ok) {
    const b = (body ?? {}) as Record<string, unknown>;
    throw new ApiError(typeof b.error === "string" ? b.error : "Request failed", r.status, b);
  }
  return body as T;
}

// ---------- time formatting (server gives ISO; we render in the zone) ------
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: SHELL.timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZoneName: "short",
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")} ${get("timeZoneName")}`;
  } catch {
    return iso;
  }
}

// ---------- live updates ----------
type Listener = (ev: Record<string, unknown>) => void;
const listeners = new Set<Listener>();
let es: EventSource | null = null;
let currentWs: string | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let paused = false;
const pauseListeners = new Set<(p: boolean) => void>();
type AnnounceFn = (s: string) => void;
const announceListeners = new Set<AnnounceFn>();

export function onEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function onPauseChange(fn: (p: boolean) => void): () => void {
  pauseListeners.add(fn);
  return () => pauseListeners.delete(fn);
}

export function onAnnouncement(fn: (s: string) => void): () => void {
  announceListeners.add(fn);
  return () => announceListeners.delete(fn);
}

export function connectStream(wsId: string, draftAid?: string | null): void {
  if (es && currentWs === wsId && (es as unknown as { __draft?: string }).__draft === (draftAid ?? null)) return;
  if (es) { es.close(); es = null; }
  currentWs = wsId;
  const url = `/api/workspaces/${wsId}/events` + (draftAid ? `?draft=${encodeURIComponent(draftAid)}` : "");
  const conn = new EventSource(url);
  (conn as unknown as { __draft?: string }).__draft = draftAid ?? undefined;
  es = conn;
  es.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data) as Record<string, unknown>;
      if (paused) return;
      if (data.type === "announce") {
        const s = String(data.sentence ?? "");
        announceListeners.forEach((l) => l(s));
        return;
      }
      listeners.forEach((l) => l(data));
    } catch { /* ignore malformed */ }
  };
  es.onerror = () => {
    setPaused(true);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      const wasWs = currentWs;
      if (es) { es.close(); es = null; }
      if (wasWs) connectStream(wasWs, draftAid);
    }, 2000);
  };
  es.onopen = () => {
    if (paused) {
      setPaused(false);
      listeners.forEach((l) => l({ type: "__refetch" }));
    }
  };
}

function setPaused(p: boolean): void {
  paused = p;
  pauseListeners.forEach((l) => l(p));
}

// ---------- router ----------
export interface Route { path: string; parts: string[] }
const routeListeners = new Set<() => void>();
function parseRoute(): Route {
  const path = location.pathname.replace(/\/+$/, "") || "/";
  return { path, parts: path.split("/").filter(Boolean).map(decodeURIComponent) };
}
let currentRoute: Route = parseRoute();

export function route(): Route { return currentRoute }
export function navigate(path: string, replace = false): void {
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  currentRoute = parseRoute();
  routeListeners.forEach((l) => l());
}
export function onRouteChange(fn: () => void): () => void {
  routeListeners.add(fn);
  return () => routeListeners.delete(fn);
}

// ---------- small helpers ----------
export function json2(text: string, indent = 2): string {
  try {
    return JSON.stringify(JSON.parse(text), null, indent);
  } catch {
    return text;
  }
}

export function objJson(v: unknown): string {
  if (v === null || v === undefined) return "{}";
  if (typeof v === "string") { try { return JSON.stringify(JSON.parse(v), null, 2); } catch { return v; } }
  return JSON.stringify(v, null, 2);
}
