/**
 * The API client.
 *
 * The browser renders the server's answers and never recomputes a verdict, an
 * amount or a deadline. It talks only to this origin: never to Kill Bill,
 * WireMock, Mailpit or PostgreSQL.
 */

import type {
  BikeView,
  DeskPayment,
  DeskRide,
  FitResult,
  Order,
  PlateLookupResult,
  ProviderStatus,
  Quote,
  Ride,
  Slot,
  User,
} from '../shared/types.js';

export interface ApiFailure {
  status: number;
  code: string | null;
  errors: Record<string, string> | null;
}

export class ApiCallError extends Error implements ApiFailure {
  readonly status: number;
  readonly code: string | null;
  readonly errors: Record<string, string> | null;

  constructor(status: number, code: string | null, errors: Record<string, string> | null) {
    super(`api ${status} ${code ?? ''}`);
    this.name = 'ApiCallError';
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
}

/** The network itself failed, so nothing is known about the request. */
export class NetworkError extends Error {
  constructor() {
    super('network unreachable');
    this.name = 'NetworkError';
  }
}

interface CallOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

async function call<T>(path: string, options: CallOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new NetworkError();
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const payload = (body ?? {}) as { error?: string; errors?: Record<string, string> };
    throw new ApiCallError(response.status, payload.error ?? null, payload.errors ?? null);
  }
  return body as T;
}

export interface Catalogue {
  donors: {
    model: string;
    name: string;
    powerTenthsKw: number;
    wheelbaseTenthsMm: number;
    bayXTenthsMm: number;
    revisions: {
      revision: 'A' | 'B';
      stations: {
        id: string;
        name: string;
        travelTenthsMm: number;
        openWidthTenthsMm: number;
        openHeightTenthsMm: number;
      }[];
    }[];
    hubFrame: {
      mouthWidthTenthsMm: number;
      armWidthTenthsMm: number;
      sprocketLineTenthsMm: number;
    } | null;
  }[];
  packs: {
    id: string;
    widthTenthsMm: number;
    heightTenthsMm: number;
    wattHours: number;
    massTenthsKg: number;
    grossCents: number;
  }[];
  hubs: {
    id: string;
    widthTenthsMm: number;
    shaftTenthsMm: number;
    powerTenthsKw: number;
    grossCents: number;
  }[];
  parts: {
    id: string;
    name: string;
    position: [number, number, number];
    storyStage: number | null;
    axis: string | null;
    storyDistanceTenthsMm: number;
    fadedFor: ('pack' | 'hub')[];
  }[];
  roadClasses: Record<string, Record<string, string>>;
  fixedLines: Record<string, { name: string; grossCents: number }> & {
    HANDOVER: { name: string; grossCents: number };
  };
  hubStations: { id: string; name: string; travelTenthsMm: number }[];
  plateFormats: Record<string, { pattern: string; example: string }>;
  storyCaptions: string[];
  minClearanceMm: string;
  bikes: BikeView[];
}

export const api = {
  status: (signal?: AbortSignal) =>
    call<ProviderStatus>('/api/status', signal ? { signal } : {}),
  catalogue: () => call<Catalogue>('/api/catalogue'),
  me: () => call<User>('/api/me'),
  signIn: (email: string, password: string) =>
    call<User>('/api/auth/sign-in', { method: 'POST', body: { email, password } }),
  register: (body: { email: string; password: string; name: string; country: string }) =>
    call<User>('/api/auth/register', { method: 'POST', body }),
  signOut: () => call<void>('/api/auth/sign-out', { method: 'POST' }),

  lookupPlate: (plate: string, country: string, signal?: AbortSignal) =>
    call<PlateLookupResult>('/api/plates/lookup', {
      method: 'POST',
      body: { plate, country },
      ...(signal ? { signal } : {}),
    }),
  fitCheck: (body: unknown, signal?: AbortSignal) =>
    call<FitResult>('/api/fit-checks', { method: 'POST', body, ...(signal ? { signal } : {}) }),
  quote: (body: unknown, signal?: AbortSignal) =>
    call<Quote>('/api/quotes', { method: 'POST', body, ...(signal ? { signal } : {}) }),

  bikes: (roadClass: '25' | '45' | null) =>
    call<{ bikes: BikeView[] }>(`/api/bikes${roadClass ? `?class=${roadClass}` : ''}`),
  slots: (bikeId: string) => call<{ slots: Slot[] }>(`/api/bikes/${bikeId}/slots`),

  createOrder: (body: unknown) => call<Order>('/api/orders', { method: 'POST', body }),
  orders: () => call<{ orders: Order[] }>('/api/orders'),
  order: (id: string, signal?: AbortSignal) =>
    call<Order>(`/api/orders/${id}`, signal ? { signal } : {}),
  patchOrder: (id: string, body: unknown) =>
    call<Order>(`/api/orders/${id}`, { method: 'PATCH', body }),
  pay: (id: string, stage: string, idempotencyKey: string) =>
    call<Order>(`/api/orders/${id}/payments`, { method: 'POST', body: { stage }, idempotencyKey }),
  withdraw: (id: string, idempotencyKey: string) =>
    call<Order>(`/api/orders/${id}/withdraw`, { method: 'POST', body: {}, idempotencyKey }),
  switchToWorkshop: (id: string, idempotencyKey: string) =>
    call<Order>(`/api/orders/${id}/switch-to-workshop`, {
      method: 'POST',
      body: {},
      idempotencyKey,
    }),

  hold: (slotId: string) => call<Ride>('/api/test-rides/holds', { method: 'POST', body: { slotId } }),
  rides: () => call<{ rides: Ride[] }>('/api/test-rides'),
  ride: (id: string, signal?: AbortSignal) =>
    call<Ride>(`/api/test-rides/${id}`, signal ? { signal } : {}),
  confirmRide: (id: string) => call<Ride>(`/api/test-rides/${id}/confirm`, { method: 'POST', body: {} }),
  cancelRide: (id: string) => call<Ride>(`/api/test-rides/${id}/cancel`, { method: 'POST', body: {} }),

  deskOrders: (signal?: AbortSignal) =>
    call<{ orders: Order[] }>('/api/desk/orders', signal ? { signal } : {}),
  deskOrder: (id: string, signal?: AbortSignal) =>
    call<Order & { payments: DeskPayment[] }>(`/api/desk/orders/${id}`, signal ? { signal } : {}),
  refundLine: (id: string, lineId: string, amountCents: number, idempotencyKey: string) =>
    call<Order>(`/api/desk/orders/${id}/refunds`, {
      method: 'POST',
      body: { lineId, amountCents },
      idempotencyKey,
    }),
  deskTransition: (id: string, to: string) =>
    call<Order>(`/api/desk/orders/${id}/transitions`, { method: 'POST', body: { to } }),
  deskDelivered: (id: string, deliveredOn: string) =>
    call<Order>(`/api/desk/orders/${id}/delivered`, { method: 'POST', body: { deliveredOn } }),
  deskInspection: (id: string) =>
    call<Order>(`/api/desk/orders/${id}/inspection`, { method: 'POST', body: {} }),
  openRideDay: (bikeId: string, date: string, times: string[]) =>
    call<{ slots: Slot[] }>('/api/desk/ride-days', { method: 'POST', body: { bikeId, date, times } }),
  deskRides: (date: string, signal?: AbortSignal) =>
    call<{ rides: DeskRide[] }>(`/api/desk/rides?date=${date}`, signal ? { signal } : {}),
  rideOutcome: (id: string, outcome: 'ridden' | 'no-show') =>
    call<Ride>(`/api/desk/rides/${id}/outcome`, { method: 'POST', body: { outcome } }),
};
