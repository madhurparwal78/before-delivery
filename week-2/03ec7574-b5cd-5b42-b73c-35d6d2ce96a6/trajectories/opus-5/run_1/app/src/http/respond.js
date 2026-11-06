import { requestId as newRequestId } from '../domain/ids.js';
import { DatabaseUnavailableError } from '../db/pool.js';
import { ApiError } from './errors.js';

/** The envelope's first three members, serialised once so replays answer byte for byte. */
export function envelopeHead({ success, data, error }) {
  return JSON.stringify({ success, data, error });
}

export function envelopeBody(head, requestId) {
  return `${head.slice(0, -1)},"meta":{"request_id":"${requestId}"}}`;
}

export function successHead(data) {
  return envelopeHead({ success: true, data: data ?? {}, error: null });
}

export function errorHead(error) {
  return envelopeHead({
    success: false,
    data: null,
    error: { code: error.code, message: error.message, details: error.details || {} }
  });
}

export function toApiError(error) {
  if (error instanceof ApiError) return error;
  if (error instanceof DatabaseUnavailableError) return new ApiError('DATABASE_UNAVAILABLE');
  return new ApiError('INTERNAL_ERROR');
}

export function writeApiResponse(response, { status, head, headers = {} }) {
  const requestId = newRequestId();
  const body = envelopeBody(head, requestId);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  response.end(body);
}
