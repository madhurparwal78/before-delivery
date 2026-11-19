import { config } from './config.js';

export type ErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_stage_holder'
  | 'download_not_allowed'
  | 'cross_origin'
  | 'not_found'
  | 'method_not_allowed'
  | 'wrong_state'
  | 'already_decided'
  | 'withdrawn'
  | 'not_requestable'
  | 'duplicate_open_request'
  | 'idempotency_conflict'
  | 'stale_version'
  | 'open_version'
  | 'publish_blocked'
  | 'already_registered'
  | 'seed_conflict'
  | 'invitation_invalid'
  | 'link_expired'
  | 'invalid_body'
  | 'invalid_credentials'
  | 'email_invalid'
  | 'weak_password'
  | 'application_prohibited'
  | 'territory_invalid'
  | 'campaign_dates'
  | 'rules_required'
  | 'rule_unknown'
  | 'note_too_long'
  | 'reason_required'
  | 'comment_required'
  | 'condition_invalid'
  | 'proof_type'
  | 'derivative_type'
  | 'size_contract'
  | 'no_derivatives'
  | 'successor_invalid'
  | 'identifier_invalid'
  | 'identifier_prefix'
  | 'identifier_duplicate'
  | 'identifier_missing'
  | 'replacement_missing'
  | 'seed_invalid'
  | 'proof_too_large'
  | 'too_large'
  | 'storage_unavailable';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;

  constructor(status: number, code: ErrorCode, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'ApiError';
  }
}

const printMegabytes = (bytes: number): string => {
  const megabytes = bytes / 1_048_576;
  return String(Number(megabytes.toFixed(3)));
};

export const errors = {
  unauthenticated: () => new ApiError(401, 'unauthenticated', 'Sign in to continue.'),
  forbidden: () => new ApiError(403, 'forbidden', "You can't do that."),
  notStageHolder: (holderDisplayName: string) =>
    new ApiError(403, 'not_stage_holder', `Only ${holderDisplayName} or an owner can decide this stage.`),
  downloadNotAllowed: (reason: string) => new ApiError(403, 'download_not_allowed', reason),
  crossOrigin: () => new ApiError(403, 'cross_origin', 'Requests must come from this site.'),
  notFound: () => new ApiError(404, 'not_found', 'Not found'),
  methodNotAllowed: () => new ApiError(405, 'method_not_allowed', 'The audit log cannot be changed.'),
  wrongState: (message: string) => new ApiError(409, 'wrong_state', message),
  alreadyDecided: (displayName: string, decisionLabel: string) =>
    new ApiError(409, 'already_decided', `Already decided by ${displayName}: ${decisionLabel}.`),
  withdrawn: (requestId: string, displayName: string) =>
    new ApiError(409, 'withdrawn', `${requestId} was withdrawn by ${displayName}.`),
  notRequestable: (cardName: string, reason: string) =>
    new ApiError(409, 'not_requestable', `${cardName} cannot be requested: ${reason}`),
  duplicateOpenRequest: (requestId: string) =>
    new ApiError(409, 'duplicate_open_request', `You already have ${requestId} open.`),
  idempotencyConflict: () =>
    new ApiError(409, 'idempotency_conflict', 'This submission key was already used for a different request.'),
  staleVersion: () =>
    new ApiError(409, 'stale_version', 'This draft changed since you opened it. Reload to see the latest.'),
  openVersion: (versionNumber: number) =>
    new ApiError(409, 'open_version', `Version ${versionNumber} is already open.`),
  publishBlocked: (versionNumber: number, blockers: string) =>
    new ApiError(409, 'publish_blocked', `Cannot publish version ${versionNumber}: ${blockers}.`),
  alreadyRegistered: (email: string) => new ApiError(409, 'already_registered', `${email} already has an account.`),
  seedConflict: () => new ApiError(409, 'seed_conflict', 'Reset before seeding.'),
  invitationInvalid: () => new ApiError(410, 'invitation_invalid', 'This invitation link is no longer valid.'),
  linkExpired: () => new ApiError(410, 'link_expired', 'This link has expired.'),
  invalidBody: () => new ApiError(422, 'invalid_body', 'Request body is not valid JSON.'),
  invalidCredentials: () => new ApiError(422, 'invalid_credentials', 'Email or password is incorrect.'),
  emailInvalid: () => new ApiError(422, 'email_invalid', 'Enter a valid email address.'),
  weakPassword: () => new ApiError(422, 'weak_password', 'Password must be at least 12 characters.'),
  applicationProhibited: (applicationLabel: string) =>
    new ApiError(422, 'application_prohibited', `${applicationLabel} use is not permitted by this licence.`),
  territoryInvalid: (codes: string[]) =>
    new ApiError(422, 'territory_invalid', `Territories must be within your engagement: ${codes.join(', ')}.`),
  campaignDates: () => new ApiError(422, 'campaign_dates', 'Campaign end must be on or after its start.'),
  rulesRequired: () => new ApiError(422, 'rules_required', 'Cite at least one rule.'),
  ruleUnknown: (identifier: string) => new ApiError(422, 'rule_unknown', `${identifier} is not a live rule.`),
  noteTooLong: () => new ApiError(422, 'note_too_long', 'Note must be 2,000 characters or fewer.'),
  reasonRequired: () => new ApiError(422, 'reason_required', 'Give a reason.'),
  commentRequired: () => new ApiError(422, 'comment_required', 'Say what needs to change.'),
  conditionInvalid: (message: string) => new ApiError(422, 'condition_invalid', message),
  proofType: () => new ApiError(422, 'proof_type', 'Proof must be a PNG, JPEG or PDF file.'),
  derivativeType: () => new ApiError(422, 'derivative_type', 'Derivative must be a PNG or SVG file.'),
  sizeContract: (lines: string[]) => new ApiError(422, 'size_contract', lines.join('\n')),
  noDerivatives: (assetName: string) =>
    new ApiError(422, 'no_derivatives', `Cannot release: ${assetName} has no derivatives.`),
  successorInvalid: () => new ApiError(422, 'successor_invalid', 'Choose a released successor asset.'),
  identifierInvalid: (identifier: string) =>
    new ApiError(422, 'identifier_invalid', `${identifier} is not a valid rule identifier.`),
  identifierPrefix: (identifier: string, slug: string) =>
    new ApiError(422, 'identifier_prefix', `${identifier} must start with ${slug}.`),
  identifierDuplicate: (identifier: string) =>
    new ApiError(422, 'identifier_duplicate', `${identifier} appears twice.`),
  identifierMissing: () => new ApiError(422, 'identifier_missing', 'Every statement needs a rule identifier.'),
  replacementMissing: (identifier: string) =>
    new ApiError(422, 'replacement_missing', `${identifier} was removed without a replacement.`),
  seedInvalid: (path: string, problem: string) => new ApiError(422, 'seed_invalid', `${path}: ${problem}`),
  proofTooLarge: () =>
    new ApiError(413, 'proof_too_large', `Proof must be ${printMegabytes(config.proofMaxBytes)} MB or smaller.`),
  tooLarge: () => new ApiError(413, 'too_large', 'Request body is too large.'),
  storageProof: () =>
    new ApiError(503, 'storage_unavailable', 'Proof storage is unavailable. Your request is unchanged.'),
  storageDownload: () => new ApiError(503, 'storage_unavailable', 'Downloads are unavailable right now.'),
  storageWrite: () =>
    new ApiError(503, 'storage_unavailable', 'Storage is unavailable. Nothing was changed.'),
};

export const CONDITION_INVALID_MESSAGES = {
  clear_space: 'Clear space must be 0.5, 1, 1.5 or 2.',
  attribution: 'Attribution needs a credit line.',
  territory: 'Territory needs at least one country code.',
  expiry_override: 'Expiry override needs a date as YYYY-MM-DD.',
} as const;
