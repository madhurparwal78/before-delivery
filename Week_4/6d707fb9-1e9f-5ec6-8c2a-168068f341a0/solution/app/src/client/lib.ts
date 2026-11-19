import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ApiErrorBody } from "../shared/api";
import { SESSION_ENDED_COPY } from "../shared/copy";

// ---- announcements

let alternate = false;

/** One polite live region; a message made twice in a row still changes the region's content. */
export function announce(message: string): void {
  const region = document.getElementById("announcements") as HTMLElement;
  alternate = !alternate;
  region.textContent = alternate ? message : `${message}​`;
}

// ---- small subscribable stores

type Listener = () => void;

function store<T>(initial: T): { get: () => T; set: (value: T) => void; use: () => T } {
  let value = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => value,
    set: (next) => {
      if (next === value) return;
      value = next;
      listeners.forEach((listener) => listener());
    },
    use: () => {
      const [, setTick] = useState(0);
      useLayoutEffect(() => {
        const listener = (): void => setTick((tick) => tick + 1);
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      }, []);
      return value;
    },
  };
}

// ---- API calls

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> | undefined,
    readonly body: ApiErrorBody["error"],
  ) {
    super(message);
  }
}

export class NetworkFailure extends Error {}

export const sessionEnded = store(false);

function endSession(): void {
  sessionEnded.set(true);
  saveDraft();
  announce(SESSION_ENDED_COPY);
}

interface CallOptions {
  method?: string;
  json?: unknown;
  raw?: BodyInit;
  type?: string;
  headers?: Record<string, string>;
  /** A wrong password also answers 401, and on a private page a session means nothing. */
  noSessionWatch?: boolean;
}

async function raw(path: string, options: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers };
  let body: BodyInit | undefined = options.raw;
  if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.json);
  } else if (options.type) {
    headers["Content-Type"] = options.type;
  }
  let response: Response;
  try {
    response = await fetch(path, { method: options.method ?? "GET", headers, body });
  } catch {
    throw new NetworkFailure("The request did not reach the server.");
  }
  if (response.ok) return response;
  const text = await response.text();
  let error: ApiErrorBody["error"];
  try {
    error = (JSON.parse(text) as ApiErrorBody).error;
  } catch {
    throw new NetworkFailure("The answer could not be read.");
  }
  if (response.status === 401 && !options.noSessionWatch && (error.code === "session_ended" || error.code === "not_signed_in")) {
    endSession();
  }
  throw new ApiFailure(response.status, error.code, error.message, error.fields, error);
}

export async function api<T>(path: string, options: CallOptions = {}): Promise<T> {
  const response = await raw(path, options);
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export const post = <T>(path: string, json?: unknown, options: CallOptions = {}): Promise<T> =>
  api<T>(path, { ...options, method: "POST", json: json ?? {} });

export const patch = <T>(path: string, json: unknown): Promise<T> => api<T>(path, { method: "PATCH", json });

export const remove = (path: string): Promise<void> => api<void>(path, { method: "DELETE" });

/** Hands a file to the browser; the app's own address decides the name. */
export async function download(path: string, fallbackName: string, options: CallOptions = {}): Promise<void> {
  const response = await raw(path, options);
  const blob = await response.blob();
  const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1];
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name ? decodeURIComponent(name) : fallbackName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

export function failureText(error: unknown): string {
  if (error instanceof ApiFailure) return error.message;
  return "Couldn't reach the desk. Nothing was saved. Try again.";
}

// ---- location

interface Place {
  pathname: string;
  search: string;
  hash: string;
  restore: { scrollY: number; focus: string | null } | null;
}

function placeNow(restore: Place["restore"] = null): Place {
  return { pathname: location.pathname, search: location.search, hash: location.hash, restore };
}

export const place = store<Place>(placeNow());

const FULL_LOAD = /^\/(a|s|p|api|assets)\//;

export function navigate(address: string, options: { restoreFocus?: string | null } = {}): void {
  const url = new URL(address, location.href);
  if (FULL_LOAD.test(url.pathname)) {
    location.href = address;
    return;
  }
  history.replaceState({ ...(history.state as object), scrollY, focus: options.restoreFocus ?? null }, "");
  history.pushState({}, "", url.pathname + url.search + url.hash);
  place.set(placeNow());
  if (url.pathname === "/") window.fioPlayIntro?.();
}

/** Holds a committed change in the address as one history entry. */
export function pushAddress(search: string): void {
  history.pushState({}, "", location.pathname + search);
  place.set(placeNow());
}

export function replaceAddress(search: string): void {
  history.replaceState(history.state, "", location.pathname + search);
  place.set(placeNow());
}

export function startNavigation(): void {
  history.scrollRestoration = "manual";
  addEventListener("popstate", () => {
    const state = history.state as { scrollY?: number; focus?: string | null } | null;
    place.set(placeNow(state && typeof state.scrollY === "number" ? { scrollY: state.scrollY, focus: state.focus ?? null } : null));
  });
  document.addEventListener("click", (event) => {
    const target = event.target as Element | null;
    const link = target?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!link || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    if (link.target || link.hasAttribute("download") || link.origin !== location.origin || FULL_LOAD.test(link.pathname)) return;
    event.preventDefault();
    navigate(link.pathname + link.search + link.hash, { restoreFocus: link.dataset.restore ?? null });
  });
}

// ---- screen refresh

const SCREEN_REFRESH_MS = 5000;

export const refreshFailed = store(false);
const refreshers = new Set<() => Promise<void>>();

async function refreshAll(): Promise<void> {
  if (sessionEnded.get() || !refreshers.size) return;
  const results = await Promise.allSettled([...refreshers].map((refresher) => refresher()));
  const failed = results.some(
    (outcome) => outcome.status === "rejected" && (outcome.reason instanceof NetworkFailure || (outcome.reason instanceof ApiFailure && outcome.reason.status >= 500)),
  );
  refreshFailed.set(failed);
}

export function startRefresh(): void {
  setInterval(() => void refreshAll(), SCREEN_REFRESH_MS);
}

export function useRefresher(refresher: () => Promise<void>): void {
  const latest = useRef(refresher);
  latest.current = refresher;
  useLayoutEffect(() => {
    const entry = (): Promise<void> => latest.current();
    refreshers.add(entry);
    return () => {
      refreshers.delete(entry);
    };
  }, []);
}

const lastKnown = new Map<string, unknown>();

/** What the document already carries for an address; the first read still refreshes it. */
export function seedResource(path: string, data: unknown): void {
  lastKnown.set(path, data);
}

interface Resource<T> {
  data: T | null;
  missing: boolean;
  /** The first read has answered, either way, so what depends on it can take its place. */
  settled: boolean;
  reload: () => Promise<void>;
}

/** Reads an address and keeps it fresh in place: the last figures stay until new ones arrive. */
export function useResource<T>(path: string | null, options: { watchSession?: boolean } = {}): Resource<T> {
  const [data, setData] = useState<T | null>(() => (path ? ((lastKnown.get(path) as T) ?? null) : null));
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);
  const sequence = useRef(0);
  const shown = useRef<string | null>(null);
  const noSessionWatch = options.watchSession === false;

  const reload = async (): Promise<void> => {
    if (!path) return;
    const mine = (sequence.current += 1);
    try {
      const fresh = await api<T>(path, { noSessionWatch });
      if (mine !== sequence.current) return;
      lastKnown.set(path, fresh);
      setMissing(false);
      setFailed(false);
      const text = JSON.stringify(fresh);
      if (text !== shown.current) {
        shown.current = text;
        setData(fresh);
      }
    } catch (error) {
      if (mine === sequence.current) {
        setFailed(true);
        if (error instanceof ApiFailure && (error.status === 404 || error.status === 410)) setMissing(true);
      }
      throw error;
    }
  };

  useLayoutEffect(() => {
    shown.current = null;
    sequence.current += 1;
    setMissing(false);
    setFailed(false);
    setData(path ? ((lastKnown.get(path) as T) ?? null) : null);
    reload().catch(() => undefined);
  }, [path]);

  useRefresher(reload);
  return { data, missing, settled: data !== null || failed, reload };
}

// ---- drafts kept through a session end

interface Draft {
  address: string;
  dialog: string;
  values: Record<string, unknown>;
}

const DRAFT_KEY = "fio.draft";
let activeForm: { dialog: string; values: () => Record<string, unknown> } | null = null;

export function setActiveForm(form: typeof activeForm): void {
  activeForm = form;
}

export function saveDraft(): void {
  if (!activeForm) return;
  const draft: Draft = { address: location.pathname + location.search, dialog: activeForm.dialog, values: activeForm.values() };
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

export function draftFor(dialog: string): Record<string, unknown> | null {
  const text = localStorage.getItem(DRAFT_KEY);
  if (!text) return null;
  const draft = JSON.parse(text) as Draft;
  return draft.dialog === dialog && draft.address === location.pathname + location.search ? draft.values : null;
}

export function clearDraft(): void {
  localStorage.removeItem(DRAFT_KEY);
}

// ---- focus

export function focusHeading(): void {
  document.querySelector<HTMLElement>("#root h1")?.focus();
}

export function useTitle(heading: string | null | undefined): void {
  useLayoutEffect(() => {
    if (heading) document.title = `${heading} — Fio Contado Desk`;
  }, [heading]);
}

export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useLayoutEffect(() => {
    const list = matchMedia(query);
    const listener = (): void => setMatches(list.matches);
    listener();
    list.addEventListener("change", listener);
    return () => list.removeEventListener("change", listener);
  }, [query]);
  return matches;
}

/** Calls back after the published 300 ms pause since the last change; the latest input wins. */
export function usePause(): (work: () => void) => void {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  return (work) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(work, 300);
  };
}

export function useAction(): [boolean, (work: () => Promise<void>) => Promise<void>] {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const run = async (work: () => Promise<void>): Promise<void> => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await work();
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return [busy, run];
}

declare global {
  interface Window {
    fioPlayIntro?: () => boolean;
    fioIntroPlaying?: boolean;
  }
}
