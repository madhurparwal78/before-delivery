// The browser's API layer. Every request is same-origin, follows the one
// error shape, and reports failures to the caller as typed results.

import type { BoardResponse, Booking, Document, Hold, Kitchen, Packet, Transaction, User } from '../shared/types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public errors?: Record<string, string>,
  ) {
    super(code);
  }
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  body?: T;
  error?: string;
  errors?: Record<string, string>;
}

/** Set by the shell so any 401 returns to sign in with the stated copy. */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0 };
  }
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (res.ok) {
    return { ok: true, status: res.status, body: parsed as T };
  }
  if (res.status === 401 && path !== '/api/session' && onUnauthorized) {
    onUnauthorized();
  }
  const record = (parsed ?? {}) as { error?: string; errors?: Record<string, string> };
  return { ok: false, status: res.status, error: record.error ?? 'unknown', errors: record.errors };
}

// Typed endpoint helpers.

export const getKitchen = () => api<Kitchen>('GET', '/api/kitchen');
export const getMe = () => api<{ user: User; balance_minutes: number | null }>('GET', '/api/me');
export const signIn = (email: string, password: string) =>
  api<{ user: User }>('POST', '/api/session', { email, password });
export const signOut = () => api<unknown>('DELETE', '/api/session');
export const getBoard = (date?: string) => api<BoardResponse>('GET', '/api/board' + (date ? `?date=${date}` : ''));
export const postHold = (hold: { station_id: string; date: string; start: string; end: string }, key?: string) =>
  api<{ hold: Hold }>('POST', '/api/holds', hold, key);
export const patchHold = (id: string, end: string, key?: string) =>
  api<{ hold: Hold }>('PATCH', `/api/holds/${id}`, { end }, key);
export const deleteHold = (id: string) => api<unknown>('DELETE', `/api/holds/${id}`);
export const confirmHold = (id: string, key?: string) =>
  api<{ booking: Booking }>('POST', `/api/holds/${id}/confirm`, {}, key);
export const getBookings = (from: string, to: string, memberId?: string) =>
  api<{ bookings: Booking[] }>('GET', `/api/bookings?from=${from}&to=${to}` + (memberId ? `&member_id=${memberId}` : ''));
export const getBooking = (id: string) => api<{ booking: Booking }>('GET', `/api/bookings/${id}`);
export const cancelBooking = (id: string, key?: string) =>
  api<{ booking: Booking }>('POST', `/api/bookings/${id}/cancel`, {}, key);
export const waiveFee = (id: string, key?: string) =>
  api<{ booking: Booking }>('POST', `/api/bookings/${id}/waive-fee`, {}, key);
export const checkIn = (id: string, key?: string) =>
  api<{ booking: Booking }>('POST', `/api/bookings/${id}/check-ins`, {}, key);
export const getLedger = (memberId?: string) =>
  api<{ member_id?: string; balance_minutes: number; transactions: Transaction[] }>('GET', '/api/ledger' + (memberId ? `?member_id=${memberId}` : ''));
export const buyPack = (packId: string, key?: string) =>
  api<{ balance_minutes: number }>('POST', `/api/packs/${packId}/purchase`, {}, key);
export const adjustHours = (memberId: string, minutes: number, reason: string, key?: string) =>
  api<{ balance_minutes: number }>('POST', '/api/ledger/adjustments', { member_id: memberId, minutes, reason }, key);
export const reverseTransaction = (id: string, reason: string, key?: string) =>
  api<{ balance_minutes: number }>('POST', `/api/ledger/transactions/${id}/reverse`, { reason }, key);
export const getDocuments = (status?: string) =>
  api<{ documents: Document[] }>('GET', '/api/documents' + (status ? `?status=${status}` : ''));
export const uploadDocument = (form: FormData) => api<{ document: Document }>('POST', '/api/documents', form);
export const reviewDocument = (id: string, action: 'approve' | 'reject', reason?: string) =>
  api<{ document: Document }>('POST', `/api/documents/${id}/${action}`, action === 'reject' ? { reason } : {});
export const getMembers = () =>
  api<{ members: { id: string; business_name: string; contact_email: string; balance_minutes: number; liability_insurance: { status: string; expires_on: string } | null }[] }>('GET', '/api/members');
export const getUsage = (date: string) =>
  api<{ date: string; time_zone: string; stations: { station_id: string; station_name: string; booked_minutes: number; cleaning_minutes: number; bookings: number }[]; total_booked_minutes: number }>('GET', `/api/usage?date=${date}`);
export const getInvoices = (memberId?: string) =>
  api<{ invoices: { id: string; date: string; amount: string; balance: string; items: { description: string; amount: string }[] }[] }>('GET', '/api/invoices' + (memberId ? `?member_id=${memberId}` : ''));
export const createPacket = (from: string, to: string, expiresAt: string, key?: string) =>
  api<{ packet: Packet }>('POST', '/api/packets', { from, to, expires_at: expiresAt }, key);
export const getPackets = () => api<{ packets: Packet[] }>('GET', '/api/packets');
export const revokePacket = (id: string) => api<{ packet: Packet }>('POST', `/api/packets/${id}/revoke`, {});
export const regeneratePacket = (id: string, expiresAt?: string) =>
  api<{ packet: Packet }>('POST', `/api/packets/${id}/regenerate`, expiresAt ? { expires_at: expiresAt } : {});
export const getPacketContent = (token: string) =>
  api<{
    kitchen: string;
    time_zone: string;
    from: string;
    to: string;
    generated_at: string;
    days: { date: string; visits: { business_name: string; station: string; start: string; end: string; liability_insurance: { valid: boolean; expires_on: string | null }; crew: { name: string; checked_in_at: string; food_handler_card: { valid: boolean; expires_on: string | null } }[] }[] };
  }>('GET', `/api/packet/${token}`);
export const saveBusinessName = (name: string) =>
  api<{ member: { id: string; business_name: string } }>('PATCH', '/api/members/me', { business_name: name });
