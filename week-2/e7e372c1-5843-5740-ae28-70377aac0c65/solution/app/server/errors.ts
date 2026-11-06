// One error constructor builds every error response. Caught error text never reaches a body.

import type { ErrorBody } from "../shared/domain.ts";

export interface Failure {
  status: number;
  body: ErrorBody;
}

const CATALOGUE = {
  vault_unavailable: { status: 503, message: "Filing vault unavailable." },
  invalid_json: { status: 422, message: "Request body is not valid JSON." },
  internal: { status: 500, message: "Something went wrong. Nothing was changed." },
  validation_failed: { status: 422, message: "Some fields need attention." },
  cross_origin: { status: 403, message: "Cross-site requests are not allowed." },
  payload_too_large: { status: 413, message: "The request body is larger than the size limit." },
  unsupported_media_type: { status: 415, message: "The request body has an unsupported media type." },
  unauthenticated: { status: 401, message: "Sign in to continue." },
  invalid_credentials: { status: 401, message: "Email or password is incorrect." },
  bad_signature: { status: 401, message: "The tick signature is not valid." },
  stale_signature: { status: 401, message: "The tick signature is outside the accepted window." },
  not_found: { status: 404, message: "Not found." },
  method_not_allowed: { status: 405, message: "That method is not allowed here." },
  forbidden: { status: 403, message: "Your role cannot do this." },
  not_preparer: { status: 403, message: "Only the preparer can change this restatement." },
  preparer_cannot_clear: { status: 403, message: "The preparer cannot review this restatement." },
  preparer_cannot_release: { status: 403, message: "The preparer cannot release or withdraw this restatement." },
  clearer_cannot_release: { status: 403, message: "The person who cleared this restatement cannot release it." },
  invalid_transition: { status: 409, message: "This restatement is not in a state that allows that action." },
  version_conflict: { status: 409, message: "This restatement changed since it was read." },
  idempotency_conflict: { status: 409, message: "That idempotency key was used for another restatement." },
  exhibit_not_verified: { status: 409, message: "Attach a verified exhibit first." },
  week_out_of_sequence: { status: 409, message: "That week is not the week after the latest published week." },
  week_not_ended: { status: 409, message: "That week has not ended yet." },
  not_latest_week: { status: 409, message: "Only the latest published week can be corrected." },
  restatement_open: { status: 409, message: "Another restatement is already open." },
  tick_id_conflict: { status: 409, message: "That tick id was already used for a different tick." },
  session_closed: { status: 409, message: "Share-price ticks are only accepted during the regular session." },
  range_not_satisfiable: { status: 416, message: "The requested range cannot be satisfied." },
} as const satisfies Record<string, { status: number; message: string }>;

type ErrorCode = keyof typeof CATALOGUE;

export function failure(code: ErrorCode, fields?: Record<string, string>): Failure {
  const { status, message } = CATALOGUE[code];
  return { status, body: { error: fields ? { code, message, fields } : { code, message } } };
}

/** Thrown by domain code; the HTTP layer turns it into a response. */
export class Refusal extends Error {
  readonly failure: Failure;

  constructor(code: ErrorCode, fields?: Record<string, string>) {
    super(code);
    this.failure = failure(code, fields);
  }
}
