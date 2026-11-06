export interface User {
  id: number;
  email: string;
  name: string;
  role: string;
  organisation_id: string | null;
}

export interface Session {
  id: string;
  title: string;
  discipline: string;
  venue_id: string;
  admission: "pass" | "seat";
  capacity: number | null;
  seats_remaining: number | null;
  price_full_cents: number | null;
  price_reduced_cents: number | null;
  starts_at: string;
  ends_at: string;
  starts_local: string;
  ends_local: string;
  festival_day: string;
  status: string;
  publish_at?: string | null;
  version?: number;
}

export interface Programme {
  edition: { name: string; first_day: string; last_day: string; time_zone: string };
  festival_days: Array<{ date: string; label: string; starts_at: string; ends_at: string }>;
  venues: Array<{ id: string; name: string }>;
  disciplines: Array<{ id: string; name: string }>;
  sessions: Session[];
}

export interface Order {
  id: string;
  ref: string;
  buyer_name: string;
  organisation_id: string | null;
  rate: string;
  status: string;
  subtotal_cents: number;
  group_discount_cents: number;
  voucher_code: string | null;
  voucher_cents: number;
  total_cents: number;
  proof_deadline: string | null;
  confirmation_mail: string;
  invoice_id: string | null;
  created_at: string;
  lines: Line[];
  refunds: Refund[];
}

export interface Line {
  id: number;
  position: number;
  kind: string;
  session_id: string | null;
  festival_day: string | null;
  title: string;
  holder_name: string;
  state: string;
  list_cents: number;
  group_discount_cents: number;
  voucher_cents: number;
  charged_cents: number;
  pass: { code: string; status: string } | null;
}

export interface Refund {
  id: string;
  order_id: string;
  line_ids: number[];
  card_cents: number;
  voucher_cents: number;
  credit_note_id: string | null;
  status: string;
  reason: string;
  created_at: string;
}

export class ApiProblem extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : `http_${status}`);
    this.status = status;
    this.body = body;
  }
}

export async function api<T>(
  path: string,
  init: RequestInit = {},
  expect: "json" | "none" = "json",
): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined && !(init.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(path, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
  if (res.status === 204) return undefined as T;
  if (expect === "none") return undefined as T;
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    throw new ApiProblem(res.status, (body ?? {}) as Record<string, unknown>);
  }
  return body as T;
}

export let me: User | null = null;

export async function loadMe(): Promise<User | null> {
  try {
    const res = await api<{ user: User }>("/api/me");
    me = res.user;
  } catch {
    me = null;
  }
  return me;
}

export function eur(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const a = Math.abs(cents);
  return `${sign}€${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

// Brussels wall clock for an instant, in the browser's own locale-agnostic form.
const brusselsFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Brussels", hour: "2-digit", minute: "2-digit", hour12: false });
const brusselsDayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Brussels", weekday: "short", day: "numeric", month: "short" });
const brusselsDateFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Brussels", day: "numeric", month: "short", year: "numeric" });

export function clock(at: string | Date): string {
  return brusselsFmt.format(new Date(at)).replace("24:", "00:");
}

export function dayMon(at: string | Date): string {
  return brusselsDayFmt.format(new Date(at));
}

export function dateLong(at: string | Date): string {
  return brusselsDateFmt.format(new Date(at));
}

export function rowWhen(s: Session): string {
  return `${dayMon(s.starts_at)} · ${clock(s.starts_at)}–${clock(s.ends_at)}`;
}

export function deadlineFmt(at: string | Date): string {
  return `${dayMon(at)}, ${clock(at)}`;
}

export function el(tag: string, attrs: Record<string, string | null> = {}, ...children: Array<Node | string | null | undefined>): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

export function status(text: string): HTMLElement {
  return el("div", { class: "status-line", role: "status", text: text });
}

export function announce(node: HTMLElement | null, text: string): void {
  if (node) node.textContent = text;
}

export function fieldError(problem: unknown, field: string): string | null {
  if (problem instanceof ApiProblem) {
    const errors = problem.body.errors as Record<string, string> | undefined;
    if (errors && errors[field]) return errors[field];
  }
  return null;
}

export function problemText(problem: unknown): string {
  if (problem instanceof ApiProblem) {
    const errors = problem.body.errors as Record<string, string> | undefined;
    if (errors) {
      return Object.entries(errors).map(([k, v]) => `${k}: ${v}`).join(", ");
    }
    return String(problem.body.error ?? "error");
  }
  return "Something went wrong.";
}
