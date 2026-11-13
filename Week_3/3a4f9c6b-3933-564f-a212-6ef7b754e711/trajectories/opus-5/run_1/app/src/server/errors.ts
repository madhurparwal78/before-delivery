import type { ErrorCode, PromotionState } from '../shared/types.js';

const statusByCode: Record<ErrorCode, number> = {
  payload_too_large: 413,
  unsupported_media_type: 415,
  cross_origin: 403,
  unauthenticated: 401,
  invalid_credentials: 401,
  not_found: 404,
  forbidden: 403,
  request_key_required: 400,
  request_key_reused: 409,
  validation: 422,
  invalid_transition: 409,
  stage_busy: 409,
  not_verified_upstream: 409,
  version_exists: 409,
  evidence_pending: 409,
  approval_expired: 409,
  no_healthy_revision: 409,
  phase_regression: 409,
  promotion_not_running: 409,
  link_expired: 410,
  stale_version: 412,
  storage_unavailable: 503,
};

export interface StageBusyHolder {
  promotion_id: string;
  bundle_version: string;
  bundle_digest: string;
  state: PromotionState;
}

type Extra =
  | { fields: Record<string, string> }
  | { holder: StageBusyHolder }
  | { state: PromotionState }
  | { current_version: number };

/** The single error shape for every API response outside `GET /api/health`. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly extra: Extra | undefined;

  constructor(code: ErrorCode, message: string, extra?: Extra) {
    super(message);
    this.code = code;
    this.status = statusByCode[code];
    this.extra = extra;
  }

  body(): Record<string, unknown> {
    return { error: this.code, message: this.message, ...(this.extra ?? {}) };
  }
}

export const errors = {
  payloadTooLarge: (limit: number) =>
    new ApiError('payload_too_large', `The request body is larger than ${limit} bytes.`),
  unsupportedMediaType: () =>
    new ApiError('unsupported_media_type', 'Send the body as application/json.'),
  crossOrigin: () => new ApiError('cross_origin', 'Cross-origin requests are not accepted.'),
  unauthenticated: () => new ApiError('unauthenticated', 'Sign in to continue.'),
  invalidCredentials: () => new ApiError('invalid_credentials', 'Email or password is wrong.'),
  notFound: () => new ApiError('not_found', 'That resource does not exist.'),
  forbidden: () => new ApiError('forbidden', 'Your role in this project cannot do that.'),
  requestKeyRequired: () =>
    new ApiError('request_key_required', 'Send a Request-Key header of 1 to 200 visible ASCII characters.'),
  requestKeyReused: () =>
    new ApiError('request_key_reused', 'That request key was already used with a different body.'),
  validation: (fields: Record<string, string>) =>
    new ApiError('validation', 'The request body is not valid.', { fields }),
  invalidTransition: (state: PromotionState) =>
    new ApiError('invalid_transition', `A promotion in ${state} cannot make that change.`, { state }),
  stageBusy: (holder: StageBusyHolder) =>
    new ApiError('stage_busy', 'That stage already has an active promotion.', { holder }),
  notVerifiedUpstream: (version: string, upstream: string) =>
    new ApiError('not_verified_upstream', `${version} has not reached Healthy in ${upstream} yet.`),
  versionExists: (version: string) =>
    new ApiError('version_exists', `Bundle version ${version} already exists in this project.`),
  evidencePending: () =>
    new ApiError('evidence_pending', 'The evidence snapshot is still being stored.'),
  approvalExpired: () => new ApiError('approval_expired', 'That approval has expired.'),
  noHealthyRevision: (stage: string) =>
    new ApiError('no_healthy_revision', `${stage} has no earlier healthy revision to roll back to.`),
  phaseRegression: () =>
    new ApiError('phase_regression', 'That phase is earlier than the promotion has already reached.'),
  promotionNotRunning: () =>
    new ApiError('promotion_not_running', 'That promotion is not applying or waiting on health.'),
  linkExpired: () => new ApiError('link_expired', 'This approval link has expired.'),
  staleVersion: (currentVersion: number) =>
    new ApiError('stale_version', `Freeze policy version ${currentVersion} is the latest version.`, {
      current_version: currentVersion,
    }),
  storageUnavailable: () =>
    new ApiError('storage_unavailable', 'Evidence storage is unreachable.'),
};

export const fieldMessages = {
  manifestShape: 'Each manifest needs apiVersion, kind and metadata.name.',
  duplicateResource: (ref: string) => `Duplicate resource ${ref}.`,
  version: 'Use 1 to 64 letters, digits, dots, plus or minus signs.',
  sourceCommit: 'Use the full 40-character commit.',
  parameters: 'Use upper-case keys and text values up to 1,000 characters.',
  replicas: 'Use whole numbers from 0 to 100.',
  replicaRefs: 'Only Deployments and StatefulSets in this bundle can take replica counts.',
  unknownBundleVersion: 'Unknown bundle version.',
  limit: 'Use a whole number from 1 to 100.',
  reason: 'Give a reason of 10 to 500 characters.',
  comment: 'Keep the comment to 500 characters.',
  days: 'Pick at least one day.',
  time: 'Use 24-hour time like 09:00.',
  endAfterStart: 'Closes must be after opens.',
  label: 'Use 1 to 80 characters.',
  from: 'Use an ISO 8601 instant with an offset.',
  count: 'Use a whole number from 1 to 20.',
  effectiveFromPast: 'Effective time cannot be in the past.',
  effectiveFromOrder: (version: number) => `Must be later than when version ${version} takes effect.`,
  freezeOrder: 'Ends must be after starts.',
  unknownStage: (name: string) => `Unknown stage ${name}.`,
  unknownResource: (ref: string) => `Unknown resource ${ref}.`,
  agentPhase: 'Use the phase applying or health_wait.',
  agentResources: 'Send 1 to 200 resources, each with a ref, sync and health.',
} as const;
