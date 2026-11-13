export type ErrorExtras = Record<string, unknown>;

/** The single error shape for every failed request. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extras: ErrorExtras;

  constructor(status: number, code: string, extras: ErrorExtras = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extras = extras;
  }

  body(): ErrorExtras {
    return { error: this.code, ...this.extras };
  }
}

export const crossOrigin = () => new ApiError(403, 'cross_origin');
export const payloadTooLarge = () => new ApiError(413, 'payload_too_large');
export const databaseUnavailable = () => new ApiError(503, 'database_unavailable');
export const notSignedIn = () => new ApiError(401, 'not_signed_in');
export const invalidCredentials = () => new ApiError(401, 'invalid_credentials');
export const emailTaken = () => new ApiError(409, 'email_taken');
export const notFound = () => new ApiError(404, 'not_found');
export const validationFailed = (fields: Record<string, string>) =>
  new ApiError(422, 'validation_failed', { fields });
export const versionConflict = (currentVersion: number) =>
  new ApiError(412, 'version_conflict', { currentVersion });
export const deckFull = () => new ApiError(409, 'deck_full');
export const emptyFile = () => new ApiError(422, 'empty_file');
export const imageTooLarge = () => new ApiError(413, 'image_too_large');
export const unsupportedType = () => new ApiError(415, 'unsupported_type');
export const imageStoreUnavailable = () => new ApiError(503, 'image_store_unavailable');
export const roomNotFound = () => new ApiError(404, 'room_not_found');
export const roomClosed = () => new ApiError(409, 'room_closed');
export const roomFull = () => new ApiError(409, 'room_full');
export const nicknameTaken = () => new ApiError(409, 'nickname_taken');
export const invalidRejoinToken = () => new ApiError(401, 'invalid_rejoin_token');
export const roomEnded = () => new ApiError(410, 'room_ended');
export const invalidClient = () => new ApiError(401, 'invalid_client');
export const clientSuperseded = () => new ApiError(409, 'client_superseded');
export const illegalTransition = (state: string, command: string) =>
  new ApiError(409, 'illegal_transition', { state, command });
export const noMoreQuestions = () => new ApiError(409, 'no_more_questions');
export const windowClosed = (remainingMs: number) =>
  new ApiError(409, 'window_closed', { remainingMs });
export const questionNotOpen = (state: string) =>
  new ApiError(409, 'question_not_open', { state });
export const alreadyAnswered = () => new ApiError(409, 'already_answered');
export const liveUnavailable = () => new ApiError(503, 'live_unavailable');
