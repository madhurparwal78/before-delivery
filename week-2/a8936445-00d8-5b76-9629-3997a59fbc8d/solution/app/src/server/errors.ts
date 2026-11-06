// The single API error shape (brief: API, Error body).

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }

  body(): { error: { code: string; message: string; details: Record<string, unknown> } } {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

export const notFound = (): ApiError => new ApiError(404, "not_found", "That record isn't available.");
export const forbidden = (): ApiError => new ApiError(403, "forbidden", "You can't do that with this account.");
export const tenantNotActive = (): ApiError => new ApiError(409, "tenant_not_active", "The business is not active.");
export const invalidTransition = (): ApiError =>
  new ApiError(409, "invalid_transition", "That can't be done in this record's current state.");

export function validation(details: Record<string, string>): ApiError {
  return new ApiError(422, "validation_failed", "Check the highlighted fields.", details);
}

/** Collects field sentences and throws one 422 when any field failed. */
export class FieldErrors {
  private readonly fields: Record<string, string> = {};

  add(field: string, sentence: string): void {
    this.fields[field] ??= sentence;
  }

  has(field: string): boolean {
    return field in this.fields;
  }

  throwIfAny(): void {
    if (Object.keys(this.fields).length > 0) throw validation(this.fields);
  }
}

export type Provider = "billing" | "storage" | "mail";

const OUTAGE_MESSAGES: Record<Provider, string> = {
  billing: "Billing is unreachable. Nothing was changed; try again in a moment.",
  storage: "Document storage is unreachable. Nothing was changed; try again in a moment.",
  mail: "Email is unreachable. Nothing was changed; try again in a moment.",
};

/** A provider was unreachable, refused the call or did not answer (brief: Services). */
export class ProviderError extends Error {
  constructor(
    readonly provider: Provider,
    detail: string,
  ) {
    super(`${provider}: ${detail}`);
  }

  toApiError(): ApiError {
    return new ApiError(503, `${this.provider}_unavailable`, OUTAGE_MESSAGES[this.provider]);
  }
}
