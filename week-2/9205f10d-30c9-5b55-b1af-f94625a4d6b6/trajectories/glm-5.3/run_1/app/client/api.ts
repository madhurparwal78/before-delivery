/* Crosshand Relay client: state, API, formatting, and the app shell. */

const AGENCY_TZ = "America/New_York";

/* ------------------------------------------------------------------ types */

export type Role = "coordinator" | "interpreter" | "client_scheduler" | "billing_admin";

export type User = {
  id: string;
  role: Role;
  display_name: string;
  email: string;
  organisation: { id: string; name: string; code: string } | null;
};

export type Seat = {
  id: string;
  label: "A" | "B";
  status: "open" | "confirmed";
  interpreter: {
    display_name?: string;
    credentials?: string[];
    phone?: string;
    id?: string;
    full_name?: string;
    email?: string;
    home_area?: string;
    pay_rate?: string;
  } | null;
};

export type RequestRec = {
  id: string;
  reference: string;
  setting: "medical" | "education" | "legal";
  required_credential: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  city: string;
  status: string;
  team_size: 1 | 2;
  rotation_minutes: number;
  seats: Seat[];
  organisation?: { id: string; name: string; code: string };
  free_cancel_until?: string;
  consumer_name?: string;
  location_address?: string;
  notes?: string;
  hourly_rate?: string;
  actual_minutes?: number;
  team_reason?: string;
  history?: Array<{ at: string; actor: string; action: string; detail: string }>;
};

export type Invoice = {
  id: string;
  request_reference: string;
  organisation: { id: string; name: string; code: string };
  kind: "interpreting" | "late_cancellation";
  billable_minutes: number;
  seats: number;
  hourly_rate: string;
  amount: string;
  billing_status: "pending" | "posted";
  killbill_invoice_id: string | null;
  created_at: string;
};

export type Credential = {
  id: string;
  credential_type: string;
  status: "uploaded" | "verified" | "expired";
  expires_on: string | null;
  uploaded_at: string;
  file_name: string | null;
  interpreter?: { id: string; display_name: string; full_name: string };
};

export type Quote = {
  kind: "early" | "late";
  fee: string;
  free_cancel_until: string;
  billable_minutes: number;
  seats_charged: number;
  hourly_rate: string;
};

export type ApiError = {
  error: { code: string; message: string; fields?: Record<string, string> };
  quote?: Quote;
};

/* --------------------------------------------------------------- formatting */

export function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: AGENCY_TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}
export function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: AGENCY_TZ, month: "short", day: "numeric" }).format(new Date(iso));
}
export function fmtWeekday(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: AGENCY_TZ, weekday: "short" }).format(new Date(iso));
}
export function fmtDateKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: AGENCY_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}
export function fmtCutoff(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: AGENCY_TZ, weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(new Date(iso));
}
export function fmtClockStamp(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: AGENCY_TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}
export function fmtDayStamp(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: AGENCY_TZ, month: "short", day: "numeric" }).format(new Date(iso));
}

export const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Open seat",
  half_staffed: "Half-staffed",
  staffed: "Staffed",
  completed: "Completed",
  invoiced: "Invoiced",
  cancelled_early: "Cancelled",
  cancelled_late: "Cancelled (late fee)",
};

export const SETTING_WORDS: Record<string, string> = {
  medical: "Medical", education: "Education", legal: "Legal",
};

/* --------------------------------------------------------------------- api */

export class Unreachable extends Error {}

export async function api<T>(method: string, path: string, body?: unknown, opts?: { idempotencyKey?: string }): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (opts?.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? null : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new Unreachable("network");
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let parsed: unknown = undefined;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = { error: { code: "bad_response", message: "Unexpected response." } };
  }
  if (!res.ok) {
    const err = parsed as ApiError;
    const out = new Error(err?.error?.message ?? "Request failed.") as Error & { api?: ApiError };
    out.api = err;
    throw out;
  }
  return parsed as T;
}

/* ------------------------------------------------------------------- state */

export type State = {
  user: User | null;
  route: string;
};

export function parseRoute(): { path: string; query: URLSearchParams } {
  const [path, search] = window.location.hash.replace(/^#/, "").split("?");
  return { path: path || "/", query: new URLSearchParams(search ?? "") };
}

export function navigate(path: string): void {
  window.location.hash = path.startsWith("/") ? path : `/${path}`;
}

export function homeFor(role: Role): string {
  switch (role) {
    case "coordinator": return "/board";
    case "interpreter": return "/open-seats";
    case "client_scheduler": return "/requests";
    case "billing_admin": return "/billing";
  }
}

export const NAV_LINKS: Record<Role, Array<[string, string]>> = {
  coordinator: [["Week board", "/board"], ["Credentials", "/credentials"]],
  interpreter: [["Open seats", "/open-seats"], ["My assignments", "/assignments"], ["Profile", "/profile"]],
  client_scheduler: [["Requests", "/requests"], ["New request", "/requests/new"], ["Invoices", "/invoices"]],
  billing_admin: [["Billing", "/billing"], ["Invoices", "/invoices"]],
};

/* ------------------------------------------------------------------- dom */

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, unknown>, ...children: unknown[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") node.setAttribute("class", String(v));
      else if (k === "dataset") Object.assign(node.dataset, v as Record<string, string>);
      else if (k.startsWith("on") && typeof v === "function") {
        node.addEventListener(k.slice(2), v as EventListener);
      } else if (v === true) node.setAttribute(k, "");
      else node.setAttribute(k, String(v));
    }
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function seatCounterHtml(confirmed: number, total: number): HTMLElement {
  const wrap = el("span", { class: "seat-counter", "aria-hidden": "true" });
  for (let i = 0; i < total; i++) {
    wrap.append(el("i", { class: i < confirmed ? "solid" : "hatched" }));
  }
  return wrap;
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}
