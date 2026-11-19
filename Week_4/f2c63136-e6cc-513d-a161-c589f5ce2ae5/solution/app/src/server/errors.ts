// One error shape for the whole API (brief: API, one error order for every route).

export class HttpError extends Error {
  constructor(readonly status: number, readonly body: Record<string, unknown>) {
    super(typeof body.error === 'string' ? body.error : JSON.stringify(body));
  }
}

export const notFound = () => new HttpError(404, { error: 'Not found' });
export const unauthenticated = () => new HttpError(401, { error: 'Authentication required' });
export const forbidden = (message: string) => new HttpError(403, { error: message });
export const conflict = (message: string) => new HttpError(409, { error: message });
export const invalid = (errors: Record<string, string>) => new HttpError(422, { errors });

const OUTAGE_PUSH = 'Storage is unavailable. Nothing was saved. Try again in a moment.';
export const OUTAGE_EXPORT = 'Storage is unavailable. The archive was not exported. Try again in a moment.';

/** Storage is needed and down; `copy` is the sentence the caller shows. */
export class StorageDown extends Error {
  constructor(readonly copy: string = OUTAGE_PUSH) {
    super(copy);
  }
}
