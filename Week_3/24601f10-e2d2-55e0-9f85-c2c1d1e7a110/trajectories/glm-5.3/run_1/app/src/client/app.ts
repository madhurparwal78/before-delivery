import type { ApiConfig, Entrant, LiveMessage, Match } from "../shared/types.js";

export interface ApiErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
  match?: Match;
  entrants?: Entrant[];
  errors?: string[];
}

export class ApiFailure extends Error {
  status: number;
  body: ApiErrorBody;
  constructor(status: number, body: ApiErrorBody) {
    super(body.message ?? "Something went wrong.");
    this.status = status;
    this.body = body;
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiFailure(res.status, data as ApiErrorBody);
  return data as T;
}

export async function upload(path: string, file: File): Promise<unknown> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(path, { method: "POST", body: form, credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiFailure(res.status, data as ApiErrorBody);
  return data;
}

export interface AppState {
  config: ApiConfig | null;
  username: string | null;
  pageNotice: string;
  pageError: string;
  liveDown: boolean;
  reducedMotion: boolean;
}

export const state: AppState = {
  config: null,
  username: null,
  pageNotice: "",
  pageError: "",
  liveDown: false,
  reducedMotion: false,
};

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

let noticeTimer: number | undefined;

export function setPageNotice(text: string): void {
  state.pageNotice = text;
  state.pageError = "";
  renderRoot();
  const toastMs = state.config?.toast_ms ?? 4000;
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => {
    state.pageNotice = "";
    renderRoot();
  }, toastMs);
}

export function setPageError(text: string): void {
  state.pageError = text;
  state.pageNotice = "";
  renderRoot();
}

export function clearPageMessages(): void {
  state.pageNotice = "";
  state.pageError = "";
}

// ---- live channel ----
type Listener = (message: LiveMessage) => void;
const liveListeners = new Set<Listener>();
let liveSocket: WebSocket | null = null;
let liveTournamentId: string | null = null;
let reconnectTimer: number | undefined;
let lastSeq = 0;

export function onLiveMessage(fn: Listener): () => void {
  liveListeners.add(fn);
  return () => liveListeners.delete(fn);
}

function dispatchLive(msg: LiveMessage): void {
  if (msg.seq > lastSeq) lastSeq = msg.seq;
  for (const fn of liveListeners) fn(msg);
}

export function connectLive(tournamentId: string, shareCode: string | null, onDown: () => void, onUp: () => void): void {
  disconnectLive();
  liveTournamentId = tournamentId;
  lastSeq = 0;
  const open = (): void => {
    const query = new URLSearchParams();
    if (shareCode) query.set("share", shareCode);
    if (lastSeq > 0) query.set("after", String(lastSeq));
    const qs = query.toString();
    const ws = new WebSocket(
      `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/tournaments/${tournamentId}/live${qs ? "?" + qs : ""}`
    );
    liveSocket = ws;
    ws.onmessage = (ev) => {
      try {
        dispatchLive(JSON.parse(ev.data as string) as LiveMessage);
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onopen = () => {
      state.liveDown = false;
      onUp();
    };
    ws.onclose = () => {
      if (liveTournamentId !== tournamentId) return;
      state.liveDown = true;
      onDown();
      // a dropped connection retries within 2 seconds and catches up using after
      window.clearTimeout(reconnectTimer);
      reconnectTimer = window.setTimeout(() => {
        if (liveTournamentId === tournamentId) open();
      }, 1200);
    };
  };
  open();
}

export function disconnectLive(): void {
  window.clearTimeout(reconnectTimer);
  liveTournamentId = null;
  if (liveSocket) {
    const sock = liveSocket;
    liveSocket = null;
    sock.onclose = null;
    sock.close();
  }
}

// ---- router ----
type RouteHandler = (params: Record<string, string>) => Promise<(() => void) | void> | (() => void) | (() => void) | Promise<(() => void) | void>;
interface Route {
  pattern: RegExp;
  names: string[];
  handler: RouteHandler;
}
const routes: Route[] = [];
let routeCleanup: (() => void) | null = null;

export function route(pattern: string, handler: RouteHandler): void {
  const names: string[] = [];
  const source = pattern
    .split("/")
    .map((part) => {
      if (part.startsWith(":")) {
        names.push(part.slice(1));
        return "([^/]+)";
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  routes.push({ pattern: new RegExp(`^${source}$`), names, handler });
}

export function navigate(path: string, replace = false): void {
  if (replace) history.replaceState({}, "", path);
  else history.pushState({}, "", path);
  render();
}

export let renderRoot: () => void = () => {};

export function setRenderRoot(fn: () => void): void {
  renderRoot = fn;
}

export async function render(): Promise<void> {
  routeCleanup?.();
  routeCleanup = null;
  const path = location.pathname;
  for (const r of routes) {
    const m = path.match(r.pattern);
    if (m) {
      const params: Record<string, string> = {};
      r.names.forEach((n, i) => {
        params[n] = decodeURIComponent(m[i + 1]!);
      });
      const result = await Promise.resolve(r.handler(params));
      routeCleanup = typeof result === "function" ? result : null;
      return;
    }
  }
  routeCleanup = await notFoundPage();
}

// ---- dom helpers ----
export type Child = Node | string | null | undefined | false | Child[];

export interface ElOptions {
  class?: string;
  attrs?: Record<string, string>;
  on?: Record<string, (ev: Event) => void>;
  role?: string;
  ariaLabel?: string;
  ariaSelected?: string;
  ariaPressed?: string;
  data?: Record<string, string>;
  href?: string;
  type?: string;
  id?: string;
  tabIndex?: number;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: ElOptions = {},
  children: Child[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.role) node.setAttribute("role", opts.role);
  if (opts.ariaLabel) node.setAttribute("aria-label", opts.ariaLabel);
  if (opts.ariaSelected !== undefined) node.setAttribute("aria-selected", opts.ariaSelected);
  if (opts.ariaPressed !== undefined) node.setAttribute("aria-pressed", opts.ariaPressed);
  if (opts.id) node.id = opts.id;
  if (opts.tabIndex !== undefined) node.tabIndex = opts.tabIndex;
  for (const [k, v] of Object.entries(opts.attrs ?? {})) node.setAttribute(k, v);
  for (const [k, v] of Object.entries(opts.data ?? {})) node.dataset[k] = v;
  for (const [k, v] of Object.entries(opts.on ?? {})) node.addEventListener(k, v);
  if (opts.href !== undefined) (node as HTMLAnchorElement).href = opts.href;
  if (opts.type !== undefined) (node as HTMLInputElement).type = opts.type;
  appendChildren(node, children);
  return node;
}

function appendChildren(node: HTMLElement, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) {
      appendChildren(node, c);
      continue;
    }
    if (typeof c === "string") node.appendChild(document.createTextNode(c));
    else node.appendChild(c as Node);
  }
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export const appEl = (): HTMLElement => document.getElementById("app")!;
export const overlaysEl = (): HTMLElement => document.getElementById("overlays")!;

export async function notFoundPage(): Promise<() => void> {
  document.title = "Cupfold";
  const app = appEl();
  clear(app);
  app.appendChild(
    el("main", { class: "page" }, [
      el("div", { class: "notfound" }, [
        el("h1", {}, ["We couldn't find that page."]),
        el("a", { href: "/", class: "btn" }, ["Back to Cupfold"]),
      ]),
    ])
  );
  return () => {};
}

/** Page notice/error bands and the live connection band, rendered on every page. */
export function bands(): Node[] {
  const out: Node[] = [];
  if (state.liveDown) {
    out.push(el("div", { class: "band band-live" }, ["Live updates paused. Reconnecting..."]));
  }
  if (state.pageError) {
    out.push(el("div", { class: "band band-error", attrs: { role: "alert" } }, [state.pageError]));
  }
  if (state.pageNotice) {
    out.push(el("div", { class: "band band-notice", attrs: { role: "status", id: "page-notice" } }, [state.pageNotice]));
  }
  return out;
}


/** The published polite status regions. */
/**
 * The published status regions. Bracket announcements appear on bracket,
 * share and me pages; Your action on bracket, setup, me and disputes pages.
 */
export function statusRegions(_page: "bracket" | "setup" | "me" | "disputes" | "share"): Node[] {
  return [
    el("div", { class: "sr-only", attrs: { role: "status", id: "bracket-announcements", "aria-label": "Bracket announcements" } }, [""]),
    el("div", { class: "sr-only", attrs: { role: "status", id: "your-action", "aria-label": "Your action" } }, [""]),
  ];
}
