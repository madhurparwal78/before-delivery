import type { ApiErrorBody } from '../shared/api';

/** Every refusal the API can answer. Messages are defined here and nowhere else. */
const MESSAGES = {
  unauthenticated: 'Sign in to continue.',
  bad_credentials: 'Email or password is not right.',
  forbidden: 'Only the founder can change this.',
  not_found: 'Not found.',
  idempotency_conflict: 'This Idempotency-Key was already used for a different request.',
  unsolvable: 'No shape satisfies every constraint with this value. Nothing was changed.',
  invalid: 'Check the highlighted fields.',
  storage_unavailable: 'Storage is unreachable.',
  cross_origin: 'Requests from another site are refused.',
  unsupported_media_type: 'Send JSON with Content-Type application/json.',
  payload_too_large: 'Request body is larger than 1,000,000 bytes.',
  starting: 'The server is starting. Try again in a moment.',
  internal: 'Something went wrong on the server.',
} as const;

type ErrorExtras = Omit<ApiErrorBody['error'], 'code' | 'message' | 'fields'>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
    readonly extras: ErrorExtras = {},
  ) {
    super(message);
  }

  body(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, ...(this.fields ? { fields: this.fields } : {}), ...this.extras } };
  }
}

export const unauthenticated = () => new ApiError(401, 'unauthenticated', MESSAGES.unauthenticated);
export const badCredentials = () => new ApiError(401, 'bad_credentials', MESSAGES.bad_credentials);
export const forbidden = () => new ApiError(403, 'forbidden', MESSAGES.forbidden);
export const notFound = () => new ApiError(404, 'not_found', MESSAGES.not_found);
export const invalid = (fields: Record<string, string>) => new ApiError(422, 'invalid', MESSAGES.invalid, fields);
export const storageUnavailable = () => new ApiError(503, 'storage_unavailable', MESSAGES.storage_unavailable);
export const idempotencyConflict = () => new ApiError(409, 'idempotency_conflict', MESSAGES.idempotency_conflict);
export const unsolvable = () => new ApiError(409, 'unsolvable', MESSAGES.unsolvable);
export const crossOrigin = () => new ApiError(403, 'cross_origin', MESSAGES.cross_origin);
export const unsupportedMediaType = () => new ApiError(415, 'unsupported_media_type', MESSAGES.unsupported_media_type);
export const starting = () => new ApiError(503, 'starting', MESSAGES.starting);
export const internalError = () => new ApiError(500, 'internal', MESSAGES.internal);
export const payloadTooLarge = () => new ApiError(413, 'payload_too_large', MESSAGES.payload_too_large);

export const overConstrained = (refused: string, existing: { id: string; label: string }) =>
  new ApiError(409, 'over_constrained', `${refused} would conflict with ${existing.label}. Nothing was changed.`, undefined, {
    refused_label: refused,
    conflicts_with: existing,
  });

export const sketchDrivesFeature = (sketch: string, feature: string) =>
  new ApiError(409, 'sketch_drives_feature', `${sketch} drives ${feature} and must stay fully held. Nothing was changed.`);

export const profileNotReady = (sketch: string) =>
  new ApiError(409, 'profile_not_ready', `${sketch} needs a closed, fully held profile before it can be extruded.`);

export const emptyBody = (operation: string) =>
  new ApiError(409, 'empty_body', `${operation} leaves no material. Nothing was changed.`);

export const separateBodies = (operation: string) =>
  new ApiError(
    409,
    'separate_bodies',
    `${operation} would leave separate pieces; a part must be one connected body. Nothing was changed.`,
  );

export const assemblyCycle = (assembly: string) =>
  new ApiError(409, 'assembly_cycle', `${assembly} cannot contain itself.`);

export const noConfirmedBody = (part: string) =>
  new ApiError(409, 'no_confirmed_body', `${part} has no stored body yet, so it cannot be placed.`);

export const staleRevision = (memberName: string, thing: string, revision: number, savedBy: { id: string; name: string }) =>
  new ApiError(
    412,
    'stale_revision',
    `${memberName} saved ${thing} at revision ${revision} after you opened it. Reload to see their changes.`,
    undefined,
    { current_revision: revision, saved_by: savedBy },
  );
