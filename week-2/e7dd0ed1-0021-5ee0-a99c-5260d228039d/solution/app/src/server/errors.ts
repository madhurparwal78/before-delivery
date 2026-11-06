// The one JSON error shape and the one S3 XML error shape (brief: API, JSON error shape / S3 error
// shape). Every refusal in the app is thrown as one of these and rendered by `jsonError` / `s3Error`.
import { randomBytes } from "node:crypto";

type ErrorCode =
  | "unauthenticated" | "invalid_credentials" | "two_step_required"
  | "forbidden" | "workspace_suspended" | "step_up_required"
  | "not_found"
  | "invalid_transition" | "bucket_name_taken" | "idempotency_key_reused" | "already_member" | "last_owner"
  | "retention_locked" | "endpoint_limit" | "rotation_in_progress" | "object_locked" | "quota_exceeded"
  | "invite_expired" | "link_expired" | "link_revoked" | "undo_expired"
  | "precondition_failed" | "payload_too_large" | "validation_failed" | "rate_limited"
  | "region_offline" | "storage_unavailable" | "service_unavailable";

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401, invalid_credentials: 401, two_step_required: 401,
  forbidden: 403, workspace_suspended: 403, step_up_required: 403,
  not_found: 404,
  invalid_transition: 409, bucket_name_taken: 409, idempotency_key_reused: 409, already_member: 409,
  last_owner: 409, retention_locked: 409, endpoint_limit: 409, rotation_in_progress: 409, object_locked: 409, quota_exceeded: 409,
  invite_expired: 410, link_expired: 410, link_revoked: 410, undo_expired: 410,
  precondition_failed: 412, payload_too_large: 413, validation_failed: 422, rate_limited: 429,
  region_offline: 503, storage_unavailable: 503, service_unavailable: 503,
};

const DEFAULT_MESSAGE: Record<ErrorCode, string> = {
  unauthenticated: "Sign in to continue.",
  invalid_credentials: "Email or password is incorrect.",
  two_step_required: "Enter the code from your authenticator app to finish signing in.",
  forbidden: "Your role can't do that.",
  workspace_suspended: "This workspace is suspended. Uploads, downloads and share links are paused.",
  step_up_required: "Confirm it's you with a code from your authenticator app.",
  not_found: "Not found.",
  invalid_transition: "That change isn't allowed from the current state.",
  bucket_name_taken: "That name is taken. Bucket names are unique across all of Farshore.",
  idempotency_key_reused: "This idempotency key was already used for a different request.",
  already_member: "That person is already in this workspace.",
  last_owner: "A workspace needs at least one owner.",
  retention_locked: "Retention can be extended but not shortened.",
  endpoint_limit: "This workspace already has 5 webhook endpoints.",
  rotation_in_progress: "Another rotation is running. Try again when it finishes.",
  object_locked: "This version is under retention or legal hold.",
  quota_exceeded: "This upload would go over the workspace's storage limit.",
  invite_expired: "This invite has expired. Ask the workspace owner for a new one.",
  link_expired: "This link has expired.",
  link_revoked: "This link was revoked.",
  undo_expired: "The undo window has closed.",
  precondition_failed: "The object changed since the condition was read.",
  payload_too_large: "The request is larger than Farshore accepts.",
  validation_failed: "Some fields need attention.",
  rate_limited: "Too many requests right now.",
  region_offline: "The bucket's origin region is offline.",
  storage_unavailable: "Farshore can't reach storage right now. Nothing was changed; try again in a minute.",
  service_unavailable: "Farshore can't reach its database right now. Try again in a minute.",
};

type ErrorExtra = Record<string, string | number | boolean | null | Record<string, string>>;

// A refusal for the caller's role, a key's permission, bucket scope or prefix: the audit trail records
// it as permission.denied in this workspace under this actor.
interface Denial {
  workspaceSlug: string;
  actor: string;
}

export class ApiError extends Error {
  readonly status: number;
  constructor(readonly code: ErrorCode, message?: string, readonly extra: ErrorExtra = {},
              readonly retryAfter?: number, readonly denial?: Denial) {
    super(message ?? DEFAULT_MESSAGE[code]);
    this.status = STATUS[code];
  }
}

export function invalid(errors: Record<string, string>): ApiError {
  return new ApiError("validation_failed", "Some fields need attention.", { errors });
}

export function rateLimited(retryAfter: number, message?: string): ApiError {
  return new ApiError("rate_limited", message, { retry_after_seconds: retryAfter }, retryAfter);
}

export function transition(from: string, to: string): ApiError {
  return new ApiError("invalid_transition", undefined, { from, to });
}

export function jsonError(error: ApiError): string {
  return JSON.stringify({ error: error.code, message: error.message, ...error.extra });
}

type S3Code =
  | "AccessDenied" | "InvalidAccessKeyId" | "SignatureDoesNotMatch" | "RequestTimeTooSkewed" | "AccountSuspended"
  | "QuotaExceeded" | "NoSuchBucket" | "NoSuchKey" | "NoSuchUpload" | "PreconditionFailed" | "EntityTooLarge"
  | "EntityTooSmall" | "InvalidPart" | "InvalidPartOrder" | "InvalidArgument" | "MetadataTooLarge" | "InvalidTag"
  | "BadDigest" | "IncompleteBody" | "MalformedXML" | "SlowDown" | "ServiceUnavailable" | "NotImplemented";

const S3_STATUS: Record<S3Code, number> = {
  AccessDenied: 403, InvalidAccessKeyId: 403, SignatureDoesNotMatch: 403, RequestTimeTooSkewed: 403,
  AccountSuspended: 403, QuotaExceeded: 403, NoSuchBucket: 404, NoSuchKey: 404, NoSuchUpload: 404,
  PreconditionFailed: 412, EntityTooLarge: 413, EntityTooSmall: 400, InvalidPart: 400, InvalidPartOrder: 400,
  InvalidArgument: 400, MetadataTooLarge: 400, InvalidTag: 400, BadDigest: 400, IncompleteBody: 400,
  MalformedXML: 400, SlowDown: 503, ServiceUnavailable: 503, NotImplemented: 501,
};

const S3_MESSAGE: Record<S3Code, string> = {
  AccessDenied: "Access Denied.",
  InvalidAccessKeyId: "The access key ID does not exist in Farshore.",
  SignatureDoesNotMatch: "The request signature does not match.",
  RequestTimeTooSkewed: "The request time is more than 15 minutes from the server time.",
  AccountSuspended: "This workspace is suspended.",
  QuotaExceeded: "This upload would go over the workspace's storage limit.",
  NoSuchBucket: "The bucket does not exist.",
  NoSuchKey: "The key does not exist.",
  NoSuchUpload: "The multipart upload does not exist.",
  PreconditionFailed: "A precondition did not hold.",
  EntityTooLarge: "The body is larger than allowed.",
  EntityTooSmall: "A part other than the last is smaller than the minimum part size.",
  InvalidPart: "A listed part is unknown or does not match.",
  InvalidPartOrder: "The part list is not in ascending order.",
  InvalidArgument: "An argument is not valid.",
  MetadataTooLarge: "User metadata is limited to 2,048 bytes in total.",
  InvalidTag: "Up to 10 tags; keys 1 to 128 characters, values up to 256.",
  BadDigest: "A digest does not match the body.",
  IncompleteBody: "The body framing or length does not match.",
  MalformedXML: "The XML body could not be read.",
  SlowDown: "The bucket's origin region is offline. Try again later.",
  ServiceUnavailable: "Farshore can't serve this request right now.",
  NotImplemented: "This operation is not supported.",
};

export class S3Error extends Error {
  readonly status: number;
  constructor(readonly code: S3Code, message?: string, readonly retryAfter?: number, readonly denial?: Denial) {
    super(message ?? S3_MESSAGE[code]);
    this.status = S3_STATUS[code];
  }
}

export function xmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] ?? c);
}

// One <Error> entry of a DeleteObjects result.
export function s3KeyError(error: S3Error, key: string, versionId: string | null): string {
  const versionXml = versionId !== null ? `<VersionId>${xmlEscape(versionId)}</VersionId>` : "";
  return `<Error><Key>${xmlEscape(key)}</Key>${versionXml}<Code>${error.code}</Code><Message>${xmlEscape(error.message)}</Message></Error>`;
}

export function s3Error(error: S3Error, resource: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${error.code}</Code><Message>${xmlEscape(error.message)}` +
    `</Message><Resource>${xmlEscape(resource)}</Resource><RequestId>${randomBytes(8).toString("hex").toUpperCase()}` +
    `</RequestId></Error>`;
}
