/** API client: one place for JSON calls, 401 handling and error bodies. */

export interface ApiErrorBody {
  error: string;
  message: string;
  errors?: Record<string, string>;
  current?: unknown;
  taken?: { stationName: string; date: string; start: string | null; end: string | null }[];
}

export class ApiFailure extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
}

export interface SessionInfo {
  user: { id: string; name: string; email: string; role: 'operator' | 'shift_lead' | 'member'; memberId: string | null };
  kitchen: { id: string; name: string; slug: string; timeZone: string };
}

export interface BoardResponse {
  date: string;
  today: string;
  now: string;
  timeZone: string;
  stations: { id: string; name: string; kind: 'hourly' | 'shelf'; capacity: number | null }[];
  peakWindows: { days: string[]; start: string; end: string }[];
  blocks: Block[];
  outOfService: { id: string; stationId: string; start: string; end: string; localDate: string; localStart: string; localEnd: string; reason: string }[];
  hourBank: HourBank | null;
}

export interface HourBank {
  month: string;
  allowanceHours: number;
  usedHours: number;
  balanceHours: number;
}

export interface Block {
  id: string;
  memberId?: string;
  businessName?: string;
  stationId: string;
  stationName?: string;
  kind: 'hourly' | 'shelf';
  localDate: string;
  localStart: string | null;
  localEnd: string | null;
  days: number | null;
  start: string;
  end: string;
  status: string;
  billingStatus?: string;
  hours?: number;
  peakHours?: number;
  chargeCents?: number;
  penaltyCents?: number;
  penaltyWaived?: boolean;
  conflict?: boolean;
  seriesId?: string | null;
  notes?: string;
  holdExpiresAt?: string | null;
  confirmedAt?: string | null;
  actions?: string[];
  version?: number;
}

export interface DocumentRecord {
  id: string;
  memberId: string;
  businessName: string;
  type: 'insurance_certificate' | 'food_handler_card';
  expiryDate: string;
  status: 'submitted' | 'approved' | 'expiring' | 'expired' | 'superseded';
  current: boolean;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
  approvedAt: string | null;
  version: number;
}

export interface InvoiceLine {
  kind: 'booking' | 'penalty' | 'credit';
  bookingId: string | null;
  description: string;
  amountCents: number;
  billingStatus: 'billed' | 'pending_billing';
}

export interface InvoiceResponse {
  memberId: string;
  month: string;
  status: 'open' | 'closed';
  lines: InvoiceLine[];
  totalCents: number;
  hourBank: HourBank;
}

export interface Station {
  id: string;
  name: string;
  kind: 'hourly' | 'shelf';
  capacity: number | null;
  currentRate: Rate | null;
  rates: Rate[];
}

export interface Rate {
  effectiveFrom: string;
  effectiveAt: string;
  status: 'past' | 'current' | 'scheduled';
  offPeakHourlyCents?: number;
  peakHourlyCents?: number;
  shelfDayCents?: number;
}

export interface KitchenInfo {
  id: string;
  name: string;
  slug: string;
  timeZone: string;
  today: string;
  currentMonth: string;
  peakWindows: { days: string[]; start: string; end: string }[];
  requiredDocuments: string[];
  rulesVersion: number;
}

export interface MemberRecord {
  id: string;
  name: string;
  businessName: string;
  email?: string;
}

/** The last own-action answer, used to discard late board responses. */
let sessionEpoch = 0;

export function newSession(): void {
  sessionEpoch++;
}

function epoch(): number {
  return sessionEpoch;
}

export async function api<T>(method: string, path: string, body?: unknown, options: { idempotencyKey?: string } = {}): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {};
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const body = (data ?? { error: 'internal', message: 'Lineboard hit an unexpected problem. Try again.' }) as ApiErrorBody;
    throw new ApiFailure(response.status, body);
  }
  return { status: response.status, data: data as T };
}

export async function apiOrNull<T>(method: string, path: string, body?: unknown, options: { idempotencyKey?: string } = {}): Promise<{ status: number; data: T } | null> {
  const myEpoch = epoch();
  const result = await api<T>(method, path, body, options).catch((err) => {
    if (err instanceof ApiFailure && err.status === 401) {
      newSession();
      onUnauthorized();
      return null;
    }
    throw err;
  });
  if (result && myEpoch !== epoch()) return null;
  return result;
}

let unauthorizedHandler: () => void = () => undefined;

export function setUnauthorizedHandler(handler: () => void): void {
  unauthorizedHandler = handler;
}

function onUnauthorized(): void {
  unauthorizedHandler();
}

/** A fresh Idempotency-Key per user action. */
export function freshKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
