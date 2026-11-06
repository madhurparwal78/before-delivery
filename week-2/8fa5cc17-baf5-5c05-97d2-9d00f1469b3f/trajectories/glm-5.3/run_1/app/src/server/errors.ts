// The single home of every error response and status-only body.

export interface ApiError {
  error: string;
}

export function errorBody(code: string): ApiError {
  return { error: code };
}

export interface ValidationErrors {
  error: "validation";
  errors: Record<string, string>;
}

export function validationBody(errors: Record<string, string>): ValidationErrors {
  if (Object.keys(errors).length === 0) return { error: "validation", errors: { "": "" } };
  return { error: "validation", errors };
}

export type StatusBody =
  | { status: "starting" }
  | { status: "unknown" }
  | { status: "expired" }
  | { status: "revoked" }
  | { error: "not_in_share" };

export function statusBody(status: "starting" | "unknown" | "expired" | "revoked"): StatusBody {
  return { status };
}
