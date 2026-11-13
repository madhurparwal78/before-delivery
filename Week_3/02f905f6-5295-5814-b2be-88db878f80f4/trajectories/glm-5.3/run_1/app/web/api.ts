export interface User {
  id: number;
  name: string;
  role: "owner" | "tech" | "member";
  member_number: string | null;
}

export interface Clay {
  id: string;
  name: string;
  max_cone: string;
}

export interface Quote {
  sides_in: {
    length?: string;
    width?: string;
    diameter?: string;
    height: string;
  };
  cubic_inches: string;
  rate_per_cubic_inch: string;
  discount_percent: number;
  order_minimum_cents: number;
  minimum_applied: boolean;
  fee_cents: number;
  rate_set_id: number;
}

export interface Piece {
  number: number;
  owner: { kind: "member" | "guest"; name: string; member_number: string | null };
  shape: "round" | "rectangular" | "plate";
  sides_in: { length?: string; width?: string; diameter?: string; height: string };
  cubic_inches: string;
  fee_cents: number;
  rate_set_id: number;
  plan: "bisque_and_glaze" | "bisque_only" | "glaze_only";
  stage: "bisque" | "glaze" | null;
  cone: string | null;
  clay_id: string;
  status: string;
  status_label: string;
  pickup_shelf: string | null;
  intake_photo_id: string | null;
  accepted_at: string;
  accepted_at_label: string;
  ready_at: string | null;
  ready_at_label: string | null;
  days_on_shelf: number | null;
  placement: { firing_id: number; layer: number; x: string; y: string; rotation: number } | null;
  history: Array<{ at: string; at_label: string; actor: string; action: string }>;
}

export interface ProfileSegment {
  rate_f_per_hour: number;
  target_f: number;
  hold_minutes: number;
}

export interface KilnProfile {
  id: number;
  kiln_id: string;
  name: string;
  stage: "bisque" | "glaze";
  cone: string;
  segments: ProfileSegment[];
  cool_down_hours: number;
  firing_hours: string;
}

export interface Kiln {
  id: string;
  name: string;
  shelf_diameter_in: number;
  layers: number;
  post_height_in: string;
  usable_cubic_inches: number;
  posts: Array<{ x: number; y: number; size_in: number }>;
  profiles: KilnProfile[];
  current_firing_id: number | null;
}

export interface FiringLayer {
  layer: number;
  height_in: string | null;
  placements: Array<{
    piece_number: number;
    shape: "round" | "rectangular" | "plate";
    x: string;
    y: string;
    rotation: number;
    width_in: string;
    depth_in: string;
    height_in: string;
  }>;
}

export interface Firing {
  id: number;
  kiln_id: string;
  profile: {
    id: number;
    name: string;
    stage: "bisque" | "glaze";
    cone: string;
    segments: ProfileSegment[];
    cool_down_hours: number;
    firing_hours: string;
  };
  status: "building" | "firing" | "cooling" | "unloadable" | "unloaded";
  status_label: string;
  started_at: string | null;
  started_at_label: string | null;
  firing_ends_at: string | null;
  firing_ends_at_label: string | null;
  cool_until: string | null;
  cool_until_label: string | null;
  server_now: string;
  server_now_label: string;
  fill_percent: number;
  layers: FiringLayer[];
}

export interface DamageReport {
  id: number;
  piece_number: number;
  kind: "glaze_run" | "crack";
  note: string | null;
  status: "reported" | "charged" | "waived";
  intake_photo_id: string | null;
  unload_photo_id: string;
  account_name: string;
  amount_cents: number | null;
  reported_by: string;
  reported_at: string;
  reported_at_label: string;
}

export interface RateSet {
  id: number;
  bisque_rate: string;
  glaze_rate: string;
  member_discount_percent: number;
  order_minimum_cents: number;
  effective_date: string;
  created_at: string;
  created_at_label: string;
}

export class ApiError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;
  extra: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.message ?? "Request failed"));
    this.status = status;
    this.code = String(body.error ?? "error");
    this.fields = (body.fields as Record<string, string>) ?? undefined;
    this.extra = body as Record<string, unknown>;
  }
}

async function request<T>(method: string, path: string, body?: unknown, opts?: { idempotencyKey?: string; raw?: boolean }): Promise<{ data: T; replayed: boolean }> {
  const headers: Record<string, string> = {};
  if (body !== undefined && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  if (opts?.idempotencyKey) {
    headers["Idempotency-Key"] = opts.idempotencyKey;
  }
  const res = await fetch(path, {
    method,
    headers,
    credentials: "same-origin",
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body)
  });
  if (res.status === 204) {
    return { data: null as T, replayed: res.headers.get("Idempotent-Replayed") === "true" };
  }
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = {};
  }
  if (!res.ok) {
    throw new ApiError(res.status, parsed);
  }
  return { data: parsed as T, replayed: res.headers.get("Idempotent-Replayed") === "true" };
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path).then((r) => r.data),
  post: <T>(path: string, body?: unknown, key?: string) => request<T>("POST", path, body === undefined && key ? {} : body, { idempotencyKey: key }).then((r) => r.data),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body).then((r) => r.data),
  del: <T>(path: string) => request<T>("DELETE", path).then((r) => r.data),
  upload: <T>(path: string, form: FormData) => request<T>("POST", path, form).then((r) => r.data)
};

export function cents(c: number): string {
  const sign = c < 0 ? "-" : "";
  const abs = Math.abs(c);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function pieceNumber(n: number): string {
  return String(n).padStart(4, "0");
}

export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
