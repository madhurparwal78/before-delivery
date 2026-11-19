import type { Locale } from '../shared/format';

/** One consistent error shape: 401, 404, 403, 409 and 422 as the brief orders them. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(JSON.stringify(body));
  }
}

export const unauthenticated = (): HttpError => new HttpError(401, { error: 'unauthenticated' });
export const notFound = (): HttpError => new HttpError(404, { error: 'not_found' });
export const forbidden = (message: string): HttpError => new HttpError(403, { error: 'forbidden', message });
export const conflict = (error: string, extra: Record<string, unknown> = {}): HttpError => new HttpError(409, { error, ...extra });
export const invalid = (errors: Record<string, string>): HttpError => new HttpError(422, { errors });
export const storageUnavailable = (): HttpError => new HttpError(503, { error: 'storage_unavailable' });

export const REVIEWER_DRAW = "Reviewers can't draw";
export const REVIEWER_ARTWORK = "Reviewers can't change artwork";
export const REVIEWER_EXPORT = "Reviewers can't export";
export const OWNER_ONLY = 'Only the project owner can do this';

export type { Locale };
