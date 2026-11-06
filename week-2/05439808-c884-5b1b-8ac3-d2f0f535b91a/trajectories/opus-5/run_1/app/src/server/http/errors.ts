export type ErrorCode =
  | 'malformed_json'
  | 'invalid_token'
  | 'unauthenticated'
  | 'invalid_credentials'
  | 'csrf_failed'
  | 'forbidden'
  | 'email_not_verified'
  | 'not_found'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'validation_failed'
  | 'rate_limited'
  | 'database_unavailable'
  | 'internal'
  | 'cell_occupied'
  | 'building_limit_reached'
  | 'saltmark_too_low'
  | 'max_level'
  | 'upgrade_in_progress'
  | 'job_already_finished'
  | 'no_free_builder'
  | 'insufficient_resources'
  | 'not_a_producer'
  | 'housing_full'
  | 'barracks_required'
  | 'barracks_level_too_low'
  | 'batch_already_finished'
  | 'cannot_raid_self'
  | 'already_under_attack'
  | 'village_shielded'
  | 'target_cooldown'
  | 'raid_in_progress'
  | 'no_army'
  | 'units_unavailable'
  | 'raid_not_active'
  | 'raid_abandoned'
  | 'nothing_deployed'
  | 'raid_not_resolved'
  | 'idempotency_key_reused'
  | 'already_claimed'
  | 'already_in_clan'
  | 'not_in_clan'
  | 'clan_name_taken'
  | 'clan_full'
  | 'invalid_role_change'
  | 'request_open'
  | 'request_closed'
  | 'exceeds_request'
  | 'donor_limit'
  | 'donation_cap_reached'
  | 'own_request'
  | 'recipient_housing_full';

const CONFLICT = 409;

const ERROR_TABLE: Record<ErrorCode, { status: number; message: string }> = {
  malformed_json: { status: 400, message: 'That request body is not valid JSON.' },
  invalid_token: { status: 400, message: 'That link has expired or was already used.' },
  unauthenticated: { status: 401, message: 'Sign in to continue.' },
  invalid_credentials: { status: 401, message: "That email and password don't match an account." },
  csrf_failed: { status: 403, message: 'This page is out of date. Reload and try again.' },
  forbidden: { status: 403, message: 'You are not allowed to do that.' },
  email_not_verified: { status: 403, message: 'Confirm your email to raid and join clans.' },
  not_found: { status: 404, message: "We couldn't find that." },
  payload_too_large: { status: 413, message: 'That request body is too large.' },
  unsupported_media_type: { status: 415, message: 'Send JSON.' },
  validation_failed: { status: 422, message: 'Check the highlighted fields.' },
  rate_limited: { status: 429, message: 'Too many tries. Try again shortly.' },
  database_unavailable: {
    status: 503,
    message: 'The tide records are out of reach. Nothing was changed.'
  },
  internal: { status: 500, message: 'Something went wrong.' },
  cell_occupied: { status: CONFLICT, message: 'That spot is taken.' },
  building_limit_reached: {
    status: CONFLICT,
    message: 'Your island already holds the most of these.'
  },
  saltmark_too_low: { status: CONFLICT, message: "Raise your island's saltmark first." },
  max_level: { status: CONFLICT, message: 'Already at the highest level.' },
  upgrade_in_progress: { status: CONFLICT, message: 'A builder is already on it.' },
  job_already_finished: { status: CONFLICT, message: 'That job already finished.' },
  no_free_builder: { status: CONFLICT, message: 'All builders are busy.' },
  insufficient_resources: { status: CONFLICT, message: 'Not enough resources for that.' },
  not_a_producer: { status: CONFLICT, message: 'Only producers can be collected.' },
  housing_full: { status: CONFLICT, message: 'Your camps are full.' },
  barracks_required: { status: CONFLICT, message: 'Build a Tide Barracks first.' },
  barracks_level_too_low: { status: CONFLICT, message: 'Upgrade your Tide Barracks first.' },
  batch_already_finished: { status: CONFLICT, message: 'That training already finished.' },
  cannot_raid_self: { status: CONFLICT, message: "That's your own island." },
  already_under_attack: { status: CONFLICT, message: 'Another raider got there first.' },
  village_shielded: { status: CONFLICT, message: 'That island is shielded.' },
  target_cooldown: { status: CONFLICT, message: 'You raided this island recently.' },
  raid_in_progress: { status: CONFLICT, message: 'Finish your current raid first.' },
  no_army: { status: CONFLICT, message: 'Train some units first.' },
  units_unavailable: { status: CONFLICT, message: 'You have no more of that unit.' },
  raid_not_active: { status: CONFLICT, message: 'This raid is already over.' },
  raid_abandoned: { status: CONFLICT, message: 'The finalize window closed.' },
  nothing_deployed: { status: CONFLICT, message: 'Deploy at least one unit first.' },
  raid_not_resolved: { status: CONFLICT, message: 'This raid has no result yet.' },
  idempotency_key_reused: {
    status: CONFLICT,
    message: 'That idempotency key was used with a different body.'
  },
  already_claimed: { status: CONFLICT, message: 'That reward is not ready yet.' },
  already_in_clan: { status: CONFLICT, message: 'Leave your current clan first.' },
  not_in_clan: { status: CONFLICT, message: "You're no longer in this clan." },
  clan_name_taken: { status: CONFLICT, message: 'That clan name is taken.' },
  clan_full: { status: CONFLICT, message: 'That clan is full.' },
  invalid_role_change: { status: CONFLICT, message: "That role change isn't allowed." },
  request_open: { status: CONFLICT, message: 'You already have an open request.' },
  request_closed: { status: CONFLICT, message: 'That request is already filled or closed.' },
  exceeds_request: { status: CONFLICT, message: 'That request needs fewer units now.' },
  donor_limit: { status: CONFLICT, message: "You've already given 3 units to this request." },
  donation_cap_reached: { status: CONFLICT, message: "You've given 8 units today." },
  own_request: { status: CONFLICT, message: 'That is your own request.' },
  recipient_housing_full: { status: CONFLICT, message: 'Their camps are full.' }
};

export type ErrorExtra = {
  errors?: Record<string, string>;
  nextClaimAt?: string;
  nextDonationAt?: string;
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly extra: ErrorExtra;
  readonly retryAfterSeconds: number | null;

  constructor(code: ErrorCode, extra: ErrorExtra = {}, retryAfterSeconds: number | null = null) {
    const entry = ERROR_TABLE[code];
    super(entry.message);
    this.name = 'ApiError';
    this.code = code;
    this.status = entry.status;
    this.extra = extra;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function errorBody(error: ApiError): Record<string, unknown> {
  const body: Record<string, unknown> = { error: error.code, message: error.message };
  if (error.extra.errors) body.errors = error.extra.errors;
  if (error.extra.nextClaimAt) body.nextClaimAt = error.extra.nextClaimAt;
  if (error.extra.nextDonationAt) body.nextDonationAt = error.extra.nextDonationAt;
  return body;
}

export function fail(code: ErrorCode, extra?: ErrorExtra, retryAfterSeconds?: number): never {
  throw new ApiError(code, extra ?? {}, retryAfterSeconds ?? null);
}

export function failValidation(errors: Record<string, string>): never {
  throw new ApiError('validation_failed', { errors });
}

export function notFound(): never {
  throw new ApiError('not_found');
}
