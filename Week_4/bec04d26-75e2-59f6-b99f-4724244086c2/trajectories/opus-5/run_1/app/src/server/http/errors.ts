import { ReturnStatus } from '../../shared/types';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`http ${status}`);
  }
}

/** Boundary checks, ahead of the error order. */
export const tooLarge = (): HttpError => new HttpError(413, { error: 'too_large' });
export const unsupportedMediaType = (): HttpError =>
  new HttpError(415, { error: 'unsupported_media_type' });
export const badJson = (): HttpError => new HttpError(400, { error: 'bad_json' });
export const crossOrigin = (): HttpError => new HttpError(403, { error: 'cross_origin' });

/** 1: anything the caller cannot open. */
export const notFound = (): HttpError => new HttpError(404, { error: 'not_found' });

/** 2: a route that needs a session, naming no record. */
export const signInRequired = (): HttpError => new HttpError(401, { error: 'sign_in_required' });

/** 3: a write the caller's role may not make. */
export const forbidden = (): HttpError => new HttpError(403, { error: 'forbidden' });

/** 4: state conflicts, in order. */
export const staleVersion = (
  version: number,
  status: ReturnStatus,
  changedBy: string,
): HttpError =>
  new HttpError(409, {
    error: 'conflict',
    return: { version, status },
    changed_by: changedBy,
  });

export const illegalStatus = (status: ReturnStatus): HttpError =>
  new HttpError(409, { error: 'illegal_status', status });

export const deadlinePassed = (): HttpError => new HttpError(409, { error: 'deadline_passed' });

export const packetPending = (): HttpError => new HttpError(409, { error: 'packet_pending' });

/** 5: validation. */
export const validation = (errors: Record<string, string>): HttpError =>
  new HttpError(422, { errors });
