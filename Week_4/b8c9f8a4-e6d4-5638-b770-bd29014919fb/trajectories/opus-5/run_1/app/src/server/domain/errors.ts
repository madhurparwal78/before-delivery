import type { ApiError, BlockerReason } from '../../shared/types';

/** Every refusal in the API carries this one shape. */
export class Refusal extends Error {
  readonly status: number;
  readonly body: ApiError;

  constructor(status: number, body: ApiError) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
}

export const refuse = (status: number, error: string, message: string, extra: Partial<ApiError> = {}): Refusal =>
  new Refusal(status, { error, message, ...extra });

export const validationFailure = (errors: Record<string, string>): Refusal =>
  new Refusal(422, { error: 'validation', message: 'Some fields need changing', errors });

export const notFound = (): Refusal => refuse(404, 'not_found', 'That could not be found');

export const notSignedIn = (): Refusal => refuse(401, 'not_signed_in', 'Sign in to carry on');

export const listingClosed = (): Refusal =>
  refuse(409, 'listing_closed', 'This car is not taking changes, viewings or offers right now');

export const illegalTransition = (): Refusal =>
  refuse(409, 'illegal_transition', 'That is not a move this listing can make');

export const publishBlocked = (reasons: readonly BlockerReason[]): Refusal =>
  refuse(409, 'publish_blocked', 'Publishing is blocked', { reasons: [...reasons] });
