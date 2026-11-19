import { F, Ftpl } from '../../shared/feedback.ts';
import { limits } from '../config.ts';
import type { ApiErrorBody } from '../../shared/types.ts';

/**
 * Every failure leaves the server as one `ApiError`, which renders the single
 * published error shape. Copy always comes from the feedback registry.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;
  readonly retryAfterSeconds?: number;
  readonly allow?: readonly string[];

  constructor(init: {
    status: number;
    code: string;
    message: string;
    fields?: Record<string, string>;
    retryAfterSeconds?: number;
    allow?: readonly string[];
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    if (init.fields) this.fields = init.fields;
    if (init.retryAfterSeconds !== undefined) this.retryAfterSeconds = init.retryAfterSeconds;
    if (init.allow) this.allow = init.allow;
  }

  body(): ApiErrorBody {
    const body: ApiErrorBody = { error: this.code, message: this.message };
    if (this.fields) body.fields = this.fields;
    if (this.retryAfterSeconds !== undefined) body.retry_after_seconds = this.retryAfterSeconds;
    return body;
  }
}

/* -- transport ---------------------------------------------------------- */

export const badRequest = (): ApiError =>
  new ApiError({ status: 400, code: 'bad_request', message: F.BAD_BODY });

export const unsupportedMediaType = (): ApiError =>
  new ApiError({ status: 415, code: 'unsupported_media_type', message: F.BAD_BODY });

export const methodNotAllowed = (allow: readonly string[]): ApiError =>
  new ApiError({ status: 405, code: 'method_not_allowed', message: F.BAD_BODY, allow });

export const requestTooLarge = (): ApiError =>
  new ApiError({ status: 413, code: 'too_large', message: F.TOO_LARGE });

/* -- precedence steps 1 to 6 -------------------------------------------- */

export const authenticationRequired = (): ApiError =>
  new ApiError({ status: 401, code: 'authentication_required', message: F.SESSION });

export const notFound = (): ApiError =>
  new ApiError({ status: 404, code: 'not_found', message: F.HIDDEN });

export const forbidden = (): ApiError =>
  new ApiError({ status: 403, code: 'forbidden', message: F.FORBIDDEN });

export const stepUpRequired = (): ApiError =>
  new ApiError({ status: 403, code: 'step_up_required', message: F.MFA_REQUIRED });

export const commandReused = (): ApiError =>
  new ApiError({ status: 409, code: 'conflict', message: F.COMMAND_REUSED });

/** Any state conflict. The caller picks the copy in the published 409 order. */
export const conflict = (message: string): ApiError =>
  new ApiError({ status: 409, code: 'conflict', message });

export const stale = (): ApiError => conflict(F.CONFLICT);

export const invalid = (fields: Record<string, string>): ApiError =>
  new ApiError({ status: 422, code: 'invalid', message: F.INVALID, fields });

/**
 * Step 6 answers 413 instead of 422 when an uploaded photograph is over
 * FLAN_UPLOAD_MAX_BYTES. Every other invalid field is listed alongside it.
 */
export const uploadTooLarge = (fields: Record<string, string>): ApiError =>
  new ApiError({ status: 413, code: 'too_large', message: F.TOO_LARGE, fields });

/* -- provider errors ---------------------------------------------------- */

export const serviceUnavailable = (): ApiError =>
  new ApiError({ status: 503, code: 'service_unavailable', message: F.SERVICE });

export const catalogUnavailable = (): ApiError =>
  new ApiError({ status: 503, code: 'catalog_unavailable', message: F.CATALOG_WAIT });

export const catalogBusy = (retryAfterSeconds: number): ApiError =>
  new ApiError({
    status: 429,
    code: 'catalog_busy',
    message: F.CATALOG_RATE,
    retryAfterSeconds,
  });

export const catalogMalformed = (): ApiError =>
  new ApiError({ status: 502, code: 'catalog_malformed', message: F.CATALOG_BAD });

export const catalogMissing = (): ApiError =>
  new ApiError({ status: 502, code: 'catalog_missing', message: F.CATALOG_MISSING });

/* -- shared field copy -------------------------------------------------- */

export const fieldCopy = {
  referenceFormat: F.REFERENCE_FORMAT,
  photoType: F.PHOTO_TYPE,
  photoSvg: F.PHOTO_SVG,
  photoMissing: F.PHOTO_MISSING,
  photoBytes: Ftpl.photoBytes(limits.uploadMaxBytes),
  photoEdge: Ftpl.photoEdge(limits.photoMinEdgePx, limits.photoMaxEdgePx),
  photoPixels: Ftpl.photoPixels(limits.photoMaxPixels),
  textLong: Ftpl.textLong(limits.noteMaxChars),
  correctionLong: Ftpl.textLong(limits.correctionMaxChars),
  coord: F.COORD,
  order: F.ORDER,
  basketFull: Ftpl.basketFull(limits.offerMaxItems),
  basketEmpty: F.BASKET_EMPTY,
  arrivalMissing: F.ARRIVAL_MISSING,
  cellEmpty: F.CELL_EMPTY,
  pageLimit: Ftpl.pageLimit(limits.pageMax),
  syncLimit: Ftpl.syncLimit(limits.syncBatchMax),
  traySize: F.TRAY_SIZE,
  setMismatch: F.SET_MISMATCH,
} as const;
