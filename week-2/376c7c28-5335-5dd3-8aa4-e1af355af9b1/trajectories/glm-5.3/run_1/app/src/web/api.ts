// API client: one fetch wrapper, the single error shape, and the session-ended rule.

export type ApiErrorShape = {
  error: string;
  message: string;
  errors?: Record<string, string>;
  next_purchase_at?: string;
};

export class ApiCallError extends Error {
  kind: "api" | "network";
  status: number;
  body: ApiErrorShape;
  constructor(kind: "api" | "network", status: number, body: ApiErrorShape) {
    super(body.message);
    this.kind = kind;
    this.status = status;
    this.body = body;
  }
}

type FetchOptions = { method?: string; body?: unknown; idempotencyKey?: string; rawBody?: BodyInit; contentType?: string; skipAuthRedirect?: boolean };

export async function api<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (opts.rawBody !== undefined) {
    if (opts.contentType) headers["Content-Type"] = opts.contentType;
    body = opts.rawBody;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body ?? {});
  }
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(path, { method: opts.method ?? (body !== undefined ? "POST" : "GET"), headers, body, credentials: "same-origin" });
  } catch {
    throw new ApiCallError("network", 0, { error: "network", message: "" });
  }
  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    if (!res.ok) {
      if (res.status === 401 && !opts.skipAuthRedirect) onUnauthenticated();
      throw new ApiCallError("api", res.status, data as ApiErrorShape);
    }
    return data as T;
  }
  if (!res.ok) {
    if (res.status === 401 && !opts.skipAuthRedirect) onUnauthenticated();
    throw new ApiCallError("api", res.status, { error: `http_${res.status}`, message: "" });
  }
  return (await res.arrayBuffer()) as unknown as T;
}

// The session-ended hook is installed by the shell.
export let onUnauthenticated: () => void = () => {};
export function setUnauthenticatedHook(fn: () => void): void {
  onUnauthenticated = fn;
}

export function isNetworkFailure(err: unknown): boolean {
  return err instanceof ApiCallError && err.kind === "network";
}

export function errorFields(err: unknown): Record<string, string> | null {
  if (err instanceof ApiCallError && err.kind === "api") return err.body.errors ?? null;
  return null;
}

export function errorCode(err: unknown): string | null {
  if (err instanceof ApiCallError) return err.kind === "api" ? err.body.error : "network";
  return null;
}

export function errorStatus(err: unknown): number | null {
  if (err instanceof ApiCallError && err.kind === "api") return err.status;
  return null;
}

export function errorExtra(err: unknown): Record<string, unknown> {
  if (err instanceof ApiCallError && err.kind === "api") return err.body as unknown as Record<string, unknown>;
  return {};
}

export type Person = {
  id: string;
  name: string;
  handle: string;
  role: "owner" | "kiln_tech" | "member";
  studio: { slug: string; name: string; time_zone: string };
};

export type Ticket = {
  id: string;
  title: string;
  status: string;
  clay_body: string;
  length_in: number;
  width_in: number;
  height_in: number;
  photo_url: string | null;
  owner_handle: string;
  waiting_since: string | null;
};

export type Charge = {
  id: string;
  piece_id: string;
  piece_title: string;
  firing: "bisque" | "glaze" | "storage";
  storage_day: string | null;
  cubic_inches: number | null;
  rate_cents: number;
  fee_cents: number;
  status: "pending" | "settled" | "refund_pending" | "refunded";
  funding: "credit" | "card" | null;
  created_at: string;
  settled_at: string | null;
  refunded_at: string | null;
};

export type LedgerEntry = {
  id: string;
  movement_id: string;
  account: string;
  amount_cents: number;
  kind: string;
  charge_id: string | null;
  created_at: string;
};

export type Passport = Ticket & {
  rounded: { length_in: number; width_in: number; height_in: number };
  cubic_inches: number;
  quote: { quoted_at: string; rates_effective_from: string; membership: string; bisque: { rate_cents: number; fee_cents: number }; glaze: { rate_cents: number; fee_cents: number } };
  location: { load_id: string; kiln_name: string; deck: number } | null;
  outcomes: { bisque: string | null; glaze: string | null };
  charges: Charge[];
  history: { status: string; at: string }[];
  pickup_deadline: string | null;
};

export type KilnRow = { id: string; name: string; stack_height_in: number; shelf_area_sq_in: number };

export type LoadDeck = {
  number: number;
  post_height_in: number;
  deck_height_in: number;
  footprint_sq_in: number;
  footprint_pct: number;
  pieces: Ticket[];
};

export type LoadBody = {
  id: string;
  kiln: { id: string; name: string; stack_height_in: number; shelf_area_sq_in: number };
  firing: "bisque" | "glaze";
  status: "planning" | "loaded" | "firing" | "cooling" | "unloaded" | "cancelled";
  headroom_in: number;
  value_cents: number;
  decks: LoadDeck[];
  created_at: string;
  unloaded_at: string | null;
};

export type Dashboard = {
  today: string;
  counts: { logged: number; waiting_bisque: number; bisqued: number; waiting_glaze: number; ready_for_pickup: number };
  longest_waiting: { id: string; title: string; owner_handle: string; status: string; days_waiting: number }[];
  pending_charges: number;
  month_revenue_cents: number;
};

export type StudioBody = {
  name: string;
  slug: string;
  time_zone: string;
  today: string;
  pickup_window_days: number;
  storage_fee_cents: number;
};

export function loadStatusLabel(s: string): string {
  return ({ planning: "Planning", loaded: "Loaded", firing: "Firing", cooling: "Cooling", unloaded: "Unloaded", cancelled: "Cancelled" } as Record<string, string>)[s] ?? s;
}

export function pieceStatusLabel(s: string): string {
  return (
    {
      logged: "Logged",
      waiting_bisque: "Waiting for bisque",
      bisqued: "Bisqued",
      waiting_glaze: "Waiting for glaze",
      glazed: "Glazed",
      ready_for_pickup: "Ready for pickup",
      collected: "Collected",
      uncollected: "Uncollected",
    } as Record<string, string>
  )[s] ?? s;
}

export function chargeKindLabel(c: Charge, screenDateOf: (d: string) => string): string {
  if (c.firing === "storage" && c.storage_day) return `Storage, ${screenDateOf(c.storage_day)}`;
  if (c.firing === "bisque") return "Bisque";
  return "Glaze";
}

export function chargeStatusLabel(c: Charge): string {
  switch (c.status) {
    case "pending":
      return "Pending billing";
    case "refund_pending":
      return "Refund pending";
    case "refunded":
      return "Refunded";
    case "settled":
      return c.funding === "card" ? "Paid by card" : "Paid from credit";
  }
}
