// Shared client types and API access.
export interface MemberOut { id: string; name: string; email: string; role: string; stockistId: string | null; createdAt: string; }
export interface MarketInfo { market: string; city: string; goLiveAt: string | null; status: string; piecesLeft?: number; storePieces?: number; claimed?: number; held?: number; }
export interface DropStaff {
  id: string; slug: string; name: string; type: 'simultaneous' | 'rolling'; status: string;
  holdSeconds: number; palette: string[]; internalNote: string;
  goLiveAt: string | null; copenhagenGoLive: string | null; localGoLive: string | null;
  markets: MarketInfo[]; styles: StyleOut[]; createdAt: string; withdrawnAt: string | null;
}
export interface StyleOut { styleNumber: string; name: string; colour: string; wholesaleEdition: number; rrpDkkMinor: number; }
export interface DropBuyer { id: string; name: string; status: string; styles: { styleNumber: string; name: string; colour: string }[]; }
export interface PublicDrop {
  slug: string; name: string; brand: string; type: string; status: string; palette: string[];
  storyHtml: string | null;
  looks: { id: string; position: number; title: string; altText: string; imageUrl: string; width: number; height: number }[];
  markets: MarketInfo[];
}
export interface PublicListItem {
  slug: string; name: string; brand: string; type: string; status: string; goLiveAt: string | null;
  weekLabel: string | null; palette: string[]; coverImageUrl: string | null; markets: MarketInfo[];
}
export interface AllocationOut {
  id: string; dropId: string; dropName: string; stockistId: string; stockistName: string;
  market: string; currency: string; status: string; version: number; requestedAt: string;
  lines: { styleNumber: string; styleName: string; requestedQuantity: number; allocatedQuantity: number; unitPriceMinor: number | null; netMinor: number | null; vatMinor: number | null; lineTotalMinor: number | null }[];
  totalMinor: number | null; priceListEffectiveDate: string | null;
  invoiceNumber: string | null; killbillInvoiceId: string | null;
  contactName: string | null; internalNote: string; savedBy: string | null; savedAt: string; confirmedAt: string | null;
}
export interface AllocationBuyer {
  id: string; dropName: string; stockistName: string; status: string; currency: string;
  lines: AllocationOut['lines']; totalMinor: number | null; priceListEffectiveDate: string | null;
  invoiceNumber: string | null; confirmedAt: string | null;
}
export interface StockistOut {
  id: string; name: string; market: string; city: string; currency: string;
  contactName: string | null; contactEmail: string | null; contactPhone: string | null;
  contactErased: boolean; notes: string; status: string; archivedAt: string | null; createdAt: string;
}
export interface LookOut { id: string; position: number; title: string; altText: string; imageUrl: string; width: number; height: number; contentType: string; sizeBytes: number; }
export interface PreviewOut { id: string; editorName: string; editorEmail: string; outlet: string; status: string; issuedAt: string; expiresAt: string; link: string; }
export interface RestockOut { id: string; weekday: string; copenhagenTime: string; pieces: Record<string, number>; nextInstants: string[]; }
export interface WaitlistEntry { id: string; name: string; email: string; market: string; status: string; joinedAt: string; position: number; hold: { status: string; offeredAt: string; expiresAt: string } | null; }

export const MARKETS = [
  { market: 'copenhagen', city: 'Copenhagen' },
  { market: 'stockholm', city: 'Stockholm' },
  { market: 'paris', city: 'Paris' },
  { market: 'london', city: 'London' },
  { market: 'new_york', city: 'New York' },
  { market: 'tokyo', city: 'Tokyo' }
] as const;

export const ROLE_LABELS: Record<string, string> = {
  launch_producer: 'Launch producer',
  merchandiser: 'Merchandiser',
  finance_lead: 'Finance lead',
  press_lead: 'Press lead',
  stockist_buyer: 'Stockist buyer'
};

export const ROLE_HOME: Record<string, string> = {
  launch_producer: '/studio/drops',
  merchandiser: '/studio/drops',
  finance_lead: '/studio/invoicing',
  press_lead: '/studio/press',
  stockist_buyer: '/studio/my-store'
};

export const NAV_BY_ROLE: Record<string, { href: string; label: string }[]> = {
  launch_producer: [
    { href: '/studio/drops', label: 'Drops' },
    { href: '/studio/members', label: 'Members' },
    { href: '/studio/price-lists', label: 'Price lists' }
  ],
  merchandiser: [
    { href: '/studio/drops', label: 'Drops' },
    { href: '/studio/stockists', label: 'Stockists' }
  ],
  finance_lead: [
    { href: '/studio/invoicing', label: 'Invoicing' },
    { href: '/studio/price-lists', label: 'Price lists' }
  ],
  press_lead: [{ href: '/studio/press', label: 'Press' }],
  stockist_buyer: [{ href: '/studio/my-store', label: 'My store' }]
};

export interface ApiFail {
  status: number;
  code: string;
  message: string;
  fields?: Record<string, string>;
  savedBy?: string;
  savedAt?: string;
  current?: Record<string, unknown>;
  claimedAt?: string;
  retryAfterSeconds?: number;
}

export class ApiError extends Error {
  constructor(public readonly fail: ApiFail) { super(fail.message); }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown, opts: { headers?: Record<string, string>; raw?: boolean } = {}): Promise<{ status: number; data: T | null; date: Date; headers: Headers }> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  let payload: BodyInit | undefined;
  if (body !== undefined && !(body instanceof FormData)) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  } else if (body instanceof FormData) {
    payload = body;
  }
  const res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  const text = await res.text();
  let data: T | null = null;
  if (text) {
    try { data = JSON.parse(text) as T; } catch { data = null; }
  }
  if (!res.ok && text) {
    const parsed = JSON.parse(text) as { error?: { code?: string; message?: string; fields?: Record<string, string>; savedBy?: string; savedAt?: string; current?: Record<string, unknown>; claimedAt?: string; retryAfterSeconds?: number } };
    const err = parsed.error ?? {};
    throw new ApiError({
      status: res.status,
      code: err.code ?? 'unknown',
      message: err.message ?? "Hourline can't be reached. Nothing was saved. Check your connection and try again.",
      fields: err.fields,
      savedBy: err.savedBy,
      savedAt: err.savedAt,
      current: err.current,
      claimedAt: err.claimedAt,
      retryAfterSeconds: err.retryAfterSeconds
    });
  }
  return { status: res.status, data, date: new Date(), headers: res.headers };
}

export async function apiOk<T>(method: string, path: string, body?: unknown, opts?: { headers?: Record<string, string>; raw?: boolean }): Promise<T> {
  const res = await api<T>(method, path, body, opts);
  return res.data as T;
}

export function unreachableMessage(): string {
  return "Hourline can't be reached. Nothing was saved. Check your connection and try again.";
}

export function failOf(err: unknown): ApiFail {
  if (err instanceof ApiError) return err.fail;
  return { status: 0, code: 'unreachable', message: unreachableMessage() };
}

export const MESSAGES = {
  required: 'This field is required.',
  email: 'Enter an email address like name@example.com.',
  tooLong: (n: number) => `Use at most ${n} characters.`,
  wholeRange: (min: number, max: number) => `Enter a whole number from ${min} to ${max}.`,
  date: 'Enter a date as YYYY-MM-DD.',
  time: 'Enter a time as HH:MM.',
  notLaterThanNow: 'Choose a time later than now.',
  gap: (date: string) => `Copenhagen skips from 02:00 to 03:00 on ${date}. Choose another time.`,
  consent: 'Tick the box to agree to drop emails.',
  unknownStockist: 'Choose a stockist.',
  unknownMarket: 'Choose one of the six markets.',
  contactErased: 'Contact erased',
  draftRestored: 'Your draft is restored.',
  forbidden: "Your role can't do this.",
  sessionEnded: 'Your session ended. Sign in again to continue — your draft is kept.',
  accessRemoved: 'Your access to this workspace was removed.',
  crossOrigin: 'This request came from another site and was refused.'
} as const;
