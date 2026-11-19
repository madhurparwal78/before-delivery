import type {
  Cart,
  Entry,
  HoldResponse,
  Offer,
  Order,
  OutboxMessage,
  OwnerOrder,
  OwnerTier,
  Performance,
  Seat,
} from '../../shared/api';

export interface ApiResult<T> {
  readonly status: number;
  readonly data: T | undefined;
  readonly error: string | undefined;
  readonly fields: Record<string, string> | undefined;
  readonly taken: string[] | undefined;
  readonly cart: Cart | undefined;
}

interface ErrorBody {
  error?: string;
  fields?: Record<string, string>;
  taken?: string[];
  cart?: Cart;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (idempotencyKey !== undefined) headers['idempotency-key'] = idempotencyKey;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    return { status: 0, data: undefined, error: 'offline', fields: undefined, taken: undefined, cart: undefined };
  }
  const text = await response.text();
  let payload: unknown = undefined;
  if (text !== '') {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = undefined;
    }
  }
  if (response.ok) {
    return {
      status: response.status,
      data: payload as T,
      error: undefined,
      fields: undefined,
      taken: undefined,
      cart: undefined,
    };
  }
  const failure = (payload ?? {}) as ErrorBody;
  return {
    status: response.status,
    data: undefined,
    error: failure.error ?? 'request_failed',
    fields: failure.fields,
    taken: failure.taken,
    cart: failure.cart,
  };
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export const api = {
  performances: () => request<{ performances: Performance[] }>('GET', '/api/performances'),
  performance: (performanceId: string) => request<Performance>('GET', `/api/performances/${performanceId}`),
  seats: (performanceId: string) => request<{ seats: Seat[] }>('GET', `/api/performances/${performanceId}/seats`),
  cart: (performanceId: string) => request<Cart>('GET', `/api/performances/${performanceId}/cart`),
  hold: (performanceId: string, seatIds: readonly string[]) =>
    request<HoldResponse>('POST', `/api/performances/${performanceId}/holds`, { seatIds }),
  release: (performanceId: string, seatId: string) =>
    request<{ cart: Cart }>('DELETE', `/api/performances/${performanceId}/holds/${seatId}`),
  checkout: (performanceId: string, body: { name: string; email: string }, key: string) =>
    request<{ order: Order }>('POST', `/api/performances/${performanceId}/checkout`, body, key),
  joinWaitlist: (performanceId: string, tierId: string, body: { name: string; email: string }) =>
    request<{ entry: Entry }>('POST', `/api/performances/${performanceId}/tiers/${tierId}/waitlist`, body),
  orders: () => request<{ orders: Order[] }>('GET', '/api/orders'),
  waitlist: () => request<{ entries: Entry[] }>('GET', '/api/waitlist'),
  exchange: (ticketId: string, newSeatId: string, key: string) =>
    request<{ order: Order; differenceCents: number }>(
      'POST',
      `/api/tickets/${ticketId}/exchange`,
      { newSeatId },
      key,
    ),
  refund: (orderId: string, ticketIds: readonly string[], key: string) =>
    request<{ order: Order; refundCents: number }>('POST', `/api/orders/${orderId}/refunds`, { ticketIds }, key),
  offer: (token: string) => request<{ offer: Offer }>('GET', `/api/offers/${token}`),
  acceptOffer: (token: string, key: string) =>
    request<{ order: Order }>('POST', `/api/offers/${token}/accept`, {}, key),
  declineOffer: (token: string) => request<{ offer: Offer }>('POST', `/api/offers/${token}/decline`, {}),
  ownerSignIn: (passcode: string) => request<undefined>('POST', '/api/owner/session', { passcode }),
  ownerSignOut: () => request<undefined>('DELETE', '/api/owner/session'),
  ownerPerformances: () => request<{ performances: Performance<OwnerTier>[] }>('GET', '/api/owner/performances'),
  ownerPublish: (body: unknown) => request<{ performance: Performance }>('POST', '/api/owner/performances', body),
  ownerOrders: () => request<{ orders: OwnerOrder[] }>('GET', '/api/owner/orders'),
  ownerOutbox: () => request<{ messages: OutboxMessage[] }>('GET', '/api/owner/outbox'),
};
