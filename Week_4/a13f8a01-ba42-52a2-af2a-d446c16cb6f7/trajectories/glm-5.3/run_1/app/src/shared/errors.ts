export type ErrorCode =
  | "body_too_large"
  | "not_signed_in"
  | "bad_credentials"
  | "not_found"
  | "forbidden"
  | "unverified"
  | "version_conflict"
  | "idempotency_conflict"
  | "duplicate"
  | "already_verified"
  | "nothing_to_fork"
  | "nothing_to_export"
  | "validation"
  | "token_invalid"
  | "token_expired"
  | "storage_unavailable"
  | "mail_unavailable";

export interface ErrorBody {
  error: ErrorCode;
  message: string;
  fields?: Record<string, string>;
  head?: number;
}

export function errorBody(code: ErrorCode, message: string): ErrorBody {
  return { error: code, message };
}

export function notFoundBody(): ErrorBody {
  return { error: "not_found", message: "Nothing here." };
}

export function validationBody(fields: Record<string, string>): ErrorBody {
  return { error: "validation", message: "Some fields need attention.", fields };
}

export function conflictBody(head: number): ErrorBody {
  return { error: "version_conflict", message: "Version conflict.", head };
}
