import { problemDetail, PROBLEM_TITLES } from './copy.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

export interface Problem {
  status: number;
  code: string;
  params?: { [name: string]: string };
  detailOverride?: string;
  errors?: { [pointer: string]: string };
  headers?: { [name: string]: string };
}

const TYPE_PREFIX = 'urn:gevelwerk:problem:';

export function problemBody(problem: Problem): { [key: string]: Json } {
  const detail =
    problem.detailOverride ?? problemDetail(problem.code, problem.params ?? {});
  const body: { [key: string]: Json } = {
    type: TYPE_PREFIX + problem.code,
    title: PROBLEM_TITLES[problem.code] ?? problem.code,
    status: problem.status,
    detail,
    code: problem.code,
  };
  if (problem.errors && Object.keys(problem.errors).length > 0) {
    body.errors = problem.errors;
  }
  return body;
}

export function problemJson(problem: Problem): string {
  return JSON.stringify(problemBody(problem));
}

// One builder for every error path in the API.
export const problems = {
  notFound: (): Problem => ({ status: 404, code: 'not_found' }),
  methodNotAllowed: (allow: string[]): Problem => ({
    status: 405,
    code: 'method_not_allowed',
    headers: { Allow: allow.join(', ') },
  }),
  malformedBody: (): Problem => ({ status: 400, code: 'malformed_body' }),
  unsupportedMediaType: (): Problem => ({ status: 415, code: 'unsupported_media_type' }),
  bodyTooLarge: (): Problem => ({ status: 413, code: 'body_too_large' }),
  originRefused: (): Problem => ({ status: 403, code: 'origin_refused' }),
  idempotencyKeyRequired: (): Problem => ({ status: 400, code: 'idempotency_key_required' }),
  idempotencyKeyReused: (): Problem => ({ status: 409, code: 'idempotency_key_reused' }),
  preconditionRequired: (): Problem => ({ status: 428, code: 'precondition_required' }),
  layoutChanged: (): Problem => ({
    status: 412,
    code: 'layout_changed',
    headers: { 'Cache-Control': 'no-store' },
  }),
  unknownField: (field: string): Problem => ({
    status: 422,
    code: 'unknown_field',
    params: { field },
    detailOverride: `Unknown field: ${field}.`,
  }),
  validationFailed: (errors: { [pointer: string]: string }): Problem => ({
    status: 422,
    code: 'validation_failed',
    errors,
    detailOverride: 'Some fields need fixing.',
  }),
  internalError: (): Problem => ({ status: 500, code: 'internal_error' }),
  databaseUnavailable: (): Problem => ({ status: 503, code: 'database_unavailable', headers: { 'Retry-After': '5' } }),
  hireDeskUnavailable: (): Problem => ({ status: 503, code: 'hire_desk_unavailable', headers: { 'Retry-After': '5' } }),
  hireDeskPending: (): Problem => ({ status: 503, code: 'hire_desk_pending', headers: { 'Retry-After': '5' } }),
  hireReleaseUnavailable: (): Problem => ({ status: 503, code: 'hire_release_unavailable', headers: { 'Retry-After': '5' } }),
  pressUnavailable: (): Problem => ({ status: 503, code: 'press_unavailable', headers: { 'Retry-After': '5' } }),
  sheetStoreUnavailable: (): Problem => ({ status: 503, code: 'sheet_store_unavailable', headers: { 'Retry-After': '5' } }),
  wallStoreUnavailable: (): Problem => ({ status: 503, code: 'wall_store_unavailable', headers: { 'Retry-After': '5' } }),
  noStock: (): Problem => ({ status: 409, code: 'no_stock' }),
  holdLapsed: (): Problem => ({ status: 409, code: 'hold_lapsed' }),
  holdNotHeld: (): Problem => ({ status: 409, code: 'hold_not_held' }),
  quoteRequired: (): Problem => ({ status: 409, code: 'quote_required' }),
  serialAlreadyInKit: (): Problem => ({ status: 409, code: 'serial_already_in_kit' }),
  serialNotThere: (): Problem => ({ status: 409, code: 'serial_not_there' }),
  serialUnknown: (): Problem => ({ status: 422, code: 'serial_unknown' }),
  serialExists: (): Problem => ({ status: 422, code: 'serial_exists' }),
  hiredInByHoldOnly: (): Problem => ({ status: 409, code: 'hired_in_by_hold_only' }),
  reversalNotPossible: (): Problem => ({ status: 409, code: 'reversal_not_possible' }),
  bodyInIssuedRig: (serial: string): Problem => ({ status: 409, code: 'body_in_issued_rig', params: { serial } }),
  bodyNotAvailable: (serial: string): Problem => ({ status: 409, code: 'body_not_available', params: { serial } }),
  bodyAlreadyInLayout: (serial: string): Problem => ({ status: 409, code: 'body_already_in_layout', params: { serial } }),
  layoutNeedsBodies: (n: number): Problem => ({ status: 409, code: 'layout_needs_bodies', params: { n: String(n) } }),
  circuitOverloaded: (name: string, load: number, capacity: number): Problem => ({
    status: 409,
    code: 'circuit_overloaded',
    params: { name, load: String(load), capacity: String(capacity) },
  }),
  sheetAlreadyIssued: (): Problem => ({ status: 409, code: 'sheet_already_issued' }),
  sheetWithdrawn: (): Problem => ({ status: 409, code: 'sheet_withdrawn' }),
  linkNotFound: (): Problem => ({ status: 404, code: 'link_not_found' }),
  linkEnded: (): Problem => ({ status: 410, code: 'link_ended' }),
  linkWindowOver: (): Problem => ({ status: 410, code: 'link_window_over' }),
  linkRateLimited: (retryAfter: number): Problem => ({
    status: 429,
    code: 'link_rate_limited',
    headers: { 'Retry-After': String(Math.max(1, retryAfter)) },
  }),
  quoteTotalMismatch: (provider: string, computed: string): Problem => ({
    status: 409,
    code: 'quote_total_mismatch',
    params: { 'provider total': provider, 'computed total': computed },
  }),
  jobFinished: (): Problem => ({ status: 409, code: 'job_finished' }),
};
