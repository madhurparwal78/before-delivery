import { newRequestId } from './core.js';

export class ApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const errors = {
  payloadTooLarge: () => new ApiError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.'),
  unsupportedMedia: () => new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send Content-Type: application/json.'),
  malformedJson: () => new ApiError(400, 'MALFORMED_JSON', 'The request body is not valid JSON.'),
  appIdRequired: () => new ApiError(400, 'APP_ID_REQUIRED', 'The X-Corvo-Org header is required.'),
  unauthenticated: () => new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue.'),
  invalidCredential: () => new ApiError(401, 'INVALID_CREDENTIAL', 'This credential is no longer valid.'),
  badCredentials: () => new ApiError(401, 'BAD_CREDENTIALS', 'Email or password is incorrect.'),
  appIdMismatch: () => new ApiError(403, 'APP_ID_MISMATCH', 'The app id does not match your organization.'),
  forbiddenRole: (message = 'Your role does not allow this action.') => new ApiError(403, 'FORBIDDEN_ROLE', message),
  validation: (field, message, extra = {}) => new ApiError(422, 'VALIDATION_ERROR', message, { field, ...extra }),
  unknownField: (field) => new ApiError(422, 'UNKNOWN_FIELD', `The field ${field} is not known here.`, { field }),
  invalidPolicy: (path) => new ApiError(422, 'INVALID_POLICY', `The policy is not valid at ${path}.`, { path }),
  notFound: (code, message) => new ApiError(404, code, message),
  conflict: (code, message, details = {}) => new ApiError(409, code, message, details),
  databaseUnavailable: () => new ApiError(503, 'DATABASE_UNAVAILABLE', "Corvo can't reach its database. Nothing was changed. Try again in a moment."),
};

export const NOT_FOUND_CODES = {
  wallet: ['WALLET_NOT_FOUND', 'No wallet with that id.'],
  intent: ['INTENT_NOT_FOUND', 'No intent with that id.'],
  policy: ['POLICY_NOT_FOUND', 'No policy with that id.'],
  quorum: ['QUORUM_NOT_FOUND', 'No key quorum with that id.'],
  member: ['MEMBER_NOT_FOUND', 'No member with that id.'],
  apiKey: ['API_KEY_NOT_FOUND', 'No API key with that id.'],
};

export function envelope(success, data, error, requestId) {
  const body = {
    success,
    data: data ?? null,
    error: error ? { code: error.code, message: error.message, details: error.details ?? {} } : null,
    meta: { request_id: requestId || newRequestId() },
  };
  return JSON.stringify(body);
}

export function jsonResponse(res, status, bodyString, requestId, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(bodyString),
    ...headers,
  });
  res.end(bodyString);
}

export function sendError(res, err, requestId, extraHeaders = {}) {
  const e = err instanceof ApiError ? err : new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong.');
  jsonResponse(res, e.status, envelope(false, null, e, requestId), requestId, extraHeaders);
}

export function sendData(res, status, data, requestId, extraHeaders = {}) {
  jsonResponse(res, status, envelope(true, data, null, requestId), requestId, extraHeaders);
}
