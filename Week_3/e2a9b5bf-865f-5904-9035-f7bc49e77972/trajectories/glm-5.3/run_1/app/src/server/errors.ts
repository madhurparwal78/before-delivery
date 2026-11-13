// One error shape for every API error, and the error precedence.
import type { NextFunction, Request, Response } from "express";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly fields?: Record<string, string>,
    readonly extra?: Record<string, unknown>,
    readonly headers?: Record<string, string>,
  ) {
    super(code);
  }

  body(): Record<string, unknown> {
    const body: Record<string, unknown> = { error: this.code };
    if (this.fields) body["fields"] = this.fields;
    if (this.extra) Object.assign(body, this.extra);
    return body;
  }
}

export const errors = {
  tooLarge: () => new ApiError(413, "too_large"),
  unsupportedMediaType: () => new ApiError(415, "unsupported_media_type"),
  crossOrigin: () => new ApiError(403, "cross_origin"),
  tooManyAttempts: (retryAfter: number) =>
    new ApiError(429, "too_many_attempts", undefined, undefined, { "Retry-After": String(retryAfter) }),
  unauthenticated: () => new ApiError(401, "unauthenticated"),
  badCredentials: () => new ApiError(401, "bad_credentials"),
  notFound: () => new ApiError(404, "not_found"),
  internal: () => new ApiError(500, "internal"),
  emailTaken: () => new ApiError(409, "email_taken"),
  validation: (fields: Record<string, string>) => new ApiError(422, "validation", fields),
  invalidTransition: (state: string) => new ApiError(409, "invalid_transition", undefined, { state }),
  staleRevision: (packet: unknown) => new ApiError(412, "stale_revision", undefined, { packet }),
  incomplete: (reasons: readonly unknown[]) => new ApiError(422, "incomplete", undefined, { reasons }),
  noPdf: () => new ApiError(409, "no_pdf"),
  storageUnavailable: () => new ApiError(503, "storage_unavailable"),
  mailUnavailable: () => new ApiError(503, "mail_unavailable"),
  mailRejected: () => new ApiError(502, "mail_rejected"),
  opConflict: () => new ApiError(409, "op_conflict"),
  idConflict: () => new ApiError(409, "id_conflict"),
  observationDeleted: () => new ApiError(409, "observation_deleted"),
  citedBySentPacket: (observation: unknown) => new ApiError(409, "cited_by_sent_packet", undefined, { observation }),
  onlyRowOfPacket: (observation: unknown) => new ApiError(409, "only_row_of_packet", undefined, { observation }),
  editedSince: (observation: unknown) => new ApiError(409, "edited_since", undefined, { observation }),
};

export function sendError(res: Response, error: ApiError): void {
  if (error.headers) {
    for (const [key, value] of Object.entries(error.headers)) {
      res.setHeader(key, value);
    }
  }
  res.status(error.status).json(error.body());
}

export function apiErrorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) return;
  if (!(err instanceof ApiError)) console.error("internal", err);
  if (err instanceof ApiError) {
    sendError(res, err);
    return;
  }
  sendError(res, errors.internal());
}
