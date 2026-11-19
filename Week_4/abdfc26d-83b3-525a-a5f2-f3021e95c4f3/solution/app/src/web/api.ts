import type { Easing, Role } from "../shared/rules";

// The app's own JSON API, same origin only. Every call resolves to a Result; nothing throws for an
// HTTP status, so each screen decides what a 4xx or 5xx means for it.

interface ApiError {
  code: string;
  message: string;
  fields?: Record<string, string>;
  [extra: string]: unknown;
}

type Result<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiError };

const NETWORK: ApiError = { code: "network", message: "No answer from the studio. Check your connection and try again." };

export async function api<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Result<T>> {
  const init: RequestInit = { method, headers: { Accept: "application/json", ...headers }, credentials: "same-origin" };
  if (body !== undefined) {
    if (body instanceof FormData) init.body = body;
    else {
      init.body = JSON.stringify(body);
      (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    }
  }
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    return { ok: false, status: 0, error: NETWORK };
  }
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (response.ok) return { ok: true, status: response.status, data: parsed as T };
  const error = (parsed as { error?: ApiError } | null)?.error;
  return { ok: false, status: response.status, error: error && typeof error.code === "string" ? error : { code: "http", message: `The studio answered ${response.status}.` } };
}

/**
 * The browser key rule: a key is reused only to retry the same request after a 5xx answer or no answer;
 * every other press sends a fresh key.
 */
export class IdempotentAction {
  private pending: { key: string; body: string } | null = null;

  async send<T>(method: string, path: string, body: unknown): Promise<Result<T>> {
    const serialised = JSON.stringify(body ?? null);
    const fresh = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
    const key = this.pending && this.pending.body === serialised ? this.pending.key : fresh();
    const result = await api<T>(method, path, body, { "Idempotency-Key": key });
    this.pending = !result.ok && (result.status === 0 || result.status >= 500) ? { key, body: serialised } : null;
    return result;
  }
}

// ---- shapes of the published API ----

export interface Me {
  id: string;
  username: string;
  display_name: string;
  email: string;
  roles: Role[];
}

interface RemixOf {
  slug: string;
  title: string;
  creator_display_name: string;
}

export interface Card {
  slug: string;
  title: string;
  creator_display_name: string;
  engine: "GLSL";
  edition_count: number;
  editions_left: number;
  price_cents: number;
  remix_of: RemixOf | null;
  published_at: string;
}

export interface Gallery {
  featured: Card | null;
  sections: { id: "runs" | "remixes"; title: string; total: number; pieces: Card[] }[];
}

export interface Uniform {
  name: string;
  label: string;
  min: number;
  max: number;
  value: number;
}

export interface Keyframe {
  time_s: number;
  value: number;
  easing: Easing;
}

export interface Timeline {
  duration_s: number;
  tracks: { uniform: string; keyframes: Keyframe[] }[];
  audio_asset_id: string | null;
}

export interface Asset {
  id: string;
  kind: "font" | "model" | "audio";
  filename: string;
  bytes: number;
}

export interface Piece {
  slug: string;
  title: string;
  state: "draft" | "published" | "withdrawn";
  version: number;
  engine: "GLSL";
  creator: { id: string; display_name: string };
  fragment_source?: string;
  uniforms: Uniform[];
  timeline: Timeline;
  assets?: Asset[];
  remix_of: RemixOf | null;
  edition_count: number | null;
  price_cents: number | null;
  editions_left: number | null;
  export_render_id: string | null;
}

export type EditionStatus = "available" | "held" | "collected";

export interface Editions {
  edition_count: number;
  editions: { number: number; status: EditionStatus; held_by_you: boolean; seed_hash: string }[];
}

export type RenderState = "accepted" | "queued" | "rendering" | "stored" | "ready" | "failed" | "timed_out" | "credits_released";

export interface Render {
  id: string;
  piece_slug: string;
  state: RenderState;
  failure_reason: null | "provider_error" | "timeout" | "malformed" | "storage_error" | "cancelled";
  cost_credits: number;
  attempts: number;
  format: "mp4" | "webm";
  resolution: "720p" | "1080p";
  duration_s: number;
  aspect: "16:9" | "9:16" | "1:1" | "4:5";
  sha256: string | null;
  history: { state: RenderState; at: string }[];
  created_at: string;
}

export type OrderState = "held" | "paying" | "paid" | "invoiced" | "receipted" | "refunded" | "expired" | "failed";

export interface Order {
  id: string;
  piece_slug: string;
  piece_title: string;
  edition: number;
  edition_count: number;
  state: OrderState;
  expires_at: string | null;
  seconds_left: number | null;
  billing_name: string | null;
  email: string | null;
  billing_country: string | null;
  net_cents: number;
  vat_rate_percent: number;
  vat_cents: number;
  gross_cents: number;
  currency: "USD";
  invoice_number: string | null;
  invoice_status: "none" | "pending" | "ready";
  receipt_status: "none" | "queued" | "sent";
  refunded_net_cents: number;
  paid_at: string | null;
  created_at: string;
}

export interface LedgerEntry {
  id: string;
  kind: "grant" | "pack" | "reserve" | "capture" | "release";
  render_id: string | null;
  created_at: string;
  rows: { account: string; amount: number }[];
}

export interface Credits {
  available: number;
  held: number;
  entries: LedgerEntry[];
}

export interface Plan {
  code: "studio-monthly" | "pro-monthly";
  state: "pending_payment" | "active" | "cancelling" | "ended";
  ends_on: string | null;
}

export interface StudioPiece {
  slug: string;
  title: string;
  state: Piece["state"];
  version: number;
  edition_count: number | null;
  editions_sold: number;
  remix_of: RemixOf | null;
}

export interface SplitRow {
  party: "creator" | "remixer" | "platform";
  holder: string;
  kind: "sale" | "refund";
  amount_cents: number;
  refund_id: string | null;
}

export interface ServiceCheck {
  name: "killbill" | "render_provider" | "gotenberg" | "mail" | "storage";
  reachable: boolean;
  checked_at: string | null;
}
