/**
 * The browser API client and the live message stream.
 */
import { signal } from "./core";
import { formatInZone } from "../shared/tz";

export interface Me {
  username: string;
  time_zone: string;
  space: { slug: string; name: string; role: string };
  spaces: { slug: string; name: string; role: string }[];
  seq: number;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  position?: number;
  fields?: Record<string, string>;
}

export class ApiFail extends Error {
  constructor(
    public status: number,
    public body: ApiErrorBody,
  ) {
    super(body.message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
    },
    credentials: "same-origin",
  });
  if (res.status === 204) return undefined as T;
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    throw new ApiFail(res.status, (body as ApiErrorBody) ?? { error: "unknown", message: "Spoorline can't reach the server." });
  }
  return body as T;
}

// ---------- Global state ----------

export const me = signal<Me | null>(null);
export const serverNow = signal<number>(Date.now());
export const serverNowLoaded = signal(false);
export const ingestLine = signal<{ stored: number; failed: number } | null>(null);
export const announcements: string[] = [];
export const announcement = signal<string>("");
export const notice = signal<string>("");
export const liveSeq = signal<number>(0);
export const pendingWrites = signal<number>(0);
export const ingestStatusLoaded = signal(false);

/** Announce one or more sentences (joined by one space). */
export function announce(...sentences: string[]): void {
  const joined = sentences.filter(Boolean).join(" ");
  if (joined === "") return;
  announcement.set(joined);
}

export function showNotice(text: string): void {
  notice.set(text);
  announce(text);
}

/** Show a success notice without the announcement (for silent page loads). */
export function setNotice(text: string): void {
  notice.set(text);
}

export async function refreshTime(): Promise<void> {
  try {
    const t = await api<{ now: string; now_ms: number }>("/api/time");
    serverNow.set(t.now_ms);
    serverNowLoaded.set(true);
  } catch {
    // keep the last known server time
  }
}

export async function loadMe(): Promise<void> {
  try {
    const m = await api<Me>("/api/me");
    me.set(m);
  } catch {
    me.set(null);
  }
}

/** The viewer's time zone. */
export function timeZone(): string {
  return me()?.time_zone ?? "UTC";
}

/** Display time for a millisecond instant. */
export function displayTime(ms: number): string {
  return formatInZone(timeZone(), ms);
}

/** Display time for an ISO string. */
export function displayIso(iso: string): string {
  const ms = Date.parse(iso);
  return isNaN(ms) ? iso : formatInZone(timeZone(), ms);
}

// ---------- Live messages ----------

type LiveHandler = (data: Record<string, unknown>) => void;
let liveStarted = false;

export function addLiveHandler(kind: string, handler: LiveHandler): void {
  const list = handlerLists.get(kind) ?? [];
  list.push(handler);
  handlerLists.set(kind, list);
}

export function removeLiveHandler(kind: string, handler: LiveHandler): void {
  const list = handlerLists.get(kind) ?? [];
  const idx = list.indexOf(handler);
  if (idx >= 0) list.splice(idx, 1);
}

const handlerLists = new Map<string, LiveHandler[]>();

function dispatch(kind: string, data: Record<string, unknown>): void {
  const list = handlerLists.get(kind) ?? [];
  for (const fn of [...list]) {
    try {
      fn(data);
    } catch {
      // a broken handler never breaks the stream
    }
  }
}

/** The page's own handlers, applied in the message handler with no timer or animation frame. */
export function startLive(spaceSlug: string): void {
  if (liveStarted) return;
  liveStarted = true;
  const es = new EventSource(`/api/events?space=${encodeURIComponent(spaceSlug)}`);
  es.addEventListener("clock", (e) => {
    const data = JSON.parse((e as MessageEvent).data) as { now: string; now_ms: number; seq: number };
    serverNow.set(data.now_ms);
    liveSeq.set(data.seq);
    dispatch("clock", data);
  });
  for (const kind of ["alert", "inbox", "case", "upload", "lifecycle"]) {
    es.addEventListener(kind, (e) => {
      const data = JSON.parse((e as MessageEvent).data) as Record<string, unknown>;
      liveSeq.set(Number(data.seq ?? 0));
      dispatch(kind, data);
    });
  }
  es.onerror = () => {
    // The browser's own EventSource reconnects.
  };
}
