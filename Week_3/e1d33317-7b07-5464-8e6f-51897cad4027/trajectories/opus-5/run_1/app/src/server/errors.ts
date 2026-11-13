import type { PartStatus, Role } from '../shared/types.js';

export type FieldErrors = Record<string, string>;

export interface ErrorExtras {
  errors?: FieldErrors;
  heldBy?: { id: string; name: string; role: Role };
  staffIds?: string[];
  retryAfterSeconds?: number;
  status?: PartStatus;
}

/** Error precedence, applied the same way on every route. */
export const PRECEDENCE: Record<number, number> = {
  413: 1,
  401: 2,
  404: 3,
  403: 4,
  429: 5,
  409: 6,
  410: 6,
  423: 6,
  422: 7,
  415: 8,
  503: 9,
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    override readonly message: string,
    readonly extras: ErrorExtras = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get rank(): number {
    return PRECEDENCE[this.status] ?? 99;
  }

  body(): Record<string, unknown> {
    return { error: this.code, message: this.message, ...this.extras };
  }
}

/** The one place failures become status codes and the single error body. */
export const errors = {
  payloadTooLarge: (): ApiError =>
    new ApiError(413, 'payload_too_large', 'Request bodies are limited to 262,144 bytes.'),
  bankTooLarge: (): ApiError =>
    new ApiError(413, 'too_large', 'Sample banks are limited to 8,000,000 bytes.'),
  unauthorized: (): ApiError =>
    new ApiError(401, 'unauthorized', 'Open your seat link again.'),
  notFound: (): ApiError => new ApiError(404, 'not_found', 'Not found.'),
  forbidden: (): ApiError => new ApiError(403, 'forbidden', 'Your role cannot do this.'),
  forbiddenStaff: (): ApiError =>
    new ApiError(403, 'forbidden', 'You can edit only your own staves.'),
  crossOrigin: (): ApiError =>
    new ApiError(403, 'cross_origin', 'Requests must come from Fairline itself.'),
  rateLimited: (retryAfterSeconds: number): ApiError =>
    new ApiError(429, 'rate_limited', 'Too many edits at once. Waiting to send the rest.', {
      retryAfterSeconds,
    }),
  opConflict: (lamport: number, site: string): ApiError =>
    new ApiError(
      409,
      'op_conflict',
      `Operation ${lamport}@${site} was already recorded with different content.`,
    ),
  staffHeld: (
    holder: { id: string; name: string; role: Role },
    staffNames: string[],
    staffIds: string[],
  ): ApiError =>
    new ApiError(423, 'staff_held', `${holder.name} is holding ${staffNames.join(', ')}.`, {
      heldBy: holder,
      staffIds,
    }),
  holdRequired: (): ApiError =>
    new ApiError(409, 'hold_required', 'Hold this staff before changing it.'),
  notConnected: (): ApiError =>
    new ApiError(409, 'not_connected', 'Open the live session before holding staves.'),
  inviteUsed: (): ApiError =>
    new ApiError(409, 'invite_used', 'This invite has already been used.'),
  inviteRevoked: (): ApiError =>
    new ApiError(410, 'invite_revoked', 'This invite was withdrawn.'),
  alreadyRemoved: (name: string): ApiError =>
    new ApiError(409, 'already_removed', `${name} was already removed.`),
  cannotRemoveComposer: (): ApiError =>
    new ApiError(409, 'cannot_remove_composer', 'The composer cannot be removed.'),
  partBusy: (name: string, status: PartStatus): ApiError =>
    new ApiError(409, 'part_busy', `${name} is already being extracted.`, { status }),
  pdfNotReady: (name: string, status: PartStatus): ApiError =>
    new ApiError(409, 'pdf_not_ready', `The PDF for ${name} is not ready.`, { status }),
  validation: (fields: FieldErrors): ApiError =>
    new ApiError(422, 'validation', 'Check the highlighted fields.', { errors: fields }),
  unsupportedType: (): ApiError =>
    new ApiError(415, 'unsupported_type', 'Upload a WAV (RIFF/WAVE) or SFZ file.'),
  storageUnavailable: (): ApiError =>
    new ApiError(503, 'storage_unavailable', 'Storage is unavailable. Nothing was saved.'),
  databaseUnavailable: (): ApiError =>
    new ApiError(
      503,
      'database_unavailable',
      'The score database is unavailable. Try again shortly.',
    ),
};
