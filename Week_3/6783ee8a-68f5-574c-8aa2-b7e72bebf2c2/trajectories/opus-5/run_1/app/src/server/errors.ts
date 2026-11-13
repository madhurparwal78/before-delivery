import type { FieldError } from '../shared/types.js';
import { withThousands } from '../shared/outputs.js';

export interface ErrorBody {
  error: string;
  message: string;
  errors?: FieldError[];
  [key: string]: unknown;
}

/** Every error answer in the API carries this one shape. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: ErrorBody;

  constructor(status: number, body: ErrorBody) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
}

export const unauthenticated = (): ApiError =>
  new ApiError(401, { error: 'unauthenticated', message: 'Sign in to continue.' });

export const notFound = (): ApiError =>
  new ApiError(404, { error: 'not_found', message: 'Notebook not found.' });

export const forbidden = (): ApiError =>
  new ApiError(403, { error: 'forbidden', message: 'Your role does not allow this.' });

export const crossOrigin = (): ApiError =>
  new ApiError(403, { error: 'cross_origin', message: 'Cross-origin requests are refused.' });

export const requestTooLarge = (limit: number): ApiError =>
  new ApiError(413, {
    error: 'too_large',
    message: `Request body is larger than ${withThousands(limit)} bytes`,
  });

export const fileTooLarge = (limit: number): ApiError =>
  new ApiError(413, { error: 'too_large', message: `File is larger than ${withThousands(limit)} bytes` });

export const conflict = (code: string, extra: Record<string, unknown> = {}): ApiError =>
  new ApiError(409, { error: code, message: CONFLICT_MESSAGES[code] ?? 'This conflicts with the current state.', ...extra });

const CONFLICT_MESSAGES: Record<string, string> = {
  stale_revision: 'A cell changed after you started editing.',
  cell_locked: 'That cell is being edited in another tab.',
  not_deleted: 'Those cells were not deleted.',
  illegal_transition: 'That run state change is not allowed.',
  run_id_reused: 'That run id was already used.',
  result_conflict: 'A different result is already stored for this run.',
  output_replaced: 'That output was replaced by a newer run.',
  already_shared: 'That person already has access.',
  invitation_for_another_account: 'This invitation is for another account.',
};

export const validationFailed = (errors: FieldError[]): ApiError =>
  new ApiError(422, {
    error: 'validation_failed',
    message: 'Some fields are not valid.',
    errors,
  });

export const storageUnavailable = (): ApiError =>
  new ApiError(503, { error: 'storage_unavailable', message: 'Storage is unavailable. Try again shortly.' });

export const searchUnavailable = (): ApiError =>
  new ApiError(503, { error: 'search_unavailable', message: 'Search is unavailable. Try again shortly.' });

export const mailUnavailable = (): ApiError =>
  new ApiError(503, { error: 'mail_unavailable', message: 'Email is unavailable. Try again shortly.' });

export const invalidCredentials = (): ApiError =>
  new ApiError(401, { error: 'invalid_credentials', message: 'Email or password is wrong.' });

export const emailNotVerified = (): ApiError =>
  new ApiError(403, { error: 'email_not_verified', message: 'Verify your email first. We sent you a link.' });

export const invitationForAnotherAccount = (): ApiError =>
  new ApiError(403, {
    error: 'invitation_for_another_account',
    message: 'This invitation is for another account.',
  });

export const noOriginal = (): ApiError =>
  new ApiError(404, { error: 'no_original', message: 'This notebook was not imported.' });
