export type FieldMessages = Record<string, string>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: FieldMessages | null;
  readonly extra: Record<string, number> | null;

  constructor(
    status: number,
    code: string,
    message: string,
    fields: FieldMessages | null = null,
    extra: Record<string, number> | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.extra = extra;
  }

  body(): Record<string, unknown> {
    return {
      error: this.code,
      message: this.message,
      ...(this.fields === null ? {} : { fields: this.fields }),
      ...(this.extra === null ? {} : this.extra),
    };
  }
}

export const apiError = {
  crossOrigin: (): ApiError =>
    new ApiError(403, 'cross_origin', 'Bloom Desk accepts writes from its own pages only.'),
  payloadTooLarge: (): ApiError =>
    new ApiError(413, 'payload_too_large', 'That request body is too large.'),
  photoTooLarge: (): ApiError =>
    new ApiError(413, 'payload_too_large', 'That photo is too large.', {
      photo: 'Photos must be 8,000,000 bytes or smaller.',
    }),
  unsupportedMediaType: (): ApiError =>
    new ApiError(415, 'unsupported_media_type', 'That request body is not JSON.'),
  photoUnsupportedType: (): ApiError =>
    new ApiError(415, 'unsupported_media_type', 'That file is not a frame photo.', {
      photo: 'Photos must be JPEG, PNG or WebP images.',
    }),
  unauthenticated: (): ApiError =>
    new ApiError(401, 'unauthenticated', 'Sign in to use Bloom Desk.'),
  invalidCredentials: (): ApiError =>
    new ApiError(
      401,
      'invalid_credentials',
      "That email and password don't match a Bloom Desk account.",
    ),
  notFound: (): ApiError => new ApiError(404, 'not_found', "That record isn't available to you."),
  forbidden: (): ApiError =>
    new ApiError(403, 'forbidden', 'Your role cannot take that action on Bloom Desk.'),
  linkSigned: (orchardName: string): ApiError =>
    new ApiError(410, 'link_signed', `The report for ${orchardName} has been signed.`),
  linkExpired: (): ApiError =>
    new ApiError(410, 'link_expired', 'That inspection link has stopped working.'),
  fileLinkExpired: (): ApiError =>
    new ApiError(410, 'file_link_expired', 'That file link has expired.'),
  invalidTransition: (statusLabel: string, ref: string): ApiError =>
    new ApiError(409, 'invalid_transition', `That can't be done while ${ref} is ${statusLabel}.`),
  dropsDelivered: (ref: string): ApiError =>
    new ApiError(409, 'drops_delivered', `${ref} has delivered drops and can't be cancelled.`),
  dropsNotDelivered: (ref: string): ApiError =>
    new ApiError(409, 'drops_not_delivered', `Every drop on ${ref} must be delivered first.`),
  dropsNotAccepted: (orchardName: string): ApiError =>
    new ApiError(
      409,
      'drops_not_accepted',
      `Every drop must be accepted before ${orchardName} can be settled.`,
    ),
  alreadySettled: (orchardName: string): ApiError =>
    new ApiError(409, 'already_settled', `${orchardName} is already settled.`),
  idempotencyKeyReused: (): ApiError =>
    new ApiError(
      409,
      'idempotency_key_reused',
      'That request was already sent with different details. Reload and try again.',
    ),
  notEnoughOpenHives: (remaining: number, ref: string): ApiError =>
    new ApiError(
      409,
      'not_enough_open_hives',
      `Only ${remaining} hives are still open on ${ref}.`,
      null,
      { remaining },
    ),
  validation: (fields: FieldMessages): ApiError =>
    new ApiError(422, 'validation_failed', 'Check the highlighted fields.', fields),
  billingUnavailable: (): ApiError =>
    new ApiError(503, 'billing_unavailable', 'Billing is unreachable. Try again in a minute.'),
  storageUnavailable: (): ApiError =>
    new ApiError(503, 'storage_unavailable', 'File storage is unreachable. Try again in a minute.'),
};

export class ProviderUnavailable extends Error {
  readonly provider: 'billing' | 'storage';

  constructor(provider: 'billing' | 'storage', message: string) {
    super(message);
    this.name = 'ProviderUnavailable';
    this.provider = provider;
  }

  toApiError(): ApiError {
    return this.provider === 'billing'
      ? apiError.billingUnavailable()
      : apiError.storageUnavailable();
  }
}
