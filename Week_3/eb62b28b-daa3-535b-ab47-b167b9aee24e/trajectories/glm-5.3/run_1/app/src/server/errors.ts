import type { Request, Response, NextFunction } from "express";

export type ApiErrorCode =
  | "not_found"
  | "method_not_allowed"
  | "too_large"
  | "rate_limited"
  | "not_signed_in"
  | "session_ended"
  | "forbidden"
  | "unsupported_media_type"
  | "bad_request"
  | "request_key_reused"
  | "invalid"
  | "stale"
  | "payments_unavailable"
  | "report_store_unavailable"
  | "attachment_store_unavailable"
  | "plus_required"
  | "slot_taken"
  | "changes_closed"
  | "not_booked"
  | "already_plus"
  | "not_plus"
  | "already_ending"
  | "same_cadence"
  | "email_taken"
  | "account_closing"
  | "not_closing"
  | "erasure_started"
  | "owner_stays"
  | "visit_page_ended"
  | "report_exists"
  | "not_collected"
  | "not_ready"
  | "kit_code_required"
  | "not_draw_day"
  | "already_collected"
  | "packet_full"
  | "ranges_already_change"
  | "not_upcoming"
  | "internal_error"
  | "sign_in_failed"
  | "address_required"
  | "already_published"
  | "forbidden";

export class ApiError extends Error {
  status: number;
  code: ApiErrorCode;
  fields?: Record<string, string> | undefined;
  retryAfterSeconds?: number | undefined;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    fields?: Record<string, string>,
    retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** The one place every error response shape is built. */
export function errorBody(error: ApiError): { error: { code: string; message: string; fields?: Record<string, string> } } {
  const body: { error: { code: string; message: string; fields?: Record<string, string> } } = {
    error: {
      code: error.code,
      message: error.message,
    },
  };
  if (error.fields && Object.keys(error.fields).length > 0) {
    body.error.fields = error.fields;
  }
  return body;
}

export function sendError(res: Response, error: unknown): void {
  if (error instanceof ApiError) {
    if (error.retryAfterSeconds !== undefined) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil(error.retryAfterSeconds))));
    }
    res.status(error.status).json(errorBody(error));
    return;
  }
  res.status(500).json(errorBody(new ApiError(500, "internal_error", "Something went wrong.")));
}

export function wrapAsync(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}
