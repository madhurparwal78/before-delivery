export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const unauthenticated = () => new ApiError(401, 'unauthenticated', 'Sign in to continue.');
export const notFound = () => new ApiError(404, 'not_found', 'Not found');
export const forbidden = () => new ApiError(403, 'forbidden', "You can't do that.");
export const crossOrigin = () => new ApiError(403, 'cross_origin', 'Requests must come from this site.');
export const methodNotAllowed = () =>
  new ApiError(405, 'method_not_allowed', 'The audit log cannot be changed.');

export const wrongStateRequest = (id: string, stateLabel: string) =>
  new ApiError(409, 'wrong_state', `${id} is already ${stateLabel}.`);
export const wrongStateGrant = (id: string, statusLabel: string) =>
  new ApiError(409, 'wrong_state', `${id} is ${statusLabel}.`);
export const wrongStateAsset = (name: string, state: string) =>
  new ApiError(409, 'wrong_state', `${name} is ${state}.`);
export const wrongStateVersion = (n: number, stateWord: string) =>
  new ApiError(409, 'wrong_state', `Version ${n} is ${stateWord}.`);
export const alreadyDecided = (name: string, decisionLabel: string) =>
  new ApiError(409, 'already_decided', `Already decided by ${name}: ${decisionLabel}.`);
export const withdrawnBy = (id: string, name: string) =>
  new ApiError(409, 'withdrawn', `${id} was withdrawn by ${name}.`);
export const notRequestable = (cardName: string, reason: string) =>
  new ApiError(409, 'not_requestable', `${cardName} cannot be requested: ${reason}`);
export const duplicateOpenRequest = (id: string) =>
  new ApiError(409, 'duplicate_open_request', `You already have ${id} open.`);
export const idempotencyConflict = () =>
  new ApiError(409, 'idempotency_conflict', 'This submission key was already used for a different request.');
export const staleVersion = () =>
  new ApiError(409, 'stale_version', 'This draft changed since you opened it. Reload to see the latest.');
export const openVersion = (n: number) => new ApiError(409, 'open_version', `Version ${n} is already open.`);
export const publishBlocked = (n: number, parts: string[]) =>
  new ApiError(409, 'publish_blocked', `Cannot publish version ${n}: ${parts.join(', ')}.`);
export const alreadyRegistered = (email: string) =>
  new ApiError(409, 'already_registered', `${email} already has an account.`);
export const seedConflict = () => new ApiError(409, 'seed_conflict', 'Reset before seeding.');
export const invitationInvalid = () =>
  new ApiError(410, 'invitation_invalid', 'This invitation link is no longer valid.');
export const linkExpired = () => new ApiError(410, 'link_expired', 'This link has expired.');

export const invalidBody = () => new ApiError(422, 'invalid_body', 'Request body is not valid JSON.');
export const invalidCredentials = () =>
  new ApiError(422, 'invalid_credentials', 'Email or password is incorrect.');
export const emailInvalid = () => new ApiError(422, 'email_invalid', 'Enter a valid email address.');
export const weakPassword = () =>
  new ApiError(422, 'weak_password', 'Password must be at least 12 characters.');
export const applicationProhibited = (label: string) =>
  new ApiError(422, 'application_prohibited', `${label} use is not permitted by this licence.`);
export const territoryInvalid = (codes: string) =>
  new ApiError(422, 'territory_invalid', `Territories must be within your engagement: ${codes}.`);
export const campaignDates = () =>
  new ApiError(422, 'campaign_dates', 'Campaign end must be on or after its start.');
export const rulesRequired = () => new ApiError(422, 'rules_required', 'Cite at least one rule.');
export const ruleUnknown = (identifier: string) =>
  new ApiError(422, 'rule_unknown', `${identifier} is not a live rule.`);
export const noteTooLong = () =>
  new ApiError(422, 'note_too_long', 'Note must be 2,000 characters or fewer.');
export const reasonRequired = () => new ApiError(422, 'reason_required', 'Give a reason.');
export const commentRequired = () => new ApiError(422, 'comment_required', 'Say what needs to change.');
export const conditionInvalidClearSpace = () =>
  new ApiError(422, 'condition_invalid', 'Clear space must be 0.5, 1, 1.5 or 2.');
export const conditionInvalidAttribution = () =>
  new ApiError(422, 'condition_invalid', 'Attribution needs a credit line.');
export const conditionInvalidTerritory = () =>
  new ApiError(422, 'condition_invalid', 'Territory needs at least one country code.');
export const conditionInvalidExpiry = () =>
  new ApiError(422, 'condition_invalid', 'Expiry override needs a date as YYYY-MM-DD.');
export const proofType = () =>
  new ApiError(422, 'proof_type', 'Proof must be a PNG, JPEG or PDF file.');
export const derivativeType = () =>
  new ApiError(422, 'derivative_type', 'Derivative must be a PNG or SVG file.');
export const noDerivatives = (name: string) =>
  new ApiError(422, 'no_derivatives', `Cannot release: ${name} has no derivatives.`);
export const successorInvalid = () =>
  new ApiError(422, 'successor_invalid', 'Choose a released successor asset.');
export const identifierInvalid = (identifier: string) =>
  new ApiError(422, 'identifier_invalid', `${identifier} is not a valid rule identifier.`);
export const identifierPrefix = (identifier: string, slug: string) =>
  new ApiError(422, 'identifier_prefix', `${identifier} must start with ${slug}.`);
export const identifierDuplicate = (identifier: string) =>
  new ApiError(422, 'identifier_duplicate', `${identifier} appears twice.`);
export const identifierMissing = () =>
  new ApiError(422, 'identifier_missing', 'Every statement needs a rule identifier.');
export const replacementMissing = (identifier: string) =>
  new ApiError(422, 'replacement_missing', `${identifier} was removed without a replacement.`);
export const seedInvalid = (path: string, problem: string) =>
  new ApiError(422, 'seed_invalid', `${path}: ${problem}`);
export const proofTooLarge = (mb: string) =>
  new ApiError(413, 'proof_too_large', `Proof must be ${mb} MB or smaller.`);
export const tooLarge = () => new ApiError(413, 'too_large', 'Request body is too large.');

export const storageProof = () =>
  new ApiError(503, 'storage_unavailable', 'Proof storage is unavailable. Your request is unchanged.');
export const storageDownload = () =>
  new ApiError(503, 'storage_unavailable', 'Downloads are unavailable right now.');
export const storageChanges = () =>
  new ApiError(503, 'storage_unavailable', 'Storage is unavailable. Nothing was changed.');

export const notStageHolder = (name: string) =>
  new ApiError(403, 'not_stage_holder', `Only ${name} or an owner can decide this stage.`);
