import { COPY } from "../shared/copy.js";

export type FieldErrors = Record<string, string>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: FieldErrors | null;
  readonly extra: Record<string, unknown> | null;

  constructor(
    status: number,
    code: string,
    message: string,
    fields: FieldErrors | null = null,
    extra: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.extra = extra;
  }

  body(): Record<string, unknown> {
    const body: Record<string, unknown> = { error: this.code, message: this.message };
    if (this.fields) body.fields = this.fields;
    if (this.extra) Object.assign(body, this.extra);
    return body;
  }
}

/** Re-tells a provider outage in the copy published for this situation. */
export async function withOutageCopy<T>(
  messages: { billing?: string; storage?: string },
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.code === "billing_unavailable" && messages.billing) {
        throw new ApiError(503, "billing_unavailable", messages.billing);
      }
      if (error.code === "storage_unavailable" && messages.storage) {
        throw new ApiError(503, "storage_unavailable", messages.storage);
      }
    }
    throw error;
  }
}

export const errors = {
  payloadTooLarge: () => new ApiError(413, "payload_too_large", "That request body is too large."),
  fileTooLarge: () => new ApiError(413, "file_too_large", "That file is larger than 10 MB."),
  unsupportedMediaType: () =>
    new ApiError(415, "unsupported_media_type", "That content type is not supported on this route."),
  unsupportedFileType: (fileName: string) =>
    new ApiError(415, "unsupported_file_type", `${fileName} is not an accepted file type.`),
  crossOrigin: () => new ApiError(403, "cross_origin", "Cross-origin writes are refused."),
  unauthenticated: () => new ApiError(401, "unauthenticated", "Sign in to continue."),
  invalidCredentials: () => new ApiError(401, "invalid_credentials", COPY.signInFailed),
  forbidden: () => new ApiError(403, "forbidden", "Your role cannot do that."),
  accessEnded: () => new ApiError(403, "access_ended", COPY.accessEndedHeading),
  notFound: () => new ApiError(404, "not_found", COPY.notFoundHeading),
  invalidTransition: (state: string) =>
    new ApiError(409, "invalid_transition", `That is not allowed while the order is ${state}.`),
  invalidPlanTransition: (status: string) =>
    new ApiError(409, "invalid_transition", `That is not allowed while the plan is ${status}.`),
  invalidEntryTransition: (status: string) =>
    new ApiError(409, "invalid_transition", `That entry is ${status}.`),
  validation: (fields: FieldErrors) =>
    new ApiError(422, "validation_failed", "Some details need fixing.", fields),
  idempotencyMismatch: () =>
    new ApiError(409, "idempotency_mismatch", "That idempotency key was used with a different request."),
  missingIdempotencyKey: () =>
    new ApiError(422, "validation_failed", "Some details need fixing.", {
      "Idempotency-Key": "An Idempotency-Key header is required.",
    }),
  cardDeclined: () => new ApiError(402, "card_declined", COPY.cardDeclined),
  billingUnavailable: () => new ApiError(503, "billing_unavailable", COPY.billingOutage),
  storageUnavailable: () => new ApiError(503, "storage_unavailable", COPY.storageOutageUpload),
  cmsUnavailable: () => new ApiError(503, "cms_unavailable", COPY.cmsOutage),
  databaseUnavailable: () =>
    new ApiError(503, "database_unavailable", "The ledger database is unreachable right now."),
  projectClosed: () => new ApiError(409, "project_closed", "That project is closed."),
  paymentNotCaptured: () => new ApiError(409, "payment_not_captured", "That payment is not captured yet."),
  noBillingAccount: () => new ApiError(409, "no_billing_account", "That account has no billing account yet."),
  planExists: () => new ApiError(409, "plan_exists", "That account already has a care plan."),
  previewExpired: () => new ApiError(409, "preview_expired", COPY.previewExpired),
  inviteUsed: () => new ApiError(409, "invite_used", "That invite was already used."),
  inviteExpired: () => new ApiError(410, "invite_expired", "That invite expired."),
  linkExpired: () => new ApiError(410, "link_expired", COPY.linkExpired),
  pdfPending: () => new ApiError(409, "pdf_pending", "That invoice PDF is not stored yet."),
};
