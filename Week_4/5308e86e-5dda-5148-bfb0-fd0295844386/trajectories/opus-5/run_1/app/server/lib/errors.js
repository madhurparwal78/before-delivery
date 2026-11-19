'use strict';

// The one error shape, and the one way of answering errors.

class ApiError extends Error {
  constructor(status, body, headers) {
    super(body && body.error ? body.error : String(status));
    this.status = status;
    this.body = body;
    this.headers = headers || null;
  }
}

const invalidJson = () => new ApiError(400, { error: 'invalid_json' });
const validation = (fields) => new ApiError(400, { error: 'validation', fields });
const unauthorized = () => new ApiError(401, { error: 'unauthorized' });
const forbidden = () => new ApiError(403, { error: 'forbidden' });
const notFound = () => new ApiError(404, { error: 'not_found' });
const methodNotAllowed = (allow) =>
  new ApiError(405, { error: 'method_not_allowed' }, { Allow: allow });
const payloadTooLarge = () => new ApiError(413, { error: 'payload_too_large' });
const unsupportedMediaType = () => new ApiError(415, { error: 'unsupported_media_type' });
const conflict = (code, extra) => new ApiError(409, Object.assign({ error: code }, extra || {}));
const unprocessable = (code) => new ApiError(422, { error: code });
const tooManyRequests = (code) => new ApiError(429, { error: code });
const moneyRefusal = (code) => new ApiError(400, { error: code });
const internal = () => new ApiError(500, { error: 'internal' });
const serviceUnavailable = () => new ApiError(503, { error: 'service_unavailable' });

// A database that cannot be reached answers 503; nothing else leaks out.
const CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
  '57P01',
  '57P02',
  '57P03',
  '08000',
  '08003',
  '08006',
  '08001',
  '08004',
  '53300',
  '3D000',
  '28000',
  '28P01',
]);

function isConnectionFailure(error) {
  if (!error) return false;
  if (error.status === 503) return true;
  const code = error.code || (error.originalError && error.originalError.code);
  if (code && CONNECTION_CODES.has(String(code))) return true;
  const message = String(error.message || '');
  return (
    message.includes('Connection terminated') ||
    message.includes('connection terminated') ||
    message.includes('terminating connection') ||
    message.includes('timeout exceeded when trying to connect') ||
    message.includes('Client has encountered a connection error') ||
    message.includes('Cannot use a pool after calling end') ||
    message.includes('database system is') ||
    message.includes('server closed the connection')
  );
}

module.exports = {
  ApiError,
  invalidJson,
  validation,
  unauthorized,
  forbidden,
  notFound,
  methodNotAllowed,
  payloadTooLarge,
  unsupportedMediaType,
  conflict,
  unprocessable,
  tooManyRequests,
  moneyRefusal,
  internal,
  serviceUnavailable,
  isConnectionFailure,
};
