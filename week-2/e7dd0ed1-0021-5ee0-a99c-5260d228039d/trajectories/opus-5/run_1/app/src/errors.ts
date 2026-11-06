/** The one JSON error shape and the one S3 XML error shape, with the single precedence order. */

export type ErrorCode =
  | 'unauthenticated'
  | 'invalid_credentials'
  | 'two_step_required'
  | 'forbidden'
  | 'workspace_suspended'
  | 'step_up_required'
  | 'not_found'
  | 'invalid_transition'
  | 'bucket_name_taken'
  | 'idempotency_key_reused'
  | 'already_member'
  | 'last_owner'
  | 'retention_locked'
  | 'endpoint_limit'
  | 'rotation_in_progress'
  | 'object_locked'
  | 'quota_exceeded'
  | 'invite_expired'
  | 'link_expired'
  | 'link_revoked'
  | 'undo_expired'
  | 'precondition_failed'
  | 'payload_too_large'
  | 'validation_failed'
  | 'rate_limited'
  | 'region_offline'
  | 'storage_unavailable'
  | 'service_unavailable';

const statusForCode: Record<ErrorCode, number> = {
  unauthenticated: 401,
  invalid_credentials: 401,
  two_step_required: 401,
  forbidden: 403,
  workspace_suspended: 403,
  step_up_required: 403,
  not_found: 404,
  invalid_transition: 409,
  bucket_name_taken: 409,
  idempotency_key_reused: 409,
  already_member: 409,
  last_owner: 409,
  retention_locked: 409,
  endpoint_limit: 409,
  rotation_in_progress: 409,
  object_locked: 409,
  quota_exceeded: 409,
  invite_expired: 410,
  link_expired: 410,
  link_revoked: 410,
  undo_expired: 410,
  precondition_failed: 412,
  payload_too_large: 413,
  validation_failed: 422,
  rate_limited: 429,
  region_offline: 503,
  storage_unavailable: 503,
  service_unavailable: 503,
};

const defaultMessage: Record<ErrorCode, string> = {
  unauthenticated: 'Sign in to continue.',
  invalid_credentials: 'Email or password is incorrect.',
  two_step_required: 'Enter the code from your authenticator app to finish signing in.',
  forbidden: "You can't do that.",
  workspace_suspended: 'This workspace is suspended.',
  step_up_required: "Confirm it's you with a code from your authenticator app.",
  not_found: 'Not found.',
  invalid_transition: "That change isn't allowed from the current state.",
  bucket_name_taken: 'That name is taken. Bucket names are unique across all of Farshore.',
  idempotency_key_reused: 'This idempotency key was used for a different request.',
  already_member: 'That person is already in this workspace.',
  last_owner: 'A workspace needs at least one owner.',
  retention_locked: 'Retention can be extended but not shortened.',
  endpoint_limit: 'This workspace already has 5 webhook endpoints.',
  rotation_in_progress: 'Another rotation is running. Try again when it finishes.',
  object_locked: 'This version is under retention or legal hold.',
  quota_exceeded: 'This workspace is at its storage limit.',
  invite_expired: 'This invite has expired.',
  link_expired: 'This link has expired.',
  link_revoked: 'This link was revoked.',
  undo_expired: 'The undo window has closed.',
  precondition_failed: 'The object changed since you read it.',
  payload_too_large: 'That request is too large.',
  validation_failed: 'Some fields need fixing.',
  rate_limited: 'Too many requests.',
  region_offline: 'That region is offline.',
  storage_unavailable: "Farshore can't reach storage right now.",
  service_unavailable: 'Farshore is temporarily unavailable.',
};

export class ApiError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message?: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message ?? defaultMessage[code]);
    this.status = statusForCode[code];
  }

  body(): Record<string, unknown> {
    return { error: this.code, message: this.message, ...this.extra };
  }
}

export function apiError(code: ErrorCode, message?: string, extra: Record<string, unknown> = {}): ApiError {
  return new ApiError(code, message, extra);
}

export class ValidationError extends ApiError {
  constructor(readonly fields: Record<string, string>, message = 'Some fields need fixing.') {
    super('validation_failed', message, { errors: fields });
  }
}

export function validation(fields: Record<string, string>): ValidationError {
  return new ValidationError(fields);
}

export class RateLimited extends ApiError {
  constructor(readonly retryAfterSeconds: number, message = 'Too many requests.') {
    super('rate_limited', message, { retry_after_seconds: retryAfterSeconds });
  }
}

export type S3Code =
  | 'AccessDenied'
  | 'InvalidAccessKeyId'
  | 'SignatureDoesNotMatch'
  | 'RequestTimeTooSkewed'
  | 'AccountSuspended'
  | 'QuotaExceeded'
  | 'NoSuchBucket'
  | 'NoSuchKey'
  | 'NoSuchUpload'
  | 'PreconditionFailed'
  | 'EntityTooLarge'
  | 'EntityTooSmall'
  | 'InvalidPart'
  | 'InvalidPartOrder'
  | 'InvalidArgument'
  | 'MetadataTooLarge'
  | 'InvalidTag'
  | 'BadDigest'
  | 'IncompleteBody'
  | 'MalformedXML'
  | 'SlowDown'
  | 'ServiceUnavailable'
  | 'NotImplemented';

const s3Status: Record<S3Code, number> = {
  AccessDenied: 403,
  InvalidAccessKeyId: 403,
  SignatureDoesNotMatch: 403,
  RequestTimeTooSkewed: 403,
  AccountSuspended: 403,
  QuotaExceeded: 403,
  NoSuchBucket: 404,
  NoSuchKey: 404,
  NoSuchUpload: 404,
  PreconditionFailed: 412,
  EntityTooLarge: 413,
  EntityTooSmall: 400,
  InvalidPart: 400,
  InvalidPartOrder: 400,
  InvalidArgument: 400,
  MetadataTooLarge: 400,
  InvalidTag: 400,
  BadDigest: 400,
  IncompleteBody: 400,
  MalformedXML: 400,
  SlowDown: 503,
  ServiceUnavailable: 503,
  NotImplemented: 501,
};

const s3Message: Record<S3Code, string> = {
  AccessDenied: 'Access Denied',
  InvalidAccessKeyId: 'The access key ID you provided does not exist in our records.',
  SignatureDoesNotMatch: 'The request signature we calculated does not match the signature you provided.',
  RequestTimeTooSkewed: 'The difference between the request time and the current time is too large.',
  AccountSuspended: 'This workspace is suspended.',
  QuotaExceeded: 'The workspace storage quota has been reached.',
  NoSuchBucket: 'The specified bucket does not exist.',
  NoSuchKey: 'The specified key does not exist.',
  NoSuchUpload: 'The specified multipart upload does not exist.',
  PreconditionFailed: 'At least one of the pre-conditions you specified did not hold.',
  EntityTooLarge: 'Your proposed upload exceeds the maximum allowed size.',
  EntityTooSmall: 'Your proposed upload is smaller than the minimum allowed object size.',
  InvalidPart: 'One or more of the specified parts could not be found.',
  InvalidPartOrder: 'The list of parts was not in ascending order.',
  InvalidArgument: 'Invalid Argument',
  MetadataTooLarge: 'Your metadata headers exceed the maximum allowed metadata size.',
  InvalidTag: 'The tag provided was not valid.',
  BadDigest: 'The checksum you specified did not match what we received.',
  IncompleteBody: 'The request body terminated unexpectedly.',
  MalformedXML: 'The XML you provided was not well-formed or did not validate.',
  SlowDown: 'Please reduce your request rate.',
  ServiceUnavailable: 'Service is unable to handle request.',
  NotImplemented: 'A header or operation you provided implies functionality that is not implemented.',
};

export class S3Error extends Error {
  readonly status: number;

  constructor(
    readonly code: S3Code,
    message?: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message ?? s3Message[code]);
    this.status = s3Status[code];
  }
}

export function s3Error(code: S3Code, message?: string, headers: Record<string, string> = {}): S3Error {
  return new S3Error(code, message, headers);
}
