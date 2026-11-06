export interface ApiFailure {
  readonly error: string;
  readonly message: string;
  readonly errors?: Record<string, string>;
  readonly offer?: { readonly accept: AcceptedStatus; readonly label: string };
  readonly opens_at?: string;
  readonly charged?: boolean;
}

export class ApiRequestError extends Error {
  constructor(readonly status: number, readonly payload: ApiFailure) {
    super(payload.message);
    this.name = 'ApiRequestError';
  }
}

export type AcceptedStatus = 'CNF' | 'RAC' | 'WL';
export type TravelClass = 'SL' | '3A';
export type QuotaCode = 'GN' | 'TQ' | 'LD' | 'SS';
export type BerthType = 'LB' | 'MB' | 'UB' | 'SL' | 'SU';
export type BerthPreference = BerthType | 'NONE';

export interface Account {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
}

export interface Station {
  readonly code: string;
  readonly name: string;
}

export interface ClockBody {
  readonly now: string;
  readonly zone: string;
  readonly rate: number;
}

export interface ClassEntry {
  readonly class: TravelClass;
  readonly quota: QuotaCode;
  readonly window: 'not_yet_open' | 'open' | 'chart_prepared';
  readonly opens_at: string;
  readonly avl: number;
  readonly rac: number | null;
  readonly wl_type: string | null;
  readonly wl: number | null;
  readonly wl_cap: number | null;
  readonly label: string;
  readonly adult_fare_paise: number;
}

export interface TrainStop {
  readonly code: string;
  readonly name: string;
  readonly km: number;
  readonly departure_at: string;
}

export interface TrainEntry {
  readonly number: string;
  readonly name: string;
  readonly run_date: string;
  readonly from: { code: string; name: string; departure_at: string };
  readonly to: { code: string; name: string; arrival_at: string };
  readonly stops: readonly TrainStop[];
  readonly chart_at: string;
  readonly chart_prepared: boolean;
  readonly classes: readonly ClassEntry[];
}

export interface BerthCell {
  readonly berth: number;
  readonly bay: number;
  readonly type: BerthType;
  readonly quota: QuotaCode | 'RAC';
  readonly state: 'free' | 'taken' | 'rac_free' | 'rac_one_free' | 'rac_full';
}

export interface CoachPlan {
  readonly coach: string;
  readonly berths: readonly BerthCell[];
}

export interface FareLine {
  readonly label: string;
  readonly amount_paise: number;
}

export interface FareQuoteBody {
  readonly lines: readonly FareLine[];
  readonly total_paise: number;
}

export interface StatusBody {
  readonly status: string;
  readonly position: number | null;
  readonly coach: string | null;
  readonly berth: number | null;
  readonly berth_type: BerthType | null;
  readonly label: string;
}

export interface PassengerBody {
  readonly number: number;
  readonly name: string;
  readonly age: number;
  readonly gender: 'M' | 'F' | 'T';
  readonly berth_preference: BerthPreference;
  readonly fare_paise: number;
  readonly booking_status: StatusBody;
  readonly current_status: StatusBody;
  readonly history: readonly { at: string; from_label: string; to_label: string }[];
}

export interface CancellationPassengerBody {
  readonly number: number;
  readonly band: string;
  readonly charge_paise: number;
  readonly gst_paise: number;
  readonly deduction_paise: number;
  readonly refund_paise: number;
}

export interface CancellationBody {
  readonly number: number;
  readonly requested_at: string;
  readonly passengers: readonly CancellationPassengerBody[];
  readonly refund_paise: number;
}

export interface RefundBody {
  readonly number: number;
  readonly reason: 'cancellation' | 'chart';
  readonly refund_paise: number;
  readonly status: 'pending' | 'issued';
  readonly issued_at: string | null;
}

export interface TicketBody {
  readonly version: number;
  readonly kind: 'booked' | 'cancellation' | 'chart';
  readonly created_at: string;
}

export interface BookingBody {
  readonly pnr: string;
  readonly version: number;
  readonly state: 'booked' | 'chart_prepared' | 'journey_complete';
  readonly train: { number: string; name: string };
  readonly run_date: string;
  readonly from: string;
  readonly to: string;
  readonly class: TravelClass;
  readonly quota: QuotaCode;
  readonly departure_at: string;
  readonly arrival_at: string;
  readonly chart_at: string;
  readonly chart_prepared: boolean;
  readonly keep_in_one_coach: boolean;
  readonly lower_berth_only: boolean;
  readonly contact_phone: string;
  readonly total_paise: number;
  readonly fare_lines: readonly FareLine[];
  readonly passengers: readonly PassengerBody[];
  readonly tickets: readonly TicketBody[];
  readonly cancellations: readonly CancellationBody[];
  readonly refunds: readonly RefundBody[];
}

export interface BookingSummary {
  readonly pnr: string;
  readonly train: { number: string; name: string };
  readonly run_date: string;
  readonly from: string;
  readonly to: string;
  readonly class: TravelClass;
  readonly state: string;
  readonly summary: string;
}

export interface PublicPnrBody {
  readonly pnr: string;
  readonly train: { number: string; name: string };
  readonly run_date: string;
  readonly from: string;
  readonly to: string;
  readonly class: TravelClass;
  readonly chart_prepared: boolean;
  readonly passengers: readonly {
    number: number;
    booking_status: string;
    current_status: string;
  }[];
}

export interface CancellationQuoteBody {
  readonly quoted_at: string;
  readonly passengers: readonly CancellationPassengerBody[];
  readonly refund_paise: number;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey !== undefined) headers['Idempotency-Key'] = idempotencyKey;
  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (response.status === 204) return undefined as T;
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const failure: ApiFailure = payload !== null && typeof payload === 'object'
      ? (payload as ApiFailure)
      : { error: 'network', message: 'Request failed' };
    throw new ApiRequestError(response.status, failure);
  }
  return payload as T;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export const api = {
  clock: (): Promise<ClockBody> => request('GET', '/api/clock'),
  stations: (): Promise<{ stations: Station[] }> => request('GET', '/api/stations'),
  me: (): Promise<Account> => request('GET', '/api/me'),
  signIn: (email: string, password: string): Promise<Account> =>
    request('POST', '/api/session', { email, password }),
  signOut: (): Promise<void> => request('DELETE', '/api/session'),
  createAccount: (input: {
    name: string;
    email: string;
    password: string;
    phone: string;
  }): Promise<Account> => request('POST', '/api/accounts', input),
  trains: (query: string): Promise<{ trains: TrainEntry[] }> =>
    request('GET', `/api/trains?${query}`),
  coaches: (
    trainNumber: string,
    runDate: string,
    query: string,
  ): Promise<{ coaches: CoachPlan[] }> =>
    request('GET', `/api/trains/${trainNumber}/runs/${runDate}/coaches?${query}`),
  fareQuote: (input: unknown): Promise<FareQuoteBody> => request('POST', '/api/fare-quote', input),
  book: (input: unknown, key: string): Promise<BookingBody> =>
    request('POST', '/api/bookings', input, key),
  myBookings: (): Promise<{ bookings: BookingSummary[] }> => request('GET', '/api/bookings'),
  booking: (pnr: string): Promise<BookingBody> => request('GET', `/api/bookings/${pnr}`),
  cancellationQuote: (pnr: string, passengers: number[]): Promise<CancellationQuoteBody> =>
    request('POST', `/api/bookings/${pnr}/cancellation-quote`, { passengers }),
  cancel: (
    pnr: string,
    passengers: number[],
    key: string,
  ): Promise<{ cancellation: CancellationBody; refund: RefundBody | null; booking: BookingBody }> =>
    request('POST', `/api/bookings/${pnr}/cancellations`, { passengers }, key),
  publicPnr: (pnr: string): Promise<PublicPnrBody> => request('GET', `/api/pnr/${pnr}`),
};
