export interface PieceJson {
  slug: string;
  title: string;
  state: 'draft' | 'published' | 'withdrawn';
  version: number;
  engine: 'GLSL';
  creator: { id: string; display_name: string };
  fragment_source?: string;
  uniforms: { name: string; label: string; min: number; max: number; value: number }[];
  timeline: { duration_s: number; tracks: { uniform: string; keyframes: { time_s: number; value: number; easing: string }[] }[]; audio_asset_id: string | null };
  assets?: { id: string; kind: string; filename: string; bytes: number }[];
  remix_of: { slug: string; title: string; creator_display_name: string } | null;
  edition_count: number | null;
  price_cents: number | null;
  editions_left: number | null;
  export_render_id: string | null;
}

export interface OrderJson {
  id: string;
  piece_slug: string;
  piece_title: string;
  edition: number;
  edition_count: number;
  state: 'held' | 'paying' | 'failed' | 'expired' | 'paid' | 'invoiced' | 'receipted' | 'refunded';
  expires_at: string | null;
  seconds_left: number | null;
  billing_name: string;
  email: string;
  billing_country: string;
  net_cents: number;
  vat_rate_percent: number;
  vat_cents: number;
  gross_cents: number;
  currency: 'USD';
  invoice_number: string | null;
  invoice_status: 'none' | 'pending' | 'ready';
  receipt_status: 'none' | 'queued' | 'sent';
  refunded_net_cents: number;
  paid_at: string | null;
  created_at: string;
}

export interface GalleryCard {
  slug: string;
  title: string;
  creator_display_name: string;
  engine: 'GLSL';
  edition_count: number;
  editions_left: number;
  price_cents: number | null;
  remix_of: { slug: string; title: string; creator_display_name: string } | null;
  published_at: string | null;
}

export interface GalleryJson {
  featured: GalleryCard | null;
  sections: { id: 'runs' | 'remixes'; title: string; total: number; pieces: GalleryCard[] }[];
}

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string>; next_free?: number | null; current_version?: number; needed?: number; available?: number; invoice_number?: string | null };
}

export interface ApiResult<T> {
  status: number;
  ok: boolean;
  body: T | ApiErrorBody;
  idempotentReplayed: boolean;
}

export async function api<T>(method: string, path: string, body?: unknown, opts: { idempotencyKey?: string; ifMatch?: string | number; raw?: boolean } = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  if (opts.ifMatch !== undefined) headers['If-Match'] = `"${opts.ifMatch}"`;
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? null : JSON.stringify(body),
    credentials: 'same-origin'
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return {
    status: res.status,
    ok: res.status >= 200 && res.status < 300,
    body: parsed as T | ApiErrorBody,
    idempotentReplayed: res.headers.get('Idempotent-Replayed') === 'true'
  };
}

export function isApiError<T>(result: ApiResult<T>): result is ApiResult<T> & { body: ApiErrorBody } {
  return !result.ok && (result.body as ApiErrorBody | null)?.error !== undefined && (result.body as ApiErrorBody).error !== null;
}

export function errorFields<T>(result: ApiResult<T>): Record<string, string> {
  const body = result.body as ApiErrorBody;
  return body.error?.fields ?? {};
}

export function errorCode<T>(result: ApiResult<T>): string {
  return (result.body as ApiErrorBody).error?.code ?? '';
}

/** Browser key rule: reuse a key only to retry a 5xx or no-answer request. */
export function freshIdempotencyKey(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function money(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const VAT_TABLE: Record<string, { label: string; rate: number }> = {
  US: { label: 'United States', rate: 0 },
  GB: { label: 'United Kingdom', rate: 20 },
  DE: { label: 'Germany', rate: 19 },
  FR: { label: 'France', rate: 20 },
  NL: { label: 'Netherlands', rate: 21 },
  IE: { label: 'Ireland', rate: 23 },
  SE: { label: 'Sweden', rate: 25 },
  OTHER: { label: 'Other country', rate: 0 }
};

export function vatOf(netCents: number, ratePercent: number): number {
  return Math.floor(netCents * ratePercent / 100 + 0.5);
}
