/**
 * The one error shape. Every API failure is raised as an `ApiError`, and the
 * order the checks run in is the single precedence order from the brief.
 */

import type { ConflictDetails } from '../domain/occupancy.js';
import type { BookingStatus, DocumentStatus, RenterStatus } from '../../shared/types.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown> & { error: string },
  ) {
    super(body.error);
  }
}

const simple = (status: number, error: string) => (): ApiError => new ApiError(status, { error });

export const payloadTooLarge = simple(413, 'payload_too_large');
export const crossOrigin = simple(403, 'cross_origin');
export const readOnly = simple(405, 'read_only');
export const unsupportedMediaType = simple(415, 'unsupported_media_type');
export const unauthenticated = simple(401, 'unauthenticated');
export const notFound = simple(404, 'not_found');
export const forbidden = simple(403, 'forbidden');
export const idempotencyConflict = simple(409, 'idempotency_conflict');
export const holdExpired = simple(409, 'hold_expired');
export const renterNotActive = simple(409, 'renter_not_active');
export const renterOffboarded = simple(409, 'renter_offboarded');
export const complianceLapsed = simple(409, 'compliance_lapsed');
export const alreadyRevoked = simple(409, 'already_revoked');
export const alreadySubscribed = simple(409, 'already_subscribed');
export const notSubscribed = simple(409, 'not_subscribed');
export const fileTooLarge = simple(413, 'file_too_large');
export const unsupportedType = simple(415, 'unsupported_type');
export const invalidCredentials = simple(401, 'invalid_credentials');
export const stationInUse = simple(409, 'station_in_use');
export const documentsIncomplete = simple(409, 'documents_incomplete');
export const documentExpired = simple(409, 'document_expired');
export const hasFutureBookings = simple(409, 'has_future_bookings');
export const billingUnavailable = simple(503, 'billing_unavailable');
export const storageUnavailable = simple(503, 'storage_unavailable');
export const paymentFailed = simple(402, 'payment_failed');

export function validation(errors: Record<string, string>): ApiError {
  return new ApiError(422, { error: 'validation', errors });
}

export function invalidTransition(
  from: BookingStatus | RenterStatus | DocumentStatus,
  to: BookingStatus | RenterStatus | DocumentStatus,
): ApiError {
  return new ApiError(409, { error: 'invalid_transition', from, to });
}

export function slotConflict(date: string, details: ConflictDetails): ApiError {
  return new ApiError(409, {
    error: 'slot_conflict',
    date,
    legal_end: details.legal_end,
    blocked_by: details.blocked_by,
    blocked_at: details.blocked_at,
  });
}

export function insufficientHours(balanceMinutes: number, neededMinutes: number): ApiError {
  return new ApiError(409, {
    error: 'insufficient_hours',
    balance_minutes: balanceMinutes,
    needed_minutes: neededMinutes,
  });
}
