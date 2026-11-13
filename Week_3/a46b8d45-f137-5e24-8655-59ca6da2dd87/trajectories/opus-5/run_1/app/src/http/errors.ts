/**
 * Every API error is built through this one shape, and the same codes are used throughout.
 * Endpoints under `/api/ops/` carry the operator copy; every other endpoint carries the
 * English owner copy.
 */

import type { ClaimState } from '../shared/claim-state';
import {
  isOperatorRefusalCode,
  isOwnerRefusalCode,
  OPERATOR_REFUSALS,
  operatorPartWithdrawn,
  operatorWrongState,
  OWNER_REFUSALS,
  type RefusalParams,
} from '../shared/copy';

export type Audience = 'owner' | 'operator';

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    state?: ClaimState;
  };
}

export interface ErrorDetail {
  fields?: Record<string, string>;
  state?: ClaimState;
  /** Whole seconds, sent as `Retry-After`. */
  retryAfter?: number;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    override readonly message: string,
    readonly detail: ErrorDetail = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }

  toBody(): ErrorBody {
    const body: ErrorBody = { error: { code: this.code, message: this.message } };
    if (this.detail.fields !== undefined) body.error.fields = this.detail.fields;
    if (this.detail.state !== undefined) body.error.state = this.detail.state;
    return body;
  }
}

export const VALIDATION_MESSAGE = 'Some fields need attention.';

/** A 404 for an unknown model or part always carries this message, on any endpoint. */
export const CHOOSE_PART_MESSAGE = 'Choose the broken or missing part.';

/** Codes with no published copy get a short English sentence. */
const PLAIN_MESSAGES: Record<string, string> = {
  validation_failed: VALIDATION_MESSAGE,
  read_only: 'This link is read-only.',
  cross_origin: 'That request came from another origin.',
  unauthenticated: 'Sign in to use the desk.',
  unsupported_media_type: 'Send the body as JSON.',
  bad_header: 'The supplier file header is wrong.',
};

function publishedMessage(audience: Audience, code: string, params: RefusalParams): string {
  if (audience === 'operator') {
    if (isOperatorRefusalCode(code)) return OPERATOR_REFUSALS[code];
  } else if (isOwnerRefusalCode(code)) {
    let text: string = OWNER_REFUSALS[code]['en-GB'];
    if (params.file !== undefined) text = text.replace('<file>', params.file);
    if (params.number !== undefined) text = text.replace('<number>', String(params.number));
    return text;
  }
  return PLAIN_MESSAGES[code] ?? 'That request could not be completed.';
}

export function apiError(
  audience: Audience,
  status: number,
  code: string,
  detail: ErrorDetail = {},
  params: RefusalParams = {},
): ApiError {
  return new ApiError(status, code, publishedMessage(audience, code, params), detail);
}

export function validationFailed(fields: Record<string, string>): ApiError {
  return new ApiError(422, 'validation_failed', VALIDATION_MESSAGE, { fields });
}

/**
 * The one place that answers a 409 state conflict, so the current state always travels with it.
 */
export function wrongState(audience: Audience, state: ClaimState): ApiError {
  const message = audience === 'operator' ? operatorWrongState(state) : OWNER_REFUSALS.wrong_state['en-GB'];
  return new ApiError(409, 'wrong_state', message, { state });
}

export function partWithdrawn(audience: Audience, bookletNumber: number): ApiError {
  const message =
    audience === 'operator'
      ? operatorPartWithdrawn(bookletNumber)
      : OWNER_REFUSALS.part_withdrawn['en-GB'].replace('<number>', String(bookletNumber));
  return new ApiError(409, 'part_withdrawn', message);
}

/** An unknown model or part, told apart from an unknown claim by its published message. */
export function partNotFound(): ApiError {
  return new ApiError(404, 'not_found', CHOOSE_PART_MESSAGE);
}

/**
 * The one place that answers a reference or token the caller may not have: unknown, another
 * owner's, erased where the rules say so, malformed, or a body reference naming a different
 * claim. Every one of these is the same bytes on an endpoint, so none can be told apart.
 */
export function unknownReference(audience: Audience, code = 'not_found'): ApiError {
  if (audience === 'operator') return new ApiError(404, 'not_found', OPERATOR_REFUSALS.not_found);
  return apiError('owner', 404, code);
}
