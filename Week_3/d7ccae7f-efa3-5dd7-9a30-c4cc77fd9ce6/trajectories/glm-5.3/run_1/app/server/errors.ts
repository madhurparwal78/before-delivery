import type { NextFunction, Request, Response } from 'express';

export type FieldErrors = Record<string, string>;

export class HttpError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;

  constructor(status: number, code: string, extra: Record<string, unknown> = {}) {
    super(code);
    this.status = status;
    this.body = { error: code, ...extra };
  }
}

export function sendError(res: Response, err: unknown): void {
  if (err instanceof HttpError) {
    res.status(err.status).json(err.body);
    return;
  }
  console.error('unexpected error', err);
  res.status(500).json({ error: 'internal_error' });
}

export const errors = {
  crossOrigin: () => new HttpError(403, 'cross_origin'),
  payloadTooLarge: () => new HttpError(413, 'payload_too_large'),
  notSignedIn: () => new HttpError(401, 'not_signed_in'),
  invalidCredentials: () => new HttpError(401, 'invalid_credentials'),
  notFound: () => new HttpError(404, 'not_found'),
  emailTaken: () => new HttpError(409, 'email_taken'),
  versionConflict: (currentVersion: number) =>
    new HttpError(412, 'version_conflict', { currentVersion }),
  deckFull: () => new HttpError(409, 'deck_full'),
  validationFailed: (fields: FieldErrors) =>
    new HttpError(422, 'validation_failed', { fields }),
  emptyFile: () => new HttpError(422, 'empty_file'),
  imageTooLarge: () => new HttpError(413, 'image_too_large'),
  unsupportedType: () => new HttpError(415, 'unsupported_type'),
  imageStoreUnavailable: () => new HttpError(503, 'image_store_unavailable'),
  roomNotFound: () => new HttpError(404, 'room_not_found'),
  roomClosed: () => new HttpError(409, 'room_closed'),
  roomFull: () => new HttpError(409, 'room_full'),
  nicknameTaken: () => new HttpError(409, 'nickname_taken'),
  roomEnded: () => new HttpError(410, 'room_ended'),
  invalidRejoinToken: () => new HttpError(401, 'invalid_rejoin_token'),
  invalidClient: () => new HttpError(401, 'invalid_client'),
  clientSuperseded: () => new HttpError(409, 'client_superseded'),
  illegalTransition: (state: string, command: string) =>
    new HttpError(409, 'illegal_transition', { state, command }),
  noMoreQuestions: () => new HttpError(409, 'no_more_questions'),
  windowClosed: (remainingMs: number) =>
    new HttpError(409, 'window_closed', { remainingMs }),
  questionNotOpen: (state: string) =>
    new HttpError(409, 'question_not_open', { state }),
  alreadyAnswered: () => new HttpError(409, 'already_answered'),
  liveUnavailable: () => new HttpError(503, 'live_unavailable'),
  databaseUnavailable: () => new HttpError(503, 'database_unavailable'),
} as const;

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
