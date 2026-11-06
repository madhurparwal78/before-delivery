// The one published error shape. Every error response in the server is built here.

type ErrorCode =
  | 'malformed_json' | 'invalid_token' | 'unauthenticated' | 'invalid_credentials' | 'csrf_failed'
  | 'forbidden' | 'email_not_verified' | 'not_found' | 'payload_too_large' | 'unsupported_media_type'
  | 'validation_failed' | 'rate_limited' | 'database_unavailable' | 'internal'
  | 'cell_occupied' | 'building_limit_reached' | 'saltmark_too_low' | 'max_level' | 'upgrade_in_progress'
  | 'job_already_finished' | 'no_free_builder' | 'insufficient_resources' | 'not_a_producer' | 'housing_full'
  | 'barracks_required' | 'barracks_level_too_low' | 'batch_already_finished' | 'cannot_raid_self'
  | 'already_under_attack' | 'village_shielded' | 'target_cooldown' | 'raid_in_progress' | 'no_army'
  | 'units_unavailable' | 'raid_not_active' | 'raid_abandoned' | 'nothing_deployed' | 'raid_not_resolved'
  | 'idempotency_key_reused' | 'already_claimed' | 'already_in_clan' | 'not_in_clan' | 'clan_name_taken'
  | 'clan_full' | 'invalid_role_change' | 'request_open' | 'request_closed' | 'exceeds_request' | 'donor_limit'
  | 'donation_cap_reached' | 'own_request' | 'recipient_housing_full';

const STATUS: Record<ErrorCode, number> = {
  malformed_json: 400, invalid_token: 400, unauthenticated: 401, invalid_credentials: 401, csrf_failed: 403,
  forbidden: 403, email_not_verified: 403, not_found: 404, payload_too_large: 413, unsupported_media_type: 415,
  validation_failed: 422, rate_limited: 429, database_unavailable: 503, internal: 500,
  cell_occupied: 409, building_limit_reached: 409, saltmark_too_low: 409, max_level: 409, upgrade_in_progress: 409,
  job_already_finished: 409, no_free_builder: 409, insufficient_resources: 409, not_a_producer: 409, housing_full: 409,
  barracks_required: 409, barracks_level_too_low: 409, batch_already_finished: 409, cannot_raid_self: 409,
  already_under_attack: 409, village_shielded: 409, target_cooldown: 409, raid_in_progress: 409, no_army: 409,
  units_unavailable: 409, raid_not_active: 409, raid_abandoned: 409, nothing_deployed: 409, raid_not_resolved: 409,
  idempotency_key_reused: 409, already_claimed: 409, already_in_clan: 409, not_in_clan: 409, clan_name_taken: 409,
  clan_full: 409, invalid_role_change: 409, request_open: 409, request_closed: 409, exceeds_request: 409,
  donor_limit: 409, donation_cap_reached: 409, own_request: 409, recipient_housing_full: 409,
};

const MESSAGE: Record<ErrorCode, string> = {
  malformed_json: 'The request body is not valid JSON.',
  invalid_token: 'This link has expired or was already used.',
  unauthenticated: 'Sign in to continue.',
  invalid_credentials: "That email and password don't match an account.",
  csrf_failed: 'This page is out of date. Reload and try again.',
  forbidden: 'You are not allowed to do that.',
  email_not_verified: 'Confirm your email first.',
  not_found: "We couldn't find that.",
  payload_too_large: 'The request body is too large.',
  unsupported_media_type: 'Send the request body as JSON.',
  validation_failed: 'Check the highlighted fields.',
  rate_limited: 'Too many tries. Try again shortly.',
  database_unavailable: 'The tide records are out of reach. Nothing was changed.',
  internal: 'Something went wrong.',
  cell_occupied: 'That spot is taken.',
  building_limit_reached: 'The island already holds the most of these.',
  saltmark_too_low: 'The island saltmark is too low for that level.',
  max_level: 'Already at the highest level.',
  upgrade_in_progress: 'A builder is already on it.',
  job_already_finished: 'That job already finished.',
  no_free_builder: 'All builders are busy.',
  insufficient_resources: 'Not enough resources for that.',
  not_a_producer: 'Only producers can be collected.',
  housing_full: 'The camps are full.',
  barracks_required: 'Build a Tide Barracks first.',
  barracks_level_too_low: 'Upgrade the Tide Barracks first.',
  batch_already_finished: 'That training already finished.',
  cannot_raid_self: 'That is your own island.',
  already_under_attack: 'That island is already under attack.',
  village_shielded: 'That island is shielded.',
  target_cooldown: 'You raided this island recently.',
  raid_in_progress: 'Finish your current raid first.',
  no_army: 'Train some units first.',
  units_unavailable: 'Those units are not available.',
  raid_not_active: 'This raid is already over.',
  raid_abandoned: 'The finalize window closed and the raid was abandoned.',
  nothing_deployed: 'Deploy at least one unit first.',
  raid_not_resolved: 'This raid has no result yet.',
  idempotency_key_reused: 'That Idempotency-Key was already used with a different body.',
  already_claimed: 'Already claimed.',
  already_in_clan: 'Leave your current clan first.',
  not_in_clan: "You're no longer in this clan.",
  clan_name_taken: 'That clan name is taken.',
  clan_full: 'That clan is full.',
  invalid_role_change: "That role change isn't allowed.",
  request_open: 'You already have an open request.',
  request_closed: 'That request is already filled or closed.',
  exceeds_request: 'That request needs fewer units now.',
  donor_limit: 'You already gave 3 units to this request.',
  donation_cap_reached: 'You reached the daily donation cap.',
  own_request: 'You cannot donate to your own request.',
  recipient_housing_full: 'Their camps are full.',
};

type Extra = { errors: Record<string, string> } | { nextClaimAt: string } | { nextDonationAt: string };

export class ApiError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    readonly extra: Extra | null = null,
    readonly headers: Record<string, string> = {},
  ) {
    super(code);
    this.status = STATUS[code];
  }

  body(): Record<string, unknown> {
    return { error: this.code, message: MESSAGE[this.code], ...(this.extra ?? {}) };
  }
}

export const fail = (code: ErrorCode, extra: Extra | null = null, headers: Record<string, string> = {}): never => {
  throw new ApiError(code, extra, headers);
};

export const fieldErrors = (errors: Record<string, string>): never => fail('validation_failed', { errors });

/** Thrown by the database layer when PostgreSQL cannot be reached. */
export class DatabaseUnavailable extends Error {}
