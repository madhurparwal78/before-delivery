export type CellValue = "mine" | "taken" | "empty";

export interface Credit {
  balance_cents: number;
  held_cents: number;
  spendable_cents: number;
}

export interface Line {
  product_id: string;
  case_name: string;
  pack: number;
  unit: "jar" | "bottle" | "jug" | "lb";
  price_cents: number;
  version: number;
  pledged_units: number;
  units_to_go: number;
  status: "filling" | "sealed" | "taken_up" | "dropped";
  short_units: number;
  my_units: number | null;
  cells: CellValue[];
}

export interface Cycle {
  id: string;
  name: string;
  status: string;
  revision: number;
  cutoff_at: string | null;
  cutoff_display: string | null;
  pickup_start_at: string | null;
  pickup_end_at: string | null;
  pickup_display: string | null;
  accepting_pledges: boolean;
  credit: Credit | null;
  lines: Line[];
}

export interface CycleSummary {
  id: string;
  name: string;
  status: string;
  cutoff_display: string | null;
}

export interface Me {
  role: "coordinator" | "member" | "volunteer";
  name: string;
  household_code: string | null;
}

export interface BagItem {
  product_id: string;
  case_name: string;
  units: number;
  packed: boolean;
  flagged_units: number;
}

export interface Bag {
  household_code: string;
  household_name: string;
  packed: boolean;
  items: BagItem[];
}

export interface Movement {
  id: number;
  kind: string;
  cycle_id: string | null;
  memo: string;
  created_at: string;
  legs: { account: string; amount_cents: number }[];
}

export interface LedgerPage {
  household_code: string;
  balance_cents: number;
  held_cents: number;
  spendable_cents: number;
  total_movements: number;
  next_before: string | null;
  movements: Movement[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class NetworkError extends Error {
  constructor() {
    super("No HTTP response");
    this.name = "NetworkError";
  }
}

export interface ApiOptions {
  method?: string;
  body?: string | ArrayBuffer;
  headers?: Record<string, string>;
  idempotencyKey?: string;
  ifMatch?: string;
  raw?: boolean;
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<{ status: number; data: T; etag: string | null }> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined && !opts.raw) headers["Content-Type"] = "application/json";
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  if (opts.ifMatch) headers["If-Match"] = opts.ifMatch;
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body as BodyInit | undefined,
      credentials: "same-origin",
    });
  } catch {
    throw new NetworkError();
  }
  const etag = res.headers.get("ETag");
  if (res.status === 204) return { status: 204, data: null as unknown as T, etag };
  let data: unknown = null;
  if (res.headers.get("content-type")?.startsWith("application/json")) {
    data = await res.json();
  } else {
    data = await res.text();
  }
  if (res.status >= 400) {
    const err = data as { error?: { code?: string; message?: string; fields?: Record<string, string> } };
    throw new ApiError(
      res.status,
      err?.error?.code ?? "error",
      err?.error?.message ?? "Something went wrong.",
      err?.error?.fields
    );
  }
  return { status: res.status, data: data as T, etag };
}

export function centsToMoney(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}$${grouped}.${frac}`;
}

export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out.slice(0, 32);
}
