import type { IncomingMessage, ServerResponse } from 'node:http';
import { JSON_CONTENT_TYPE } from '../config';
import { ApiError } from './errors';

export interface ApiResult {
  status: number;
  json?: unknown;
  bytes?: Buffer;
  contentType?: string;
}

export interface Ctx {
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  headers: IncomingMessage['headers'];
  body: Buffer;
  res: ServerResponse;
}

export function jsonResult(status: number, json: unknown): ApiResult {
  return { status, json };
}

export function serializeResult(result: ApiResult): { bytes: Buffer; contentType: string } {
  if (result.bytes) {
    return { bytes: result.bytes, contentType: result.contentType ?? 'application/octet-stream' };
  }
  return {
    bytes: Buffer.from(JSON.stringify(result.json ?? null), 'utf8'),
    contentType: result.contentType ?? JSON_CONTENT_TYPE,
  };
}

export function writeResult(res: ServerResponse, result: ApiResult): void {
  const { bytes, contentType } = serializeResult(result);
  res.writeHead(result.status, {
    'content-type': contentType,
    'content-length': bytes.byteLength,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(bytes);
}

export function writeApiError(res: ServerResponse, error: ApiError): void {
  writeResult(res, { status: error.status, json: error.body() });
}

export function parseJsonBody(body: Buffer): Record<string, unknown> {
  if (body.byteLength === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    throw new ApiError(422, 'validation_failed', 'Send a JSON object.', {
      fields: { body: 'Send a JSON object.' },
    });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError(422, 'validation_failed', 'Send a JSON object.', {
      fields: { body: 'Send a JSON object.' },
    });
  }
  return parsed as Record<string, unknown>;
}

export function headerValue(ctx: Ctx, name: string): string | undefined {
  const raw = ctx.headers[name];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}
