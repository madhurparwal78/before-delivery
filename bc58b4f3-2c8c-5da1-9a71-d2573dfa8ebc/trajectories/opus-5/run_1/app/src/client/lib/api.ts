export type Role = 'scheduler' | 'org_admin' | 'dispatcher' | 'billing_lead' | 'interpreter';

export interface CurrentUser {
  id: string;
  name: string;
  role: Role;
  initials: string;
  org: { code: string; name: string } | null;
}

export type SeatStatus = 'open' | 'held' | 'served';

export interface SeatView {
  seat: number;
  status: SeatStatus;
  interpreter_initials?: string | null;
  interpreter_name?: string | null;
}

export interface CancellationView {
  cancelled_at: string;
  fee_applies: boolean;
  business_minutes_notice: number;
  fee_cents: number;
}

export interface BillingView {
  status: 'none' | 'ready' | 'queued' | 'posted';
  invoice_id: string | null;
  total_cents: number | null;
}

export interface AssignmentView {
  number: string;
  status: string;
  language: string;
  setting: string;
  city: string;
  start_at: string;
  end_at: string;
  duration_minutes: number;
  street_address?: string;
  patient_initials?: string;
  medical_notes?: string;
  scheduler?: { name: string; phone: string };
  seats: SeatView[];
  cancellation?: CancellationView | null;
  billing?: BillingView;
  org?: { code: string; name: string };
}

export interface CoverageAssignment {
  number: string;
  status: string;
  org_code: string;
  setting: string;
  start_at: string;
  end_at: string;
  duration_minutes: number;
  seats: SeatView[];
}

export interface CoverageLanguage {
  code: string;
  name: string;
  uncovered_minutes: number;
  assignments: CoverageAssignment[];
}

export interface Coverage {
  week_start: string;
  languages: CoverageLanguage[];
}

export interface CancellationQuote {
  fee_applies: boolean;
  business_minutes_notice: number;
  fee_cents: number;
}

export interface QueueItem {
  number: string;
  org_code: string;
  kind: 'service' | 'late_cancellation';
  start_at: string;
  total_cents: number | null;
  billing: BillingView;
}

export interface RateEntryView {
  org: string;
  service_line: 'asl' | 'spoken';
  effective_from: string;
  hourly_rate_cents: number;
  mileage_cents_per_mile: number;
}

export interface SchedulerView {
  id: string;
  name: string;
  email: string;
  phone: string;
}

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;

  constructor(status: number, code: string, message: string, fields: Record<string, string>) {
    super(message);
    this.name = 'ApiFailure';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export class NetworkFailure extends Error {
  constructor() {
    super('Network failure');
    this.name = 'NetworkFailure';
  }
}

interface RequestOptions {
  json?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
}

async function request<Payload>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<Payload> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(options.json === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.headers ?? {}),
      },
      ...(options.json === undefined ? {} : { body: JSON.stringify(options.json) }),
      ...(options.form === undefined ? {} : { body: options.form }),
    });
  } catch {
    throw new NetworkFailure();
  }
  if (response.status === 204) return undefined as Payload;
  const text = await response.text();
  const payload: unknown = text === '' ? null : JSON.parse(text);
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; fields?: Record<string, string> } })?.error;
    throw new ApiFailure(
      response.status,
      error?.code ?? 'unknown',
      error?.message ?? 'Something went wrong.',
      error?.fields ?? {},
    );
  }
  return payload as Payload;
}

export function signIn(email: string, password: string): Promise<{ user: CurrentUser }> {
  return request('POST', '/api/session', { json: { email, password } });
}

export function signOut(): Promise<void> {
  return request('DELETE', '/api/session');
}

export function currentUser(): Promise<{ user: CurrentUser }> {
  return request('GET', '/api/me');
}

export interface NewAssignment {
  language: string;
  setting: string;
  start_at: string;
  duration_minutes: number;
  street_address: string;
  city: string;
  patient_initials: string;
  medical_notes: string;
}

export function createAssignment(
  body: NewAssignment,
  idempotencyKey: string,
): Promise<AssignmentView> {
  return request('POST', '/api/assignments', {
    json: body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export function listAssignments(search: string): Promise<{ assignments: AssignmentView[] }> {
  const query = search.trim() === '' ? '' : `?q=${encodeURIComponent(search.trim())}`;
  return request('GET', `/api/assignments${query}`);
}

export function changeTime(
  number: string,
  body: { start_at: string; duration_minutes: number },
): Promise<AssignmentView> {
  return request('PATCH', `/api/assignments/${number}`, { json: body });
}

export function releaseAssignment(
  number: string,
): Promise<{ assignment: AssignmentView; offers_sent: number }> {
  return request('POST', `/api/assignments/${number}/release`, { json: {} });
}

export function cancellationQuote(number: string): Promise<CancellationQuote> {
  return request('GET', `/api/assignments/${number}/cancellation-quote`);
}

export function cancelAssignment(number: string): Promise<AssignmentView> {
  return request('POST', `/api/assignments/${number}/cancel`, { json: {} });
}

export function listOffers(): Promise<{ offers: AssignmentView[] }> {
  return request('GET', '/api/offers');
}

export function listMySeats(): Promise<{ assignments: AssignmentView[] }> {
  return request('GET', '/api/my-seats');
}

export function claimSeat(number: string, seat: number): Promise<AssignmentView> {
  return request('POST', `/api/assignments/${number}/seats/${seat}/claim`, { json: {} });
}

export function giveBackSeat(number: string, seat: number): Promise<AssignmentView> {
  return request('POST', `/api/assignments/${number}/seats/${seat}/give-back`, { json: {} });
}

export function submitVerification(
  number: string,
  seat: number,
  form: FormData,
): Promise<AssignmentView> {
  return request('POST', `/api/assignments/${number}/seats/${seat}/verification`, { form });
}

export function verificationLink(
  number: string,
  seat: number,
): Promise<{ url: string; expires_in_seconds: number }> {
  return request('GET', `/api/assignments/${number}/seats/${seat}/verification-link`);
}

export function loadCoverage(weekStart: string): Promise<Coverage> {
  return request('GET', `/api/coverage?week=${weekStart}`);
}

export function postInvoice(number: string): Promise<{ billing: BillingView }> {
  return request('POST', `/api/assignments/${number}/invoice`, { json: {} });
}

export function loadBillingQueue(): Promise<{ items: QueueItem[] }> {
  return request('GET', '/api/billing/queue');
}

export function loadRateCard(org: string): Promise<{ entries: RateEntryView[] }> {
  return request('GET', `/api/rate-cards?org=${encodeURIComponent(org)}`);
}

export function addRate(body: {
  org: string;
  service_line: string;
  effective_from: string;
  hourly_rate_cents: number;
  mileage_cents_per_mile: number;
}): Promise<RateEntryView> {
  return request('POST', '/api/rate-cards', { json: body });
}

export function loadSchedulers(): Promise<{ schedulers: SchedulerView[] }> {
  return request('GET', '/api/org/schedulers');
}

export function addScheduler(body: {
  name: string;
  email: string;
  phone: string;
  password: string;
}): Promise<SchedulerView> {
  return request('POST', '/api/org/schedulers', { json: body });
}

export function removeScheduler(id: string): Promise<void> {
  return request('DELETE', `/api/org/schedulers/${id}`);
}

export async function downloadStatement(month: string): Promise<void> {
  const response = await fetch(`/api/org/statement?month=${encodeURIComponent(month)}`, {
    credentials: 'same-origin',
  });
  if (!response.ok) {
    const payload = (await response.json()) as {
      error?: { code?: string; message?: string; fields?: Record<string, string> };
    };
    throw new ApiFailure(
      response.status,
      payload.error?.code ?? 'unknown',
      payload.error?.message ?? 'Something went wrong.',
      payload.error?.fields ?? {},
    );
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `statement-${month}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
