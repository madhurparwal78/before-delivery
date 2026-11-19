// The one error shape `{"error": "<code>"}` and the one way a provider failure becomes a 503.

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: { error: string } & Record<string, unknown>,
    readonly headers: Record<string, string> = {},
  ) {
    super(body.error);
  }
}

type Provider = "keycloak" | "killbill" | "svix" | "minio" | "mailpit";

/** Thrown by a provider client when the provider cannot be reached or answers 5xx. */
export class ProviderDown extends Error {
  constructor(readonly provider: Provider, detail: string) {
    super(`${provider} unavailable: ${detail}`);
  }
}

/** The published 503 code for each feature that depends on a provider. */
export type Outage =
  | "sign_in_unavailable"
  | "identity_unavailable"
  | "payments_unavailable"
  | "billing_unavailable"
  | "webhooks_unavailable"
  | "statements_unavailable"
  | "documents_unavailable";

export const notFound = (): HttpError => new HttpError(404, { error: "not_found" });
export const forbidden = (): HttpError => new HttpError(403, { error: "forbidden" });
export const conflict = (error: string, extra: Record<string, unknown> = {}): HttpError =>
  new HttpError(409, { error, ...extra });
export const invalid = (errors: Record<string, string>): HttpError =>
  new HttpError(422, { error: "validation", errors });
export const unavailable = (code: Outage): HttpError => new HttpError(503, { error: code });
