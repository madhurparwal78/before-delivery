export type ErrorCode =
  | 'INVALID_JSON'
  | 'AUTH_REQUIRED'
  | 'INVALID_CREDENTIALS'
  | 'NOT_FOUND'
  | 'ORIGIN_REFUSED'
  | 'FORBIDDEN'
  | 'EMAIL_EXISTS'
  | 'ENCOUNTER_LOCKED'
  | 'REVISION_CHANGED'
  | 'INVALID_TRANSITION'
  | 'EVIDENCE_CONFLICT'
  | 'PROOF_REQUIRED'
  | 'CHALLENGE_EXISTS'
  | 'PLAYBACK_CHANGED'
  | 'COMMAND_REFUSED'
  | 'INVALID_FIELDS'
  | 'JSON_REQUIRED'
  | 'METHOD_REFUSED'
  | 'BODY_TOO_LARGE'
  | 'DATABASE_UNAVAILABLE'
  | 'EVIDENCE_UNAVAILABLE'
  | 'DISCOVERY_UNAVAILABLE';

interface ErrorSpec {
  status: number;
  message: string;
}

const REGISTRY: Record<ErrorCode, ErrorSpec> = {
  INVALID_JSON: { status: 400, message: 'Send a valid JSON object.' },
  AUTH_REQUIRED: { status: 401, message: 'Sign in to continue.' },
  INVALID_CREDENTIALS: { status: 401, message: 'Email or password is incorrect.' },
  NOT_FOUND: { status: 404, message: 'Harbour record not found.' },
  ORIGIN_REFUSED: { status: 403, message: "Use this harbour's own page." },
  FORBIDDEN: { status: 403, message: "Only this run's owner can share playback." },
  EMAIL_EXISTS: { status: 409, message: 'This email already has an account.' },
  ENCOUNTER_LOCKED: { status: 409, message: 'Complete the preceding encounter first.' },
  REVISION_CHANGED: { status: 409, message: 'Reload the saved revision before continuing.' },
  INVALID_TRANSITION: { status: 409, message: "This harbour record can't make that change." },
  EVIDENCE_CONFLICT: { status: 409, message: 'This ticket already holds different command evidence.' },
  PROOF_REQUIRED: { status: 409, message: 'Verify a victory for this saved revision first.' },
  CHALLENGE_EXISTS: { status: 409, message: 'This definition is already published.' },
  PLAYBACK_CHANGED: { status: 409, message: 'Reload shared playback before changing it.' },
  COMMAND_REFUSED: { status: 422, message: 'Command refused.' },
  INVALID_FIELDS: { status: 422, message: 'Check the highlighted fields.' },
  JSON_REQUIRED: { status: 415, message: 'Send application/json.' },
  METHOD_REFUSED: { status: 405, message: 'Use a documented method.' },
  BODY_TOO_LARGE: { status: 413, message: 'This request exceeds the published byte limit.' },
  DATABASE_UNAVAILABLE: { status: 503, message: 'Harbour records unavailable. Try again.' },
  EVIDENCE_UNAVAILABLE: { status: 503, message: 'Replay evidence unavailable. Try again.' },
  DISCOVERY_UNAVAILABLE: { status: 503, message: 'Challenge search unavailable. Try again.' },
};

export const FIELD_MESSAGE = 'Use a permitted value.';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields: Record<string, string>;

  constructor(code: ErrorCode, fields: Record<string, string> = {}, message?: string) {
    const spec = REGISTRY[code];
    super(message ?? spec.message);
    this.status = spec.status;
    this.code = code;
    this.fields = fields;
  }

  body(): { error: { code: string; message: string; fields: Record<string, string> } } {
    return { error: { code: this.code, message: this.message, fields: this.fields } };
  }
}

export function commandRefused(reason: string): ApiError {
  return new ApiError('COMMAND_REFUSED', {}, reason);
}
