import { ServerResponse } from 'node:http';

export interface ApiError {
  code: string;
  message: string;
  fields?: Record<string, string>;
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

export function empty(res: ServerResponse, status: number): void {
  res.writeHead(status, { 'Content-Length': 0 });
  res.end();
}

export function errorResponse(res: ServerResponse, status: number, code: string, message: string, fields: Record<string, string> = {}): void {
  json(res, status, { error: { code, message, fields } });
}

export const errors = {
  invalidJson(res: ServerResponse): void {
    errorResponse(res, 400, 'INVALID_JSON', 'Send a valid JSON object.');
  },
  authRequired(res: ServerResponse): void {
    errorResponse(res, 401, 'AUTH_REQUIRED', 'Sign in to continue.');
  },
  invalidCredentials(res: ServerResponse): void {
    errorResponse(res, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  },
  notFound(res: ServerResponse): void {
    errorResponse(res, 404, 'NOT_FOUND', 'Harbour record not found.');
  },
  originRefused(res: ServerResponse): void {
    errorResponse(res, 403, 'ORIGIN_REFUSED', "Use this harbour's own page.");
  },
  forbidden(res: ServerResponse): void {
    errorResponse(res, 403, 'FORBIDDEN', "Only this run's owner can share playback.");
  },
  emailExists(res: ServerResponse): void {
    errorResponse(res, 409, 'EMAIL_EXISTS', 'This email already has an account.');
  },
  encounterLocked(res: ServerResponse): void {
    errorResponse(res, 409, 'ENCOUNTER_LOCKED', 'Complete the preceding encounter first.');
  },
  revisionChanged(res: ServerResponse): void {
    errorResponse(res, 409, 'REVISION_CHANGED', 'Reload the saved revision before continuing.');
  },
  invalidTransition(res: ServerResponse): void {
    errorResponse(res, 409, 'INVALID_TRANSITION', "This harbour record can't make that change.");
  },
  evidenceConflict(res: ServerResponse): void {
    errorResponse(res, 409, 'EVIDENCE_CONFLICT', 'This ticket already holds different command evidence.');
  },
  proofRequired(res: ServerResponse): void {
    errorResponse(res, 409, 'PROOF_REQUIRED', 'Verify a victory for this saved revision first.');
  },
  challengeExists(res: ServerResponse): void {
    errorResponse(res, 409, 'CHALLENGE_EXISTS', 'This definition is already published.');
  },
  playbackChanged(res: ServerResponse): void {
    errorResponse(res, 409, 'PLAYBACK_CHANGED', 'Reload shared playback before changing it.');
  },
  commandRefused(res: ServerResponse, reason: string): void {
    errorResponse(res, 422, 'COMMAND_REFUSED', reason);
  },
  invalidFields(res: ServerResponse, fields: Record<string, string>): void {
    errorResponse(res, 422, 'INVALID_FIELDS', 'Check the highlighted fields.', fields);
  },
  jsonRequired(res: ServerResponse): void {
    errorResponse(res, 415, 'JSON_REQUIRED', 'Send application/json.');
  },
  methodRefused(res: ServerResponse): void {
    errorResponse(res, 405, 'METHOD_REFUSED', 'Use a documented method.');
  },
  bodyTooLarge(res: ServerResponse): void {
    errorResponse(res, 413, 'BODY_TOO_LARGE', 'This request exceeds the published byte limit.');
  },
  databaseUnavailable(res: ServerResponse): void {
    errorResponse(res, 503, 'DATABASE_UNAVAILABLE', 'Harbour records unavailable. Try again.');
  },
  evidenceUnavailable(res: ServerResponse): void {
    errorResponse(res, 503, 'EVIDENCE_UNAVAILABLE', 'Replay evidence unavailable. Try again.');
  },
  discoveryUnavailable(res: ServerResponse): void {
    errorResponse(res, 503, 'DISCOVERY_UNAVAILABLE', 'Challenge search unavailable. Try again.');
  },
};

export type ApiErrorName = keyof typeof errors;
