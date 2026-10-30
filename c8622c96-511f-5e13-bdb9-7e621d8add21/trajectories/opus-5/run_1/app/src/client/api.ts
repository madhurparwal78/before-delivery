import type { Role } from '../domain/sections.js';

export interface ApiErrorBody {
  code: string;
  message: string;
  fields?: Record<string, string>;
  held_by?: 'you' | 'your_newsroom' | 'another_newsroom';
  held_until?: string;
  blocked_until?: string;
  current_version?: number;
  from?: string;
  action?: string;
}

export class RequestFailed extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'RequestFailed';
    this.status = status;
    this.body = body;
  }
}

/** No HTTP answer arrived, so the outcome of the request is unknown. */
export class NoAnswer extends Error {
  constructor() {
    super('no answer');
    this.name = 'NoAnswer';
  }
}

export interface Session {
  id: string;
  name: string;
  email: string;
  role: Role;
  newsroom: { slug: string; name: string; home_zone: string } | null;
  contributor_handle: string | null;
}

export interface WindowView {
  state: 'open' | 'claimed';
  held_by: 'you' | 'your_newsroom' | 'another_newsroom' | null;
  held_until: string | null;
  held_until_display: string | null;
  standard_running_until: string | null;
  standard_running_until_display: string | null;
}

export type EssayState = 'draft' | 'in_review' | 'embargoed' | 'live' | 'withdrawn' | 'taken_down';

export interface FrameView {
  id: string;
  position: number;
  caption: string;
  grid_url: string;
  story_url?: string;
  preview_url: string;
}

export interface EssayView {
  id: string;
  version: number;
  title: string;
  caption: string;
  credit_line: string;
  credits: Array<{ handle: string; name: string; position: number; split_bp?: number }>;
  state: EssayState;
  lift_local: string;
  lift_at: string;
  lift_display: string;
  lift_resolution: 'exact' | 'first_occurrence' | 'shifted_after_gap';
  exclusive_days: number;
  standard_days: number;
  exclusive_price_minor: number;
  standard_price_minor: number;
  frames: FrameView[];
  desk_notes?: Array<{ note: string; at: string; at_display: string }>;
  withdrawal_requested?: boolean;
  window: WindowView;
}

export interface StudioEssay extends EssayView {
  licences: Array<{
    newsroom: { slug: string; name: string };
    kind: 'exclusive' | 'standard';
    state: string;
    window_end: string;
    window_end_display: string;
    amount_minor: number;
  }>;
}

export interface FeedEssay {
  id: string;
  title: string;
  credit_line: string;
  state: EssayState;
  lift_at: string;
  lift_display: string;
  frame_count: number;
  cover_url: string | null;
  window: WindowView;
}

export interface LicenceView {
  id: string;
  essay_id: string;
  essay_title: string;
  credit_line: string | null;
  kind: 'exclusive' | 'standard';
  state: 'pending_invoice' | 'active' | 'expired' | 'revoked';
  newsroom: { slug: string; name: string };
  licensed_by: { name: string };
  confirmed_at: string;
  confirmed_display: string;
  window_start: string;
  window_end: string;
  window_end_display: string;
  hold_until: string | null;
  hold_until_display: string | null;
  amount_minor: number;
  currency: 'USD';
  invoice_state: 'pending' | 'raised';
  receipt_state: 'queued' | 'sent' | 'cancelled' | null;
  frames: Array<{ id: string; position: number }>;
}

export interface ShortlistItem {
  id: string;
  essay_id: string;
  essay_title: string;
  frame_id: string;
  position: number;
  added_by: string;
  added_at: string;
  added_display: string;
}

export interface FollowItem {
  id: string;
  essay_id: string | null;
  contributor: string | null;
  title: string | null;
  name: string | null;
}

export interface UsageTotals {
  newsroom: { slug: string; name: string };
  active: number;
  pending_invoice: number;
  expired: number;
  revoked: number;
  exclusive: number;
  standard: number;
  invoiced_minor: number;
  shortlist_count: number;
  next_expiry: { licence_id: string; window_end: string; window_end_display: string } | null;
}

export interface CommissionRates {
  current: { effective_from: string; rate_bp: number } | null;
  rates: Array<{ effective_from: string; rate_bp: number; status: 'past' | 'current' | 'scheduled' }>;
}

export interface StatementBody {
  month: string;
  lines: Array<{
    licence_id: string;
    essay_title: string;
    newsroom: { slug: string; name: string };
    confirmed_at: string;
    confirmed_display: string;
    amount_minor: number;
    rate_bp: number;
    commission_minor: number;
    shares: Array<{
      handle: string;
      name: string;
      position: number;
      split_bp: number;
      amount_minor: number;
    }>;
  }>;
  totals: {
    invoiced_minor: number;
    commission_minor: number;
    contributors: Array<{ handle: string; name: string; amount_minor: number }>;
  };
  payouts: Array<{ handle: string; amount_minor: number; state: 'queued' | 'recorded' }>;
}

export interface RoyaltyLine {
  month: string;
  licence_id: string;
  essay_title: string;
  position: number;
  split_bp: number;
  amount_minor: number;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface ApiResponse<T> {
  status: number;
  data: T;
  etag: string | null;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  let payload: string | undefined;
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(options.body);
  }
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body: payload,
      credentials: 'same-origin',
    });
  } catch {
    throw new NoAnswer();
  }
  const etag = response.headers.get('etag');
  if (response.status === 204) return { status: 204, data: undefined as T, etag };
  const text = await response.text();
  const parsed: unknown = text.length > 0 ? JSON.parse(text) : null;
  if (!response.ok) {
    const body = (parsed as { error?: ApiErrorBody } | null)?.error ?? {
      code: 'unknown',
      message: 'Something went wrong.',
    };
    throw new RequestFailed(response.status, body);
  }
  return { status: response.status, data: parsed as T, etag };
}

export async function uploadFrame(
  essayId: string,
  file: File,
  caption: string,
): Promise<ApiResponse<{ essay_version: number; id: string; position: number }>> {
  const form = new FormData();
  form.append('file', file);
  form.append('caption', caption);
  let response: Response;
  try {
    response = await fetch(`/api/essays/${essayId}/frames`, {
      method: 'POST',
      body: form,
      credentials: 'same-origin',
    });
  } catch {
    throw new NoAnswer();
  }
  const text = await response.text();
  const parsed: unknown = text.length > 0 ? JSON.parse(text) : null;
  if (!response.ok) {
    const body = (parsed as { error?: ApiErrorBody } | null)?.error ?? {
      code: 'unknown',
      message: 'Something went wrong.',
    };
    throw new RequestFailed(response.status, body);
  }
  return {
    status: response.status,
    data: parsed as { essay_version: number; id: string; position: number },
    etag: response.headers.get('etag'),
  };
}
