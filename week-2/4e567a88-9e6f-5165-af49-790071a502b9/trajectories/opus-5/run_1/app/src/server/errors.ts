import { JsonValue } from './types';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, JsonValue>;

  constructor(status: number, code: string, message: string, extra: Record<string, JsonValue> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  body(): JsonValue {
    return { error: { code: this.code, message: this.message, ...this.extra } };
  }
}

export const fail = {
  malformedJson: () => new ApiError(400, 'malformed_json', 'The request body is not valid JSON.'),
  payloadTooLarge: () => new ApiError(413, 'payload_too_large', 'The request body is larger than the limit.'),
  unsupportedMediaType: (message = 'Send this request as application/json; charset=utf-8.') =>
    new ApiError(415, 'unsupported_media_type', message),
  unauthenticated: () => new ApiError(401, 'unauthenticated', 'Sign in or send an API key to use this endpoint.'),
  crossOrigin: () => new ApiError(403, 'cross_origin', 'This write came from another origin and was refused.'),
  idempotencyKeyRequired: () =>
    new ApiError(
      400,
      'idempotency_key_required',
      'Send an Idempotency-Key header of 1 to 255 visible ASCII characters.',
    ),
  idempotencyKeyReused: () =>
    new ApiError(409, 'idempotency_key_reused', 'This Idempotency-Key was already used with a different body.'),
  notFound: () => new ApiError(404, 'not_found', 'That resource does not exist.'),
  forbidden: () => new ApiError(403, 'forbidden', 'Your role cannot use this endpoint.'),
  modelBlocked: (message: string) => new ApiError(403, 'model_blocked', message),
  assetGone: (removedAt: string, reason: string) =>
    new ApiError(410, 'asset_gone', 'That asset is gone.', { removed_at: removedAt, reason }),
  validation: (fields: Record<string, string>, message = 'Some fields are not valid.') =>
    new ApiError(422, 'validation_failed', message, { fields }),
  jobNotCancellable: (status: string) =>
    new ApiError(409, 'job_not_cancellable', `That job is already ${status} and cannot be cancelled.`, { status }),
  rateAlreadyEffective: () =>
    new ApiError(409, 'rate_already_effective', 'That rate is already in effect and cannot be withdrawn.'),
  policyVersionStale: (currentVersion: number) =>
    new ApiError(412, 'policy_version_stale', 'Someone saved a newer policy.', { current_version: currentVersion }),
  endpointLimitReached: () => new ApiError(409, 'endpoint_limit_reached', 'This team already has 5 endpoints.'),
  endpointNotDisabled: () => new ApiError(409, 'endpoint_not_disabled', 'That endpoint is not disabled.'),
  insufficientCredits: (requiredMicro: bigint, availableMicro: bigint) =>
    new ApiError(402, 'insufficient_credits', 'This run needs more credits than the team has available.', {
      required_micro: Number(requiredMicro),
      available_micro: Number(availableMicro),
    }),
  budgetHardCap: (periodEndsAt: string) =>
    new ApiError(429, 'budget_hard_cap', 'This team has reached its hard cap for the budget period.', {
      period_ends_at: periodEndsAt,
    }),
  storageUnavailable: () => new ApiError(503, 'storage_unavailable', 'Object storage is unreachable.'),
  billingRejected: () => new ApiError(502, 'billing_rejected', 'Billing declined the top-up.'),
};

export const fieldMessages = {
  refusedAddress: 'This address is not allowed. Use a public address.',
  unfetchableImage: 'That image could not be fetched.',
  notAnImage: 'That address did not return a PNG, JPEG or WebP image.',
  imageTooLarge: 'That image is larger than the upload limit.',
  required: 'Required.',
  notInFuture: 'Choose a moment in the future.',
  nonexistentLocalTime: (timezone: string) =>
    `That time does not exist in ${timezone} because clocks move forward.`,
};
