import * as copy from '../../shared/copy';
import type { ApiError } from '../../shared/types';

/** Every API error leaves through this one shape. */
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.error);
  }
}

export const crossSite = (): ApiFailure =>
  new ApiFailure(403, { error: copy.CROSS_SITE_REFUSED });
export const sessionEnded = (): ApiFailure => new ApiFailure(401, { error: copy.SESSION_ENDED });
export const signInRequired = (): ApiFailure =>
  new ApiFailure(401, { error: copy.SIGN_IN_TO_CONTINUE });
export const notFound = (): ApiFailure => new ApiFailure(404, { error: copy.NOT_FOUND });
export const staffOnly = (): ApiFailure => new ApiFailure(403, { error: copy.STAFF_ONLY });
export const coordinatorOnly = (): ApiFailure =>
  new ApiFailure(403, { error: copy.COORDINATOR_ONLY });
export const membersOnly = (): ApiFailure => new ApiFailure(403, { error: copy.MEMBERS_ONLY });
export const signOutBeforeJoining = (): ApiFailure =>
  new ApiFailure(403, { error: copy.SIGN_OUT_BEFORE_JOINING });
export const sendJson = (): ApiFailure => new ApiFailure(415, { error: copy.SEND_JSON });
export const requestTooLarge = (): ApiFailure =>
  new ApiFailure(413, { error: copy.REQUEST_TOO_LARGE });
export const photoTooLarge = (): ApiFailure => new ApiFailure(413, { error: copy.PHOTO_TOO_LARGE });
export const signInRefused = (): ApiFailure =>
  new ApiFailure(401, { error: copy.SIGN_IN_REFUSED });

export function invalid(fields: Record<string, string>): ApiFailure {
  return new ApiFailure(422, { error: copy.FORM_PROBLEMS_SUMMARY, fields });
}

export function wrongPeg(): ApiFailure {
  return new ApiFailure(422, { error: copy.WRONG_PEG, fields: { peg_part_id: copy.WRONG_PEG } });
}

export function conflict(message: string): ApiFailure {
  return new ApiFailure(409, { error: message });
}

export function providerDown(message: string): ApiFailure {
  return new ApiFailure(503, { error: message });
}

/** Collects field messages so a 422 lists them in the endpoint's published order. */
export class FieldProblems {
  private readonly fields: Record<string, string> = {};

  add(field: string, message: string): void {
    if (!(field in this.fields)) this.fields[field] = message;
  }

  get any(): boolean {
    return Object.keys(this.fields).length > 0;
  }

  throwIfAny(): void {
    if (this.any) throw invalid(this.fields);
  }
}
