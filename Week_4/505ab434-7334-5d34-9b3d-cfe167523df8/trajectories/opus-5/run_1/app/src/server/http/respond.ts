import type { ServerResponse } from 'node:http';
import { ApiError } from '../errors.js';
import { StorageUnavailable } from '../storage.js';

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  });
  res.end(body);
}

export function sendEmpty(res: ServerResponse, status: number): void {
  res.writeHead(status, { 'cache-control': 'no-store' });
  res.end();
}

export function sendApiError(res: ServerResponse, error: ApiError): void {
  sendJson(res, error.status, { error: error.code, message: error.message });
}

export function sendText(res: ServerResponse, status: number, contentType: string, body: string | Buffer): void {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': buffer.length,
    'cache-control': 'no-store',
  });
  res.end(buffer);
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof StorageUnavailable) {
    return new ApiError(503, 'storage_unavailable', 'Storage is unavailable. Nothing was changed.');
  }
  return new ApiError(500, 'not_found', 'Not found');
}
