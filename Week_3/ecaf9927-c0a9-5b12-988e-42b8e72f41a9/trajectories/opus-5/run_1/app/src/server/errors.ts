import type { ApiErrorBody } from '../shared/api.js';

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error.message);
    this.status = status;
    this.body = body;
  }
}

type ErrorExtras = Omit<ApiErrorBody['error'], 'code' | 'message'>;

function fail(status: number, code: string, message: string, extras: ErrorExtras = {}): ApiError {
  return new ApiError(status, { error: { code, message, ...extras } });
}

export const FIELD_MESSAGES = {
  lengthGrammar: 'Enter a number, optionally followed by mm or in.',
  lengthRange: 'Enter a length greater than 0 and at most 10000 mm.',
  coordinateRange: 'Enter a coordinate from \u221210000 mm to 10000 mm.',
  angle: 'Enter an angle in degrees.',
  tolerance: 'Enter a tolerance like \u00b10.05 or +0.1/\u22120.05.',
  refs: (kindWord: string) => `These entities cannot take a ${kindWord} constraint.`,
  baseRevision: 'Send the revision you started from.',
  idempotencyKey: 'Send an Idempotency-Key header of 1 to 100 visible characters.',
  nameLength: 'Enter a name of 1 to 80 characters.',
  nameTaken: 'That name is already used.',
  quantity: 'Enter a whole number from 1 to 999.',
  declaredMass: 'Enter a mass greater than 0 and at most 100000 g.',
  operation: 'The first extrude makes the body; later extrudes join, cut or intersect.',
  choice: 'Choose one of the listed options.',
  materialId: 'Choose one of the listed materials.',
  component: 'Choose one of the listed components.',
  email: 'Enter your email.',
  password: 'Enter your password.',
} as const;

export const errors = {
  unauthenticated: () => fail(401, 'unauthenticated', 'Sign in to continue.'),
  badCredentials: () => fail(401, 'bad_credentials', 'Email or password is not right.'),
  forbidden: () => fail(403, 'forbidden', 'Only the founder can change this.'),
  notFound: () => fail(404, 'not_found', 'Not found.'),
  crossOrigin: () => fail(403, 'cross_origin', 'Requests from another site are refused.'),
  unsupportedMediaType: () =>
    fail(415, 'unsupported_media_type', 'Send JSON with Content-Type application/json.'),
  payloadTooLarge: () =>
    fail(413, 'payload_too_large', 'Request body is larger than 1,000,000 bytes.'),
  idempotencyConflict: () =>
    fail(409, 'idempotency_conflict', 'This Idempotency-Key was already used for a different request.'),
  overConstrained: (refusedLabel: string, conflictsWith: { id: string; label: string }) =>
    fail(
      409,
      'over_constrained',
      `${refusedLabel} would conflict with ${conflictsWith.label}. Nothing was changed.`,
      { refused_label: refusedLabel, conflicts_with: conflictsWith },
    ),
  unsolvable: () =>
    fail(409, 'unsolvable', 'No shape satisfies every constraint with this value. Nothing was changed.'),
  sketchDrivesFeature: (sketchName: string, featureName: string) =>
    fail(
      409,
      'sketch_drives_feature',
      `${sketchName} drives ${featureName} and must stay fully held. Nothing was changed.`,
    ),
  profileNotReady: (sketchName: string) =>
    fail(
      409,
      'profile_not_ready',
      `${sketchName} needs a closed, fully held profile before it can be extruded.`,
    ),
  emptyBody: (operationWord: string) =>
    fail(409, 'empty_body', `${operationWord} leaves no material. Nothing was changed.`),
  separateBodies: (operationWord: string) =>
    fail(
      409,
      'separate_bodies',
      `${operationWord} would leave separate pieces; a part must be one connected body. Nothing was changed.`,
    ),
  assemblyCycle: (assemblyName: string) =>
    fail(409, 'assembly_cycle', `${assemblyName} cannot contain itself.`),
  noConfirmedBody: (partName: string) =>
    fail(409, 'no_confirmed_body', `${partName} has no stored body yet, so it cannot be placed.`),
  staleRevision: (thing: string, currentRevision: number, savedBy: { id: string; name: string }) =>
    fail(
      412,
      'stale_revision',
      `${savedBy.name} saved ${thing} at revision ${currentRevision} after you opened it. Reload to see their changes.`,
      { current_revision: currentRevision, saved_by: savedBy },
    ),
  invalid: (fields: Record<string, string>) =>
    fail(422, 'invalid', 'Check the highlighted fields.', { fields }),
  storageUnavailable: () => fail(503, 'storage_unavailable', 'Storage is unreachable.'),
};

/** Collects at most one problem per request field, then raises a single 422. */
export class FieldErrors {
  private readonly fields = new Map<string, string>();

  add(field: string, message: string): void {
    if (!this.fields.has(field)) this.fields.set(field, message);
  }

  get empty(): boolean {
    return this.fields.size === 0;
  }

  throwIfAny(): void {
    if (!this.empty) throw errors.invalid(Object.fromEntries(this.fields));
  }
}
