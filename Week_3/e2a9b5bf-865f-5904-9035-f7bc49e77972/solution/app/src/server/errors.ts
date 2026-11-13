import { FIELD_MESSAGES, type FieldMessageKey } from "../shared/messages";

/** Every API error leaves through this one shape: `{"error": "<code>", ...extra}`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
    readonly headers: Record<string, string> = {},
  ) {
    super(String(body.error));
  }
}

export const notFound = () => new ApiError(404, { error: "not_found" });
export const unauthenticated = () => new ApiError(401, { error: "unauthenticated" });
export const invalidTransition = (state: string) => new ApiError(409, { error: "invalid_transition", state });
export const conflict = (code: string, extra: Record<string, unknown> = {}) => new ApiError(409, { error: code, ...extra });

/** Raised when object storage can't be reached or refuses a request. */
export class StorageUnavailable extends Error {}
export class MailUnavailable extends Error {}
export class MailRejected extends Error {}
export class RendererUnavailable extends Error {}

/** Collects field errors; messages always come from the one table. */
export class Fields {
  private readonly found: Record<string, string> = {};

  /** `field` is the response key; `message` the table entry (defaults to the same name). */
  add(field: string, message: FieldMessageKey = field as FieldMessageKey): this {
    this.found[field] = FIELD_MESSAGES[message];
    return this;
  }

  get any(): boolean {
    return Object.keys(this.found).length > 0;
  }

  toError(): ApiError {
    return new ApiError(422, { error: "validation", fields: { ...this.found } });
  }

  check(): void {
    if (this.any) throw this.toError();
  }
}
