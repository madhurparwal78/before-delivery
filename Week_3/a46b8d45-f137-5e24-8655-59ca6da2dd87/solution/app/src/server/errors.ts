import { OPS_REFUSALS, OWNER_REFUSALS, PART_NOT_FOUND_MESSAGE, FIELDS_MESSAGE, fill, stateName, type OpsRefusalCode, type OwnerRefusalCode } from "../shared/copy";
import type { ApiErrorBody, ClaimState } from "../shared/types";

/** Every API error code with its HTTP status: the one table that maps a refusal to a status. */
const STATUS = {
  rate_limited: 429,
  read_only: 405,
  method_not_allowed: 405,
  request_too_large: 413,
  payload_too_large: 413,
  file_too_large: 413,
  unsupported_media_type: 415,
  cross_origin: 403,
  unauthenticated: 401,
  bad_credentials: 401,
  not_found: 404,
  claim_unknown: 404,
  link_unknown: 404,
  share_unknown: 404,
  link_lapsed: 410,
  claim_closed: 410,
  link_withdrawn: 410,
  reference_locked: 423,
  wrong_state: 409,
  already_paid: 409,
  not_paid: 409,
  part_withdrawn: 409,
  link_used: 409,
  idempotency_conflict: 409,
  edition_date_taken: 409,
  edition_code_taken: 409,
  validation_failed: 422,
  carrier_malformed: 502,
  database_unavailable: 503,
  storage_unavailable: 503,
  mail_unavailable: 503,
  billing_unavailable: 503,
  carrier_unavailable: 503,
  carrier_timeout: 504,
  internal_error: 500,
} as const;

type ErrorCode = keyof typeof STATUS;

interface ErrorDetail {
  fields?: Record<string, string>;
  state?: ClaimState;
  number?: number;
  message?: string;
  retryAfter?: number;
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly detail: ErrorDetail;

  constructor(code: ErrorCode, detail: ErrorDetail = {}) {
    super(code);
    this.code = code;
    this.detail = detail;
  }

  get status(): number {
    return STATUS[this.code];
  }
}

export const fail = (errorCode: ErrorCode, detail: ErrorDetail = {}): never => {
  throw new ApiError(errorCode, detail);
};

export const failFields = (fields: Record<string, string>): never => fail("validation_failed", { fields });

/** The other owner's, an erased and a malformed reference all answer exactly like an unknown one. */
export const unknownClaim = (code: "not_found" | "claim_unknown" | "link_unknown" | "share_unknown" = "not_found"): never => fail(code);

export const unknownPartOrModel = (): never => fail("not_found", { message: PART_NOT_FOUND_MESSAGE });

const SENTENCES: Partial<Record<ErrorCode, string>> = {
  read_only: "This address can only be read.",
  method_not_allowed: "That method is not allowed here.",
  payload_too_large: "That request is too large.",
  unsupported_media_type: "That content type is not supported.",
  cross_origin: "That request came from another origin.",
  unauthenticated: "Sign in first.",
  validation_failed: FIELDS_MESSAGE,
  internal_error: "Something went wrong on our side.",
};

function messageFor(error: ApiError, ops: boolean): string {
  if (error.detail.message !== undefined) return error.detail.message;
  const numberValue = error.detail.number ?? 0;
  if (ops && error.code in OPS_REFUSALS) {
    const template = OPS_REFUSALS[error.code as OpsRefusalCode];
    return fill(template, { state: stateName(error.detail.state ?? "started", "en-GB"), number: numberValue });
  }
  if (error.code in OWNER_REFUSALS) {
    return fill(OWNER_REFUSALS[error.code as OwnerRefusalCode][0], { number: numberValue });
  }
  return SENTENCES[error.code] ?? "That request could not be completed.";
}

/** The one builder of an API error body, shared by every endpoint. */
export function errorBody(error: ApiError, ops: boolean): ApiErrorBody {
  const body: ApiErrorBody = { error: { code: error.code, message: messageFor(error, ops) } };
  if (error.detail.fields) body.error.fields = error.detail.fields;
  if (error.detail.state) body.error.state = error.detail.state;
  return body;
}
