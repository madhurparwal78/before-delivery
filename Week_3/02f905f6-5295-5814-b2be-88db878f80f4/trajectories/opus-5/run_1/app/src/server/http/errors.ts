import type { ApiErrorBody, PlacementReason } from '../../shared/types';

/** Every refusal the API makes carries one of these. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Partial<ApiErrorBody>;

  constructor(status: number, code: string, message: string, extra: Partial<ApiErrorBody> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  get body(): ApiErrorBody {
    return { error: this.code, message: this.message, ...this.extra };
  }
}

export const crossOrigin = (): ApiError =>
  new ApiError(403, 'cross_origin', 'Cross-origin request refused.');

export const methodNotAllowed = (): ApiError =>
  new ApiError(405, 'method_not_allowed', 'Method not allowed.');

export const tooLarge = (): ApiError => new ApiError(413, 'too_large', 'Request is too large.');

export const unsupportedType = (): ApiError =>
  new ApiError(415, 'unsupported_type', 'Unsupported content type.');

export const unauthenticated = (): ApiError =>
  new ApiError(401, 'unauthenticated', 'Sign in first.');

export const badCredentials = (): ApiError =>
  new ApiError(401, 'bad_credentials', 'Email or password is wrong.');

export const notFound = (message = 'Not found.'): ApiError =>
  new ApiError(404, 'not_found', message);

export const forbidden = (): ApiError =>
  new ApiError(403, 'forbidden', "Your role can't do that.");

export const conflict = (code: string, message: string, extra: Partial<ApiErrorBody> = {}): ApiError =>
  new ApiError(409, code, message, extra);

export const unprocessable = (fields: Record<string, string>): ApiError =>
  new ApiError(422, 'invalid_fields', 'Check these fields.', { fields });

export const placementRefused = (reason: PlacementReason, message: string): ApiError =>
  new ApiError(409, 'placement_refused', message, { reason });

export const storageUnavailable = (): ApiError =>
  new ApiError(503, 'storage_unavailable', 'Photo not saved — storage is unreachable. Try again in a minute.');

export const billingUnavailable = (message = 'Billing is unreachable.'): ApiError =>
  new ApiError(503, 'billing_unavailable', message);

export const paymentFailed = (): ApiError =>
  new ApiError(502, 'payment_failed', 'The payment was not accepted.');

export const intakeFailed = (step: 'photo' | 'charge' | 'receipt'): ApiError => {
  const message =
    step === 'photo'
      ? 'Intake stopped at the photo step: the photo could not be confirmed. Nothing was charged.'
      : step === 'charge'
        ? 'Intake stopped at the charge step: billing is unreachable. Nothing was charged.'
        : 'Intake stopped at the receipt step: email is unreachable. The charge was voided.';
  return new ApiError(503, 'intake_failed', message, { step });
};

/** Thrown by the providers so the routes can decide which step failed. */
export class ProviderDown extends Error {
  readonly provider: 'storage' | 'billing' | 'mail';

  constructor(provider: 'storage' | 'billing' | 'mail', message: string) {
    super(message);
    this.provider = provider;
  }
}

/** Kill Bill answered, but it did not accept the payment. */
export class PaymentDeclined extends Error {}
