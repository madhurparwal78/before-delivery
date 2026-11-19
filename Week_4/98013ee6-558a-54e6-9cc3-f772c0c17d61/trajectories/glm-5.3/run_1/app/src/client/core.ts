// ---------- Client foundation: router, api, clock, announcements ----------

export interface PinJson {
  id: number;
  version: number;
  title: string;
  description: string;
  alt: string;
  source: string | null;
  source_host: string | null;
  tags: string[];
  owner: { id: number; name: string; handle: string };
  board: { id: number; name: string; visibility: "public" | "secret" };
  section: { id: number; name: string } | null;
  position: number;
  image: { width: number; height: number; sha256: string; variants: { width: number; url: string }[]; original_url: string };
  saved_from: { pin_id: number | null; user_name: string; removed: boolean } | null;
  saves: number;
  comments: number;
  reactions: number;
  my_reaction: string | null;
  created_at: string;
}

export interface BoardJson {
  id: number;
  name: string;
  visibility: "public" | "secret";
  owner: { id: number; name: string; handle: string };
  role: "owner" | "editor" | "viewer" | null;
  seq: number;
  pin_count: number;
  followers: number;
  following: boolean;
  cover: number | null;
  created_at: string;
  last_saved_at: string | null;
  order: { unsectioned: number[]; sections: { id: number; name: string; pins: number[] }[] };
  pins?: PinJson[];
}

export interface AppConfig {
  now: string;
  time_zone: string;
  undo_seconds: number;
  invite_ttl_seconds: number;
  limits: { image_max_bytes: number; image_max_pixels: number; title_max: number; description_max: number; comment_max: number; board_name_max: number };
}

export interface Me { id: number; name: string; handle: string; email?: string }

export const state: {
  config: AppConfig | null;
  me: Me | null;
  route: Route;
  motion: "full" | "reduced";
  now: Date;
  nowBaseReal: number;
} = {
  config: null,
  me: null,
  route: { kind: "landing" },
  motion: "full",
  now: new Date(),
  nowBaseReal: Date.now(),
};

export type Route =
  | { kind: "landing" }
  | { kind: "signup" }
  | { kind: "signin"; next?: string }
  | { kind: "home" }
  | { kind: "pin"; id: number }
  | { kind: "create" }
  | { kind: "board"; id: number }
  | { kind: "boards" }
  | { kind: "profile"; handle: string; tab: "boards" | "pins"; sort: string }
  | { kind: "search"; q: string; tag: string; board: number | null }
  | { kind: "invite"; token: string }
  | { kind: "notfound" };

export function parseRoute(path: string, search: string, signedIn: boolean): Route {
  const params = new URLSearchParams(search);
  const m = (re: RegExp): RegExpMatchArray | null => path.match(re);
  // The root is the landing page for a visitor and the home feed for a signed-in browser.
  if (path === "/") return signedIn ? { kind: "home" } : { kind: "landing" };
  if (path === "/signup") return { kind: "signup" };
  if (path === "/signin") return { kind: "signin", next: params.get("next") ?? undefined };
  if (path === "/create") return { kind: "create" };
  if (path === "/boards") return { kind: "boards" };
  if (m(/^\/pin\/(\d+)$/)) return { kind: "pin", id: Number(m(/^\/pin\/(\d+)$/)![1]) };
  if (m(/^\/b\/(\d+)$/)) return { kind: "board", id: Number(m(/^\/b\/(\d+)$/)![1]) };
  if (m(/^\/u\/([\w.]+)$/)) {
    const handle = m(/^\/u\/([\w.]+)$/)![1];
    return { kind: "profile", handle, tab: params.get("tab") === "pins" ? "pins" : "boards", sort: params.get("sort") ?? "last_saved" };
  }
  if (path === "/search") return { kind: "search", q: params.get("q") ?? "", tag: params.get("tag") ?? "", board: params.get("board") ? Number(params.get("board")) : null };
  if (m(/^\/invites\/([A-Za-z0-9_-]+)$/)) return { kind: "invite", token: m(/^\/invites\/([A-Za-z0-9_-]+)$/)![1] };
  return { kind: "notfound" };
}

export function routePath(route: Route): string {
  switch (route.kind) {
    case "landing": case "home": return "/";
    case "signup": return "/signup";
    case "signin": return "/signin" + (route.next ? `?next=${encodeURIComponent(route.next)}` : "");
    case "pin": return `/pin/${route.id}`;
    case "create": return "/create";
    case "board": return `/b/${route.id}`;
    case "boards": return "/boards";
    case "profile": return `/u/${route.handle}` + (route.tab === "pins" ? "?tab=pins" : "") + (route.sort !== "last_saved" ? `&sort=${route.sort}` : "");
    case "search": return "/search?q=" + encodeURIComponent(route.q) + (route.tag ? `&tag=${route.tag}` : "") + (route.board ? `&board=${route.board}` : "");
    case "invite": return `/invites/${route.token}`;
    case "notfound": return "/notfound";
  }
}

// ---------- API ----------

export class ApiFailure extends Error {
  constructor(public status: number, public code: string, public body: Record<string, unknown>) {
    super(code);
  }
}

export async function api(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(path, init);
  if (res.status === 204) return null;
  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
    throw new ApiFailure(res.status, String(record.error ?? "unknown"), record);
  }
  return body;
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  return api(path, init) as Promise<T>;
}

// ---------- Business clock (DP-71) ----------

export function businessNow(): Date {
  return new Date(state.now.getTime() + (Date.now() - state.nowBaseReal));
}

export function setBusinessNow(iso: string): void {
  state.now = new Date(iso);
  state.nowBaseReal = Date.now();
  document.querySelectorAll<HTMLElement>("time[data-instant]").forEach(el => {
    el.textContent = relativeTime(el.dataset.instant!);
  });
}

/** The published relative-time rule. */
export function relativeTime(instant: string): string {
  const at = new Date(instant).getTime();
  const now = businessNow().getTime();
  const diff = Math.max(0, now - at);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(diff / 86_400_000);
  if (days < 7) return `${days}d`;
  if (days < 28) return `${Math.floor(days / 7)}w`;
  // Mar 3 in the same year, or Mar 3, 2026 in another year, in the configured zone.
  const zone = state.config?.time_zone ?? "UTC";
  const formatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: zone });
  const withYear = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: zone });
  const then = new Date(at);
  const sameYear = new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: zone }).format(then)
    === new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: zone }).format(businessNow());
  return sameYear ? formatter.format(then) : withYear.format(then);
}

export function timeElement(instant: string): HTMLTimeElement {
  const el = document.createElement("time");
  el.className = "meta";
  el.dateTime = instant;
  el.dataset.instant = instant;
  el.textContent = relativeTime(instant);
  return el;
}

// ---------- Announcements, notices and alerts (DP-79) ----------

let announceTimeout: number | undefined;

export function announce(text: string): void {
  const region = byRole("status", "Announcements");
  if (!region) return;
  // Move through empty so repeat strings are spoken again.
  region.textContent = "";
  window.clearTimeout(announceTimeout);
  announceTimeout = window.setTimeout(() => { region.textContent = text; }, 10);
}

export function errorAlert(text: string): void {
  const region = document.getElementById("ml-alert");
  if (!region) return;
  region.textContent = text;
  region.hidden = false;
}

export function clearAlert(): void {
  const region = document.getElementById("ml-alert");
  if (region) { region.hidden = true; region.textContent = ""; }
}

export interface ToastOptions {
  undo?: { operationId: number; deadline: string; onUndo: () => void };
  untilDeadline?: boolean;
}

const activeToasts = new Map<string, { deadline: string; undoEl: HTMLButtonElement; toEl: HTMLElement }>();

export function toast(text: string, options: ToastOptions = {}): void {
  const stack = byRole("status", "Notices");
  if (!stack) return;
  const el = document.createElement("div");
  el.className = "toast" + (options.undo ? " toast-undo" : "");
  const span = document.createElement("span");
  span.textContent = text;
  el.appendChild(span);
  let undoEl: HTMLButtonElement | null = null;
  if (options.undo) {
    undoEl = document.createElement("button");
    undoEl.className = "link";
    undoEl.textContent = "Undo";
    undoEl.addEventListener("click", () => { options.undo!.onUndo(); });
    el.appendChild(undoEl);
    el.dataset.deadline = options.undo.deadline;
    activeToasts.set(String(options.undo.operationId), { deadline: options.undo.deadline, undoEl, toEl: el });
  }
  stack.appendChild(el);
  requestAnimationFrame(() => el.classList.add("in"));
  if (!options.undo) {
    window.setTimeout(() => dismiss(el), 6_000);
  }
}

function dismiss(el: HTMLElement): void {
  el.classList.remove("in");
  window.setTimeout(() => el.remove(), state.motion === "reduced" ? 0 : 420);
}

/** The server says the undo window closed; the toast leaves whatever the device clock says (DP-42). */
export function operationExpired(operationId: number): void {
  const entry = activeToasts.get(String(operationId));
  if (entry) {
    activeToasts.delete(String(operationId));
    dismiss(entry.toEl);
  }
}

export function undoDone(operationId: number): void {
  const entry = activeToasts.get(String(operationId));
  if (entry) {
    activeToasts.delete(String(operationId));
    dismiss(entry.toEl);
  }
}

// ---------- Derived count text (Business rules) ----------

export function pinCountText(n: number): string { return `${n === 1 ? "1 pin" : `${n} pins`}`; }
export function followerText(n: number): string { return `${n === 1 ? "1 follower" : `${n} followers`}`; }
export function followingText(n: number): string { return `${n} following`; }
export function saveText(n: number): string { return `${n === 1 ? "1 save" : `${n} saves`}`; }
export function commentText(n: number): string { return `${n === 1 ? "1 comment" : `${n} comments`}`; }
export function reactionText(n: number): string { return `${n === 1 ? "1 reaction" : `${n} reactions`}`; }

// ---------- DOM helpers ----------

export function h<T extends HTMLElement = HTMLElement>(tag: string, attrs: Record<string, string | boolean | ((e: Event) => void)> | null, ...children: (Node | string | null | undefined)[]): T {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null) continue;
      if (key === "class") el.className = String(value);
      else if (key === "text") el.textContent = String(value);
      else if (typeof value === "function") el.addEventListener(key.replace(/^on/, ""), value as (e: Event) => void);
      else if (typeof value === "boolean") { if (value) el.setAttribute(key, ""); }
      else el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    el.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el as T;
}

export function byRole(role: string, name: string): HTMLElement | null {
  return document.querySelector(`[role="${role}"][aria-label="${name}"]`);
}

export function focusable(el: HTMLElement): boolean {
  return el.matches("a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])");
}

export function modalTrap(container: HTMLElement, onClose: () => void): (e: KeyboardEvent) => void {
  const handler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "Tab") {
      const items = Array.from(container.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")).filter(el => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  container.addEventListener("keydown", handler);
  return handler;
}

export function closeModal(container: HTMLElement, handler: (e: KeyboardEvent) => void, opener: HTMLElement | null): void {
  container.removeEventListener("keydown", handler);
  container.remove();
  if (opener && document.contains(opener)) opener.focus();
}

/** Marks a pending button busy and disabled. */
export async function busy<T>(button: HTMLButtonElement, pendingText: string, fn: () => Promise<T>): Promise<T | null> {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = pendingText;
  try {
    return await fn();
  } catch (e) {
    showApiError(e);
    return null;
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

export function showApiError(e: unknown): void {
  if (e instanceof ApiFailure) {
    errorAlert(failureText(e));
  } else {
    errorAlert("Something went wrong. Try again.");
  }
}

export function failureText(e: ApiFailure): string {
  const extra = e.body as { field?: string; max_bytes?: number; board?: { name?: string }; current?: PinJson };
  const limits = state.config?.limits;
  switch (e.code) {
    case "validation": {
      const field = extra.field;
      if (field === "email") return "Enter a valid email address.";
      if (field === "password") return "Use at least 8 characters.";
      if (field === "handle") return "Use 3 to 20 lowercase letters, digits or underscores.";
      if (field === "name") return "Add your name.";
      if (field === "code") return "That code doesn't match.";
      if (field === "title") return "Add a title.";
      if (field === "alt") return "Add alt text so everyone knows what this pin shows.";
      if (field === "source") return "Use a link that starts with http:// or https://.";
      if (field === "image") return "Images must be 4.0 megapixels or smaller.";
      if (field === "board") return "You already have a board called this."; 
      if (field === "text") return `Comments are 1 to ${limits?.comment_max ?? 500} characters.`;
      return "Something went wrong. Try again.";
    }
    case "unsupported_type": return "Use a PNG or JPEG image.";
    case "too_large": return `Images must be ${Math.floor((extra.max_bytes ?? 0) / 1000)} KB or smaller.`;
    case "duplicate_image": return `You already saved this pin to ${extra.board?.name ?? "a board"}`;
    case "already_on_board": return `This pin is already on ${extra.board?.name ?? "that board"}.`;
    case "handle_taken": return "That handle is taken.";
    case "board_name_taken": return `You already have a board called ${extra.board?.name ?? "this name"}.`;
    case "section_name_taken": return `This board already has a section called this name.`;
    case "invalid_credentials": return "That email and password don't match.";
    case "already_undone": return "Too late to undo.";
    case "undo_conflict": return "This can't be undone because some pins have changed.";
    case "undo_expired": return "Too late to undo.";
    case "already_member": return `${extra.board?.name ?? "They"} is already on this board.`;
    case "invite_not_pending": return "This invite has already been used.";
    case "storage_unavailable": return "Images can't be uploaded right now. Your draft is kept.";
    case "version_conflict": return "This pin was changed somewhere else.";
    default: return "Something went wrong. Try again.";
  }
}

// ---------- Motion (DP-76) ----------

export function detectMotion(): void {
  state.motion = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduced" : "full";
  document.documentElement.dataset.motion = state.motion;
}
