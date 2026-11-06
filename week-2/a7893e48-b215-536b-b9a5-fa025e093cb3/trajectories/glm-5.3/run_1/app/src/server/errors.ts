export type ErrCode =
  | "invalid_json" | "unauthenticated" | "not_found" | "forbidden" | "invalid_credentials"
  | "idempotency_key_required" | "idempotency_key_reused" | "request_in_progress"
  | "invalid_transition" | "billing_unavailable" | "cross_origin" | "body_too_large"
  | "unsupported_media_type" | "validation" | "slot_taken" | "hold_expired"
  | "certificate_required" | "pay_now_required" | "pack_insufficient"
  | "outside_check_in_window" | "cleaning_fee_already_charged" | "policy_date_taken"
  | "email_taken" | "file_too_large" | "unsupported_file_type" | "link_not_found"
  | "read_only" | "internal";

export class ApiError extends Error {
  status: number;
  code: ErrCode;
  extra: Record<string, unknown>;
  constructor(status: number, code: ErrCode, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const notFound = () => new ApiError(404, "not_found", "Not found.");
export { notFound };

export const unauthenticated = () => new ApiError(401, "unauthenticated", "Sign in first.");
export const forbidden = () => new ApiError(403, "forbidden", "You may not do that.");
export const invalidJson = () => new ApiError(400, "invalid_json", "The request body is not valid JSON.");
export const validation = (fields: Record<string, string>) =>
  new ApiError(422, "validation", "Some fields need attention.", { fields });
export const billingUnavailable = () =>
  new ApiError(503, "billing_unavailable", "Billing is unreachable right now.");
export const transition = (from: string, action: string) =>
  new ApiError(409, "invalid_transition", `Cannot ${action} a booking that is ${from}.`, { from, action });
export const holdTransition = (from: string, action: string) =>
  new ApiError(409, "invalid_transition", `Cannot ${action} a hold that is ${from}.`, { from, action });
export const holdExpired = () => new ApiError(410, "hold_expired", "Your hold ran out before payment. Nothing was charged.");
