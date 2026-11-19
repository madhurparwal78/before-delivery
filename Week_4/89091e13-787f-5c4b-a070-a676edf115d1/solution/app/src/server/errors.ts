/** An answer that is not a success, in one of the published shapes. */
export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 413 | 415 | 422 | 503,
    readonly body: { error: string } | { errors: Record<string, string> },
  ) {
    super(JSON.stringify(body));
  }
}

export const notFound = () => new HttpError(404, { error: "Not found" });
export const unauthorized = () => new HttpError(401, { error: "Sign in to continue." });
export const forbidden = (copy: string) => new HttpError(403, { error: copy });
export const conflict = (copy: string) => new HttpError(409, { error: copy });
export const unavailable = (copy: string) => new HttpError(503, { error: copy });
export const invalid = (field: string, message: string) => new HttpError(422, { errors: { [field]: message } });

/** A first failing rule. A null field is a state conflict (409); a field is a validation failure (422). */
export interface Refusal {
  field: string | null;
  message: string;
}

export const refusalToError = (refusal: Refusal) => (refusal.field === null ? conflict(refusal.message) : invalid(refusal.field, refusal.message));
